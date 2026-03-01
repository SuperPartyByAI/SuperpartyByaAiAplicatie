import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:http/http.dart' as http;
import '../services/auth_service.dart';
import '../services/backend_service.dart';
import '../services/voip_service.dart';

class DiagnosticsScreen extends StatefulWidget {
  const DiagnosticsScreen({super.key});
  @override
  State<DiagnosticsScreen> createState() => _DiagnosticsScreenState();
}

class _DiagnosticsScreenState extends State<DiagnosticsScreen> {
  String _fcmToken = '...';
  String _twilioPushSid = '(necunoscut)';
  bool _isVoipRegistered = false;
  bool _isAuthenticated = false;
  bool _isApproved = false;
  bool _hasConsent = false;
  String _logs = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _refreshAll());
  }

  void _appendLog(String s) {
    setState(() {
      _logs = '⏱ ${DateTime.now().toLocal().toIso8601String().substring(11, 19)} — $s\n$_logs';
    });
  }

  Future<void> _refreshAll() async {
    _appendLog('Refresh started...');

    // Capture providers synchronously before any async gaps
    final auth = Provider.of<AuthService>(context, listen: false);
    final backend = Provider.of<BackendService>(context, listen: false);
    setState(() => _isAuthenticated = auth.isAuthenticated);

    // FCM Token
    try {
      final token = await Future.value('dummy_token');
      setState(() => _fcmToken = token ?? 'NO_TOKEN');
      _appendLog('FCM: ${_snip(_fcmToken)}');
    } catch (e) {
      _appendLog('FCM error: $e');
    }

    // Status & consent from backend
    try {
      final status = await backend.getMyStatus();
      final profile = await backend.getUserProfile();
      setState(() {
        _isApproved = status['approved'] == true;
        _hasConsent = profile['latestConsentVersion'] != null;
      });
      _appendLog('Status: approved=$_isApproved consent=$_hasConsent');
    } catch (e) {
      _appendLog('Status error: $e');
    }

    // Fetch Twilio token + decode push_credential_sid
    try {
      final idToken = await auth.getIdToken();
      final resp = await http.get(
        Uri.parse('${BackendService.BASE_URL}/voice/token'),
        headers: {'Authorization': 'Bearer $idToken'},
      );
      if (resp.statusCode == 200) {
        final body = json.decode(resp.body);
        final tok = body['token'] as String?;
        if (tok != null) {
          final parts = tok.split('.');
          if (parts.length >= 2) {
            final payload = json.decode(
              utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
            ) as Map<String, dynamic>;
            final grants = payload['grants'] as Map<String, dynamic>? ?? {};
            final voiceGrant = grants['voice'] as Map<String, dynamic>? ?? {};
            final sid = voiceGrant['push_credential_sid'] as String? ?? '(not found in grant)';
            setState(() => _twilioPushSid = sid);
            _appendLog('Twilio token OK. PushSID: $sid');
          }
        }
      } else {
        _appendLog('/voice/token: HTTP ${resp.statusCode} — ${resp.body}');
      }
    } catch (e) {
      _appendLog('Twilio token error: $e');
    }
  }


  Future<void> _forceVoipInit() async {
    _appendLog('Force VoIP init...');
    try {
      final backend = Provider.of<BackendService>(context, listen: false);
      final svc = VoipService();
      await svc.init(backend);
      setState(() => _isVoipRegistered = true);
      _appendLog('✅ VoIP init done');
    } catch (e) {
      _appendLog('VoIP init error: $e');
    }
  }

  Future<void> _simulatePush() async {
    _appendLog('Trimit simulate_push → server...');
    try {
      final resp = await http.post(
        Uri.parse('${BackendService.BASE_URL}/voice/simulate_push'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ${await Provider.of<AuthService>(context, listen: false).getIdToken()}',
        },
        body: json.encode({'fcmToken': _fcmToken}),
      );
      _appendLog('simulate_push: ${resp.statusCode} ${resp.body}');
    } catch (e) {
      _appendLog('simulate_push error: $e');
    }
  }

  void _showCurlInstructions() {
    _appendLog(
      'CURL:\ncurl -X POST \\\n  -H "Authorization: key=FCM_SERVER_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"to":"$_fcmToken","priority":"high","data":{"twi_message_type":"twilio.voice.call","twi_call_sid":"CA_TEST"}}\' \\\n  https://fcm.googleapis.com/fcm/send',
    );
  }

  String _snip(String t) {
    if (t.length <= 16) return t;
    return '${t.substring(0, 8)}…${t.substring(t.length - 8)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF121212),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E1E1E),
        title: const Text('🔍 VoIP Diagnostics', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: _refreshAll,
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Status chips
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                _chip('Autentificat', _isAuthenticated),
                _chip('Aprobat', _isApproved),
                _chip('Consent', _hasConsent),
                _chip('VoIP reg', _isVoipRegistered),
              ],
            ),
            const SizedBox(height: 10),
            // Token info
            _infoTile('FCM Token', _snip(_fcmToken)),
            _infoTile('Twilio PushSID', _twilioPushSid),
            const Divider(color: Colors.white24),
            // Action buttons
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                _btn('Force VoIP Init', Icons.phone_callback, _forceVoipInit),
                _btn('Simulate Push', Icons.send, _simulatePush, color: Colors.orange),
                _btn('Arată CURL', Icons.terminal, _showCurlInstructions, color: Colors.grey),
              ],
            ),
            const SizedBox(height: 8),
            const Text('Instrucțiuni test:', style: TextStyle(color: Colors.white70, fontSize: 12)),
            const Text(
              '1. Force VoIP Init → verifică VoIP reg=YES\n'
              '2. Pune app în background / blochează ecranul\n'
              '3. Simulate Push → ar trebui să apară ecranul nativ de apel\n'
              '4. Dacă nu apare → copiază logurile de mai jos + adb logcat',
              style: TextStyle(color: Colors.white38, fontSize: 11),
            ),
            const Divider(color: Colors.white24),
            // Logs
            const Text('Logs:', style: TextStyle(color: Colors.white54, fontSize: 12)),
            Expanded(
              child: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: const Color(0xFF0A0A0A),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: SingleChildScrollView(
                  child: Text(
                    _logs.isEmpty ? '(fără loguri)' : _logs,
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      color: Color(0xFF00FF88),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _chip(String label, bool ok) => Chip(
        label: Text('$label: ${ok ? 'YES' : 'NO'}',
            style: const TextStyle(fontSize: 12, color: Colors.black)),
        backgroundColor: ok ? Colors.green[400] : Colors.red[400],
        padding: EdgeInsets.zero,
      );

  Widget _infoTile(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          children: [
            Text('$label: ', style: const TextStyle(color: Colors.white54, fontSize: 12)),
            Expanded(
              child: Text(
                value,
                style: const TextStyle(color: Colors.white, fontSize: 12, fontFamily: 'monospace'),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      );

  Widget _btn(String label, IconData icon, VoidCallback onPressed, {Color color = Colors.blueAccent}) =>
      ElevatedButton.icon(
        icon: Icon(icon, size: 16),
        label: Text(label, style: const TextStyle(fontSize: 12)),
        onPressed: onPressed,
        style: ElevatedButton.styleFrom(backgroundColor: color, foregroundColor: Colors.white),
      );
}
