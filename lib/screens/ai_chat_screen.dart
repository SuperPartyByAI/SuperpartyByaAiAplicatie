import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:image_picker/image_picker.dart';
import '../services/ai_service.dart';
import 'sales_extractor_screen.dart';

class AIChatScreen extends StatefulWidget {
  final ScrollController? scrollController;
  const AIChatScreen({super.key, this.scrollController});

  @override
  State<AIChatScreen> createState() => _AIChatScreenState();
}

class _AIChatScreenState extends State<AIChatScreen> {
  final TextEditingController _controller = TextEditingController();
  late final ScrollController _scrollController;
  List<Map<String, String>> _messages = [];
  
  bool _isLoading = false;
  bool _inEventConversation = false;
  Map<String, dynamic>? _currentDraftEvent;
  final String _sessionId = DateTime.now().millisecondsSinceEpoch.toString();

  XFile? _selectedImage;
  final ImagePicker _picker = ImagePicker();

  @override
  void initState() {
    super.initState();
    _scrollController = widget.scrollController ?? ScrollController();
    _loadMessages();
  }

  Future<void> _loadMessages() async {
    final prefs = await SharedPreferences.getInstance();
    final String? messagesJson = prefs.getString('ai_chat_history');
    if (messagesJson != null && messagesJson.isNotEmpty) {
      try {
        final List<dynamic> decoded = jsonDecode(messagesJson);
        setState(() {
          _messages = decoded.map((e) => Map<String, String>.from(e as Map)).toList();
        });
        Future.delayed(const Duration(milliseconds: 100), _scrollToBottom);
        return;
      } catch (e) {
        debugPrint('Error decoding chat history: $e');
      }
    }
    
    // Default initial message
    setState(() {
      _messages = [
        {
          'role': 'ai',
          'content': '✨ Salut! Sunt asistentul tău Superparty by AI.\n\nTe pot ajuta să notezi evenimente noi, să îți dau idei de petreceri sau să te ajut cu orice detaliu legat de muncă! Cu ce începem azi?'
        }
      ];
    });
  }

  Future<void> _saveMessages() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('ai_chat_history', jsonEncode(_messages));
  }

  bool _detectEventIntent(String text) {
    if (text.trim().isEmpty) return false;
    final normalized = text.toLowerCase();
    
    // Strong hook: explicitly referencing an ID
    if (RegExp(r'\b(id|ev|eveniment(ul)?)\s*#?\d+\b', caseSensitive: false).hasMatch(normalized)) return true;
    
    // Command hooks: Expanded to catch variations
    final keywords = ['notez', 'noteaza', 'notează', 'notam', 'notăm', 'adauga', 'adaugă', 'adaug', 'creeaza', 'creează', 'creez', 'creem', 'petrecere', 'eveniment', 'rezervare', 'modific', 'modifica', 'modifică'];
    
    for (var k in keywords) {
      if (normalized.contains(k)) return true;
    }
    return false;
  }

  bool _isConfirmation(String text) {
    final normalized = text.trim().toLowerCase();
    return ['da', 'ok', 'confirm', 'yes', 'dap', 'sigur'].contains(normalized);
  }

  Future<bool> _checkStaffPermission() async {
    final user = (Supabase.instance.client.auth.currentUser);
    if (user == null) return false;

    // Admin bypass is absolute
    if (user.email == 'ursache.andrei1995@gmail.com') return true;

    try {
      final querySnap = await /* Removed */ ;

      if (querySnap.docs.isNotEmpty) {
         final data = querySnap.docs.first.data();
         return data['canNoteEvents'] == true;
      }
      return false;
    } catch (e) {
      debugPrint('[RBAC] Error checking staffProfiles permissions: $e');
      return false;
    }
  }

  Future<void> _pickImage() async {
    try {
      final XFile? image = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 70);
      if (image != null) {
        setState(() {
          _selectedImage = image;
        });
      }
    } catch (e) {
      debugPrint('[ImagePicker] Error picking image: $e');
    }
  }

  Future<void> _sendMessage() async {
    final text = _controller.text.trim();
    if ((text.isEmpty && _selectedImage == null) || _isLoading) return;
    
    // Read and encode image if selected
    String? base64Image;
    if (_selectedImage != null) {
      try {
        final bytes = await _selectedImage!.readAsBytes();
        base64Image = base64Encode(bytes);
      } catch (e) {
        debugPrint('[ImageEncoder] Failed to encode image: $e');
      }
    }

    setState(() {
      _messages.add({
        'role': 'user', 
        'content': text.isNotEmpty ? text : '[A încărcat o imagine]',
        if (_selectedImage != null) 'hasAttachment': 'true',
      });
      _isLoading = true;
    });
    
    _saveMessages();
    _controller.clear();
    
    // Clear image selection immediately after UI updates
    final imagePayload = base64Image;
    setState(() {
      _selectedImage = null;
    });
    
    bool useV2 = false;
    if (_inEventConversation && _isConfirmation(text)) {
      useV2 = true; 
    } else if (_detectEventIntent(text) || imagePayload != null) {
      useV2 = true; // Auto-route to V2 if there's an image attached (assume form scanning)
    }
    
    // Evaluate Access Control before proceeding to Event AI Engine
    if (useV2) {
      final hasPermission = await _checkStaffPermission();
      if (!hasPermission) {
        setState(() {
          _isLoading = false;
          _messages.add({
            'role': 'ai',
            'content': '⚠️ Îmi pare rău, dar contul tău nu are bifată permisiunea de Notare Evenimente în panoul de Echipă. Ia legătura cu administratorul.'
          });
          _saveMessages();
          _scrollToBottom();
        });
        return; // Halt AI Route
      }
    }

    debugPrint('[AI_ROUTER] Text: "$text" Image: ${imagePayload != null} -> Routing to: ${useV2 ? "V2 (Event)" : "V1 (General)"}');
    
    Map<String, dynamic> response;
    if (useV2) {
      response = await AiService().sendMessageToEventAI(text, _sessionId, imageBase64: imagePayload);
    } else {
      response = await AiService().sendMessageToGeneralAI(text, _sessionId);
    }
    
    if (mounted) {
      setState(() {
        _isLoading = false;
        
        // Parse structured JSON Protocol
        final action = response['action']?.toString().toUpperCase() ?? 'NONE';
        final msgText = response['message']?.toString() ?? 'A apărut o problemă la procesarea textului.';
        
        _messages.add({'role': 'ai', 'content': msgText});
        _saveMessages();
        
        // State Machine Management
        if (useV2) {
          if (action == 'START_NOTING' || action == 'ASK_INFO' || action == 'UPDATE_DRAFT' || action == 'CONFIRM') {
              _inEventConversation = true;
              if (response.containsKey('draftEvent') && response['draftEvent'] != null) {
                _currentDraftEvent = Map<String, dynamic>.from(response['draftEvent'] as Map);
              }
          } else if (['UPDATE', 'CREATE', 'ARCHIVE', 'CANCELLED'].contains(action)) {
              _inEventConversation = false;
              _currentDraftEvent = null; // Clear ticket on finish/cancel
              debugPrint('[EXECUTOR] AI Triggered Action: $action on Event: ${response['eventId']}');
          }
        } else {
           if (['UPDATE', 'CREATE', 'ARCHIVE'].contains(action)) {
              _inEventConversation = false;
              _currentDraftEvent = null;
              debugPrint('[EXECUTOR] V1 Triggered Action: $action on Event: ${response['eventId']}');
           }
        }
      });
      
      _scrollToBottom();
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Widget _buildMessageBubble(Map<String, String> msg) {
    final isUser = msg['role'] == 'user';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0, horizontal: 16.0),
      child: Row(
        mainAxisAlignment: isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isUser) ...[
            Container(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: Colors.deepPurple.withOpacity(0.3),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  )
                ],
              ),
              child: const CircleAvatar(
                backgroundColor: Colors.deepPurpleAccent,
                radius: 18,
                child: Icon(Icons.auto_awesome, color: Colors.white, size: 20),
              ),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 18),
              decoration: BoxDecoration(
                gradient: isUser
                    ? const LinearGradient(
                        colors: [Colors.purple, Colors.deepPurple],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      )
                    : null,
                color: isUser ? null : Colors.white,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(20),
                  topRight: const Radius.circular(20),
                  bottomLeft: isUser ? const Radius.circular(20) : const Radius.circular(4),
                  bottomRight: isUser ? const Radius.circular(4) : const Radius.circular(20),
                ),
                boxShadow: [
                  if (!isUser)
                    BoxShadow(
                      color: Colors.black.withOpacity(0.04),
                      blurRadius: 10,
                      offset: const Offset(0, 4),
                    ),
                ],
              ),
              child: Text(
                msg['content']!,
                style: TextStyle(
                  color: isUser ? Colors.white : Colors.black87,
                  fontSize: 15,
                  height: 1.4,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ),
          if (isUser) ...[
            const SizedBox(width: 8),
            const CircleAvatar(
              backgroundColor: Colors.grey,
              radius: 18,
              child: Icon(Icons.person, color: Colors.white, size: 20),
            ),
          ],
        ],
      ),
    );
  }
  Widget _buildEventTicketHeader() {
    if (!_inEventConversation || _currentDraftEvent == null) return const SizedBox.shrink();

    final draft = _currentDraftEvent!;
    
    // Safely extract draft fields (since AI returns them incrementally)
    final date = draft['date'] as String? ?? '...';
    final address = draft['address'] as String? ?? '...';
    final client = draft['client'] as String? ?? '...';

    // Parse roles
    List<dynamic> rolesDraft = [];
    if (draft['rolesDraft'] is List) {
      rolesDraft = draft['rolesDraft'];
    }

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.all(12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.deepPurple.withOpacity(0.3), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: Colors.deepPurple.withOpacity(0.1),
            blurRadius: 10,
            offset: const Offset(0, 4),
          )
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.confirmation_num, color: Colors.deepPurple, size: 24),
              const SizedBox(width: 8),
              const Text(
                "Tichet Eveniment",
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.deepPurple),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.orange.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Text(
                  "ÎN CREARE",
                  style: TextStyle(color: Colors.orange, fontSize: 10, fontWeight: FontWeight.bold),
                ),
              )
            ],
          ),
          const Divider(height: 20, thickness: 1),
          _buildTicketRow(Icons.calendar_today, 'Dată/Oră:', date),
          const SizedBox(height: 8),
          _buildTicketRow(Icons.location_on, 'Locație:', address),
          const SizedBox(height: 8),
          _buildTicketRow(Icons.phone, 'Contact:', client),
          const SizedBox(height: 8),
          if (rolesDraft.isNotEmpty) ...[
            const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.people, size: 16, color: Colors.grey),
                SizedBox(width: 8),
                Text('Roluri:', style: TextStyle(color: Colors.grey, fontSize: 13, fontWeight: FontWeight.w500)),
              ],
            ),
            const SizedBox(height: 4),
            Padding(
              padding: const EdgeInsets.only(left: 24.0),
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                children: rolesDraft.map((roleDef) {
                  final label = roleDef['label']?.toString() ?? 'Necunoscut';
                  return Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.deepPurple.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.deepPurple.withOpacity(0.2)),
                    ),
                    child: Text(label, style: const TextStyle(fontSize: 12, color: Colors.deepPurple, fontWeight: FontWeight.w600)),
                  );
                }).toList(),
              ),
            ),
            
            // Render the Dynamic Staff Header
            if (draft['totalStaffRequired'] != null && draft['totalStaffRequired'] > 0) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.blue.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.blue.withOpacity(0.3)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.groups, color: Colors.blue, size: 20),
                    const SizedBox(width: 8),
                    const Text('Echipă Necesară:', style: TextStyle(color: Colors.blue, fontSize: 13, fontWeight: FontWeight.bold)),
                    const Spacer(),
                    Text(
                      '${draft['totalStaffRequired']} ${draft['totalStaffRequired'] == 1 ? 'Om' : 'Oameni'}',
                      style: const TextStyle(color: Colors.blue, fontSize: 14, fontWeight: FontWeight.w900),
                    ),
                  ],
                ),
              ),
            ]
            
          ] else ...[
             _buildTicketRow(Icons.people, 'Roluri:', '...'),
          ]
        ],
      ),
    );
  }

  Widget _buildTicketRow(IconData icon, String label, String value) {
    // If value is still '...' it means the AI hasn't collected it yet
    final isPending = value == '...';
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: Colors.grey),
        const SizedBox(width: 8),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 13, fontWeight: FontWeight.w500)),
        const SizedBox(width: 4),
        Expanded(
          child: Text(
            value,
            style: TextStyle(
              color: isPending ? Colors.orange : Colors.black87,
              fontSize: 13,
              fontWeight: isPending ? FontWeight.normal : FontWeight.bold,
              fontStyle: isPending ? FontStyle.italic : FontStyle.normal,
            ),
          ),
        ),
      ],
    );
  }


  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[50], // Soft background
      appBar: AppBar(
        title: GestureDetector(
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const SalesExtractorScreen()),
            );
          },
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.auto_awesome, color: Colors.white, size: 22),
              SizedBox(width: 8),
              Text('Superparty AI', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
              SizedBox(width: 4),
              Icon(Icons.arrow_forward_ios, color: Colors.white70, size: 14),
            ],
          ),
        ),
        backgroundColor: Colors.deepPurple,
        elevation: 1,
        centerTitle: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            _buildEventTicketHeader(),
            if (!_inEventConversation)
              Expanded(
                child: ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.only(top: 16, bottom: 8),
                  itemCount: _messages.length,
                  itemBuilder: (context, index) {
                    return _buildMessageBubble(_messages[index]);
                  },
                ),
              )
            else
              Expanded(
                child: Container(
                  width: double.infinity,
                  color: Colors.grey[50],
                  child: Center(
                    child: SingleChildScrollView(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.auto_awesome, size: 48, color: Colors.deepPurpleAccent),
                          const SizedBox(height: 24),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 32.0),
                            child: Text(
                              _messages.isNotEmpty && _messages.last['role'] == 'ai'
                                  ? _messages.last['content'] ?? 'Analizez datele...'
                                  : 'Scrie detaliile evenimentului sau încarcă o poză...',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                                color: Colors.deepPurple,
                                height: 1.4,
                              ),
                            ),
                          ),
                          
                          // Inject Save Button directly if we are in CONFIRM phase
                          if (_messages.isNotEmpty && 
                              _messages.last['role'] == 'ai' && 
                              _messages.last['content'] != null && 
                              _messages.last['content']!.contains('Verifică')) ...[
                              const SizedBox(height: 24),
                              ElevatedButton.icon(
                                onPressed: () {
                                  _controller.text = "Da, salveaza";
                                  _sendMessage();
                                },
                                icon: const Icon(Icons.check_circle, color: Colors.white),
                                label: const Text("Salvează Evenimentul", style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white)),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: Colors.green.shade600,
                                  padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                                  elevation: 4,
                                ),
                              ),
                          ]
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            if (_isLoading)
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: Row(
                  children: [
                    const CircleAvatar(
                      backgroundColor: Colors.deepPurpleAccent,
                      radius: 12,
                      child: SizedBox(
                        width: 12,
                        height: 12,
                        child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text('Superparty AI gândește...', style: TextStyle(color: Colors.grey[600], fontStyle: FontStyle.italic)),
                  ],
                ),
              ),

            Container(
              decoration: BoxDecoration(
                color: Colors.white,
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.05),
                    blurRadius: 10,
                    offset: const Offset(0, -5),
                  ),
                ],
              ),
              child: Column(
                children: [
                  if (_selectedImage != null)
                    Padding(
                      padding: const EdgeInsets.only(left: 16.0, right: 16.0, top: 12.0),
                      child: Row(
                        children: [
                          Container(
                            height: 60,
                            width: 60,
                            decoration: BoxDecoration(
                              color: Colors.grey[200],
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: Colors.deepPurple.withOpacity(0.3)),
                            ),
                            child: const Center(child: Icon(Icons.image, color: Colors.deepPurple)),
                          ),
                          const SizedBox(width: 12),
                          const Expanded(
                            child: Text('Imagine atașată', style: TextStyle(color: Colors.deepPurple, fontWeight: FontWeight.bold, fontSize: 13)),
                          ),
                          IconButton(
                            icon: const Icon(Icons.close, color: Colors.grey, size: 20),
                            onPressed: () => setState(() => _selectedImage = null),
                          )
                        ],
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 12.0),
                    child: Row(
                      children: [
                        IconButton(
                          icon: const Icon(Icons.add_photo_alternate, color: Colors.deepPurple),
                          onPressed: _isLoading ? null : _pickImage,
                        ),
                        Expanded(
                          child: Container(
                            decoration: BoxDecoration(
                              color: Colors.grey[100],
                              borderRadius: BorderRadius.circular(24),
                              border: Border.all(color: Colors.grey[300]!),
                            ),
                            child: TextField(
                              controller: _controller,
                              enabled: !_isLoading,
                              maxLines: null,
                              textInputAction: TextInputAction.send,
                              decoration: InputDecoration(
                                hintText: 'Scrie-i AI-ului meu...',
                                hintStyle: TextStyle(color: Colors.grey[500]),
                                border: InputBorder.none,
                                contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
                              ),
                              onSubmitted: (_) => _sendMessage(),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Container(
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              colors: [Colors.deepPurple, Colors.purple],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: Colors.deepPurple.withOpacity(0.4),
                                blurRadius: 8,
                                offset: const Offset(0, 3),
                              ),
                            ],
                          ),
                          child: IconButton(
                            icon: const Icon(Icons.send_rounded, color: Colors.white),
                            onPressed: _isLoading ? null : _sendMessage,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

