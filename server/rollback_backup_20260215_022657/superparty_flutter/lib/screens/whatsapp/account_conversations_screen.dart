import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

/// Shows all conversations for a specific WhatsApp account
/// Navigated to from StaffAccountsInbox
class AccountConversationsScreen extends StatelessWidget {
  final String accountId;
  final String accountName;

  const AccountConversationsScreen({
    super.key,
    required this.accountId,
    required this.accountName,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Conversations'),
            Text(
              accountName,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.normal),
            ),
          ],
        ),
        backgroundColor: const Color(0xFF25D366),
      ),
      body: StreamBuilder<QuerySnapshot>(
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('threads') // ✅ Canon Path
            .where('accountId', isEqualTo: accountId)
            .orderBy('lastMessageSortMs', descending: true)
            .limit(200)
            .snapshots(), // ← Real-time, NOT cache!
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.error, color: Colors.red, size: 48),
                  const SizedBox(height: 16),
                  Text('Error: ${snapshot.error}'),
                ],
              ),
            );
          }

          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text('Loading conversations...'),
                ],
              ),
            );
          }

          if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
            return const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.inbox, color: Colors.grey, size: 64),
                  SizedBox(height: 16),
                  Text(
                    'No conversations yet',
                    style: TextStyle(color: Colors.grey, fontSize: 16),
                  ),
                ],
              ),
            );
          }

          return ListView.builder(
            itemCount: snapshot.data!.docs.length,
            itemBuilder: (context, index) {
              final doc = snapshot.data!.docs[index];
              final data = doc.data() as Map<String, dynamic>;
              
              // Canon Schema Mapping
              final lastMessagePreview = data['lastMessagePreview'] as String? ?? 
                                       data['lastMessageText'] as String? ?? '';
              
              DateTime? lastMessageTime;
              if (data['lastMessageSortMs'] != null) {
                lastMessageTime = DateTime.fromMillisecondsSinceEpoch(data['lastMessageSortMs'] as int);
              } else {
                lastMessageTime = (data['lastMessageAt'] as Timestamp?)?.toDate();
              }

              return _ConversationTile(
                conversationId: doc.id, // This is the threadId
                accountId: accountId,
                data: {
                  ...data,
                  'displayMessage': lastMessagePreview,
                  'displayTime': lastMessageTime,
                },
                onTap: () {
                  // Navigate to chat screen with explicit threadId
                  final displayName = data['displayName'] as String? ??
                                    data['pushName'] as String? ??
                                    data['name'] as String? ??
                                    doc.id;
                  
                  context.push(
                    '/whatsapp/chat',
                    extra: {
                      'accountId': accountId,
                      'threadId': doc.id, // ✅ CRITICAL: Pass threadId for Canon Stream
                      'conversationId': doc.id, // Legacy fallback
                      'displayName': displayName,
                    },
                  );
                },
              );
            },
          );
        },
      ),
    );
  }
}

class _ConversationTile extends StatelessWidget {
  final String conversationId;
  final String accountId;
  final Map<String, dynamic> data;
  final VoidCallback onTap;

  const _ConversationTile({
    required this.conversationId,
    required this.accountId,
    required this.data,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final displayName = data['displayName'] as String? ??
                       data['pushName'] as String? ??
                       data['name'] as String? ??
                       conversationId;
    
    final lastMessageText = data['displayMessage'] as String? ?? '';
    final lastMessageAt = data['displayTime'] as DateTime?;
    final unreadCount = data['unreadCount'] as int? ?? 0;
    final lastMessageFromMe = data['lastMessageFromMe'] as bool? ?? false;

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: ListTile(
        onTap: onTap,
        leading: CircleAvatar(
          backgroundColor: _getAvatarColor(conversationId),
          child: Text(
            _getInitials(displayName),
            style: const TextStyle(color: Colors.white),
          ),
        ),
        title: Text(
          displayName,
          style: TextStyle(
            fontWeight: unreadCount > 0 ? FontWeight.bold : FontWeight.normal,
          ),
        ),
        subtitle: Row(
          children: [
            if (lastMessageFromMe)
              const Icon(Icons.done_all, size: 14, color: Colors.grey),
            if (lastMessageFromMe) const SizedBox(width: 4),
            Expanded(
              child: Text(
                lastMessageText.isNotEmpty ? lastMessageText : 'No messages',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontWeight: unreadCount > 0 ? FontWeight.w600 : FontWeight.normal,
                ),
              ),
            ),
          ],
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            if (lastMessageAt != null)
              Text(
                _formatTimestamp(lastMessageAt),
                style: TextStyle(
                  fontSize: 12,
                  color: unreadCount > 0
                      ? const Color(0xFF25D366)
                      : Colors.grey,
                ),
              ),
            if (unreadCount > 0) ...[
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.all(6),
                decoration: const BoxDecoration(
                  color: Color(0xFF25D366),
                  shape: BoxShape.circle,
                ),
                child: Text(
                  unreadCount > 99 ? '99+' : unreadCount.toString(),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatTimestamp(DateTime timestamp) {
    final now = DateTime.now();
    final diff = now.difference(timestamp);

    if (diff.inDays == 0) {
      return DateFormat('HH:mm').format(timestamp);
    } else if (diff.inDays == 1) {
      return 'Yesterday';
    } else if (diff.inDays < 7) {
      return DateFormat('EEEE').format(timestamp);
    } else {
      return DateFormat('dd/MM/yy').format(timestamp);
    }
  }

  String _getInitials(String name) {
    final words = name.trim().split(' ');
    if (words.isEmpty) return '?';
    if (words.length == 1) {
      return words[0].substring(0, 1).toUpperCase();
    }
    return (words[0].substring(0, 1) + words[1].substring(0, 1))
        .toUpperCase();
  }

  Color _getAvatarColor(String id) {
    final hash = id.hashCode;
    final colors = [
      Colors.blue,
      Colors.green,
      Colors.orange,
      Colors.purple,
      Colors.teal,
      Colors.pink,
      Colors.indigo,
    ];
    return colors[hash % colors.length];
  }
}
