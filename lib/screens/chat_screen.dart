import 'dart:async';
import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:just_audio/just_audio.dart';
import 'package:url_launcher/url_launcher.dart';

class ChatScreen extends StatefulWidget {
  final String convId;
  final String accountId;
  const ChatScreen({Key? key, required this.convId, required this.accountId}) : super(key: key);

  @override
  _ChatScreenState createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final int pageSize = 50;
  List<Map<String, dynamic>> messages = [];
  dynamic? lastDoc;
  bool loadingMore = false;
  StreamSubscription<dynamic>? messagesSub;
  AudioPlayer? _audioPlayer;
  final ScrollController _scrollController = ScrollController();
  final TextEditingController _textController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _audioPlayer = AudioPlayer();
    _listenMessages();
  }

  @override
  void dispose() {
    messagesSub?.cancel();
    _audioPlayer?.dispose();
    _scrollController.dispose();
    _textController.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _listenMessages() async {
    final docRef = /* Removed */ ;
    final docSnap = await docRef.get();
    final data = docSnap.data();

    // If messages exist as array in doc -> subscribe doc changes
    if (data != null && data['messages'] != null && data['messages'] is List && (data['messages'] as List).isNotEmpty) {
      messagesSub?.cancel();
      messages = List<Map<String, dynamic>>.from(data['messages']).map(_normalizeMessage).toList();
      setState(() {});
      _scrollToBottom();
      // subscribe to doc updates for real-time
      messagesSub = docRef.snapshots().listen((snap) {
        final d = snap.data();
        if (d != null && d['messages'] != null && d['messages'] is List) {
          setState(() => messages = List<Map<String, dynamic>>.from(d['messages']).map(_normalizeMessage).toList());
          _scrollToBottom();
        }
      });
      return;
    }

    // Else, use subcollection listener (recommended)
    final colRef = docRef.collection('messages')
      .orderBy('timestamp', descending: true)
      .limit(pageSize);

    messagesSub?.cancel();
    messagesSub = colRef.snapshots().listen((qs) {
      final list = qs.docs.map((d) => _normalizeMessage(d.data() as Map<String, dynamic>)).toList();
      // received newest-first -> reverse to display oldest->newest
      setState(() {
        messages = list.reversed.toList();
        if (qs.docs.isNotEmpty) lastDoc = qs.docs.last;
      });
      _scrollToBottom();
    }, onError: (e) {
      debugPrint('messagesSub error: $e');
    });
  }

  Future<void> _loadMore() async {
    if (loadingMore || lastDoc == null) return;
    setState(() => loadingMore = true);
    try {
      final docRef = /* Removed */ ;
      final next = await docRef.collection('messages')
        .orderBy('timestamp', descending: true)
        .startAfterDocument(lastDoc!)
        .limit(pageSize)
        .get();
      if (next.docs.isNotEmpty) {
        final older = next.docs.map((d) => _normalizeMessage(d.data() as Map<String, dynamic>)).toList();
        setState(() {
          messages.insertAll(0, older.reversed.toList());
          lastDoc = next.docs.last;
        });
      }
    } catch (e) {
      debugPrint('loadMore error: $e');
    } finally {
      setState(() => loadingMore = false);
    }
  }

  Map<String, dynamic> _normalizeMessage(Map<String, dynamic> m) {
    dynamic? ts;
    if (m['timestamp'] is dynamic) ts = m['timestamp'];
    else if (m['timestamp'] is Map && (m['timestamp']['_seconds'] != null)) {
      ts = dynamic(m['timestamp']['_seconds'], m['timestamp']['_nanoseconds'] ?? 0);
    }
    final dt = ts?.toDate();
    return {
      'id': m['id'] ?? m['_id'] ?? UniqueKey().toString(),
      'body': m['body'] ?? m['text'] ?? '',
      'type': m['type'] ?? 'text',
      'pushName': m['pushName'] ?? m['pushname'] ?? m['senderName'] ?? '',
      'from': m['from'] ?? m['sender'] ?? null,
      'timestamp': dt,
      'mediaPath': m['storagePath'] ?? m['mediaPath'] ?? m['mediaUrl'] ?? null,
      'direction': m['direction'] ?? 'inbound',
      'raw': m,
    };
  }

  Widget _buildMessageTile(Map<String, dynamic> m) {
    final type = (m['type'] ?? 'text') as String;
    final body = m['body'] ?? '';
    final pushName = m['pushName'] ?? '';
    final mediaPath = m['mediaPath'] as String?;

    Widget content;
    if ((type == 'image' || (mediaPath != null && _isImage(mediaPath))) && mediaPath != null) {
      content = FutureBuilder<String>(
        future: _getMediaUrl(mediaPath),
        builder: (c, snap) {
          if (!snap.hasData) return SizedBox(height: 120, child: Center(child: CircularProgressIndicator()));
          return CachedNetworkImage(imageUrl: snap.data!, placeholder: (_,__) => SizedBox(height:120, child: Center(child: CircularProgressIndicator())));
        },
      );
    } else if ((type == 'audio' || (mediaPath != null && _isAudio(mediaPath))) && mediaPath != null) {
      content = _AudioWidget(mediaPath: mediaPath, getUrl: _getMediaUrl, audioPlayer: _audioPlayer!);
    } else if ((type == 'file' || (mediaPath != null && _isFile(mediaPath))) && mediaPath != null) {
      content = FutureBuilder<String>(
        future: _getMediaUrl(mediaPath),
        builder: (c, snap) {
          if (!snap.hasData) return ListTile(title: Text('Loading file...'));
          final url = snap.data!;
          return ListTile(
            leading: Icon(Icons.insert_drive_file),
            title: Text(m['raw']?['fileName'] ?? 'File'),
            subtitle: Text((m['raw']?['size'] != null) ? '${m['raw']['size']} bytes' : ''),
            onTap: () async { if (await canLaunch(url)) await launch(url); },
          );
        },
      );
    } else {
      content = ListTile(
        title: Text(body),
        subtitle: pushName != '' ? Text(pushName) : null,
      );
    }

    return Container(
      padding: EdgeInsets.symmetric(vertical: 6, horizontal: 12),
      alignment: m['direction'] == 'inbound' ? Alignment.centerLeft : Alignment.centerRight,
      child: content,
    );
  }

  bool _isImage(String path) {
    final p = path.toLowerCase();
    return p.endsWith('.jpg') || p.endsWith('.jpeg') || p.endsWith('.png') || p.endsWith('.gif') || p.contains('/images/');
  }
  bool _isAudio(String path) {
    final p = path.toLowerCase();
    return p.endsWith('.mp3') || p.endsWith('.m4a') || p.endsWith('.wav') || p.contains('/audio/');
  }
  bool _isFile(String path) => !_isImage(path) && !_isAudio(path);

  Future<String> _getMediaUrl(String path) async {
    try {
      if (path.startsWith('gs://')) {
        final rest = path.substring(5);
        final idx = rest.indexOf('/');
        final bucket = rest.substring(0, idx);
        final name = rest.substring(idx + 1);
        final ref = null /* Storage Removed */;
        return await ref.getDownloadURL();
      } else if (path.startsWith('http')) {
        return path;
      } else {
        final ref = null /* Storage Removed */;
        return await ref.getDownloadURL();
      }
    } catch (e) {
      debugPrint('_getMediaUrl error: $e');
      rethrow;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Chat')),
      body: Column(
        children: [
          Expanded(
            child: NotificationListener<ScrollNotification>(
              onNotification: (ScrollNotification scrollInfo) {
                if (scrollInfo.metrics.pixels <= 100 && !loadingMore) {
                  // near top: load older messages
                  _loadMore();
                }
                return false;
              },
              child: ListView.builder(
                controller: _scrollController,
                reverse: false,
                itemCount: messages.length,
                itemBuilder: (ctx, i) => _buildMessageTile(messages[i]),
              ),
            ),
          ),
          _buildInputArea(),
        ],
      ),
    );
  }

  Widget _buildInputArea() {
    return SafeArea(
      child: Row(
        children: [
          Expanded(child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 8.0),
            child: TextField(controller: _textController, decoration: InputDecoration(hintText: 'Type a message')),
          )),
          IconButton(onPressed: () async {
            final text = _textController.text.trim();
            if (text.isEmpty) return;
            _textController.clear();
            await _sendMessage(text);
          }, icon: Icon(Icons.send))
        ],
      ),
    );
  }

  Future<void> _sendMessage(String text) async {
    // Optimistic UI: add message to list immediately
    final optimisticMsg = {
      'id': 'local-${DateTime.now().millisecondsSinceEpoch}',
      'body': text,
      'type': 'text',
      'pushName': '',
      'from': null,
      'timestamp': DateTime.now(),
      'mediaPath': null,
      'direction': 'outbound',
      'raw': {},
    };
    setState(() => messages.add(optimisticMsg));
    _scrollToBottom();

    // Write to Database in background
    try {
      final db = null;
      final convRef = db.collection('conversations').doc(widget.convId);
      final msgRef = convRef.collection('messages').doc();
      final batch = db.batch();
      batch.set(msgRef, {
        'id': msgRef.id,
        'body': text,
        'type': 'text',
        'timestamp': FieldValue.serverdynamic(),
        'direction': 'outbound',
        'pushName': null
      });
      batch.update(convRef, {
        'lastMessageAt': FieldValue.serverdynamic(),
        'lastMessagePreview': text,
        'updatedAt': FieldValue.serverdynamic()
      });
      await batch.commit();
    } catch (e) {
      debugPrint('sendMessage error: $e');
    }
  }
}

class _AudioWidget extends StatefulWidget {
  final String mediaPath;
  final Future<String> Function(String) getUrl;
  final AudioPlayer audioPlayer;
  const _AudioWidget({Key? key, required this.mediaPath, required this.getUrl, required this.audioPlayer}) : super(key:key);

  @override State<_AudioWidget> createState() => _AudioWidgetState();
}

class _AudioWidgetState extends State<_AudioWidget> {
  bool loading = true;
  String? url;
  bool playing = false;

  @override
  void initState() {
    super.initState();
    _prepare();
  }
  Future<void> _prepare() async {
    try {
      url = await widget.getUrl(widget.mediaPath);
    } catch (e) {
      url = null;
    } finally {
      setState(() { loading = false; });
    }
  }
  @override
  Widget build(BuildContext context) {
    if (loading) return SizedBox(height: 60, child: Center(child: CircularProgressIndicator()));
    if (url == null) return ListTile(title: Text('Audio (not found)'));
    return ListTile(
      leading: IconButton(
        icon: Icon(playing ? Icons.pause : Icons.play_arrow),
        onPressed: () async {
          if (!playing) {
            try {
              await widget.audioPlayer.setUrl(url!);
              await widget.audioPlayer.play();
              setState(() => playing = true);
              widget.audioPlayer.playerStateStream.listen((state) {
                if (state.processingState == ProcessingState.completed) setState(() => playing = false);
              });
            } catch (e) {
              ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Audio error: $e')));
            }
          } else {
            await widget.audioPlayer.pause();
            setState(() => playing = false);
          }
        },
      ),
      title: Text('Audio'),
    );
  }
}
