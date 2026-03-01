import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
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
      // Query Postgres schema instead of Firestore
      final response = await Supabase.instance.client
          .from('wa_accounts')
          .select('phone_number');
          
      final numbers = <String>{};
      for (final doc in response) {
        final phone = doc['phone_number']?.toString() ?? '';
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
    // We use stream instead of snapshots() for Supabase Realtime
    return StreamBuilder<List<Map<String, dynamic>>>(
      stream: Supabase.instance.client
          .from('conversations')
          .stream(primaryKey: ['id'])
          .order('last_message_at', ascending: false)
          .limit(100),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Center(
            child: Text('Eroare: ${snapshot.error}',
                style: const TextStyle(color: Colors.red)));
        }
        if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }

        final docs = snapshot.data ?? [];
        if (docs.isEmpty) return const Center(child: Text('Nu există conversații'));

        final internalDocs = docs.where((doc) {
          final jid = doc['jid']?.toString() ?? '';
          return _isInternalJid(jid);
        }).toList();

        if (internalDocs.isEmpty) {
          return const Center(child: Text('Nu există log-uri interne'));
        }

        return _buildConversationList(internalDocs);
      },
    );
  }

  Widget _buildConversationList(List<Map<String, dynamic>> docs) {
    return ListView.builder(
      itemCount: docs.length,
      itemBuilder: (context, index) {
        final data = docs[index];
        final docId = data['id']?.toString() ?? '';

        DateTime lastDt = DateTime.now();
        int timestamp = 0;
        
        // Supabase Postgres Schema: BigInt UNIX seconds
        final ts = data['last_message_at'] ?? data['updated_at'];
        
        if (ts != null) {
          if (ts is num) {
             timestamp = ts.toInt();
             lastDt = DateTime.fromMillisecondsSinceEpoch(timestamp * 1000);
          } else if (ts is String) {
             try {
               final parsed = DateTime.parse(ts);
               lastDt = parsed;
               timestamp = (parsed.millisecondsSinceEpoch / 1000).round();
             } catch (_) {
               final parsedNum = int.tryParse(ts);
               if (parsedNum != null) {
                 timestamp = parsedNum;
                 lastDt = DateTime.fromMillisecondsSinceEpoch(timestamp * 1000);
               }
             }
          }
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
        } else if (data['client_id'] != null && data['client_id'].toString().isNotEmpty) {
          name = data['client_id'];
        } else {
          name = docId;
        }

        if (name.contains('@') && !name.contains(' ')) {
          name = name.split('@')[0];
        }

        final preview = data['last_message_preview'] ?? 'Fără previzualizare';
        final assignedTo = data['assigned_employee_id'];
        String accountLabel = data['account_label'] ?? '';
        final photoUrl = data['photo_url'];

        return ListTile(
          leading: CircleAvatar(
            backgroundColor: Colors.grey,
            backgroundImage: (photoUrl != null && photoUrl.toString().isNotEmpty)
                ? NetworkImage(photoUrl.toString())
                : null,
            child: (photoUrl == null || photoUrl.toString().isEmpty)
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
            preview.toString(),
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
              if (assignedTo != null && assignedTo.toString().isNotEmpty)
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
