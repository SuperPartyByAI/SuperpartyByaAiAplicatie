import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';
import '../screens/chat_detail_screen.dart';

class AdminInternalChatsTab extends StatefulWidget {
  const AdminInternalChatsTab({super.key});

  @override
  State<AdminInternalChatsTab> createState() => _AdminInternalChatsTabState();
}

class _AdminInternalChatsTabState extends State<AdminInternalChatsTab> {
  // Internal phone numbers — messages from/to these go to "Interne" tab
  static const Set<String> _internalNumbers = {
    '40737571397', // Admin personal number
    '0737571397',
    '737571397',
  };

  Set<String> _connectedAccountNumbers = {};

  @override
  void initState() {
    super.initState();
    _loadConnectedAccounts();
  }

  Future<void> _loadConnectedAccounts() async {
    try {
      final snap = await FirebaseFirestore.instance.collection('wa_accounts').get();
      final numbers = <String>{};
      for (final doc in snap.docs) {
        final phone = doc.data()['phoneNumber']?.toString() ?? '';
        if (phone.isNotEmpty) {
          numbers.add(phone);
          if (phone.startsWith('40')) {
            numbers.add('0${phone.substring(2)}');
            numbers.add(phone.substring(2));
          }
        }
      }
      if (mounted) {
        setState(() {
          _connectedAccountNumbers = numbers;
        });
      }
    } catch (e) {
      debugPrint('Error loading connected accounts: $e');
    }
  }

  bool _isInternalJid(String? jid) {
    if (jid == null || jid.isEmpty) return false;
    final phone = jid.split('@')[0];
    if (_internalNumbers.contains(phone)) return true;
    if (_connectedAccountNumbers.contains(phone)) return true;
    return false;
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot>(
      stream: FirebaseFirestore.instance
          .collection('conversations')
          .orderBy('lastMessageAt', descending: true)
          .limit(100)
          .snapshots(),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Center(child: Text('Eroare: ${snapshot.error}', style: const TextStyle(color: Colors.red)));
        }
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        final docs = snapshot.data?.docs ?? [];
        if (docs.isEmpty) return const Center(child: Text('Nu există conversații'));

        final internalDocs = docs.where((doc) {
          final data = doc.data() as Map<String, dynamic>;
          final jid = data['jid']?.toString() ?? '';
          return _isInternalJid(jid);
        }).toList();

        if (internalDocs.isEmpty) {
          return const Center(child: Text('Nu există log-uri interne'));
        }

        return _buildConversationList(internalDocs);
      },
    );
  }

  Widget _buildConversationList(List<QueryDocumentSnapshot> docs) {
    return ListView.builder(
      itemCount: docs.length,
      itemBuilder: (context, index) {
        final data = docs[index].data() as Map<String, dynamic>;
        final docId = docs[index].id;

        DateTime lastDt = DateTime.now();
        int timestamp = 0;
        final ts = data['lastMessageAt'] ?? data['updatedAt'];
        if (ts is Timestamp) {
          lastDt = ts.toDate();
          timestamp = (ts.seconds).toInt();
        } else if (ts is int) {
          timestamp = ts;
          lastDt = DateTime.fromMillisecondsSinceEpoch(ts * 1000);
        }

        String name = '';
        String phoneNumber = '';

        if (data['jid'] != null && data['jid'].toString().contains('@s.whatsapp.net')) {
          phoneNumber = data['jid'].toString().split('@')[0];
        }

        if (data['name'] != null && data['name'].toString().isNotEmpty) {
          name = data['name'];
        } else if (data['pushName'] != null && data['pushName'].toString().isNotEmpty) {
          name = data['pushName'];
          if (phoneNumber.isNotEmpty && name != phoneNumber) {
            name = '$name (~$phoneNumber)';
          }
        } else if (phoneNumber.isNotEmpty) {
          name = phoneNumber;
        } else if (data['clientId'] != null && data['clientId'].toString().isNotEmpty) {
          name = data['clientId'];
        } else {
          name = docId;
        }

        if (name.contains('@') && !name.contains(' ')) {
          name = name.split('@')[0];
        }

        final preview = data['lastMessagePreview'] ?? 'Fără previzualizare';
        final assignedTo = data['assignedEmployeeId'];
        String accountLabel = data['accountLabel'] ?? '';
        final photoUrl = data['photoUrl'];

        return ListTile(
          leading: CircleAvatar(
            backgroundColor: Colors.grey,
            backgroundImage: (photoUrl != null && photoUrl.isNotEmpty)
                ? NetworkImage(photoUrl)
                : null,
            child: (photoUrl == null || photoUrl.isEmpty)
                ? const Icon(Icons.business, color: Colors.white)
                : null,
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
                  child: Text(
                    accountLabel,
                    style: const TextStyle(fontSize: 10, color: Colors.blue),
                  ),
                ),
            ],
          ),
          subtitle: Text(
            preview,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12, color: Colors.grey),
          ),
          trailing: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (timestamp > 0)
                Text(
                  DateFormat('HH:mm').format(lastDt),
                  style: const TextStyle(fontSize: 12, color: Colors.grey),
                ),
              if (assignedTo != null)
                const Icon(Icons.assignment_ind, size: 16, color: Colors.blue)
            ],
          ),
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => ChatDetailScreen(
                  conversationId: docId,
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
