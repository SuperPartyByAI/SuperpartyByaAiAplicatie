import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:qr_flutter/qr_flutter.dart';

class WhatsAppMonitorScreen extends StatelessWidget {
  const WhatsAppMonitorScreen({Key? key}) : super(key: key);

  Color _getStateColor(String state, {bool isStale = false}) {
    if (state == 'connected') return isStale ? Colors.orangeAccent : Colors.greenAccent;
    if (state == 'connecting') return Colors.blueAccent;
    if (state == 'needs_qr') return Colors.yellowAccent;
    return Colors.redAccent;
  }

  IconData _getStateIcon(String state, {bool isStale = false}) {
    if (state == 'connected') return isStale ? Icons.wifi_off : Icons.wifi;
    if (state == 'connecting') return Icons.autorenew;
    if (state == 'needs_qr') return Icons.qr_code_scanner;
    return Icons.error_outline;
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
      body: StreamBuilder<List<Map<String, dynamic>>>(
        stream: Supabase.instance.client.from('wa_accounts').stream(primaryKey: ['id']),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(child: Text('Error: ${snapshot.error}', style: TextStyle(color: Colors.red)));
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator(color: Colors.greenAccent));
          }

          final accounts = snapshot.data!;
          if (accounts.isEmpty) {
            return const Center(child: Text('Telemětrie Inactivă. Niciun agent WhatsApp găsit.', style: TextStyle(color: Colors.white70)));
          }

          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: accounts.length,
            itemBuilder: (context, index) {
              final doc = accounts[index];
              final docId = doc['id']?.toString() ?? 'unknown';
              
              final label = doc['label'] ?? docId;
              final state = doc['status'] ?? doc['state'] ?? 'disconnected';
              final pingMs = doc['ping_ms'] ?? 0;
              final msgsIn = doc['messages_in'] ?? 0;
              final msgsOut = doc['messages_out'] ?? 0;
              final phone = doc['phone_number'] ?? 'Așteaptă Validarea';
              final List recentLogs = (doc['recent_logs'] is List) ? doc['recent_logs'] as List : [];
              
              final lastPingAt = doc['last_ping_at'];
              int lastPingMs = 0;
              if (lastPingAt != null) {
                 if (lastPingAt is int) lastPingMs = lastPingAt;
                 else if (lastPingAt is String) {
                    lastPingMs = int.tryParse(lastPingAt) ?? DateTime.tryParse(lastPingAt)?.millisecondsSinceEpoch ?? 0;
                 }
              }

              bool isStale = false;
              bool isOnlineReal = false;
              String displayState = state.toString().toUpperCase();

              if (state == 'connected' && lastPingMs > 0) {
                  final nowMs = DateTime.now().millisecondsSinceEpoch;
                  final diffMs = nowMs - lastPingMs;
                  if (diffMs <= 90000) {
                      isOnlineReal = true;
                      displayState = 'ONLINE (Live)';
                  } else {
                      isStale = true;
                      final sec = (diffMs / 1000).toStringAsFixed(0);
                      displayState = 'STALE (-${sec}s)';
                  }
              }

              final Color stateColor = _getStateColor(state, isStale: isStale);
              final IconData stateIcon = _getStateIcon(state, isStale: isStale);

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
                              color: stateColor.withOpacity(0.2),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: stateColor),
                            ),
                            child: Row(
                              children: [
                                Icon(stateIcon, color: stateColor, size: 16),
                                const SizedBox(width: 4),
                                Text(
                                  displayState,
                                  style: TextStyle(color: stateColor, fontWeight: FontWeight.bold, fontSize: 12),
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
                      if (state == 'needs_qr' && doc['qr_code'] != null && doc['qr_code'].toString().isNotEmpty) ...[
                        const Divider(color: Colors.white24, height: 24),
                        const Text('⚠️ Scan required for recovery:', style: TextStyle(color: Colors.orangeAccent, fontWeight: FontWeight.bold, fontSize: 13)),
                        const SizedBox(height: 8),
                        Center(
                          child: Container(
                             color: Colors.white,
                             padding: const EdgeInsets.all(8),
                             child: QrImageView(data: doc['qr_code'].toString(), size: 200),
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],
                      
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
                                  children: recentLogs.reversed.take(5).map((log) => 
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
