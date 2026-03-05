
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
      debugPrint('[IncomingCallScreen] Accepting native WebRTC call via Twilio SDK...');
      
      final prefs = await SharedPreferences.getInstance();
      final identity = prefs.getString('twilio_client_identity') ?? 'superparty';
      
      String confStr = widget.callSid;
      if (confStr.isEmpty || !confStr.startsWith('CA')) {
        final fallbackSid = prefs.getString('last_incoming_call_sid') ?? '';
        if (fallbackSid.startsWith('CA')) confStr = fallbackSid;
      }
      if (confStr.isEmpty || !confStr.startsWith('CA')) {
        debugPrint('[IncomingCallScreen] ❌ No valid Twilio CallSid available for conference join. Aborting.');
        return;
      }
      final confRoomRaw = confStr.startsWith('conf_') ? confStr : 'conf_$confStr';
      final to = confRoomRaw.startsWith('client:') ? confRoomRaw : 'client:$confRoomRaw';
      
      BackendService? backend;
      try { backend = Provider.of<BackendService>(context, listen: false); } catch (_) {}
      if (backend != null) {
        await VoipService().init(backend, forceReinit: false); 
      }

      // 1️⃣ ATTEMPT NATIVE DIRECT ANSWER (Huawei Bypass)
      try {
        // Request audio focus immediately for native TCP WebRTC bridge
        try {
          await MethodChannel('com.superpartybyai.app/audio').invokeMethod('requestAudioFocusAndMode');
        } catch (_) {}

        debugPrint('[IncomingCallScreen] Attempting directAnswer via Native Platform Channel...');
        final bool directAccepted = await MethodChannel('com.superpartybyai.app/call_actions').invokeMethod('directAnswer') ?? false;
        if (directAccepted) {
           debugPrint('[IncomingCallScreen] ✅ directAnswer SUCCESS! Bypassing call.place fallback.');
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
      } catch (e) {
        debugPrint('[IncomingCallScreen] ❌ directAnswer exception: $e');
      }

      // 2️⃣ FALLBACK: Outbound dial to conference
      bool placed = false;
      try {
        final prefs = await SharedPreferences.getInstance();
        String? accessToken = prefs.getString('twilio_access_token');
        if (accessToken == null || accessToken.isEmpty) {
          if (backend != null) await VoipService().init(backend, forceReinit: true);
          accessToken = prefs.getString('twilio_access_token');
        }

        if (accessToken != null && accessToken.isNotEmpty) {
          await VoipService.ensureDeviceFlagsInitialized();
          if (VoipService.isHuaweiOrHonor) {
            final placedNative = await const MethodChannel('com.superpartybyai.app/call_actions').invokeMethod<bool>(
              'directPlace',
              {'accessToken': accessToken, 'to': to},
            );
            if (placedNative == true) {
               placed = true;
               debugPrint('[IncomingCallScreen] ✅ directPlace SUCCESS (native Voice.connect). Skip call.place.');
            } else {
               debugPrint('[IncomingCallScreen] ⚠️ directPlace returned false. Fallback to call.place.');
            }
          } else {
             debugPrint('[IncomingCallScreen] ℹ️ Skipping directPlace on non-Huawei device.');
          }
        }
      } catch (e) {
        debugPrint('[IncomingCallScreen] ❌ directPlace exception: $e. Fallback to call.place.');
      }

      if (!placed) {
        placed = await TwilioVoice.instance.call.place(to: to, from: identity) ?? false;
        debugPrint('[IncomingCallScreen] call.place result=$placed to=$to from=$identity');
      }
      if (placed != true && backend != null) {
        debugPrint('[IncomingCallScreen] call.place failed -> forceReinit + retry');
        await VoipService().init(backend, forceReinit: true);
        await Future.delayed(const Duration(seconds: 2));
        final placed2 = await TwilioVoice.instance.call.place(to: to, from: identity);
        debugPrint('[IncomingCallScreen] call.place retry result=$placed2');
      }
      
      // Navigate immediately
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
