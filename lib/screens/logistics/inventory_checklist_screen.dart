import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import '../services/backend_service.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class InventoryChecklistScreen extends StatefulWidget {
  final String eventId;
  const InventoryChecklistScreen({super.key, required this.eventId});

  @override
  State<InventoryChecklistScreen> createState() => _InventoryChecklistScreenState();
}

class _InventoryChecklistScreenState extends State<InventoryChecklistScreen> {
  bool _isLoading = true;
  List<dynamic> _requirements = [];

  @override
  void initState() {
    super.initState();
    _fetchRequirements();
  }

  Future<void> _fetchRequirements() async {
    setState(() => _isLoading = true);
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) throw Exception('No session found');
      
      final url = '${BackendService.AI_MANAGER_URL}/logistics/inventory/requirements/${widget.eventId}';
      final response = await http.get(Uri.parse(url), headers: {
        'Authorization': 'Bearer ${session.accessToken}',
      });

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data['ok'] == true) {
          setState(() {
            _requirements = data['data'];
          });
        }
      } else {
        debugPrint('[Inventory] Failed to fetch. Status: ${response.statusCode}');
      }
    } catch (e) {
      debugPrint('[Inventory] Error fetching: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _markItemHandoff(String inventoryItemId, String status) async {
    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) return;
      
      final url = '${BackendService.AI_MANAGER_URL}/logistics/inventory/handoff';
      final response = await http.post(
        Uri.parse(url),
        headers: {
          'Authorization': 'Bearer ${session.accessToken}',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'eventId': widget.eventId,
          'employeeId': session.user.id,
          'inventoryItemId': inventoryItemId,
          'status': status,
        })
      );

      if (response.statusCode == 201) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Status $status salvat!'), backgroundColor: Colors.green));
        // Refresh items or state
        _fetchRequirements();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Eroare salvare status'), backgroundColor: Colors.red));
      }
    } catch (e) {
      debugPrint('[Inventory] Handoff error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Componență Recuzită', style: TextStyle(color: Colors.white)),
        backgroundColor: Colors.indigo,
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      backgroundColor: Colors.grey[100],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _requirements.isEmpty
              ? const Center(child: Text('Nu există recuzită obligatorie listată pentru acest eveniment.'))
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _requirements.length,
                  itemBuilder: (context, index) {
                    final req = _requirements[index];
                    final itemDetails = req['inventory_items'];
                    final itemName = itemDetails?['name'] ?? 'Articol Necunoscut';
                    final qty = req['required_qty'] ?? 1;

                    return Card(
                      elevation: 2,
                      margin: const EdgeInsets.only(bottom: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      child: Padding(
                        padding: const EdgeInsets.all(16.0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(itemName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                            const SizedBox(height: 8),
                            Text('Necesar: $qty x ${itemDetails?['unit'] ?? 'buc'}', style: TextStyle(color: Colors.grey[700])),
                            if (req['notes'] != null)
                              Padding(
                                padding: const EdgeInsets.only(top: 4.0),
                                child: Text('Notă: ${req['notes']}', style: const TextStyle(fontStyle: FontStyle.italic)),
                              ),
                            const SizedBox(height: 16),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                              children: [
                                ElevatedButton.icon(
                                  style: ElevatedButton.styleFrom(backgroundColor: Colors.orange[100], foregroundColor: Colors.deepOrange),
                                  icon: const Icon(Icons.arrow_upward),
                                  label: const Text('Pick Up'),
                                  onPressed: () => _markItemHandoff(req['inventory_item_id'], 'picked_up'),
                                ),
                                ElevatedButton.icon(
                                  style: ElevatedButton.styleFrom(backgroundColor: Colors.green[100], foregroundColor: Colors.green[800]),
                                  icon: const Icon(Icons.check),
                                  label: const Text('Return'),
                                  onPressed: () => _markItemHandoff(req['inventory_item_id'], 'returned'),
                                ),
                                IconButton(
                                  color: Colors.red,
                                  icon: const Icon(Icons.warning_amber),
                                  onPressed: () => _markItemHandoff(req['inventory_item_id'], 'missing'),
                                  tooltip: 'Anunță Lipsă/Defect',
                                )
                              ],
                            )
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
