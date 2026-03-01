import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

class AppInboxScreen extends StatelessWidget {
  const AppInboxScreen({Key? key}) : super(key: key);

  void _markAsRead(String docId, List<dynamic> currentReadBy, String uid) async {
    if (!currentReadBy.contains(uid)) {
      await /* Removed */ ;
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = (Supabase.instance.client.auth.currentUser);
    if (user == null) {
      return const Scaffold(body: Center(child: Text('Trebuie să fii autentificat.')));
    }
    final String currentUid = user.uid;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Cutia Poștală', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        backgroundColor: const Color(0xFF008069),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      backgroundColor: Colors.grey[100],
      body: FutureBuilder<dynamic>(
        future: /* Removed */ ;
          }

          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          final docs = snapshot.data?.docs ?? [];

          if (docs.isEmpty) {
            return const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.mark_email_read, size: 80, color: Colors.grey),
                  SizedBox(height: 20),
                  Text('Cutia poștală este goală.', style: TextStyle(color: Colors.black54, fontSize: 18)),
                ],
              ),
            );
          }

          return ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: docs.length,
            itemBuilder: (context, index) {
              final data = docs[index].data() as Map<String, dynamic>;
              final docId = docs[index].id;
              
              final String title = data['title'] ?? 'Mesaj Fără Titlu';
              final String body = data['body'] ?? '';
              final String type = data['type'] ?? 'info';
              final dynamic? timestamp = data['timestamp'] as dynamic?;
              final List<dynamic> readBy = data['readBy'] ?? [];
              
              final bool isUnread = !readBy.contains(currentUid);
              
              // Color coding based on type
              Color cardColor = Colors.white;
              Color iconColor = Colors.blue;
              IconData iconData = Icons.info;
              
              if (type == 'error') {
                iconColor = Colors.red;
                iconData = Icons.warning;
              } else if (type == 'announcement') {
                iconColor = Colors.purple;
                iconData = Icons.campaign;
              }

              // Format time
              String timeStr = '';
              if (timestamp != null) {
                final date = timestamp.toDate();
                timeStr = DateFormat('dd MMM, HH:mm').format(date);
              }

              return Card(
                elevation: isUnread ? 4 : 1,
                margin: const EdgeInsets.only(bottom: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: BorderSide(
                    color: isUnread ? Colors.red.withOpacity(0.5) : Colors.transparent,
                    width: 2,
                  ),
                ),
                child: InkWell(
                  onTap: () => _markAsRead(docId, readBy, currentUid),
                  borderRadius: BorderRadius.circular(12),
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: iconColor.withOpacity(0.1),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(iconData, color: iconColor, size: 28),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Expanded(
                                    child: Text(
                                      title,
                                      style: TextStyle(
                                        fontWeight: isUnread ? FontWeight.bold : FontWeight.w600,
                                        fontSize: 16,
                                        color: isUnread ? Colors.black87 : Colors.black54,
                                      ),
                                    ),
                                  ),
                                  if (timeStr.isNotEmpty)
                                    Text(
                                      timeStr,
                                      style: const TextStyle(fontSize: 12, color: Colors.grey),
                                    ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Text(
                                body,
                                style: TextStyle(
                                  fontSize: 14,
                                  color: isUnread ? Colors.black87 : Colors.grey[600],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
