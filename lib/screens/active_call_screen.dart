import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:twilio_voice/twilio_voice.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import '../services/voip_service.dart';
import 'dart:async';


const _kAudioChannel = 'com.superpartybyai.app/audio';

class ActiveCallScreen extends StatefulWidget {
  final String remoteId;
  final bool isOutgoing;
  final String? callSid; // pass from incoming call notification

  const ActiveCallScreen({super.key, required this.remoteId, required this.isOutgoing, this.callSid});

  @override
  State<ActiveCallScreen> createState() => _ActiveCallScreenState();
}

class _ActiveCallScreenState extends State<ActiveCallScreen> {
  String _status = "Intiating...";
  bool _isMuted = false;
  bool _isSpeaker = false;
  StreamSubscription<CallEvent>? _sub;
  StreamSubscription<RemoteMessage>? _fcmSub;
  Timer? _inactivityTimer;
  Timer? _firestorePollTimer;
  bool _isClosing = false;
  String? _activeCallSid; // tracks current call SID to avoid closing on unrelated events
  final DateTime _screenOpenedAt = DateTime.now(); // for time-window close logic

  @override
  void initState() {
    super.initState();
    _status = widget.isOutgoing ? "Calling..." : "Connected";
    _activeCallSid = widget.callSid; // set from widget param if provided

    // Fallback: ensure audio is routed correctly even if main.dart didn't call it
    _requestAudioFocus();
    
    _sub = TwilioVoice.instance.callEventsListener.listen((event) {
      debugPrint("[ActiveCall] Event: $event");
      if (!mounted) return;

      setState(() {
        switch (event) {
          case CallEvent.ringing:
            _status = "Ringing...";
            break;
          case CallEvent.connected:
            _status = "Connected";
            _requestAudioFocus();
            break;
          case CallEvent.callEnded:
          case CallEvent.declined:
            _closeCall("Call Ended");
            break;
          default:
            break;
        }
      });
    });

    // Fallback 1: FCM call_ended push from server (most reliable on Huawei — bypasses Doze)
    _fcmSub = FirebaseMessaging.onMessage.listen((msg) {
      final type = msg.data['type'];
      final incomingSid = msg.data['callSid'] as String?;
      debugPrint('[ActiveCall] FCM message received: type=$type sid=$incomingSid activeSid=$_activeCallSid');
      if (type == 'call_ended' && mounted) {
        final secSinceOpen = DateTime.now().difference(_screenOpenedAt).inSeconds;
        // Accept if: screen has been open >3s (avoid instant-close from stale events)
        // AND screen is not too old (>10min = stale timer will handle)
        if (secSinceOpen >= 3) {
          debugPrint('[ActiveCall] FCM call_ended accepted (${secSinceOpen}s after open) — closing screen');
          _closeCall('Apelul s-a terminat');
        } else {
          debugPrint('[ActiveCall] FCM call_ended IGNORED (too early: ${secSinceOpen}s)');
        }
      } else if (type == 'call_incoming' && incomingSid != null && _activeCallSid == null) {
        _activeCallSid = incomingSid;
        debugPrint('[ActiveCall] Captured callSid from FCM: $_activeCallSid');
      }
    });

    // Fallback 2: 90-second inactivity timer
    _inactivityTimer = Timer(const Duration(seconds: 90), () {
      debugPrint('[ActiveCall] Inactivity timer fired — force closing screen');
      _closeCall('Call Ended');
    });

    // Fallback 2: Real-time Firestore stream on active_incoming_calls for completion
    // Simple query — no orderBy, no index needed
    _firestorePollTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      _checkCallStatusInFirestore();
    });
  }

  Future<void> _checkCallStatusInFirestore() async {
    if (_isClosing) return;
    try {
      // If we have a known callSid, look up that specific document
      if (_activeCallSid != null) {
        final doc = await FirebaseFirestore.instance
            .collection('active_incoming_calls')
            .doc(_activeCallSid)
            .get();
        if (!doc.exists || !mounted) return;
        final data = doc.data()!;
        final status = data['status'] as String? ?? '';
        final terminalStatuses = ['completed', 'failed', 'no-answer', 'canceled', 'busy'];
        if (terminalStatuses.contains(status)) {
          final ts = data['endTime'] ?? data['timestamp'];
          if (ts != null) {
            final dt = (ts as Timestamp).toDate();
            if (DateTime.now().difference(dt).inSeconds < 300) {
              debugPrint('[ActiveCall] Firestore: call $status — closing screen');
              _closeCall("Apelul s-a terminat");
            }
          }
        }
      }
      // If no callSid, do nothing (avoid false positives from old calls)
    } catch (e) {
      debugPrint('[ActiveCall] Firestore poll error: $e');
    }
  }

  void _closeCall(String status) {
    if (_isClosing) return;
    _isClosing = true;
    _inactivityTimer?.cancel();
    _firestorePollTimer?.cancel();
    _releaseAudioFocus();
    VoipService.clearCallAnswered();
    if (mounted) {
      setState(() => _status = status);
      Future.delayed(const Duration(milliseconds: 1000), () {
        if (mounted) Navigator.of(context).pop();
      });
    }
  }

  Future<void> _requestAudioFocus() async {
    try {
      await const MethodChannel(_kAudioChannel).invokeMethod('requestAudioFocusAndMode');
      debugPrint('[ActiveCall] ✅ Audio focus requested');
    } catch (e) {
      debugPrint('[ActiveCall] audio focus error: $e');
    }
  }

  Future<void> _releaseAudioFocus() async {
    try {
      await const MethodChannel(_kAudioChannel).invokeMethod('releaseAudioFocus');
      debugPrint('[ActiveCall] Audio focus released');
    } catch (e) {
      debugPrint('[ActiveCall] releaseAudioFocus error: $e');
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    _fcmSub?.cancel();
    _inactivityTimer?.cancel();
    _firestorePollTimer?.cancel();
    super.dispose();
  }

  void _toggleMute() {
    TwilioVoice.instance.call.toggleMute(!_isMuted);
    setState(() => _isMuted = !_isMuted);
  }

  void _toggleSpeaker() {
    TwilioVoice.instance.call.toggleSpeaker(!_isSpeaker);
    setState(() => _isSpeaker = !_isSpeaker);
  }

  void _hangUp() {
    TwilioVoice.instance.call.hangUp();
    // Huawei workaround: SDK hangUp() doesn't disconnect — force via server
    _forceHangupOnServer();
    _closeCall("Ending...");
  }

  Future<void> _forceHangupOnServer() async {
    try {
      final token = await FirebaseAuth.instance.currentUser?.getIdToken();
      await http.post(
        Uri.parse('http://46.225.182.127/api/voice/forceHangup'),
        headers: {
          'Content-Type': 'application/json',
          if (token != null) 'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'callSid': _activeCallSid ?? '',
          'terminateAll': true,
        }),
      ).timeout(const Duration(seconds: 5));
      debugPrint('[ActiveCall] forceHangup sent to server');
    } catch (e) {
      debugPrint('[ActiveCall] forceHangup error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF202124),
      body: SafeArea(
        child: Column(
          children: [
            // Compliance: Recording Indicator
            Container(
              margin: const EdgeInsets.only(top: 10),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: Colors.red.withOpacity(0.2),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: Colors.red.withOpacity(0.5))
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                   const Icon(Icons.fiber_manual_record, color: Colors.red, size: 12),
                   const SizedBox(width: 8),
                   const Text("Recording On", style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 12)),
                ],
              ),
            ),
            const SizedBox(height: 30),
            const CircleAvatar(
              radius: 50,
              backgroundColor: Colors.grey,
              child: Icon(Icons.person, size: 60, color: Colors.white),
            ),
            const SizedBox(height: 20),
            Text(
              widget.remoteId,
              style: const TextStyle(fontSize: 28, color: Colors.white, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 10),
            Text(
              _status,
              style: const TextStyle(fontSize: 18, color: Colors.white70),
            ),
            const Spacer(),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _buildOptionButton(
                  icon: _isMuted ? Icons.mic_off : Icons.mic,
                  label: "Mute",
                  isActive: _isMuted,
                  onPressed: _toggleMute,
                ),
                _buildOptionButton(
                  icon: _isSpeaker ? Icons.volume_up : Icons.volume_down,
                  label: "Speaker",
                  isActive: _isSpeaker,
                  onPressed: _toggleSpeaker,
                ),
              ],
            ),
            const SizedBox(height: 40),
            FloatingActionButton(
              backgroundColor: Colors.red,
              onPressed: _hangUp,
              child: const Icon(Icons.call_end, color: Colors.white),
            ),
            const SizedBox(height: 60),
          ],
        ),
      ),
    );
  }

  Widget _buildOptionButton({required IconData icon, required String label, required bool isActive, required VoidCallback onPressed}) {
    return Column(
      children: [
        IconButton(
          onPressed: onPressed,
          icon: Icon(icon, color: isActive ? Colors.white : Colors.white54, size: 32),
          style: IconButton.styleFrom(
            backgroundColor: isActive ? Colors.white24 : Colors.transparent, 
            padding: const EdgeInsets.all(16)
          ),
        ),
        const SizedBox(height: 8),
        Text(label, style: TextStyle(color: isActive ? Colors.white : Colors.white54)),
      ],
    );
  }
}
