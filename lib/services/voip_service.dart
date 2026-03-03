// Push notifications handled by Twilio SDK via FCM
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:twilio_voice/twilio_voice.dart';
import 'package:permission_handler/permission_handler.dart';
import 'dart:io';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import 'backend_service.dart';
import 'call_kit_service.dart';
import 'voip_logger.dart';

import 'voip_logger.dart';

class VoipService {
  static final VoipService _instance = VoipService._internal();
  factory VoipService() => _instance;
  VoipService._internal();

  static final FlutterLocalNotificationsPlugin _notif = FlutterLocalNotificationsPlugin();

  // Background handler delegate
  static Future<void> handleBackgroundMessage(Map<String, dynamic> data) async {
    if (data['type'] == 'incoming_call') {
      await _showIncomingNotification(data);
    }
  }

  static Future<void> handleIncomingData(Map<String, dynamic> data) async {
    _showIncomingUI(data);
  }

  static Future<void> _showIncomingUI(Map<String, dynamic> data) async {
    WakelockPlus.enable();
    await _showIncomingNotification(data);
  }

  static Future<void> _showIncomingNotification(Map<String, dynamic> data) async {
    final String conf = data['conf'] ?? '';
    final String callSid = data['callSid'] ?? '';
    final String caller = data['from'] ?? data['callerNumber'] ?? 'Unknown';
    final String sig = data['sig'] ?? '';
    final String expires = data['expires'] ?? '';

    const AndroidNotificationDetails androidPlatformChannelSpecifics =
      AndroidNotificationDetails(
        'voip_channel',
        'VoIP',
        channelDescription: 'Incoming VoIP calls',
        importance: Importance.max,
        priority: Priority.high,
        fullScreenIntent: true,
        ticker: 'ticker',
      );

    const NotificationDetails platformChannelSpecifics =
      NotificationDetails(android: androidPlatformChannelSpecifics);

    final payload = jsonEncode({'conf': conf, 'callSid': callSid, 'caller': caller, 'sig': sig, 'expires': expires});

    await _notif.show(
        id: 0,
        title: 'Apel de la $caller',
        body: 'Glisați pentru a răspunde',
        notificationDetails: platformChannelSpecifics,
        payload: payload);
  }

  static Future<bool> acceptCall(String conf, String callSid, String deviceNumber, String apiBaseUrl, String sig, String expires) async {
    final url = Uri.parse('$apiBaseUrl/api/voice/accept');
    final body = {
      'conf': conf,
      'callSid': callSid,
      'deviceNumber': deviceNumber,
      'sig': sig,
      'expires': expires,
    };
    try {
      final resp = await http.post(url, body: jsonEncode(body), headers: {'Content-Type':'application/json'});
      return resp.statusCode == 200;
    } catch (e) {
      debugPrint('[VoIP] acceptCall error: $e');
      return false;
    }
  }

  bool _isRegistered = false;
  bool get isRegistered => _isRegistered;
  String? _lastIdentity; // set during registerDevice, used in makeCall

  /// Set to true IMMEDIATELY after answer() is called to block any re-init
  /// that would fire endAllCalls() and kill the active call.
  /// Automatically resets after 15 seconds.
  static bool callAnsweredGuard = false;

  static void setCallAnswered() {
    callAnsweredGuard = true;
    Future.delayed(const Duration(seconds: 15), () {
      callAnsweredGuard = false;
      debugPrint('[VoIP] callAnsweredGuard reset after 15s');
    });
  }

  static void clearCallAnswered() {
    callAnsweredGuard = false;
    debugPrint('[VoIP] callAnsweredGuard cleared (call ended)');
  }

  Future<void> init(BackendService backendService, {bool forceReinit = false}) async {
    if (_isRegistered && !forceReinit) {
      debugPrint('[VoIP] Already initialized — skipping. Use forceReinit:true to re-register.');
      return;
    }
    if (forceReinit) {
      _isRegistered = false;
      debugPrint('[VoIP] Force re-init requested — resetting registration state');
    }

    // GUARD: Do NOT reinit (endAllCalls) if a call was just answered or is active.
    // callAnsweredGuard is set immediately when answer() succeeds.
    // activeCall check is a secondary safeguard once Twilio SDK updates its state.
    final activeCall = TwilioVoice.instance.call.activeCall;
    if (callAnsweredGuard || activeCall != null) {
      debugPrint('[VoIP] ⚠️ Call active/answered guard — skipping re-init (callAnsweredGuard=$callAnsweredGuard, activeCall=${activeCall?.to})');
      _isRegistered = true;
      return;
    }

    // Clear ALL stale CallKit call UIs from previous sessions BEFORE re-registering.
    // Without this, every app restart re-shows all pending/missed calls simultaneously.
    try {
      await FlutterCallkitIncoming.endAllCalls();
      debugPrint('[VoIP] 🧹 Cleared stale CallKit calls');
    } catch (e) {
      debugPrint('[VoIP] endAllCalls error (non-fatal): $e');
    }

    debugPrint('[VoIP] ═══ Initializing VoIP ═══');


    // 1. Request microphone permission
    final mic = await Permission.microphone.request();
    debugPrint('[VoIP] Microphone: ${mic.isGranted ? "✅ Granted" : "❌ Denied"}');

    // 2. Request notification permission
    final notif = await Permission.notification.request();
    debugPrint('[VoIP] Notifications: ${notif.isGranted ? "✅ Granted" : "⚠️ Denied"}');

    // 3. Request phone permissions via permission_handler (awaited).
    // These MUST be granted before registerPhoneAccount() can work.
    // On real devices these show a dialog; on emulator they may be auto-denied.
    final phoneState = await Permission.phone.request();
    debugPrint('[VoIP] Phone state: ${phoneState.isGranted ? "✅ Granted" : "⚠️ Denied (non-fatal)"}');

    // Also ask Twilio for READ_PHONE_NUMBERS specifically
    try {
      await TwilioVoice.instance.requestReadPhoneNumbersPermission();
      debugPrint('[VoIP] PhoneNumbers permission requested.');
    } catch (e) {
      debugPrint('[VoIP] PhoneNumbers permission error (non-fatal): $e');
    }

    // 4. Fetch Twilio access token + FCM token
    try {
      // 4a. Get stable device identifier
      final prefs = await SharedPreferences.getInstance();
      String? deviceId = prefs.getString('voip_device_id');
      if (deviceId == null) {
        deviceId = const Uuid().v4();
        await prefs.setString('voip_device_id', deviceId);
      }
      debugPrint('[VoIP] Unique Device ID: $deviceId');

      // Get real FCM token for Twilio incoming call push notifications
      String deviceToken = '';
      try {
        final fcmToken = await FirebaseMessaging.instance.getToken().timeout(const Duration(seconds: 5));
        if (fcmToken != null && fcmToken.isNotEmpty) {
          deviceToken = fcmToken;
          debugPrint('[VoIP] FCM Token: ${fcmToken.substring(0, 20)}...');
        } else {
          debugPrint('[VoIP] ⚠️ FCM token null — WebSocket-only mode (foreground calls only)');
        }
      } catch (e) {
        debugPrint('[VoIP] ⚠️ FCM error ($e) — WebSocket-only mode (foreground calls only)');
      }

      // 4b. Register device and FCM token with backend
      await backendService.registerDevice(deviceId, deviceToken);

      // 4c. Fetch Voip token for this specific device identity
      final data = await backendService.getVoipTokenForDevice(deviceId);
      final accessToken = data['token'] as String;
      final identity = data['identity'] as String;
      _lastIdentity = identity; // save for outgoing calls
      debugPrint('[VoIP] Token received for identity: $identity');

      // 5. Register with Twilio SDK (links FCM token → Twilio identity)
      final result = await TwilioVoice.instance.setTokens(
        accessToken: accessToken,
        deviceToken: deviceToken,
      );

      if (result == true) {
        _isRegistered = true;
        debugPrint('[VoIP] ✅ Registered as "$identity"');

        try {
          if (Platform.isAndroid) {
            final ok = await const MethodChannel('com.superpartybyai.app/diag').invokeMethod('isCallCapable');
            if (ok != true) {
              debugPrint('[VoIP] ❌ calling account not enabled (ignoring due to UX update).');
            }
          }
        } catch (e) {
          debugPrint('[VoIP] ⚠️ isCallCapable error (non-fatal): $e');
        }
      } else {
        debugPrint('[VoIP] ❌ Registration failed');
        return;
      }

      // 6. Listen for incoming call events from Twilio SDK
      TwilioVoice.instance.callEventsListener.listen((event) {
        debugPrint('[VoIP] 📞 CallEvent: $event');

        switch (event) {
          case CallEvent.incoming:
            final fromRaw = TwilioVoice.instance.call.activeCall?.from ?? 'Unknown';
            final toRaw   = TwilioVoice.instance.call.activeCall?.to ?? 'unknown';
            final from = fromRaw.startsWith('client:')
                ? fromRaw.replaceFirst('client:', '')
                : fromRaw;
            debugPrint('[VoIP] 📲 INCOMING from: \$from — showing CallKit UI (because native UI is blocked by Huawei)');
            VoipLogger.instance.logCallInvite(from: from, to: toRaw);
            VoipLogger.instance.logEvent('INCOMING', extra: {'from': from, 'to': toRaw});
            // MUST show CallKit UI so the user can actually press Answer to trigger the By-Pass
            // REMOVED CallKitService() here because native Kotlin handles the FullScreen Intent
            // CallKitService().showIncomingCall(from, 'Superparty');
            break;

          case CallEvent.connected:
            final connectedCall = TwilioVoice.instance.call.activeCall;
            debugPrint('[VoIP] ✅ CallEvent.connected');
            debugPrint('[VoIP]    from=${connectedCall?.from}');
            debugPrint('[VoIP]    to=${connectedCall?.to}');
            debugPrint('[VoIP]    dir=${connectedCall?.callDirection}');
            VoipLogger.instance.logEvent('CONNECTED', extra: {
              'from': connectedCall?.from,
              'to': connectedCall?.to,
              'dir': connectedCall?.callDirection?.name,
            });
            break;

          case CallEvent.callEnded:
          case CallEvent.declined:
            debugPrint('[VoIP] 📴 Call ended/declined');
            CallKitService().endCall();
            break;

          case CallEvent.ringing:
            debugPrint('[VoIP] 🔔 Ringing...');
            break;

          default:
            break;
        }
      });

    // NOTE: answerCall / rejectCall are handled in main.dart's
    // _registerCallActionsHandler() which includes VoipLogger,
    // isCallCapable(), wait-for-activeCall, and retry logic.
    // DO NOT set a handler here — it would override main.dart's handler.
    debugPrint('[VoIP] MethodChannel call_actions — handled by main.dart');

    // Handle FCM foreground/background payloads
    FirebaseMessaging.onMessage.listen((RemoteMessage msg) async {
      if (msg.data.isNotEmpty && msg.data['type'] == 'incoming_call') {
        debugPrint('[VoIP] FCM Foreground message received: \${msg.data}');
        await handleIncomingData(msg.data);
      }
    });

    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage msg) {
      if (msg.data.isNotEmpty && msg.data['type'] == 'incoming_call') {
        debugPrint('[VoIP] FCM message opened app: \${msg.data}');
        _showIncomingUI(msg.data);
      }
    });

    } catch (e) {
      debugPrint('[VoIP] ❌ Init error: $e');
    }

    debugPrint('[VoIP] ═══ Init complete ═══');
  }

  Future<void> makeCall(String to) async {
    debugPrint('CALL_FLOW: VoipService.makeCall STARTED pt $to');

    final mic = await Permission.microphone.status;
    if (!mic.isGranted) {
      debugPrint('CALL_FLOW: Mic permission denied — requesting...');
      await Permission.microphone.request();
    }

    try {
      debugPrint('CALL_FLOW: Requesting TwilioVoice.instance.registerPhoneAccount() before call...');
      await TwilioVoice.instance.registerPhoneAccount();
      
      if (Platform.isAndroid) {
        // Checking if user has toggled the Calling Account ON via Android Settings
        final ok = await const MethodChannel('com.superpartybyai.app/diag').invokeMethod('isCallCapable');
        if (ok != true) {
          debugPrint('CALL_FLOW: ❌ PhoneAccount disabled (ignoring due to UX update).');
        }
      }

      debugPrint('CALL_FLOW: await TwilioVoice.instance.call.place()');
      final result = await TwilioVoice.instance.call.place(
        to: to,
        from: _lastIdentity ?? 'superparty',
      );
      debugPrint('CALL_FLOW: Call placed result: $result');
    } catch (e, st) {
      debugPrint('CALL_FLOW: ❌ Call error in try/catch: $e\n$st');
    }
  }

  Future<void> hangUp() async {
    try {
      await TwilioVoice.instance.call.hangUp();
    } catch (e) {
      debugPrint('[VoIP] HangUp error: $e');
    }
  }
}
