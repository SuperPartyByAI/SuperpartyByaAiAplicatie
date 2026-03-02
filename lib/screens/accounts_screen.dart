import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/backend_service.dart';
import '../services/auth_service.dart';
import 'whatsapp_monitor_screen.dart';

class AccountsScreen extends StatefulWidget {
  const AccountsScreen({super.key});

  @override
  State<AccountsScreen> createState() => _AccountsScreenState();
}

class _AccountsScreenState extends State<AccountsScreen> {
  bool _isCreating = false;

  Future<void> _createAccount() async {
    final labelController = TextEditingController();
    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New WhatsApp Account'),
        content: TextField(
          controller: labelController,
          decoration: const InputDecoration(labelText: 'Label (e.g. Sales, Support)'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(
            onPressed: () async {
              Navigator.pop(ctx);
              if (labelController.text.isNotEmpty) {
                try {
                  setState(() => _isCreating = true);
                  final service = Provider.of<BackendService>(context, listen: false);
                  await service.createAccount(labelController.text);
                } catch (e) {
                   ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
                } finally {
                  if (mounted) setState(() => _isCreating = false);
                }
              }
            },
            child: const Text('Create'),
          )
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('WhatsApp Accounts'),
        actions: [
          IconButton(
            icon: const Icon(Icons.monitor_heart),
            color: Colors.greenAccent,
            tooltip: 'Live Telemetry Dashboard',
            onPressed: () {
               Navigator.push(context, MaterialPageRoute(builder: (_) => const WhatsAppMonitorScreen()));
            },
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () async {
              await Provider.of<AuthService>(context, listen: false).signOut();
              Navigator.of(context).popUntil((route) => route.isFirst);
            },
          ),
        ],
      ),
      body: Column(
        children: [
          if (_isCreating) const LinearProgressIndicator(),
          Expanded(
            child: StreamBuilder<List<Map<String, dynamic>>>(
              stream: Supabase.instance.client.from('wa_accounts').stream(primaryKey: ['id']),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return Center(child: Text('Error: ${snapshot.error}'));
                }
                if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }

                final docs = snapshot.data ?? [];
                
                if (docs.isEmpty) {
                   return const Center(child: Text('No accounts found. Create one!'));
                }

                return ListView.builder(
                  itemCount: docs.length,
                  itemBuilder: (ctx, i) {
                    final data = docs[i];
                    final docId = data['id']?.toString() ?? '';
                    final label = data['label'] ?? 'Account';
                    final status = data['state'] ?? data['status'] ?? 'unknown'; // Prefer state, fallback to status
                    final phone = data['phone_number'] ?? 'Unknown';
                    
                    final needsQr = status == 'needs_qr' || status == 'logged_out' || status == 'disconnected';

                    return Card(
                      margin: const EdgeInsets.all(8),
                      child: ExpansionTile(
                        leading: _buildStatusIcon(status),
                        title: Text(label),
                        subtitle: Text('Status: $status\nID: $docId'),
                        children: [
                          if (status == 'scanning')
                             const Padding(
                               padding: EdgeInsets.all(16.0),
                               child: CircularProgressIndicator(),
                             ),
                          if (needsQr)
                             Padding(
                               padding: const EdgeInsets.all(16.0),
                               child: Column(
                                 children: [
                                    _QrPollingWidget(accountId: docId),
                                    const SizedBox(height: 10),
                                    ElevatedButton.icon(
                                      icon: const Icon(Icons.qr_code),
                                      label: const Text('Regenerate QR'),
                                      onPressed: () async {
                                        try {
                                          final service = Provider.of<BackendService>(context, listen: false);
                                          await service.regenerateQR(docId);
                                          ScaffoldMessenger.of(context).showSnackBar(
                                            const SnackBar(content: Text('QR regenerating... wait a moment')),
                                          );
                                        } catch (e) {
                                          ScaffoldMessenger.of(context).showSnackBar(
                                            SnackBar(content: Text('Error: $e')),
                                          );
                                        }
                                      },
                                    ),
                                 ],
                               ),
                             ),
                           if (status == 'connected')
                              Padding(
                                padding: const EdgeInsets.all(16.0),
                                child: Column(
                                   children: [
                                      Text('Connected as: $phone'),
                                      const SizedBox(height: 5),
                                      const Text('Ready to use.', style: TextStyle(color: Colors.green)),
                                   ],
                                ),
                              ),
                        ],
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _createAccount,
        child: const Icon(Icons.add),
      ),
    );
  }

  Widget _buildStatusIcon(String status) {
     switch (status) {
       case 'connected': return const Icon(Icons.check_circle, color: Colors.green);
       case 'scanning': return const Icon(Icons.qr_code_scanner, color: Colors.orange);
       case 'needs_qr': return const Icon(Icons.qr_code, color: Colors.orange);
       case 'disconnected': return const Icon(Icons.error, color: Colors.red);
       default: return const Icon(Icons.help_outline, color: Colors.grey);
     }
  }
}

class _QrPollingWidget extends StatefulWidget {
  final String accountId;
  const _QrPollingWidget({required this.accountId, Key? key}) : super(key: key);

  @override
  State<_QrPollingWidget> createState() => _QrPollingWidgetState();
}

class _QrPollingWidgetState extends State<_QrPollingWidget> {
  String? _qrCode;
  bool _isDisposed = false;

  @override
  void initState() {
    super.initState();
    _pollQr();
  }

  @override
  void dispose() {
    _isDisposed = true;
    super.dispose();
  }

  Future<void> _pollQr() async {
    while (!_isDisposed) {
      if (!mounted) break;
      try {
        final service = Provider.of<BackendService>(context, listen: false);
        final data = await service.checkQrStatus(widget.accountId);
        if (data.containsKey('qr') && data['qr'] != null) {
           if (mounted) setState(() => _qrCode = data['qr']);
        }
      } catch (e) {
        debugPrint('Polling error: $e');
      }
      if (_isDisposed) break;
      await Future.delayed(const Duration(seconds: 3));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_qrCode == null) {
      return const Padding(
        padding: EdgeInsets.all(16.0),
        child: Text('Requesting latest QR Code from server...'),
      );
    }
    return Column(
      children: [
        const Text('Scan with WhatsApp:', style: TextStyle(fontWeight: FontWeight.bold)),
        const SizedBox(height: 10),
        Container(
          color: Colors.white,
          padding: const EdgeInsets.all(8),
          child: QrImageView(data: _qrCode!, size: 240),
        ),
      ],
    );
  }
}
