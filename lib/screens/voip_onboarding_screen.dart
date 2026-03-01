import 'dart:io';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:twilio_voice/twilio_voice.dart';

import '../services/voip_service.dart';
import '../services/voip_logger.dart';
import '../services/auth_service.dart';
import '../services/backend_service.dart';

/// Full-screen VoIP onboarding checklist.
/// Launched from Settings → "Configurare Apeluri VoIP".
class VoipOnboardingScreen extends StatefulWidget {
  const VoipOnboardingScreen({super.key});

  @override
  State<VoipOnboardingScreen> createState() => _VoipOnboardingScreenState();
}

class _VoipOnboardingScreenState extends State<VoipOnboardingScreen>
    with WidgetsBindingObserver {
  // ──────────────────────────── state ────────────────────────────
  bool _micOK = false;
  bool _notifOK = false;
  bool _phoneOK = false;
  bool _batteryOK = false;
  bool _callAccountOK = false; // Add state for tracking Telecom account
  bool _voipRegistered = false;
  bool _initRunning = false;
  bool _diagSending = false;
  String _logs = '';

  // ──────────────────────────── lifecycle ────────────────────────
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _checkAll();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Re-check statuses when user returns from system settings.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _checkAll();
  }

  // ──────────────────────────── helpers ──────────────────────────
  void _log(String msg) {
    final ts = DateTime.now().toLocal().toIso8601String().substring(11, 19);
    setState(() => _logs = '⏱ $ts — $msg\n$_logs');
  }

  Future<void> _checkAll() async {
    final mic = await Permission.microphone.status;
    final phone = await Permission.phone.status;
    final notif = await Permission.notification.status;
    bool battery = false;
    bool callCapable = false;
    if (Platform.isAndroid) {
      battery = await Permission.ignoreBatteryOptimizations.status ==
          PermissionStatus.granted;
      try {
        callCapable = await const MethodChannel('com.superpartybyai.app/diag')
            .invokeMethod<bool>('isCallCapable') ?? false;
      } catch (_) {}
    }
    setState(() {
      _micOK = mic.isGranted;
      _phoneOK = phone.isGranted;
      _notifOK = notif.isGranted;
      _batteryOK = battery;
      _callAccountOK = callCapable;
    });
  }

  bool get _essentialsDone => _micOK && _notifOK && _phoneOK && (!Platform.isAndroid || _callAccountOK);

  // ──────────────────────────── actions ──────────────────────────
  Future<void> _requestMic() async {
    final s = await Permission.microphone.request();
    setState(() => _micOK = s.isGranted);
    _log('Microfon: ${s.isGranted ? "✅ Acordat" : "❌ Refuzat"}');
    if (s.isPermanentlyDenied) _openSettingsDialog('microfon');
  }

  Future<void> _requestNotif() async {
    final settings = await FirebaseMessaging.instance.requestPermission(
      alert: true, badge: true, sound: true,
    );
    final ok = settings.authorizationStatus == AuthorizationStatus.authorized;
    setState(() => _notifOK = ok);
    _log('Notificări: ${ok ? "✅ Acordat" : "⚠️ ${settings.authorizationStatus.name}"}');
    if (!ok) {
      // Fallback: request via permission_handler (Android 13+)
      final s = await Permission.notification.request();
      setState(() => _notifOK = s.isGranted);
    }
  }

  Future<void> _requestPhone() async {
    final s = await Permission.phone.request();
    setState(() => _phoneOK = s.isGranted);
    _log('Telefon (READ_PHONE_STATE): ${s.isGranted ? "✅ Acordat" : "❌ Refuzat"}');
    if (s.isPermanentlyDenied) _openSettingsDialog('permisiunea de telefon');
  }

  Future<void> _requestBattery() async {
    if (!Platform.isAndroid) return;
    final s = await Permission.ignoreBatteryOptimizations.request();
    setState(() => _batteryOK = s.isGranted);
    _log('Baterie (ignore optimizări): ${s.isGranted ? "✅ Acordat" : "⚠️ Refuzat — deschide manual"}');
    if (!s.isGranted) {
      // Fallback: open battery settings via method channel
      try {
        const channel = MethodChannel('com.superpartybyai.app/settings');
        await channel.invokeMethod('openBatterySettings');
      } catch (_) {
        await openAppSettings();
      }
    }
  }

  Future<void> _requestAutostart() async {
    // There is no standard runtime permission for autostart.
    // Best we can do is send user to app details screen.
    _log('Autostart — deschide setările aplicației.');
    await openAppSettings();
  }

  Future<void> _requestCallingAccount() async {
    _log('Se solicită activarea Calling Account (Android 10+)...');
    try {
      if (Platform.isAndroid) {
        await TwilioVoice.instance.registerPhoneAccount();
        await TwilioVoice.instance.openPhoneAccountSettings();
        _log('✅ Te rugăm să activezi "Superparty" în meniul afișat.');
      } else {
        _log('ℹ️ Calling Accounts nu este valabil/necesar pe iOS.');
        setState(() => _callAccountOK = true);
      }
    } catch (e) {
      _log('❌ Eroare Calling Account: $e');
    }
  }

  Future<void> _sendDiag() async {
    if (_diagSending) return;
    setState(() => _diagSending = true);
    _log('═══ Trimitere diagnostic ═══');
    try {
      final auth = Provider.of<AuthService>(context, listen: false);
      final idToken = await auth.getIdToken();
      final fcmToken = await FirebaseMessaging.instance.getToken();
      final fcmHash = fcmToken != null
          ? fcmToken.substring(0, 10) + '...' + fcmToken.substring(fcmToken.length - 6)
          : 'null';

      // Collect notification channel info + DND state via native MethodChannel
      Map<String, dynamic>? channelInfo;
      bool? dndOff;
      if (Platform.isAndroid) {
        try {
          final raw = await const MethodChannel('com.superpartybyai.app/diag')
              .invokeMapMethod<String, dynamic>('getNotificationChannelInfo');
          if (raw != null) {
            channelInfo = Map<String, dynamic>.from(raw);
            dndOff = raw['dndOff'] as bool?;
            _log('📋 Channel importance=${channelInfo["importance"]} sound=${channelInfo["sound"] != "none" ? "✅" : "❌"} dndOff=$dndOff bypassDnd=${channelInfo["bypassDnd"]}');
          }
        } catch (e) {
          _log('⚠️ channelInfo error: $e');
        }
      }

      // Log callSid if known
      final lastSid = VoipLogger.instance.lastCallSid;
      if (lastSid != null) _log('📞 Last CallSid: $lastSid');

      final payload = VoipLogger.instance.buildDiagPayload(
        buildVersion: 'v40',
        deviceModel: Platform.operatingSystem,
        osVersion: Platform.operatingSystemVersion,
        userIdentity: 'superparty_admin',
        fcmTokenHash: fcmHash,
        voipRegistered: _voipRegistered,
        permissions: {
          'mic': _micOK,
          'notif': _notifOK,
          'phone': _phoneOK,
          'battery': _batteryOK,
        },
        channelInfo: channelInfo,
        dndOff: dndOff,
      );

      final resp = await http.post(
        Uri.parse('${BackendService.BASE_URL}/voice/diag'),
        headers: {
          'Content-Type': 'application/json',
          if (idToken != null) 'Authorization': 'Bearer $idToken',
        },
        body: jsonEncode(payload),
      );

      if (resp.statusCode == 200 || resp.statusCode == 201) {
        final body = jsonDecode(resp.body) as Map<String, dynamic>;
        final verdict = body['verdict'] ?? 'UNKNOWN';
        final detail  = body['detail'] ?? '';
        _log('✅ Trimis! (${VoipLogger.instance.toList().length} ev.) — SERVER VERDICT: $verdict');
        if (detail.toString().isNotEmpty) _log('   $detail');
      } else {
        _log('⚠️ Server: ${resp.statusCode} ${resp.body.substring(0, resp.body.length.clamp(0, 120))}');
      }
    } catch (e) {
      _log('❌ Eroare trimitere: $e');
      VoipLogger.instance.logAuthError('diag_send_error', details: e.toString());
    } finally {
      setState(() => _diagSending = false);
    }
  }

  Future<void> _forceVoipInit() async {
    if (_initRunning) return;
    setState(() {
      _initRunning = true;
      _voipRegistered = false;
    });
    _log('═══ Force VoIP Init ═══');

    try {
      final backend = Provider.of<BackendService>(context, listen: false);
      await VoipService().init(backend, forceReinit: true);
      setState(() => _voipRegistered = VoipService().isRegistered);
      _log(_voipRegistered
          ? '✅ Înregistrat ca "superparty_admin"'
          : '❌ Înregistrare eșuată — verifică permisiunile și rețeaua.');
    } catch (e) {
      _log('❌ Eroare init: $e');
    } finally {
      setState(() => _initRunning = false);
    }
  }

  void _openSettingsDialog(String what) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Permisiune necesară'),
        content: Text(
            'Permisiunea "$what" a fost permanent refuzată. '
            'Deschide setările aplicației și acordă-o manual.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Anulează')),
          ElevatedButton(
              onPressed: () {
                Navigator.pop(context);
                openAppSettings();
              },
              child: const Text('Deschide Setări')),
        ],
      ),
    );
  }

  // ──────────────────────────── UI ───────────────────────────────
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Configurare Apeluri VoIP'),
        centerTitle: true,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          children: [
            // ── Header ──
            Card(
              color: theme.colorScheme.primaryContainer,
              margin: const EdgeInsets.only(bottom: 16),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      const Icon(Icons.phone_in_talk, size: 28),
                      const SizedBox(width: 10),
                      Text('Apeluri Superparty',
                          style: theme.textTheme.titleLarge
                              ?.copyWith(fontWeight: FontWeight.bold)),
                    ]),
                    const SizedBox(height: 8),
                    const Text(
                        'Acordă permisiunile de mai jos pentru a primi apeluri '
                        'ca un apel telefonic normal, chiar dacă aplicația este '
                        'închisă sau ecranul este blocat.'),
                  ],
                ),
              ),
            ),

            // ── Permission tiles ──
            _PermTile(
              icon: Icons.mic,
              title: 'Microfon',
              subtitle: 'Necesar pentru audio în apel.',
              ok: _micOK,
              onTap: _requestMic,
            ),
            _PermTile(
              icon: Icons.notifications_active,
              title: 'Notificări',
              subtitle: 'Activează push VoIP (Android 13+).',
              ok: _notifOK,
              onTap: _requestNotif,
            ),
            _PermTile(
              icon: Icons.phone_android,
              title: 'Telefon',
              subtitle:
                  'READ_PHONE_STATE — integrare cu sistemul de apeluri Android.',
              ok: _phoneOK,
              onTap: _requestPhone,
              required: true,
            ),
            if (Platform.isAndroid)
              _PermTile(
                icon: Icons.sim_card,
                title: 'Cont Apelare (Android Telecom)',
                subtitle: _callAccountOK
                    ? 'Activ (Apasă pentru restabilire forțată)'
                    : 'Apasă pt. activare (Obligatoriu Android 10+)',
                ok: false, // Force the button to be always shown
                showCheckmark: false,
                onTap: _requestCallingAccount,
                required: true,
              ),
            _PermTile(
              icon: Icons.battery_charging_full,
              title: 'Dezactivează optimizări baterie',
              subtitle:
                  'Permite aplicației să primească apeluri în background / când e închisă.',
              ok: _batteryOK,
              onTap: _requestBattery,
              required: false,
              optionalLabel: 'Recomandat',
            ),
            _PermTile(
              icon: Icons.launch,
              title: 'Autostart (Xiaomi / Huawei / Samsung)',
              subtitle:
                  'Dacă ai un telefon OEM: activează Autostart din setările producătorului.',
              ok: false, // can't check programmatically
              onTap: _requestAutostart,
              required: false,
              optionalLabel: 'OEM specific',
              showCheckmark: false,
            ),

            const SizedBox(height: 20),

            // ── Force VoIP Init ──
            ElevatedButton.icon(
              icon: _initRunning
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : Icon(_voipRegistered ? Icons.check_circle : Icons.sync),
              label: Text(_initRunning
                  ? 'Se înregistrează...'
                  : _voipRegistered
                      ? '✅ Înregistrat ca superparty_admin'
                      : 'Înregistrează și testează'),
              onPressed: _essentialsDone && !_initRunning ? _forceVoipInit : null,
              style: ElevatedButton.styleFrom(
                minimumSize: const Size(double.infinity, 52),
                backgroundColor: _voipRegistered
                    ? Colors.green
                    : theme.colorScheme.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
            ),

            if (!_essentialsDone) ...[
              const SizedBox(height: 8),
              const Text(
                '⚠️ Acordă Microfonul, Notificările și Telefonul pentru a continua.',
                style: TextStyle(color: Colors.orange, fontSize: 12),
                textAlign: TextAlign.center,
              ),
            ],

            const SizedBox(height: 20),

            // ── Remote Diagnostics ──
            OutlinedButton.icon(
              icon: _diagSending
                  ? const SizedBox(
                      width: 18, height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.upload_rounded),
              label: Text(_diagSending
                  ? 'Trimitere...'
                  : 'Trimite Diagnostic (${VoipLogger.instance.toList().length} ev.)'),
              onPressed: _diagSending ? null : _sendDiag,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(double.infinity, 48),
                side: BorderSide(color: Colors.blue.shade400),
                foregroundColor: Colors.blue.shade700,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
            ),
            const Padding(
              padding: EdgeInsets.only(top: 6, bottom: 4),
              child: Text(
                '📲 Apasă după orice test de apel (fără USB). '
                'Timeline-ul complet se trimite la server — vizibil în /api/voice/diag/latest.',
                style: TextStyle(fontSize: 11, color: Colors.grey),
                textAlign: TextAlign.center,
              ),
            ),

            const SizedBox(height: 12),

            // ── Logs ──
            if (_logs.isNotEmpty) ...[
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Log diagnostics',
                      style: theme.textTheme.labelLarge
                          ?.copyWith(fontWeight: FontWeight.bold)),
                  TextButton(
                      onPressed: () => setState(() => _logs = ''),
                      child: const Text('Șterge')),
                ],
              ),
              Container(
                height: 220,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.black,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: SingleChildScrollView(
                  child: Text(
                    _logs,
                    style: const TextStyle(
                        color: Colors.greenAccent,
                        fontFamily: 'monospace',
                        fontSize: 11),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────── sub-widget ───────────────────────────

class _PermTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final bool ok;
  final VoidCallback onTap;
  final bool required;
  final String? optionalLabel;
  final bool showCheckmark;

  const _PermTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.ok,
    required this.onTap,
    this.required = true,
    this.optionalLabel,
    this.showCheckmark = true,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor:
              ok ? Colors.green.shade100 : Colors.grey.shade200,
          child: Icon(icon,
              color: ok ? Colors.green : Colors.grey.shade600),
        ),
        title: Row(
          children: [
            Expanded(
              child: Text(title,
                  style: const TextStyle(fontWeight: FontWeight.w600)),
            ),
            if (optionalLabel != null)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.orange.shade100,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(optionalLabel!,
                    style: TextStyle(
                        fontSize: 10, color: Colors.orange.shade800)),
              ),
            if (this.required && optionalLabel == null)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.red.shade100,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text('Obligatoriu',
                    style: TextStyle(
                        fontSize: 10, color: Colors.red.shade800)),
              ),
          ],
        ),
        subtitle: Text(subtitle,
            style: const TextStyle(fontSize: 12)),
        trailing: showCheckmark && ok
            ? const Icon(Icons.check_circle, color: Colors.green)
            : ElevatedButton(
                onPressed: onTap,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 6),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: Text(ok ? 'OK' : 'Permite',
                    style: const TextStyle(fontSize: 12)),
              ),
      ),
    );
  }
}
