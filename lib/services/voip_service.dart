// Push notifications handled by Twilio SDK via FCM
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:superparty_app/widgets/global_inbox_badge.dart';
import 'package:superparty_app/main.dart';
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
import 'package:supabase_flutter/supabase_flutter.dart';
import 'call_kit_service.dart';
import 'call_kit_service.dart';
import 'voip_logger.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

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

  // WebSocket Connection instance
  IOWebSocketChannel? _wsChannel;
  bool _wsConnecting = false;

  Future<void> _connectWebSocket(String identity, String? deviceNumber, String apiBaseUrl) async {
    if (_wsConnecting) return;
    _wsConnecting = true;

    try {
      // 1. Get short-lived JWT for WS Auth
      final tokenUrl = Uri.parse('$apiBaseUrl/auth/get-ws-token?identity=$identity');
      final accessToken = Supabase.instance.client.auth.currentSession?.accessToken;
      final resp = await http.get(
        tokenUrl,
        headers: {
          if (accessToken != null) 'Authorization': 'Bearer $accessToken',
        },
      );
      if (resp.statusCode != 200) {
        debugPrint('[VoIP WS] Failed to get WS token: ${resp.body}');
        _wsConnecting = false;
        return;
      }
      
      final jwtToken = jsonDecode(resp.body)['token'];
      if (jwtToken == null) {
        _wsConnecting = false;
        return;
      }

      // Convert http/https to ws/wss
      final wsBaseUrl = apiBaseUrl.startsWith('https') 
          ? apiBaseUrl.replaceFirst('https', 'wss') 
          : apiBaseUrl.replaceFirst('http', 'ws');

      final wsUri = Uri.parse('$wsBaseUrl/voip-ws?token=$jwtToken');
      debugPrint('[VoIP WS] Connecting to: $wsUri');

      _wsChannel = IOWebSocketChannel.connect(wsUri, pingInterval: const Duration(seconds: 20));
      
      // 2. Register identity over WS
      _wsChannel!.sink.add(jsonEncode({
        'type': 'register',
        'identity': identity,
        'deviceNumber': deviceNumber ?? 'unknown',
      }));

      // 3. Listen for Incoming WS Calls
      _wsChannel!.stream.listen((message) async {
        try {
          final data = jsonDecode(message);
          if (data['type'] == 'incoming_call') {
            debugPrint('[VoIP WS] Foreground message received via WS: $data');
            // Show the exact same incoming UI as FCM Push 
            // (Note: we cast values to String to match expected map format from native FCM)
            final Map<String, dynamic> pushPayload = {
               'type': data['type']?.toString(),
               'conf': data['conf']?.toString(),
               'callSid': data['callSid']?.toString(),
               'callerNumber': data['callerNumber']?.toString(),
               'sig': data['sig']?.toString(),
               'expires': data['expires']?.toString(),
            };
            await handleIncomingData(pushPayload);
          } else if (data['type'] == 'registered') {
            debugPrint('[VoIP WS] Successfully registered on WebSocket Server');
          } else if (data['type'] == 'call_closed') {
            debugPrint('[VoIP WS] Server issued call_closed. Terminating Native Audio and Dismissing UI.');
            try {
              // 1. Terminate native audio immediately
              await TwilioVoice.instance.call.hangUp();
            } catch(e) {
              debugPrint('[VoIP WS] Warning hanging up Twilio locally: $e');
            }
            
            // 2. Clear Active UI components (IncomingCallScreen / ActiveCallScreen)
            navigatorKey.currentState?.popUntil((route) => route.isFirst);
          }
        } catch (e) {
          debugPrint('[VoIP WS] Message parse error: $e');
        }
      }, onDone: () {
        debugPrint('[VoIP WS] Connection closed. Attempting reconnect in 10s...');
        _wsConnecting = false;
        _wsChannel = null;
        Future.delayed(const Duration(seconds: 10), () => _connectWebSocket(identity, deviceNumber, apiBaseUrl));
      }, onError: (err) {
        debugPrint('[VoIP WS] Connection error: $err');
      });

    } catch (e) {
      debugPrint('[VoIP WS] Setup exception: $e');
      _wsConnecting = false;
    }
  }

  static Future<void> handleIncomingData(Map<String, dynamic> data) async {
    _showIncomingUI(data);
  }

  static Future<void> _showIncomingUI(Map<String, dynamic> data) async {
    isRingingOrActive = true;
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



  bool _isRegistered = false;
  bool get isRegistered => _isRegistered;
  static bool isRingingOrActive = false;

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
      await prefs.setString('twilio_client_identity', identity);
      debugPrint('[VoIP] Token received for identity: $identity');

      // 5. Register with Twilio SDK (links FCM token → Twilio identity)
      final result = await TwilioVoice.instance.setTokens(
        accessToken: accessToken,
        deviceToken: deviceToken,
      );

      // 6. Connect WebSocket Fallback (Huawei foreground support)
      final apiBaseUrl = backendService.voiceBaseUrl;
      final prefsDeviceNum = prefs.getString('user_phone'); // Or passed down if known
      _connectWebSocket(identity, prefsDeviceNum, apiBaseUrl);

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
      debugPrint('[VoIP API] Network error during hangup proxy request: $e');
    }
  }

  /// Broadcasts a Reject signal directly to the NodeJS PBX to manually advance
  /// Twilio Conference bindings into ACTIVE status when the local User hits "Answer".
  /// Essential for Huawei where native Twilio SDK callbacks randomly stall.
  static Future<void> rejectCallFromServer(String conf, String callSid) async {
    if (callSid.isEmpty) return;
    try {
      final String confName = conf.isNotEmpty ? conf : 'conf_$callSid';
      final Uri hangupUri = Uri.parse('${BackendService.VOICE_BASE_URL}/voice/hangup');
      
      final accessToken = Supabase.instance.client.auth.currentSession?.accessToken;
      String clientIdentity = 'SuperpartyApp';
      try {
        final prefs = await SharedPreferences.getInstance();
        final stored = prefs.getString('twilio_client_identity');
        if (stored != null) clientIdentity = stored;
      } catch (_) {}

      final resp = await http.post(
        hangupUri,
        headers: {
          'Content-Type': 'application/json',
          if (accessToken != null) 'Authorization': 'Bearer $accessToken',
        },
        body: jsonEncode({
          'conf': confName,
          'callSid': callSid,
          'deviceNumber': 'SuperpartyApp',
          'clientIdentity': clientIdentity
        })
      );
      if (resp.statusCode == 200) {
        debugPrint('[VoIP API] Successfully notified Server to manually hangup Conference $confName.');
      } else {
        debugPrint('[VoIP API] Failed to manually hangup call remotely. statusCode: ${resp.statusCode}');
      }
    } catch (e) {
      debugPrint('[VoIP API] Network error during manual hangup proxy request: $e');
    }
  }

  static Future<void> acceptCallFromServer(String conf, String callSid) async {
    if (callSid.isEmpty) return;
    try {
      final String confName = conf.isNotEmpty ? conf : 'conf_$callSid';
      final Uri acceptUri = Uri.parse('${BackendService.VOICE_BASE_URL}/voice/accept');
      
      String clientIdentity = 'SuperpartyApp';
      try {
        final prefs = await SharedPreferences.getInstance();
        final stored = prefs.getString('twilio_client_identity');
        if (stored != null) clientIdentity = stored;
      } catch (e) {
        debugPrint('[VoIP API] Error reading SharedPreferences for identity: $e');
      }

      final accessToken = Supabase.instance.client.auth.currentSession?.accessToken;
      final resp = await http.post(
        acceptUri,
        headers: {
          'Content-Type': 'application/json',
          if (accessToken != null) 'Authorization': 'Bearer $accessToken',
        },
        body: jsonEncode({
          'conf': confName,
          'callSid': callSid,
          'deviceNumber': 'SuperpartyApp',
          'clientIdentity': clientIdentity
        })
      );
      if (resp.statusCode == 200) {
        debugPrint('[VoIP API] Successfully notified Server to manually answer Conference $confName.');
      } else {
        debugPrint('[VoIP API] Failed to manually accept call remotely. statusCode: ${resp.statusCode}');
      }
    } catch (e) {
      debugPrint('[VoIP API] Network error during manual accept proxy request: $e');
    }
  }
}
