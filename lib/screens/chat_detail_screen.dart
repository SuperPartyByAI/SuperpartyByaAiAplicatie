import 'dart:async';
import 'dart:convert';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'dart:io';
import 'dart:typed_data';
import 'dart:math';
import 'package:image_picker/image_picker.dart';
import 'package:mime/mime.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:bubble/bubble.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:intl/intl.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import 'package:flutter_linkify/flutter_linkify.dart';
import '../services/backend_service.dart';
import '../services/auth_service.dart';
import '../services/supabase_service.dart';

class ChatDetailScreen extends StatefulWidget {
  final String conversationId; // Renamed from jid for clarity (Hybrid Model)
  final String? name;

  const ChatDetailScreen({super.key, required this.conversationId, this.name});

  @override
  State<ChatDetailScreen> createState() => _ChatDetailScreenState();
}

class _ChatDetailScreenState extends State<ChatDetailScreen> {
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final FocusNode _focusNode = FocusNode();

  // Supabase state
  Map<String, dynamic>? _conversation;
  List<Map<String, dynamic>> _messages = [];
  bool _loadingMessages = true;
  bool _isLoadingMore = false;
  bool _hasMore = true;
  static const int _pageSize = 60;
  String? _loadError;
  Timer? _pollTimer;

  @override
  void dispose() {
    _pollTimer?.cancel();
    _controller.dispose();
    _scrollController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _loadData();
    _pollTimer = Timer.periodic(const Duration(seconds: 8), (_) => _pollNewMessages());
    _scrollController.addListener(_onScroll);
  }

  void _onScroll() {
    // Load more when user scrolls close to the top
    if (_scrollController.hasClients &&
        _scrollController.position.pixels < 200 &&
        !_isLoadingMore &&
        _hasMore) {
      _loadMoreMessages();
    }
  }

  /// Returns true if user is within 150px of the bottom (index 0 when reversed)
  bool _isNearBottom() {
    if (!_scrollController.hasClients) return true;
    final pos = _scrollController.position;
    return pos.pixels < 150;
  }

  void _scrollToBottom({bool animate = true}) {
    if (!_scrollController.hasClients) return;
    if (animate) {
      _scrollController.animateTo(
        0.0,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    } else {
      _scrollController.jumpTo(0.0);
    }
  }

  /// Poll only for new messages (since last message timestamp) - lightweight
  Future<void> _pollNewMessages() async {
    if (_messages.isEmpty) { await _loadMessages(); return; }
    try {
      final lastTs = _messages.last['timestamp'] as int? ?? 0;
      final newMsgs = await SupabaseService.select(
        'messages',
        select: 'id,conversation_id,text,from_me,timestamp,type,media_url,mimetype,push_name',
        filters: {
          'conversation_id': 'like.%${widget.conversationId}%',
          'timestamp': 'gt.$lastTs',
        },
        order: 'timestamp.asc.nullslast',
        limit: 30,
      );
      if (mounted && newMsgs.isNotEmpty) {
        final existingIds = _messages.map((m) => m['id']).toSet();
        final fresh = newMsgs.where((m) => !existingIds.contains(m['id'])).toList();
        if (fresh.isNotEmpty) {
          final wasNearBottom = _isNearBottom();
          setState(() => _messages = [..._messages, ...fresh]);
          // Only auto-scroll if user was already at the bottom
          if (wasNearBottom) {
            WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
          }
        }
      }
    } catch (_) {}
  }

  /// Load older messages (scroll-up pagination)
  Future<void> _loadMoreMessages() async {
    if (_isLoadingMore || !_hasMore) return;
    setState(() => _isLoadingMore = true);
    try {
      final oldestTs = _messages.first['timestamp'] as int? ?? 9999999999;
      final older = await SupabaseService.select(
        'messages',
        select: 'id,conversation_id,text,from_me,timestamp,type,media_url,mimetype,push_name',
        filters: {
          'conversation_id': 'like.%${widget.conversationId}%',
          'timestamp': 'lt.$oldestTs',
        },
        order: 'timestamp.desc.nullslast',
        limit: _pageSize,
      );
      if (mounted) {
        final reversed = older.reversed.toList();
        setState(() {
          _messages = [...reversed, ..._messages];
          _hasMore = older.length >= _pageSize;
          _isLoadingMore = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isLoadingMore = false);
    }
  }

  Future<void> _loadData() async {
    await Future.wait([_loadConversation(), _loadMessages()]);
  }

  Future<void> _loadConversation() async {
    try {
      try {
        // Attempt secure RPC first (Security Definer on backend)
        final res = await Supabase.instance.client.rpc('get_conversation', params: {'p_conv_id': widget.conversationId}).single();
        if (mounted) setState(() => _conversation = res);
      } catch (rpcError) {
        // Fallback to direct table read if RPC is not yet created
        debugPrint('RPC fallback triggered: $rpcError');
        final conv = await SupabaseService.getById(
          'conversations',
          id: widget.conversationId,
          select: 'id,name,jid,phone,photo_url,assigned_employee_id,assigned_employee_name,account_label',
        );
        if (mounted) setState(() => _conversation = conv);
      }
    } catch (e) {
      debugPrint('Supabase conv error: $e');
    }
  }

  Future<void> _loadMessages() async {
    try {
      final msgs = await SupabaseService.getMessages(widget.conversationId, limit: _pageSize);
      if (mounted) {
        setState(() {
          _messages = msgs;
          _loadingMessages = false;
          _hasMore = msgs.length >= _pageSize;
        });
        WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
      }
    } catch (e) {
      if (mounted) setState(() { _loadError = e.toString(); _loadingMessages = false; });
    }
  }



  Uint8List? _tryDecodeBase64(String? data) {
    if (data == null || data.isEmpty) return null;
    try {
      return base64Decode(data);
    } catch (_) {
      return null;
    }
  }

  // --- Avatar tap handler: show real phone only for special email ---
  Future<void> _onAvatarTap(BuildContext context) async {
    final authService = Provider.of<AuthService>(context, listen: false);
    final userEmail = authService.currentUser?.email?.toLowerCase();
    const allowedEmail = 'ursache.andrei1995@gmail.com';

    final showRealNumber = (userEmail != null && userEmail == allowedEmail);
    final phone = (_conversation?['phone'] ?? '').toString();
    final waName = (_conversation?['client_display_name'] ?? widget.name ?? '').toString();

    debugPrint('[AvatarTap] userEmail=$userEmail showRealNumber=$showRealNumber');
    debugPrint('[AvatarTap] phone=$phone waName=$waName');

    final content = showRealNumber ? (phone.isNotEmpty ? phone : 'Număr indisponibil') : (waName.isNotEmpty ? waName : 'Nume WhatsApp indisponibil');

    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(showRealNumber ? 'Număr client' : 'Nume WhatsApp'),
        content: SelectableText(content),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Închide')),
          if (showRealNumber && phone.isNotEmpty)
            TextButton(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: phone));
                Navigator.of(ctx).pop();
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Număr copiat în clipboard')));
              },
              child: const Text('Copiază'),
            ),
          if (showRealNumber && phone.isNotEmpty)
            TextButton(
              onPressed: () async {
                final uri = Uri.parse('tel:$phone');
                if (await canLaunchUrl(uri)) {
                  await launchUrl(uri);
                } else {
                  if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Nu pot iniția apel')));
                }
                if (ctx.mounted) Navigator.of(ctx).pop();
              },
              child: const Text('Sună'),
            ),
        ],
      ),
    );
  }

  // NOTE: Schema for messages in Database:
  // direction, text, timestamp, type, hasMedia, etc.

  @override
  Widget build(BuildContext context) {
    final authService = Provider.of<AuthService>(context, listen: false);
    final myUid = authService.currentUser?.id;

    return Scaffold(
      resizeToAvoidBottomInset: true,
      appBar: AppBar(
        backgroundColor: const Color(0xFF008069),
        foregroundColor: Colors.white,
        titleSpacing: 0,
        title: Builder(builder: (context) {
            String displayName = (widget.name?.split('@')[0]) ?? widget.conversationId.split('@')[0];
            String? photoUrl;
            
            if (_conversation != null) {
               final data = _conversation!;
               // Enforce Client N explicitly across the UI
               if ((data['client_display_name']?.toString() ?? '').isNotEmpty) {
                 displayName = data['client_display_name'];
               } else if ((data['client_display_name']?.toString() ?? '').isNotEmpty) {
                 displayName = data['client_display_name'];
               }
               photoUrl = data['photo_url'];
            }

            return Row(
              children: [
                GestureDetector(
                  onTap: () => _onAvatarTap(context),
                  child: CircleAvatar(
                    radius: 16,
                    backgroundColor: Colors.grey[300],
                    backgroundImage: (photoUrl != null && photoUrl.isNotEmpty) ? NetworkImage(photoUrl) : null,
                    child: (photoUrl == null || photoUrl.isEmpty) ? const Icon(Icons.person, size: 20, color: Colors.white) : null,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    displayName,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 16),
                  ),
                ),
              ],
            );
          }),
        actions: [
          IconButton(
            icon: const Icon(Icons.keyboard),
            onPressed: () async {
              // ... existing logic ...
              // 1. Visual Feedback
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('DEBUG: Requesting Focus & Ping...'), duration: Duration(milliseconds: 500)),
              );

              // 2. Force Focus
              if (!_focusNode.hasFocus) {
                FocusScope.of(context).requestFocus(_focusNode);
              }
              
              // 3. Force System Keyboard (Android specific mostly)
              await SystemChannels.textInput.invokeMethod('TextInput.show');

              // 4. Test Network Ping
              try {
                final service = Provider.of<BackendService>(context, listen: false);
                await http.get(Uri.parse('${BackendService.BASE_URL.replaceFirst('/api', '')}/status'));
                 ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('DEBUG: Ping OK'), backgroundColor: Colors.green),
                );
              } catch (e) {
                 ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('DEBUG: Ping Failed: $e'), backgroundColor: Colors.red),
                );
              }
            },
          )
        ],
      ),
      body: Builder(builder: (context) {
          final data = _conversation;
          final assignedId = data?['assigned_employee_id'];
          final assignedName = data?['assigned_employee_name'] ?? 'Another Agent';

          bool canType = true;
          Widget banner = const SizedBox.shrink();

          if (assignedId == null) {
            banner = const SizedBox.shrink(); 
          } else if (assignedId == myUid) {
            banner = Container(
              width: double.infinity,
              color: Colors.green[100],
              padding: const EdgeInsets.all(4.0),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.check_circle, size: 16, color: Colors.green),
                  const SizedBox(width: 8),
                  const Text('Reserved by You', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold)),
                  const Spacer(),
                  TextButton(
                    onPressed: () async {
                       try {
                        await Provider.of<BackendService>(context, listen: false).unassignConversation(widget.conversationId);
                      } catch (e) {
                         ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to unassign: $e')));
                      }
                    }, 
                    child: const Text('Release', style: TextStyle(fontSize: 12))
                  )
                ],
              ),
            );
          } else {
            canType = true; 
            banner = Container(
              width: double.infinity,
              color: Colors.grey[300],
              padding: const EdgeInsets.all(8.0),
              child: Center(
                child: Text(
                  'Reserved by $assignedName', 
                  style: const TextStyle(color: Colors.black54, fontWeight: FontWeight.bold)
                )
              ),
            );
          }

          return Column(
            children: [
              banner,
              Expanded(
                child: _buildMessagesList(),
              ),
              ChatInput(
                canType: canType,
                focusNode: _focusNode,
                controller: _controller,
                onSend: (text) => _sendMessageInternal(text),
                onAttach: () => _pickAndSendImage(),
              ),
            ],
          );
        }),
    );
  }

  // Helper wrapper to match signature
  bool _isSendingMedia = false;

  Future<void> _pickAndSendImage() async {
    final picker = ImagePicker();

    // Show bottom sheet: Camera, Gallery, or Document
    final source = await showModalBottomSheet<String>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt, color: Color(0xFF008069)),
              title: const Text('Camera'),
              onTap: () => Navigator.pop(ctx, 'camera'),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library, color: Color(0xFF008069)),
              title: const Text('Galerie'),
              onTap: () => Navigator.pop(ctx, 'gallery'),
            ),
            ListTile(
              leading: const Icon(Icons.insert_drive_file, color: Color(0xFF008069)),
              title: const Text('Document (PDF, etc.)'),
              onTap: () => Navigator.pop(ctx, 'document'),
            ),
          ],
        ),
      ),
    );

    if (source == null) return;

    String? filePath;
    String mimeType = 'application/octet-stream'; // Default fallback

    if (source == 'document') {
    try {
      debugPrint('DEBUG: Calling FilePicker...');
      FilePickerResult? result = await FilePicker.platform.pickFiles(
        type: FileType.any,
      );
      
      if (result == null) {
        debugPrint('DEBUG: FilePicker returned null (user canceled)');
        return;
      }
      
      if (result.files.single.path == null) {
        debugPrint('DEBUG: FilePicker path is null! File might be in cloud storage.');
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Eroare: Fisierul nu poate fi citit direct (Cloud/Drive). Încearcă să-l descarci local.'), backgroundColor: Colors.orange),
          );
        }
        return;
      }
      
      filePath = result.files.single.path!;
      debugPrint('DEBUG: FilePicker path retrieved: $filePath');
      mimeType = lookupMimeType(filePath) ?? 'application/pdf'; // Try to deduce, otherwise fallback to pdf
    } catch (e) {
      debugPrint('DEBUG: FilePicker exception: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Eroare FilePicker: $e'), backgroundColor: Colors.red),
        );
      }
      return;
    }
  } else {
      final ImageSource imgSource = source == 'camera' ? ImageSource.camera : ImageSource.gallery;
      final XFile? picked = await picker.pickImage(
        source: imgSource,
        maxWidth: 1920,
        maxHeight: 1920,
        imageQuality: 80,
      );
      if (picked == null) return;
      filePath = picked.path;
      mimeType = lookupMimeType(filePath) ?? 'image/jpeg';
    }

    if (filePath == null) return;

    setState(() => _isSendingMedia = true);

    try {
      final service = Provider.of<BackendService>(context, listen: false);
      await service.sendMediaMessage(widget.conversationId, filePath, mimeType);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
           SnackBar(content: Text(source == 'document' ? '📄 Document trimis!' : '📸 Imagine trimisă!'), backgroundColor: const Color(0xFF008069)),
        );
      }
    } catch (e) {
      debugPrint('DEBUG: Send media failed: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Eroare: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isSendingMedia = false);
    }
  }

  Future<void> _sendMessageInternal(String text) async {
      await _sendMessage(text);
  }
   Future<void> _sendMessage(String text) async {
    if (text.isEmpty) return;
    try {
      debugPrint('DEBUG: Attempting to send message to ${widget.conversationId}: "$text"');
      final service = Provider.of<BackendService>(context, listen: false);
      await service.sendMessage(widget.conversationId, text);
      debugPrint('DEBUG: Message sent successfully!');
    } catch (e) {
      debugPrint('DEBUG: Send failed: $e');
      if (mounted) {
        String message = 'Failed to send message';
        final errorStr = e.toString().replaceAll('Exception: ', '');
        try {
          final errJson = jsonDecode(errorStr);
          if (errJson['error'] != null) {
            message = errJson['error'];
          }
        } catch (_) {
          message = errorStr;
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(message),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }


  String _formatMessageTime(DateTime ts) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final msgDay = DateTime(ts.year, ts.month, ts.day);

    if (msgDay == today) {
      return DateFormat('HH:mm').format(ts); // azi: doar ora
    } else if (today.difference(msgDay).inDays < 7) {
      return DateFormat('EEE HH:mm', 'en_US').format(ts); // în ultima săptămână: Mon 14:05
    } else {
      return DateFormat('dd MMM yyyy HH:mm').format(ts); // altfel: 01 Jan 2024 14:05
    }
  }

  Widget _buildDateSeparator(DateTime date) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(
            color: Colors.grey.shade300,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(DateFormat('EEEE, dd MMM yyyy').format(date), style: const TextStyle(fontSize: 12, color: Colors.black54)),
        ),
      ),
    );
  }

  /// Resolve media URL: prefer media.url (public permanent), fallback to legacy mediaUrl
  String? _resolveMediaUrl(Map<String, dynamic> data) {
    // 1. Structured media{} from Supabase Storage — use public URL
    final media = data['media'];
    if (media is Map && media['url'] != null && (media['url'] as String).isNotEmpty) {
      return media['url'] as String;
    }
    // 2. Flat mediaUrl field (actual schema from backend)
    final mediaUrl = data['mediaUrl'];
    if (mediaUrl is String && mediaUrl.isNotEmpty) {
      if (mediaUrl.startsWith('http')) return mediaUrl;
      final base = BackendService.BASE_URL.replaceFirst('/api', '');
      return '$base$mediaUrl';
    }
    return null;
  }

  /// Detect MIME type from structured media or legacy field
  String _resolveMime(Map<String, dynamic> data) {
    // Flat mimetype field (actual schema)
    if (data['mimetype'] != null && (data['mimetype'] as String).isNotEmpty) {
      return data['mimetype'] as String;
    }
    final media = data['media'];
    if (media is Map && media['mime'] != null) return media['mime'] as String;
    return '';
  }

  /// Build media widget for a message bubble
  Widget _buildMediaWidget(Map<String, dynamic> data, bool isMe) {
    final mime = _resolveMime(data);
    var mediaUrl = _resolveMediaUrl(data);
    // Has media if mediaUrl is non-null or mime is set
    final hasMedia = mediaUrl != null || (mime.isNotEmpty && mime != 'text/plain');

    if (!hasMedia) return const SizedBox.shrink();

    // Image
    if (mime.startsWith('image/')) {
        
      // 1. Prevent crashes on Encrypted WhatsApp CDNs
      if (mediaUrl?.contains('.enc') == true) {
        return _mediaPlaceholder(Icons.lock_outline, 'Encrypted Image', data);
      }

      // 2. Resolve Signed URLs for Server storage
      bool needsSignedUrl = mediaUrl == null || 
                            mediaUrl.startsWith('/media/') || 
                            mediaUrl.contains('whatsapp.net') || 
                            (mediaUrl.contains('.enc') == true);
      
      if (needsSignedUrl) {
         final service = Provider.of<BackendService>(context, listen: false);
         final msgId = data['id']; // This is standard Supabase message ID

         return FutureBuilder<String?>(
           future: service.getSignedMediaUrl(widget.conversationId, msgId),
           builder: (ctx, snap) {
             if (snap.connectionState == ConnectionState.waiting) {
               return const SizedBox(
                 width: 220, height: 150,
                 child: Center(child: CircularProgressIndicator()),
               );
             }
             if (snap.hasError || !snap.hasData || snap.data == null) {
                // We fallback to original mediaUrl if getSignedMediaUrl returns null or errors.
                // If mediaUrl is strictly null or relative, then error out.
                if (mediaUrl == null || mediaUrl.startsWith('/media/') || mediaUrl.contains('.enc')) {
                  return _mediaPlaceholder(Icons.broken_image, 'URL Expired', data);
                }
             }
             
             final signedUrl = snap.data ?? mediaUrl!;
             
             return Padding(
               padding: const EdgeInsets.only(bottom: 6.0),
               child: GestureDetector(
                 onTap: () => _showFullScreenImage(context, signedUrl),
                 child: ClipRRect(
                   borderRadius: BorderRadius.circular(8),
                   child: Image.network(
                     signedUrl,
                     width: 220,
                     cacheWidth: 800, // <--- CRITICAL OOM FIX: Prevent full 4K decode
                     fit: BoxFit.cover,
                     loadingBuilder: (ctx, child, progress) {
                       if (progress == null) return child;
                       return SizedBox(
                         width: 220, height: 150,
                         child: Center(child: CircularProgressIndicator(
                           value: progress.expectedTotalBytes != null
                             ? progress.cumulativeBytesLoaded / progress.expectedTotalBytes!
                             : null,
                         )),
                       );
                     },
                     errorBuilder: (ctx, err, st) => const SizedBox(
                       width: 220, height: 100,
                       child: Center(child: Icon(Icons.broken_image, size: 50, color: Colors.grey)),
                     ),
                   ),
                 ),
               ),
             );
           }
         );
      }

      // Absolute URL fallback
      if (mediaUrl != null) {
        return Padding(
          padding: const EdgeInsets.only(bottom: 6.0),
          child: GestureDetector(
            onTap: () => _showFullScreenImage(context, mediaUrl!),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.network(
                mediaUrl,
                width: 220,
                cacheWidth: 800, // <--- CRITICAL OOM FIX: Prevent full 4K decode
                fit: BoxFit.cover,
                loadingBuilder: (ctx, child, progress) {
                  if (progress == null) return child;
                  return SizedBox(
                    width: 220, height: 150,
                    child: Center(child: CircularProgressIndicator(
                      value: progress.expectedTotalBytes != null
                        ? progress.cumulativeBytesLoaded / progress.expectedTotalBytes!
                        : null,
                    )),
                  );
                },
                errorBuilder: (ctx, err, st) => const SizedBox(
                  width: 220, height: 100,
                  child: Center(child: Icon(Icons.broken_image, size: 50, color: Colors.grey)),
                ),
              ),
            ),
          ),
        );
      }
      // No URL yet (needs signed URL) — show placeholder
      return _mediaPlaceholder(Icons.image, 'Photo', data);
    }

    // Audio
    if (mime.startsWith('audio/')) {
      if (mediaUrl != null) {
        return AudioPlayerWidget(url: mediaUrl, isMe: isMe);
      }
      return _mediaPlaceholder(Icons.audiotrack, 'Audio', data);
    }

    // Video
    if (mime.startsWith('video/')) {
      if (mediaUrl != null) {
        return _mediaPlaceholder(Icons.play_circle_fill, 'Video', data);
      }
      return _mediaPlaceholder(Icons.videocam, 'Video', data);
    }

    // Document / other
    final media = data['media'];
    final fileName = (media is Map ? media['name'] : null) ?? 'Document';
    final sizeBytes = (media is Map ? media['size'] : null);
    final sizeStr = sizeBytes is num ? '${(sizeBytes / 1024).toStringAsFixed(1)} KB' : '';
    
    return GestureDetector(
      onTap: () async {
        if (mediaUrl != null) {
          final uri = Uri.parse(mediaUrl);
          // Always use standard launch protocol for documents to hand off to OS Viewer
          try {
            // ignore: deprecated_member_use
            await launch(mediaUrl);
          } catch (e) {
            debugPrint('Could not launch $mediaUrl: $e');
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Eroare la deschiderea fisierului!'), backgroundColor: Colors.red),
              );
            }
          }
        }
      },
      child: Container(
        width: 220,
        padding: const EdgeInsets.all(10),
        margin: const EdgeInsets.only(bottom: 6),
        decoration: BoxDecoration(
          color: isMe ? Colors.green[100] : Colors.grey[100],
          borderRadius: BorderRadius.circular(8),
        ),
      child: Row(
        children: [
          const Icon(Icons.insert_drive_file, size: 32, color: Colors.blue),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(fileName, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500), maxLines: 1, overflow: TextOverflow.ellipsis),
                if (sizeStr.isNotEmpty) Text(sizeStr, style: TextStyle(fontSize: 11, color: Colors.grey[600])),
                Text(mime.split('/').last.toUpperCase(), style: TextStyle(fontSize: 10, color: Colors.grey[500])),
              ],
            ),
          ),
        ],
      ),
    ));
  }

  /// Placeholder for media that needs signed URL or can't be displayed inline
  Widget _mediaPlaceholder(IconData icon, String label, Map<String, dynamic> data) {
    return Container(
      width: 220, height: 80,
      margin: const EdgeInsets.only(bottom: 6),
      decoration: BoxDecoration(
        color: Colors.grey[200],
        borderRadius: BorderRadius.circular(8),
      ),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 32, color: Colors.grey[600]),
            const SizedBox(height: 4),
            Text(label, style: TextStyle(fontSize: 12, color: Colors.grey[600])),
          ],
        ),
      ),
    );
  }

  /// Show full-screen image viewer
  void _showFullScreenImage(BuildContext context, String url) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, elevation: 0),
        body: Center(
          child: InteractiveViewer(
            child: Image.network(url, fit: BoxFit.contain,
              errorBuilder: (_, __, ___) => const Icon(Icons.broken_image, size: 100, color: Colors.white54),
            ),
          ),
        ),
      ),
    ));
  }

  Widget _buildMessagesList() {
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onTap: () => FocusScope.of(context).unfocus(),
      child: Container(
        color: const Color(0xFFE5DDD5),
        child: Builder(builder: (context) {
          if (_loadingMessages) {
            return const Center(child: CircularProgressIndicator());
          }
          if (_loadError != null) {
            return Center(child: Text('Eroare: $_loadError', style: const TextStyle(color: Colors.red)));
          }
          if (_messages.isEmpty) {
            return Center(child: Text('Niciun mesaj', style: TextStyle(color: Colors.grey[600])));
          }

          return ListView.builder(
            reverse: true, // Anchor to bottom
            controller: _scrollController,
            padding: const EdgeInsets.all(8),
            itemCount: _messages.length + (_isLoadingMore ? 1 : 0),
            itemBuilder: (context, index) {
              // The loading indicator goes at the top (end of the reversed list)
              if (_isLoadingMore && index == _messages.length) {
                return const Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(child: SizedBox(
                    width: 20, height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )),
                );
              }
              // Map visual index 0 (bottom) to _messages.last (newest)
              final msgIndex = _messages.length - 1 - index;
              final data = _messages[msgIndex];

              // from_me: bool in Supabase
              final isMe = data['from_me'] == true;
              final text = data['text'] ?? '';

              DateTime time = DateTime.now();
              final ts = data['timestamp'];
              if (ts is int) {
                time = DateTime.fromMillisecondsSinceEpoch(ts * 1000);
              } else if (ts is String) {
                try { time = DateTime.parse(ts); } catch (_) {}
              }

              final msgDay = DateTime(time.year, time.month, time.day);
              
              bool showDateSeparator = false;
              if (msgIndex == 0) {
                showDateSeparator = true;
              } else {
                final prevTs = _messages[msgIndex - 1]['timestamp'];
                DateTime prevTime = DateTime.now();
                if (prevTs is int) prevTime = DateTime.fromMillisecondsSinceEpoch(prevTs * 1000);
                else if (prevTs is String) try { prevTime = DateTime.parse(prevTs); } catch (_) {}
                final prevDay = DateTime(prevTime.year, prevTime.month, prevTime.day);
                showDateSeparator = msgDay != prevDay;
              }

              Widget dateSeparator = const SizedBox.shrink();
              if (showDateSeparator) {
                dateSeparator = _buildDateSeparator(msgDay);
              }

              // Build Supabase-compatible data map for existing media helpers
              final compat = <String, dynamic>{
                ...data,
                'fromMe': isMe,
                'mediaUrl': data['media_url'],
                'mimetype': data['mimetype'],
              };

              return Column(
                children: [
                  dateSeparator,
                  Bubble(
                    margin: const BubbleEdges.only(top: 10),
                    alignment: isMe ? Alignment.topRight : Alignment.topLeft,
                    nip: isMe ? BubbleNip.rightTop : BubbleNip.leftTop,
                    color: isMe ? const Color(0xFFD9FDD3) : Colors.white,
                    child: Column(
                      crossAxisAlignment:
                          isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                      children: [
                        if (!isMe && (data['push_name'] != null && (data['push_name'] as String).isNotEmpty))
                          Text(
                            data['push_name'],
                            style: const TextStyle(fontSize: 12, color: Colors.orange, fontWeight: FontWeight.bold),
                          ),
                        _buildMediaWidget(compat, isMe),
                        Builder(builder: (_) {
                          const mediaPlaceholders = ['Media Message', '📷 Photo', '🎥 Video', 'Audio Message', '📎 File'];
                          if (mediaPlaceholders.contains(text)) {
                            return Row(
                              mainAxisSize: MainAxisSize.min,
                              children: const [
                                Icon(Icons.image, size: 18, color: Colors.grey),
                                SizedBox(width: 4),
                                Text('Media', style: TextStyle(fontSize: 13, color: Colors.grey)),
                              ],
                            );
                          }
                          if (text.isEmpty) return const SizedBox.shrink();
                          return SelectableLinkify(
                            text: text,
                            style: const TextStyle(fontSize: 16, color: Colors.black),
                            linkStyle: const TextStyle(color: Colors.blue, decoration: TextDecoration.underline),
                            onOpen: (link) async {
                              final uri = Uri.parse(link.url);
                              try {
                                await launchUrl(uri, mode: LaunchMode.externalApplication);
                              } catch (e) {
                                debugPrint('Could not launch ${link.url}: $e');
                              }
                            },
                          );
                        }),
                        const SizedBox(height: 6),
                        Text(
                          _formatMessageTime(time),
                          style: TextStyle(fontSize: 10, color: Colors.grey[600]),
                        ),
                      ],
                    ),
                  ),
                ],
              );
            },
          );
        }),
      ),
    );
  }
}

class AudioPlayerWidget extends StatefulWidget {
  final String url;
  final bool isMe;

  const AudioPlayerWidget({super.key, required this.url, required this.isMe});

  @override
  State<AudioPlayerWidget> createState() => _AudioPlayerWidgetState();
}

class _AudioPlayerWidgetState extends State<AudioPlayerWidget> {
  final AudioPlayer _audioPlayer = AudioPlayer();
  bool _isPlaying = false;
  Duration _duration = Duration.zero;
  Duration _position = Duration.zero;

  @override
  void initState() {
    super.initState();
    _audioPlayer.onPlayerStateChanged.listen((state) {
      if (mounted) {
        setState(() {
          _isPlaying = state == PlayerState.playing;
        });
      }
    });

    _audioPlayer.onDurationChanged.listen((d) {
      if (mounted) setState(() => _duration = d);
    });

    _audioPlayer.onPositionChanged.listen((p) {
      if (mounted) setState(() => _position = p);
    });
  }

  @override
  void dispose() {
    _audioPlayer.dispose();
    super.dispose();
  }

  String _formatDuration(Duration d) {
    String twoDigits(int n) => n.toString().padLeft(2, "0");
    String twoDigitMinutes = twoDigits(d.inMinutes.remainder(60));
    String twoDigitSeconds = twoDigits(d.inSeconds.remainder(60));
    return "$twoDigitMinutes:$twoDigitSeconds";
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 200,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: widget.isMe ? Colors.green[200] : Colors.grey[200],
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          IconButton(
            icon: Icon(_isPlaying ? Icons.pause : Icons.play_arrow),
            onPressed: () async {
              if (_isPlaying) {
                await _audioPlayer.pause();
              } else {
                await _audioPlayer.play(UrlSource(widget.url));
              }
            },
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                LinearProgressIndicator(
                  value: (_duration.inSeconds > 0) ? _position.inSeconds / _duration.inSeconds : 0.0,
                  backgroundColor: Colors.grey[400],
                  valueColor: AlwaysStoppedAnimation<Color>(widget.isMe ? Colors.white : Colors.blue),
                ),
                const SizedBox(height: 4),
                Text(
                  "${_formatDuration(_position)} / ${_formatDuration(_duration)}",
                  style: const TextStyle(fontSize: 10),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class ChatInput extends StatefulWidget {
  final Function(String) onSend;
  final VoidCallback? onAttach;
  final bool canType;
  final FocusNode? focusNode;                 // <-- acceptat
  final TextEditingController? controller;    // <-- acceptat

  const ChatInput({
    required this.onSend,
    this.onAttach,
    this.canType = true,
    this.focusNode,
    this.controller,
    Key? key,
  }) : super(key: key);

  @override
  State<ChatInput> createState() => _ChatInputState();
}

class _ChatInputState extends State<ChatInput> {
  late final TextEditingController _ctrl;
  late final FocusNode _focusNode;
  late final bool _ownsController;
  late final bool _ownsFocusNode;

  @override
  void initState() {
    super.initState();
    _ownsController = widget.controller == null;
    _ownsFocusNode = widget.focusNode == null;

    _ctrl = widget.controller ?? TextEditingController();
    _focusNode = widget.focusNode ?? FocusNode();

    _focusNode.addListener(() {
      debugPrint('DEBUG: Focus changed: ${_focusNode.hasFocus}');
    });
  }

  @override
  void dispose() {
    if (_ownsController) _ctrl.dispose();
    if (_ownsFocusNode) _focusNode.dispose();
    super.dispose();
  }

  void _send() {
    final text = _ctrl.text.trim();
    if (text.isEmpty) return;
    debugPrint('DEBUG: _send() tapped in ChatInput. Text: "$text"');
    widget.onSend(text);
    _ctrl.clear();
    _focusNode.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.canType) {
      return Container(
        padding: const EdgeInsets.all(16),
        color: Colors.grey[200],
        child: const Center(child: Text('Messaging disabled (Unassigned/Reserved)', style: TextStyle(color: Colors.grey))),
      );
    }

    return SafeArea(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        color: Colors.white,
        child: Row(
          children: [
            if (widget.onAttach != null)
              IconButton(
                icon: const Icon(Icons.attach_file, color: Color(0xFF008069)),
                onPressed: widget.onAttach,
                tooltip: 'Trimite imagine',
              ),
            IconButton(
              icon: const Icon(Icons.keyboard_alt_outlined),
              onPressed: () {
                debugPrint('DEBUG: Manual Request Focus');
                if (!_focusNode.hasFocus) {
                  FocusScope.of(context).requestFocus(_focusNode);
                }
                SystemChannels.textInput.invokeMethod('TextInput.show');
              },
            ),
            Expanded(
              child: Listener(
                onPointerDown: (_) => debugPrint('DEBUG: Pointer down on textField wrapper'),
                child: TextField(
                  controller: _ctrl,
                  focusNode: _focusNode,
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => _send(),
                  decoration: const InputDecoration(
                    hintText: 'Type a message...',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.all(Radius.circular(24.0))
                    ),
                    contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    fillColor: Color(0xFFFAFAFA),
                    filled: true,
                  ),
                  minLines: 1,
                  maxLines: 5,
                ),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.send, color: Color(0xFF008069)),
              onPressed: _send,
            ),
          ],
        ),
      ),
    );
  }
}
