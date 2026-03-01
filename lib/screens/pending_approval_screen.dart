import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/auth_service.dart';
import '../services/backend_service.dart';

class PendingApprovalScreen extends StatefulWidget {
  final VoidCallback? onApproved;
  const PendingApprovalScreen({super.key, this.onApproved});

  @override
  State<PendingApprovalScreen> createState() => _PendingApprovalScreenState();
}

class _PendingApprovalScreenState extends State<PendingApprovalScreen> {
  bool _isLoading = false;

  void _checkStatus() async {
    setState(() => _isLoading = true);
    final auth = Provider.of<AuthService>(context, listen: false);
    final backend = Provider.of<BackendService>(context, listen: false);

    try {
      // Force token refresh to get new claims if approved
      await auth.refreshUser(); 
      
      // Also check API explicit status
      final status = await backend.getMyStatus(); // endpoint /me
      
      if (status['approved'] == true) {
         ScaffoldMessenger.of(context).showSnackBar(
           const SnackBar(content: Text('Approved! Redirecting...')),
         );
         widget.onApproved?.call();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
           SnackBar(content: Text('Status: ${status['status'] ?? 'Pending'}')),
         );
      }

    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error checking status: $e')),
      );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthService>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Pending Approval'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => auth.signOut(),
          )
        ],
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.hourglass_empty, size: 64, color: Colors.orange),
            const SizedBox(height: 20),
            const Text(
              'Your account is pending approval.',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 10),
            const Text('An admin must approve your request before you can access the app.'),
            const SizedBox(height: 30),
            _isLoading
                ? const CircularProgressIndicator()
                : ElevatedButton.icon(
                    onPressed: _checkStatus,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Check Status'),
                  ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }
}
