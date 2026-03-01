import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../services/supabase_service.dart';
import 'chat_detail_screen.dart';

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key});

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  // Internal numbers — filter out our own WA accounts from client list
  static const Set<String> _internalNumbers = {
    '40737571397',
    '0737571397',
    '737571397',
  };

  List<Map<String, dynamic>> _conversations = [];
  bool _loading = true;
  String? _error;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _loadConversations();
    // Poll every 15 seconds for live updates
    _pollTimer = Timer.periodic(const Duration(seconds: 15), (_) => _loadConversations());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  bool _isInternalJid(String? jid) {
    if (jid == null || jid.isEmpty) return false;
    final phone = jid.split('@')[0];
    return _internalNumbers.contains(phone);
  }

  Future<void> _loadConversations() async {
    try {
      final data = await SupabaseService.select(
        'conversations',
        select: 'id,jid,name,phone,account_label,photo_url,last_message_at,last_message_preview,assigned_employee_id',
        order: 'last_message_at.desc.nullslast',
        limit: 500,
      );

      final filtered = data.where((row) {
        final name = row['name']?.toString() ?? '';
        final jid = row['jid']?.toString() ?? '';
        if (name == 'System') return false;
        if (_isInternalJid(jid)) return false;
        return true;
      }).toList();

      if (mounted) setState(() { _conversations = filtered; _loading = false; });
    } catch (e, stack) {
      debugPrint('Supabase Error loading conversations: $e');
      debugPrint('Stacktrace: $stack');
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('WhatsApp SuperPartyByAi', style: TextStyle(color: Colors.white)),
        backgroundColor: const Color(0xFF008069),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white),
            onPressed: () { setState(() => _loading = true); _loadConversations(); },
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return Center(child: Text('Eroare: $_error', style: const TextStyle(color: Colors.red)));
    if (_conversations.isEmpty) return const Center(child: Text('Nicio conversație cu clienți'));
    return _buildList();
  }

  Widget _buildList() {
    return ListView.builder(
      itemCount: _conversations.length,
      itemBuilder: (context, index) {
        final row = _conversations[index];

        // Name resolution
        String name = '';
        final jid = row['jid']?.toString() ?? '';
        final phone = row['phone']?.toString() ?? (jid.isNotEmpty ? jid.split('@')[0] : '');
        if ((row['name']?.toString() ?? '').isNotEmpty) {
          name = row['name'];
        } else if (phone.isNotEmpty) {
          name = phone;
        } else {
          name = row['id'] ?? '';
        }
        if (name.contains('@') && !name.contains(' ')) name = name.split('@')[0];

        // dynamic
        final ts = row['last_message_at'];
        DateTime? lastDt;
        if (ts != null) lastDt = DateTime.fromMillisecondsSinceEpoch((ts as int) * 1000);

        final preview = row['last_message_preview'] ?? '';
        final accountLabel = row['account_label']?.toString() ?? '';
        final photoUrl = row['photo_url']?.toString() ?? '';
        final assignedTo = row['assigned_employee_id'];

        return ListTile(
          leading: CircleAvatar(
            backgroundColor: Colors.grey,
            backgroundImage: photoUrl.isNotEmpty 
                ? ResizeImage(NetworkImage(photoUrl), width: 100, height: 100) 
                : null,
            child: photoUrl.isEmpty ? const Icon(Icons.person, color: Colors.white) : null,
          ),
          title: Row(
            children: [
              Expanded(child: Text(name, overflow: TextOverflow.ellipsis)),
              if (accountLabel.isNotEmpty)
                Container(
                  margin: const EdgeInsets.only(left: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.blue.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(color: Colors.blue.withOpacity(0.3)),
                  ),
                  child: Text(accountLabel, style: const TextStyle(fontSize: 10, color: Colors.blue)),
                ),
            ],
          ),
          subtitle: Text(preview, maxLines: 1, overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: Colors.grey)),
          trailing: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (lastDt != null)
                Text(DateFormat('HH:mm').format(lastDt),
                    style: const TextStyle(fontSize: 12, color: Colors.grey)),
              if (assignedTo != null)
                const Icon(Icons.assignment_ind, size: 16, color: Colors.blue),
            ],
          ),
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => ChatDetailScreen(
                  conversationId: row['id'] ?? '',
                  name: name,
                ),
              ),
            );
          },
        );
      },
    );
  }
}
