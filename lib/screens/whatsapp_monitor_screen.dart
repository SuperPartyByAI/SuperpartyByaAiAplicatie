import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

class WhatsAppMonitorScreen extends StatelessWidget {
  const WhatsAppMonitorScreen({Key? key}) : super(key: key);

  Color _getStateColor(String state) {
    if (state == 'connected') return Colors.greenAccent;
    if (state == 'connecting') return Colors.orangeAccent;
    return Colors.redAccent;
  }

  IconData _getStateIcon(String state) {
    if (state == 'connected') return Icons.check_circle;
    if (state == 'connecting') return Icons.autorenew;
    return Icons.error;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[900], // Dark premium theme
      appBar: AppBar(
        title: const Text('Server Monitor', style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: Colors.black,
        elevation: 0,
      ),
      body: StreamBuilder<dynamic>(
        stream: Stream.empty(),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(child: Text('Error: ${snapshot.error}', style: TextStyle(color: Colors.red)));
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator(color: Colors.greenAccent));
          }

          final accounts = snapshot.data!.docs;
          if (accounts.isEmpty) {
            return const Center(child: Text('Telemětrie Inactivă. Niciun agent WhatsApp găsit.', style: TextStyle(color: Colors.white70)));
          }

          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: accounts.length,
            itemBuilder: (context, index) {
              final doc = accounts[index].data() as Map<String, dynamic>;
              final docId = accounts[index].id;
              
              final label = doc['label'] ?? docId;
              final state = doc['state'] ?? doc['status'] ?? 'disconnected';
              final pingMs = doc['pingMs'] ?? 0;
              final msgsIn = doc['messagesIn'] ?? 0;
              final msgsOut = doc['messagesOut'] ?? 0;
              final phone = doc['phoneNumber'] ?? 'Așteaptă Validarea';
              final dynamic recentLogs = doc['recentLogs'] ?? [];

              return Card(
                color: Colors.grey[850],
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                margin: const EdgeInsets.only(bottom: 16),
                elevation: 4,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Header: Label and State
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Text(
                              '$label',
                              style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: _getStateColor(state).withOpacity(0.2),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: _getStateColor(state)),
                            ),
                            child: Row(
                              children: [
                                Icon(_getStateIcon(state), color: _getStateColor(state), size: 16),
                                const SizedBox(width: 4),
                                Text(
                                  state.toUpperCase(),
                                  style: TextStyle(color: _getStateColor(state), fontWeight: FontWeight.bold, fontSize: 12),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text('📱 $phone', style: const TextStyle(color: Colors.white54, fontSize: 14)),
                      
                      const Divider(color: Colors.white24, height: 24),
                      
                      // Telemetry Stats Row
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceAround,
                        children: [
                          _buildStatColumn('PING', '${pingMs}ms', pingMs > 1000 ? Colors.redAccent : (pingMs > 0 ? Colors.greenAccent : Colors.grey)),
                          _buildStatColumn('IN', '$msgsIn', Colors.blueAccent),
                          _buildStatColumn('OUT', '$msgsOut', Colors.purpleAccent),
                        ],
                      ),
                      
                      const SizedBox(height: 16),
                      
                      // Recent Logs Section
                      const Text('Jurnal Evenimente Tehnice:', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold, fontSize: 12)),
                      const SizedBox(height: 8),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.black26,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: Colors.white10),
                        ),
                        child: recentLogs.isNotEmpty 
                          ? Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: (recentLogs as List).reversed.take(5).map((log) => 
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 4),
                                  child: Text('• $log', style: const TextStyle(color: Colors.white60, fontSize: 11, fontFamily: 'monospace')),
                                )
                              ).toList(),
                            )
                          : const Text('Niciun eveniment înregistrat încă.', style: TextStyle(color: Colors.white38, fontSize: 11, fontStyle: FontStyle.italic)),
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }

  Widget _buildStatColumn(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.bold)),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(color: Colors.white54, fontSize: 10, letterSpacing: 1)),
      ],
    );
  }
}
