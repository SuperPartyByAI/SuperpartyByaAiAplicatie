
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../services/voip_service.dart';
import '../services/backend_service.dart';
import '../services/auth_service.dart';
import '../services/supabase_service.dart';
import 'package:http/http.dart' as http;
import 'package:superparty_app/services/voip_service.dart';
import '../screens/active_call_screen.dart';
import 'package:twilio_voice/twilio_voice.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:permission_handler/permission_handler.dart';
import 'dart:io';

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
  @override
  void initState() {
    super.initState();
    debugPrint('[ROUTE_H_FLUTTER_INCOMING_UI_START] IncomingCallScreen init');
  }
  bool _isAccepting = false;

  Future<void> _handleAccept() async {
    setState(() {
      _isAccepting = true;
    });

    try {
      if (Platform.isAndroid) {
        try {
          await Permission.bluetoothConnect.request();
          await Permission.bluetoothScan.request();
        } catch (_) {}
      }
      debugPrint('[ROUTE_I_FLUTTER_ACCEPT_BUTTON] 📞 answerCall received. Accepting native WebRTC call via Twilio SDK...');
      
      BackendService? backend;
      try { backend = Provider.of<BackendService>(context, listen: false); } catch (_) {}
      if (backend != null) {
        await VoipService().init(backend, forceReinit: false); 
      }

      // 1️⃣ ATTEMPT NATIVE DIRECT ANSWER (Huawei Bypass)
      debugPrint('[IncomingCallScreen] 📞 directAnswer started...');
      bool directAccepted = false;
      try {
        // Request audio focus immediately for native TCP WebRTC bridge
        try {
          await const MethodChannel('com.superpartybyai.app/audio').invokeMethod('requestAudioFocusAndMode');
        } catch (_) {}

        directAccepted = await const MethodChannel('com.superpartybyai.app/call_actions').invokeMethod('directAnswer') ?? false;
        debugPrint('[IncomingCallScreen] 📞 directAnswer result: $directAccepted');
      } catch (e) {
        debugPrint('[IncomingCallScreen] ❌ directAnswer exception: $e');
      }
      
      if (directAccepted) {
         debugPrint('[IncomingCallScreen] ✅ directAnswer SUCCESS!');
         debugPrint('[IncomingCallScreen] 🧹 cleanup invoked: no');
         if (mounted) {
           Navigator.pop(context); // Close incoming custom screen
           Navigator.push(
             context,
             MaterialPageRoute(
               builder: (_) => ActiveCallScreen(
                 remoteId: widget.caller,
                 isOutgoing: false,
                 callSid: widget.callSid,
               ),
             ),
           );
         }
         return; 
      }

      // 2️⃣ NATIVE ANSWER ON EXISTING INVITE (Twilio SDK default answer)
      Call? activeCallBefore = TwilioVoice.instance.call.activeCall;
      if (activeCallBefore == null) {
        debugPrint('[IncomingCallScreen] 📞 activeCall not present — trying a short wait for SDK...');
        for (int i = 0; i < 15; i++) {
          activeCallBefore = TwilioVoice.instance.call.activeCall;
          if (activeCallBefore != null) break;
          await Future.delayed(const Duration(milliseconds: 200));
        }
        if (activeCallBefore == null) {
          debugPrint('[IncomingCallScreen] ❌ activeCall still null after 3s wait.');
        } else {
          debugPrint('[IncomingCallScreen] ✅ activeCall found after wait!');
        }
      }

      bool activeCallPresent = activeCallBefore != null;
      debugPrint('[IncomingCallScreen] 📞 activeCall present before answer: ${activeCallPresent ? "yes" : "no"}');
      if (activeCallPresent) {
        debugPrint('[IncomingCallScreen] 📞 current activeCall: from=${activeCallBefore?.from}, to=${activeCallBefore?.to}, dir=${activeCallBefore?.callDirection}');
      }

      debugPrint('[ROUTE_K_TWILIO_SDK_ANSWER_CALLED] 📞 TwilioVoice.instance.call.answer() started...');
      bool answered = false;
      try {
        answered = await TwilioVoice.instance.call.answer() ?? false;
        debugPrint('[IncomingCallScreen] 📞 TwilioVoice.instance.call.answer() result: $answered');
      } catch(e) {
        debugPrint('[IncomingCallScreen] ❌ TwilioVoice.instance.call.answer() exception: $e');
      }

      if (answered) {
        debugPrint('[IncomingCallScreen] 🧹 cleanup invoked: no');
      } else {
        debugPrint('[IncomingCallScreen] ❌ Answer completely failed. No native call found.');
        debugPrint('[IncomingCallScreen] 🧹 cleanup invoked: yes');
      }

      // Navigate immediately only if answered
      if (mounted) {
        Navigator.pop(context); // Close incoming custom screen
        if (answered) {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => ActiveCallScreen(
                remoteId: widget.caller,
                isOutgoing: false,
                callSid: widget.callSid,
              ),
            ),
          );
        }
      }
    } catch (e) {
      debugPrint('[IncomingCallScreen] Error in accept: $e');
      if (mounted) {
        setState(() {
          _isAccepting = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Eroare WebRTC: $e')),
        );
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
              'Apel de la ${widget.caller}',
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
                        onPressed: () {
                          debugPrint('[ROUTE_J_FLUTTER_REJECT_BUTTON] Reject tapped');
                          VoipService.isRingingOrActive = false;
                          VoipService.rejectCallFromServer('', widget.callSid);
                          MethodChannel('com.superpartybyai.app/call_actions').invokeMethod('directHangup');
                          Navigator.pop(context);
                        },
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
