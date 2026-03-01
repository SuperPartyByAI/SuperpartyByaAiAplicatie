import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/backend_service.dart';
import '../widgets/admin_internal_chats_tab.dart'; // Import the internal chats screen
import 'whatsapp_monitor_screen.dart'; // Import the new telemetry dashboard

class AdminRequestsScreen extends StatefulWidget {
  const AdminRequestsScreen({super.key});

  @override
  State<AdminRequestsScreen> createState() => _AdminRequestsScreenState();
}

class _AdminRequestsScreenState extends State<AdminRequestsScreen> {
  List<dynamic> _requests = [];
  List<dynamic> _employees = [];
  List<dynamic> _suspended = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _fetchData();
  }

  void _fetchData() async {
    setState(() => _isLoading = true);
    final backend = Provider.of<BackendService>(context, listen: false);

    // ⚡ Execute all 3 backend requests in parallel to drastically improve loading speed
    final results = await Future.wait([
      () async { try { return await backend.getPendingRequests(); } catch (e) { print("Error requests: $e"); return []; } }(),
      () async { try { return await backend.getEmployees(); } catch (e) { print("Error employees: $e"); return []; } }(),
      () async { try { return await backend.getSuspendedEmployees(); } catch (e) { print("Error suspended: $e"); return []; } }(),
    ]);

    if (mounted) {
      setState(() {
        _requests = results[0];
        _employees = results[1];
        _suspended = results[2];
        _isLoading = false;
      });
    }
  }

  void _decide(String docId, String action) async {
    setState(() => _isLoading = true);
    final backend = Provider.of<BackendService>(context, listen: false);
    try {
      if (action == 'approve') {
        await backend.approveEmployee(docId);
      } else if (action == 'reject') {
        await backend.rejectEmployee(docId);
      } else if (action == 'suspend') {
        await backend.suspendEmployee(docId);
      }
      _fetchData(); // Refresh lists
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Action failed: $e')),
      );
      setState(() => _isLoading = false);
    }
  }

  Widget _buildRequestsList() {
    if (_requests.isEmpty) {
      return const Center(child: Text("Nu există cereri în așteptare"));
    }
    return ListView.builder(
      itemCount: _requests.length,
      itemBuilder: (context, index) {
        final req = _requests[index];
        return Card(
          child: ListTile(
            leading: const CircleAvatar(backgroundColor: Colors.orange, child: Icon(Icons.person_add, color: Colors.white)),
            title: Text(req['displayName'] ?? 'Necunoscut'),
            subtitle: Text(req['email'] ?? ''),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  icon: const Icon(Icons.check, color: Colors.green),
                  onPressed: () => _decide(req['docId'], 'approve'),
                ),
                IconButton(
                  icon: const Icon(Icons.close, color: Colors.red),
                  onPressed: () => _decide(req['docId'], 'reject'), // Permanent Reject
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildEmployeesList() {
    if (_employees.isEmpty) return const Center(child: Text("Nu există utilizatori aprobați"));
    return ListView.builder(
      itemCount: _employees.length,
      itemBuilder: (context, index) {
        final emp = _employees[index];
        return Card(
          child: ListTile(
            leading: const CircleAvatar(backgroundColor: Colors.green, child: Icon(Icons.check, color: Colors.white)),
            title: Text(emp['displayName'] ?? 'Necunoscut'),
            subtitle: Text(emp['personCode'] ?? emp['email'] ?? '', style: TextStyle(color: Colors.deepPurple, fontFamily: 'monospace', fontWeight: FontWeight.w600)),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  tooltip: 'Suspendare Temporară',
                  icon: const Icon(Icons.pause_circle_filled, color: Colors.orange),
                  onPressed: () => _decide(emp['docId'], 'suspend'),
                ),
                 IconButton(
                  tooltip: 'Blocare / Ștergere',
                  icon: const Icon(Icons.block, color: Colors.red),
                  onPressed: () => showDialog(
                    context: context,
                    builder: (context) => AlertDialog(
                      title: const Text('Revocare Acces'),
                      content: Text('Sigur vrei să blochezi accesul pentru ${emp['displayName']}?'),
                      actions: [
                        TextButton(child: const Text('Anulează'), onPressed: () => Navigator.pop(context)),
                        TextButton(
                          child: const Text('Blochează', style: TextStyle(color: Colors.red)),
                          onPressed: () {
                             Navigator.pop(context);
                             _decide(emp['docId'], 'reject');
                          },
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildSuspendedList() {
    if (_suspended.isEmpty) return const Center(child: Text("Nu există utilizatori suspendați"));
    return ListView.builder(
      itemCount: _suspended.length,
      itemBuilder: (context, index) {
        final emp = _suspended[index];
        return Card(
          color: Colors.grey[200],
          child: ListTile(
            leading: const CircleAvatar(backgroundColor: Colors.grey, child: Icon(Icons.pause, color: Colors.white)),
            title: Text(emp['displayName'] ?? 'Necunoscut', style: const TextStyle(decoration: TextDecoration.lineThrough)),
            subtitle: Text(emp['personCode'] ?? emp['email'] ?? '', style: const TextStyle(fontFamily: 'monospace')),
            trailing: IconButton(
              tooltip: 'Reactivare',
              icon: const Icon(Icons.play_circle_fill, color: Colors.green, size: 32),
              onPressed: () => _decide(emp['docId'], 'approve'), // Re-approve to reactivate
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 5,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Admin Panel'),
          bottom: const TabBar(
            isScrollable: true,
            tabs: [
              Tab(text: "Cereri", icon: Icon(Icons.person_add)),
              Tab(text: "Aprobați", icon: Icon(Icons.people)),
              Tab(text: "Suspendați", icon: Icon(Icons.pause)),
              Tab(text: "Interne", icon: Icon(Icons.business)),
              Tab(text: "Monitor", icon: Icon(Icons.monitor_heart, color: Colors.blueAccent)),
            ],
          ),
        ),
        body: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : TabBarView(
                children: [
                  _buildRequestsList(),
                  _buildEmployeesList(),
                  _buildSuspendedList(),
                  const AdminInternalChatsTab(), // Add the newly built Interne chats widget here
                  const WhatsAppMonitorScreen(), // The new Server Monitor Dashboard
                ],
              ),
      ),
    );
  }
}
