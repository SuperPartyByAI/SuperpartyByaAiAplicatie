import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;

class TeamManagementScreen extends StatefulWidget {
  const TeamManagementScreen({super.key});

  @override
  State<TeamManagementScreen> createState() => _TeamManagementScreenState();
}

class _TeamManagementScreenState extends State<TeamManagementScreen> {
  

  Future<void> _togglePermission(String docId, String permKey, bool currentVal) async {
    try {
      final token = await Future.value(Supabase.instance.client.auth.currentSession?.accessToken);
      final resp = await http.post(
        Uri.parse('http://46.225.182.127/api/admin/toggle-permission'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: jsonEncode({'docId': docId, 'permission': permKey, 'value': !currentVal}),
      );
      
      if (resp.statusCode == 200 && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(!currentVal ? '$permKey ACTIVAT' : '$permKey REVOCAT'),
            backgroundColor: !currentVal ? Colors.green : Colors.red,
            duration: const Duration(seconds: 1),
          ),
        );
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Eroare: ${resp.statusCode}'), backgroundColor: Colors.red),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Eroare: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  void _editPersonCode(String docId, String? currentCode, String name) {
    final controller = TextEditingController(text: currentCode ?? '');
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1F2937),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('Cod intern — $name', style: const TextStyle(color: Colors.white, fontSize: 16)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Scrie codul pe care vrei să-l atribui:', style: TextStyle(color: Colors.white70, fontSize: 13)),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              autofocus: true,
              style: const TextStyle(color: Colors.white, fontSize: 18, fontFamily: 'monospace', fontWeight: FontWeight.bold),
              decoration: InputDecoration(
                hintText: 'ex: Ana, BOSS, SP-123...',
                hintStyle: TextStyle(color: Colors.white.withOpacity(0.3)),
                filled: true,
                fillColor: Colors.white.withOpacity(0.05),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: const Color(0xFF7C3AED))),
                focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Color(0xFF7C3AED), width: 2)),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Anulează', style: TextStyle(color: Colors.white54)),
          ),
          if (currentCode != null && currentCode.isNotEmpty)
            TextButton(
              onPressed: () async {
                await _db.collection('employees').doc(docId).update({'personCode': FieldValue.delete()});
                if (mounted) Navigator.pop(ctx);
              },
              child: const Text('Șterge cod', style: TextStyle(color: Colors.red)),
            ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF7C3AED)),
            onPressed: () async {
              final newCode = controller.text.trim();
              debugPrint('[CODE] Save pressed, newCode="$newCode", docId=$docId');
              if (newCode.isEmpty) return;
              
              try {
                // Get auth token for admin verification
                final token = await Future.value(Supabase.instance.client.auth.currentSession?.accessToken);
                debugPrint('[CODE] Token obtained, calling API...');
                
                final resp = await http.post(
                  Uri.parse('http://46.225.182.127/api/admin/set-code'),
                  headers: {
                    'Content-Type': 'application/json',
                    if (token != null) 'Authorization': 'Bearer $token',
                  },
                  body: jsonEncode({'docId': docId, 'personCode': newCode}),
                );
                
                debugPrint('[CODE] API response: ${resp.statusCode} ${resp.body}');
                
                if (resp.statusCode == 200) {
                  if (mounted) {
                    Navigator.pop(ctx);
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Cod setat: $newCode'), backgroundColor: const Color(0xFF7C3AED)),
                    );
                  }
                } else if (resp.statusCode == 409) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Codul "$newCode" e deja folosit!'), backgroundColor: Colors.red),
                    );
                  }
                } else {
                  final body = jsonDecode(resp.body);
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Eroare: ${body['error'] ?? resp.statusCode}'), backgroundColor: Colors.red),
                    );
                  }
                }
              } catch (e) {
                debugPrint('[CODE] ERROR: $e');
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Eroare: $e'), backgroundColor: Colors.red),
                  );
                }
              }
            },
            child: const Text('Salvează', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  void _showPermissionsDialog(String docId, Map<String, dynamic> data) {
    final personCode = data['personCode']?.toString();
    final name = data['displayName'] ?? 'Fără Nume';
    final email = data['email'] ?? '';
    
    // Mutable local state for dialog
    bool canNote = data['canNoteEvents'] == true;
    bool canViewAll = data['canViewAllChats'] == true;
    bool canManage = data['canManageAccounts'] == true;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF1F2937),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
              const SizedBox(height: 4),
              Text(email, style: TextStyle(color: Colors.white.withOpacity(0.5), fontSize: 13)),
              const SizedBox(height: 8),
              Row(
                children: [
                  if (personCode != null && personCode.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: const Color(0xFF7C3AED).withOpacity(0.2),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: const Color(0xFF7C3AED), width: 1),
                      ),
                      child: Text(personCode, style: const TextStyle(color: Color(0xFF7C3AED), fontSize: 16, fontWeight: FontWeight.w600)),
                    )
                  else
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.orange.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text('fără cod', style: TextStyle(color: Colors.orange, fontSize: 14)),
                    ),
                  const SizedBox(width: 8),
                  GestureDetector(
                    onTap: () {
                      Navigator.pop(ctx);
                      _editPersonCode(docId, personCode, name);
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.edit, color: Colors.white70, size: 14),
                          SizedBox(width: 4),
                          Text('Editează', style: TextStyle(color: Colors.white70, fontSize: 12)),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildPermRow('Acces AI / Evenimente', 'canNoteEvents', canNote, docId, (newVal) {
                setDialogState(() => canNote = newVal);
              }),
              _buildPermRow('Vede toate chat-urile', 'canViewAllChats', canViewAll, docId, (newVal) {
                setDialogState(() => canViewAll = newVal);
              }),
              _buildPermRow('Gestionează conturi WA', 'canManageAccounts', canManage, docId, (newVal) {
                setDialogState(() => canManage = newVal);
              }),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Închide', style: TextStyle(color: Colors.white70)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPermRow(String label, String key, bool value, String docId, Function(bool) onUpdate) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(
            value ? Icons.check_circle : Icons.cancel,
            color: value ? Colors.green : Colors.red.withOpacity(0.5),
            size: 20,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: value ? Colors.white : Colors.white54,
                fontSize: 14,
                fontWeight: value ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
          ),
          Switch(
            value: value,
            activeColor: Colors.green,
            activeTrackColor: Colors.green.withOpacity(0.3),
            inactiveThumbColor: Colors.red.withOpacity(0.7),
            inactiveTrackColor: Colors.red.withOpacity(0.2),
            onChanged: (newVal) async {
              onUpdate(newVal);
              await _togglePermission(docId, key, !newVal);
            },
          ),
        ],
      ),
    );
  }

  void _copyCode(String code) {
    Clipboard.setData(ClipboardData(text: code));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Cod copiat: $code'),
        backgroundColor: const Color(0xFF7C3AED),
        duration: const Duration(seconds: 1),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Echipă & Permisiuni', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        backgroundColor: const Color(0xFF111827),
        iconTheme: const IconThemeData(color: Colors.white),
        elevation: 0,
      ),
      backgroundColor: const Color(0xFF111827),
      body: StreamBuilder<dynamic>(
        stream: _db.collection('employees').where('approved', isEqualTo: true).snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator(color: Color(0xFF7C3AED)));
          }

          if (snapshot.hasError) {
            return Center(child: Text('Eroare: ${snapshot.error}', style: const TextStyle(color: Colors.red)));
          }

          final docs = snapshot.data?.docs ?? [];

          if (docs.isEmpty) {
            return const Center(
              child: Text(
                'Nu ați acceptat încă niciun angajat.\nMergeți în secțiunea de aprobare.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey, fontSize: 16),
              ),
            );
          }

          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: docs.length,
            itemBuilder: (context, index) {
              final doc = docs[index];
              final data = doc.data() as Map<String, dynamic>;
              
              final name = data['displayName']?.toString() ?? data['nume']?.toString() ?? 'Fără Nume';
              final email = data['email']?.toString() ?? '';
              final personCode = data['personCode']?.toString();
              final role = data['role']?.toString() ?? 'employee';
              final canNote = data['canNoteEvents'] == true;
              final canViewAll = data['canViewAllChats'] == true;
              final canManage = data['canManageAccounts'] == true;
              
              final activePerms = <String>[];
              if (canNote) activePerms.add('AI');
              if (canViewAll) activePerms.add('Chat');
              if (canManage) activePerms.add('WA');

              return Container(
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: const Color(0xFF1F2937),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.white.withOpacity(0.08)),
                ),
                child: InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: () => _showPermissionsDialog(doc.id, data),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        // Avatar
                        Container(
                          width: 48,
                          height: 48,
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: role == 'admin' 
                                ? [const Color(0xFFEF4444), const Color(0xFFF97316)]
                                : [const Color(0xFF7C3AED), const Color(0xFF6366F1)],
                            ),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Center(
                            child: Text(
                              name.isNotEmpty ? name[0].toUpperCase() : '?',
                              style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ),
                        const SizedBox(width: 14),
                        // Info
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 16)),
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  if (personCode != null && personCode.isNotEmpty) ...[
                                    GestureDetector(
                                      onTap: () => _copyCode(personCode),
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFF7C3AED).withOpacity(0.15),
                                          borderRadius: BorderRadius.circular(6),
                                        ),
                                        child: Text(personCode, style: const TextStyle(color: Color(0xFF7C3AED), fontSize: 13, fontWeight: FontWeight.w600)),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                  ] else ...[
                                    GestureDetector(
                                      onTap: () => _editPersonCode(doc.id, personCode, name),
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: Colors.orange.withOpacity(0.15),
                                          borderRadius: BorderRadius.circular(6),
                                        ),
                                        child: const Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Icon(Icons.add, color: Colors.orange, size: 14),
                                            SizedBox(width: 2),
                                            Text('Setează cod', style: TextStyle(color: Colors.orange, fontSize: 12)),
                                          ],
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                  ],
                                  if (role == 'admin')
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: Colors.red.withOpacity(0.15),
                                        borderRadius: BorderRadius.circular(6),
                                      ),
                                      child: const Text('ADMIN', style: TextStyle(color: Colors.red, fontSize: 11, fontWeight: FontWeight.w600)),
                                    ),
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(email, style: TextStyle(color: Colors.white.withOpacity(0.35), fontSize: 11)),
                              if (activePerms.isNotEmpty) ...[
                                const SizedBox(height: 6),
                                Row(
                                  children: activePerms.map((p) => Container(
                                    margin: const EdgeInsets.only(right: 6),
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: Colors.green.withOpacity(0.12),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Text(p, style: const TextStyle(color: Colors.green, fontSize: 11, fontWeight: FontWeight.w500)),
                                  )).toList(),
                                ),
                              ],
                            ],
                          ),
                        ),
                        // Edit icon
                        IconButton(
                          icon: const Icon(Icons.edit, color: Colors.white24, size: 20),
                          onPressed: () => _editPersonCode(doc.id, personCode, name),
                          tooltip: 'Editează codul',
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
