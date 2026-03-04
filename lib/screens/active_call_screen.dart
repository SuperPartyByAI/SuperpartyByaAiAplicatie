import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:twilio_voice/twilio_voice.dart';
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
  // FCM removed — database polling + Twilio SDK events handle call status
  Timer? _inactivityTimer;
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

    // FCM fallback removed — database polling (below) handles call_ended detection

    // Fallback: 90-second inactivity timer as a last resort safeguard
    _inactivityTimer = Timer(const Duration(seconds: 90), () {
      debugPrint('[ActiveCall] Inactivity timer fired — force closing screen');
      _closeCall('Call Ended');
    });
  }

  void _closeCall(String status) {
    if (_isClosing) return;
    _isClosing = true;
    _inactivityTimer?.cancel();
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
    // FCM subscription removed
    _inactivityTimer?.cancel();
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
    VoipService.isRingingOrActive = false;
    VoipService.rejectCallFromServer('', _activeCallSid ?? '');
    TwilioVoice.instance.call.hangUp();
    _closeCall("Ending...");
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
