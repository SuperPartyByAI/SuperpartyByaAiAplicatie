import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/voip_service.dart';
import '../services/backend_service.dart';
import '../services/auth_service.dart';
import '../services/supabase_service.dart';

class IncomingCallScreen extends StatefulWidget {
  final String conf;
  final String callSid;
  final String caller;
  final String sig;
  final String expires;

  const IncomingCallScreen({
    Key? key,
    required this.conf,
    required this.callSid,
    required this.caller,
    required this.sig,
    required this.expires,
  }) : super(key: key);

  @override
  State<IncomingCallScreen> createState() => _IncomingCallScreenState();
}

class _IncomingCallScreenState extends State<IncomingCallScreen> {
  bool _isAccepting = false;

  Future<void> _handleAccept() async {
    setState(() {
      _isAccepting = true;
    });

    try {
      final backend = Provider.of<BackendService>(context, listen: false);
      final auth = Provider.of<AuthService>(context, listen: false);
      final email = auth.currentUser?.email;

      String deviceNumber = '';
      if (email != null && email.isNotEmpty) {
        final rows = await SupabaseService.select('employees', filters: {'email': 'eq.$email'}, limit: 1);
        if (rows.isNotEmpty) {
          deviceNumber = rows.first['phone'] ?? '';
        }
      }

      if (deviceNumber.isEmpty) {
        debugPrint('[IncomingCallScreen] Cannot accept: No device number (phone) found for employee.');
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Eroare: Numărul de telefon nu a fost găsit în profil.')),
          );
          Navigator.pop(context);
        }
        return;
      }

      // Add Romanian prefix if missing
      if (deviceNumber.startsWith('07')) {
        deviceNumber = '+40\${deviceNumber.substring(1)}';
      }

      bool ok = await VoipService.acceptCall(
        widget.conf,
        widget.callSid,
        deviceNumber,
        BackendService.BASE_URL.replaceFirst('/api', ''),
        widget.sig,
        widget.expires
      );

      if (ok) {
        debugPrint('[IncomingCallScreen] Call accepted successfully. Wait for GSM bridge.');
        // Don't close immediately so the user sees something is happening, or close letting them see the GSM call.
      } else {
        debugPrint('[IncomingCallScreen] Accept failed.');
      }
    } catch (e) {
      debugPrint('[IncomingCallScreen] Error in accept: $e');
    } finally {
      if (mounted) {
        Navigator.pop(context);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1E1E1E),
      body: SafeArea(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Spacer(),
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white.withOpacity(0.1),
              ),
              child: const Icon(Icons.person, size: 80, color: Colors.white),
            ),
            const SizedBox(height: 30),
            Text(
              'Apel de la \${widget.caller}',
              style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 10),
            const Text(
              'Apel PBX SuperParty...',
              style: TextStyle(color: Colors.white70, fontSize: 16),
            ),
            const Spacer(),
            if (_isAccepting)
              const CircularProgressIndicator(color: Colors.green)
            else
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  // Refuză Button
                  Column(
                    children: [
                      FloatingActionButton(
                        heroTag: 'decline_btn',
                        backgroundColor: Colors.redAccent,
                        onPressed: () => Navigator.pop(context),
                        child: const Icon(Icons.call_end, color: Colors.white, size: 30),
                      ),
                      const SizedBox(height: 12),
                      const Text('Refuză', style: TextStyle(color: Colors.white, fontSize: 16)),
                    ],
                  ),
                  // Accept Button
                  Column(
                    children: [
                      FloatingActionButton(
                        heroTag: 'accept_btn',
                        backgroundColor: Colors.greenAccent.shade700,
                        onPressed: _handleAccept,
                        child: const Icon(Icons.call, color: Colors.white, size: 30),
                      ),
                      const SizedBox(height: 12),
                      const Text('Răspunde', style: TextStyle(color: Colors.white, fontSize: 16)),
                    ],
                  ),
                ],
              ),
            const SizedBox(height: 60),
          ],
        ),
      ),
    );
  }
}
