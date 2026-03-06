// Push notifications handled by Twilio SDK via FCM
import 'dart:async';
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
import 'package:device_info_plus/device_info_plus.dart';

class VoipService {
  static final VoipService _instance = VoipService._internal();
  factory VoipService() => _instance;
  VoipService._internal();

  static bool isHuaweiOrHonor = false;
  static bool _deviceFlagsInitialized = false;

  static Future<void> ensureDeviceFlagsInitialized() async {
    if (_deviceFlagsInitialized) return;
    try {
      if (Platform.isAndroid) {
        final deviceInfo = DeviceInfoPlugin();
        final androidInfo = await deviceInfo.androidInfo;
        final manufacturer = androidInfo.manufacturer.toLowerCase();
        isHuaweiOrHonor = manufacturer == 'huawei' || manufacturer == 'honor';
      }
    } catch (_) {}
    _deviceFlagsInitialized = true;
  }

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
            // Reconcile immediately after WS registration to catch missed events
            unawaited(_reconcileActiveCalls(apiBaseUrl, jwtToken));
          } else if (data['type'] == 'active-calls-snapshot') {
            // Server-side source of truth — sent immediately on every WS connect
            final activeCalls = (data['activeCalls'] as List? ?? []);
            debugPrint('[VoIP WS] active-calls-snapshot: ${activeCalls.length} calls');
            if (activeCalls.isEmpty) {
              if (isRingingOrActive) {
                debugPrint('[VoIP Reconcile] Snapshot empty — clearing stale UI');
                unawaited(clearStaleIncomingUi());
              }
            } else if (!isRingingOrActive) {
              debugPrint('[VoIP Reconcile] Late connect — triggering missed incoming from snapshot');
              final call = activeCalls.first as Map<String, dynamic>;
              unawaited(handleIncomingData({
                'type': 'incoming_call',
                'callSid': call['callSid']?.toString() ?? '',
                'callerNumber': call['from']?.toString() ?? 'Unknown',
                'conf': '',
                'sig': '',
                'expires': '${DateTime.now().add(const Duration(minutes: 2)).millisecondsSinceEpoch}',
              }));
            }
          } else if (data['type'] == 'call_closed' || data['type'] == 'call_ended') {
            final wsSid = data['callSid']?.toString();
            debugPrint('[VoIP WS] Server issued ${data['type']} sid=$wsSid — full cleanup');
            // 1. Hang up native audio if active
            try {
              final activeForWs = TwilioVoice.instance.call.activeCall;
              if (activeForWs != null) {
                await TwilioVoice.instance.call.hangUp();
              }
            } catch(e) {
              debugPrint('[VoIP WS] Warning hanging up Twilio locally: $e');
            }
            // 2. Full stale UI cleanup (notification + CallKit + SharedPrefs + flags + nav)
            await VoipService.clearStaleIncomingUi(callSid: wsSid);
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
    _sendPushAck(data);
    _showIncomingUI(data);
  }

  static Future<void> _sendPushAck(Map<String, dynamic> data) async {
    final ackToken = data['ackToken'];
    final callSid = data['callSid'] ?? data['twi_call_sid'];
    if (ackToken == null || callSid == null) return;
    
    try {
      final prefs = await SharedPreferences.getInstance();
      final identity = prefs.getString('twilio_client_identity');
      if (identity == null || identity.isEmpty) return;

      final url = Uri.parse('https://voice.superparty.ro/api/voice/push-ack');
      http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'callSid': callSid,
          'identity': identity,
          'ackToken': ackToken,
        }),
      ).then((response) {
        debugPrint('[VoIP ACK] Sent Flutter push-ack for $callSid!');
      }).catchError((e) {
        debugPrint('[VoIP ACK] Error sending push-ack: $e');
      });
    } catch (e) {
      debugPrint('[VoIP ACK] Exception in push-ack: $e');
    }
  }

  static Future<void> _showIncomingUI(Map<String, dynamic> data) async {
    isRingingOrActive = true;
    WakelockPlus.enable();
    await _showIncomingNotification(data);
  }

  static Future<void> _showIncomingNotification(Map<String, dynamic> data) async {
    final String conf = data['conf'] ?? '';
    final String callSid = (data['callSid'] ?? data['twi_call_sid'] ?? '').toString();
    
    // --- Android dedupe: if native UI is already active, suppress Flutter UI/notification ---
    if (Platform.isAndroid && callSid.isNotEmpty) {
      final prefs = await SharedPreferences.getInstance();
      final nativeSid = prefs.getString('native_ringing_call_sid');     // without "flutter." in Dart
      final nativeUntil = prefs.getInt('native_ringing_until') ?? 0;    // Long -> int in Dart
      final now = DateTime.now().millisecondsSinceEpoch;

      if (nativeSid == callSid && now < nativeUntil) {
        debugPrint('[VoIP] Suppressing Flutter incoming notification (native already ringing) sid=$callSid');
        // lock flag to prevent ConsentScreen collisions
        isRingingOrActive = true;
        return;
      }
    }
    
    // Persist last incoming Twilio CallSid so lockscreen Answer always joins the correct conference
    try {
      final prefs = await SharedPreferences.getInstance();
      if (callSid.isNotEmpty && callSid.startsWith('CA')) {
        await prefs.setString('last_incoming_call_sid', callSid);
      }
    } catch (_) {}
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

  /// ── clearStaleIncomingUi ───────────────────────────────────────────────
  /// Single entry-point for ALL post-call cleanup. Idempotent — safe to call
  /// multiple times. Clears:
  ///   • Flutter local notification (voip_channel id:0)
  ///   • FlutterCallkitIncoming all calls
  ///   • CallKitService UI
  ///   • SharedPreferences ring state (native_ringing_*, last_incoming_call_sid)
  ///   • isRingingOrActive flag
  ///   • callAnsweredGuard
  ///   • WakelockPlus
  ///   • Navigator stack (pops to root safely)
  static Future<void> clearStaleIncomingUi({String? callSid}) async {
    debugPrint('[VoIP Cleanup] clearStaleIncomingUi() triggered${callSid != null ? " sid=$callSid" : ""}');

    // 1. Cancel Flutter local notification
    try {
      await _notif.cancel(id: 0);
      debugPrint('[VoIP Cleanup] ✅ _notif.cancel(id: 0)');
    } catch (e) {
      debugPrint('[VoIP Cleanup] _notif.cancel error (non-fatal): $e');
    }

    // 2. End all CallKit calls (clears system UI on Android/iOS)
    try {
      await FlutterCallkitIncoming.endAllCalls();
      debugPrint('[VoIP Cleanup] ✅ FlutterCallkitIncoming.endAllCalls()');
    } catch (e) {
      debugPrint('[VoIP Cleanup] endAllCalls error (non-fatal): $e');
    }

    // 3. CallKit service endCall
    try {
      CallKitService().endCall();
      debugPrint('[VoIP Cleanup] ✅ CallKitService().endCall()');
    } catch (e) {
      debugPrint('[VoIP Cleanup] CallKitService.endCall error (non-fatal): $e');
    }

    // 4. Clear SharedPreferences ring state
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('native_ringing_call_sid');
      await prefs.remove('native_ringing_until');
      if (callSid != null) {
        // Only clear last_incoming_call_sid if it matches this call
        final stored = prefs.getString('last_incoming_call_sid');
        if (stored == callSid) await prefs.remove('last_incoming_call_sid');
      } else {
        await prefs.remove('last_incoming_call_sid');
      }
      debugPrint('[VoIP Cleanup] ✅ SharedPreferences ring state cleared');
    } catch (e) {
      debugPrint('[VoIP Cleanup] SharedPreferences error (non-fatal): $e');
    }

    // 5. Reset flags
    isRingingOrActive = false;
    clearCallAnswered();

    // 6. Wakelock
    try {
      await WakelockPlus.disable();
    } catch (_) {}

    // 7. Navigator pop to root (safe — won't crash if already at root)
    try {
      final nav = navigatorKey.currentState;
      if (nav != null) {
        while (nav.canPop()) {
          nav.pop();
        }
      }
    } catch (e) {
      debugPrint('[VoIP Cleanup] Navigator pop error (non-fatal): $e');
    }

    debugPrint('[VoIP Cleanup] ✅ Done — all stale UI cleared');
  }

  /// Startup cleanup: if native_ringing_until is in the past, wipe stale state.
  static Future<void> clearStaleStartupRinging() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final until = prefs.getInt('native_ringing_until') ?? 0;
      final now = DateTime.now().millisecondsSinceEpoch;
      if (until > 0 && now > until) {
        debugPrint('[VoIP Cleanup] Startup: stale native_ringing_until detected — clearing');
        await clearStaleIncomingUi();
      }
    } catch (e) {
      debugPrint('[VoIP Cleanup] clearStaleStartupRinging error: $e');
    }
  }

  // ── Cache for reconcile on app resume ─────────────────────────────────────
  static String? _lastApiBaseUrl;
  static String? _lastWsToken;

  /// Polls GET /api/voice/active-calls for a durable source of truth.
  /// Called on WS connect (after registered) and app resume.
  static Future<void> _reconcileActiveCalls(String apiBaseUrl, String? token) async {
    _lastApiBaseUrl = apiBaseUrl;
    _lastWsToken = token;
    try {
      final headers = <String, String>{};
      if (token != null) headers['Authorization'] = 'Bearer $token';
      final resp = await http.get(
        Uri.parse('$apiBaseUrl/api/voice/active-calls'),
        headers: headers,
      ).timeout(const Duration(seconds: 5));
      if (resp.statusCode != 200) {
        debugPrint('[VoIP Reconcile] /active-calls ${resp.statusCode}');
        return;
      }
      final body = jsonDecode(resp.body) as Map<String, dynamic>;
      final activeCalls = (body['activeCalls'] as List? ?? []);
      debugPrint('[VoIP Reconcile] /active-calls: ${activeCalls.length} calls');
      if (activeCalls.isEmpty && isRingingOrActive) {
        debugPrint('[VoIP Reconcile] No active calls — clearing stale UI');
        await clearStaleIncomingUi();
      } else if (activeCalls.isNotEmpty && !isRingingOrActive) {
        debugPrint('[VoIP Reconcile] Missed incoming_call — triggering from snapshot');
        final call = activeCalls.first as Map<String, dynamic>;
        await handleIncomingData({
          'type': 'incoming_call',
          'callSid': call['callSid']?.toString() ?? '',
          'callerNumber': call['from']?.toString() ?? 'Unknown',
          'conf': '',
          'sig': '',
          'expires': '${DateTime.now().add(const Duration(minutes: 2)).millisecondsSinceEpoch}',
        });
      }
    } catch (e) {
      debugPrint('[VoIP Reconcile] Error: $e');
    }
  }

  /// Called from AppLifecycleState.resumed
  static Future<void> reconcileOnResume() async {
    if (_lastApiBaseUrl != null) {
      debugPrint('[VoIP Reconcile] App resumed — reconciling');
      await _reconcileActiveCalls(_lastApiBaseUrl!, _lastWsToken);
    }
  }

  Future<void> init(BackendService backendService, {bool forceReinit = false}) async {
    await ensureDeviceFlagsInitialized();

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
    if (activeCall != null) {
      if (forceReinit) {
        debugPrint('[VoIP] activeCall present but forceReinit=true -> attempting hangUp then continue');
        try { await TwilioVoice.instance.call.hangUp(); } catch (_) {}
      } else {
        debugPrint('[VoIP] ⚠️ activeCall present — skipping re-init (activeCall=${activeCall.to})');
        _isRegistered = true;
        return;
      }
    }

    // if user tapped Answer, DO NOT clear UIs, but allow Init to continue registering tokens
    final skipUiCleanup = callAnsweredGuard;
    if (skipUiCleanup) {
      debugPrint('[VoIP] callAnsweredGuard active — skipping endAllCalls, continuing token registration');
    }

    // Clear ALL stale CallKit call UIs from previous sessions BEFORE re-registering.
    // Also clears stale SharedPreferences ring state if native_ringing_until is expired.
    try {
      if (!skipUiCleanup) {
        // Clear stale native ringing prefs first
        await clearStaleStartupRinging();
        await FlutterCallkitIncoming.endAllCalls();
        // Also cancel any lingering local notification
        await _notif.cancel(id: 0);
        debugPrint('[VoIP] 🧹 Cleared stale CallKit calls + local notification + ring prefs');
      }
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
      await prefs.setString('twilio_access_token', accessToken);
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
            // ActiveCall has no callSid field — read SID from SharedPreferences
            // Use unawaited to avoid 'await in non-async method' error in switch
            unawaited(Future.sync(() async {
              final endedPrefs = await SharedPreferences.getInstance();
              final endedSid = endedPrefs.getString('last_incoming_call_sid');
              debugPrint('[VoIP] 📴 Call ended/declined sid=$endedSid — full cleanup');
              await VoipService.clearStaleIncomingUi(callSid: endedSid);
            }));
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

  /// Normalizes a phone number to E.164 format.
  /// Romanian heuristic: 07xxxxxxxx → +407xxxxxxx, 00xx… → +xx…
  String _normalizeToE164(String input) {
    var s = input.trim().replaceAll(RegExp(r'[\s\-\(\)]'), '');
    if (s.startsWith('+')) return s;
    if (s.startsWith('00')) return '+${s.substring(2)}';
    if (RegExp(r'^\d+$').hasMatch(s)) {
      if (s.startsWith('0') && s.length >= 9 && s.length <= 10) return '+40${s.substring(1)}';
      if (s.startsWith('40') && s.length >= 10) return '+$s';
    }
    return s;
  }

  Future<bool> makeCall(String to) async {
    await ensureDeviceFlagsInitialized();
    final normalizedTo = _normalizeToE164(to);
    debugPrint('CALL_FLOW: VoipService.makeCall STARTED raw=$to normalized=$normalizedTo');

    if (!normalizedTo.startsWith('+')) {
      debugPrint('CALL_FLOW: ❌ Invalid PSTN number (need E.164 like +407xxxxxxx)');
      return false;
    }

    final mic = await Permission.microphone.status;
    if (!mic.isGranted) {
      debugPrint('CALL_FLOW: Mic permission denied — requesting...');
      await Permission.microphone.request();
    }

    // Android 12+/14: keep BT connect granted (AudioSwitch)
    if (Platform.isAndroid) {
      try {
        final bt = await Permission.bluetoothConnect.request();
        debugPrint('CALL_FLOW: BluetoothConnect granted=${bt.isGranted}');
      } catch (_) {}
    }

    final prefs = await SharedPreferences.getInstance();
    final accessToken = prefs.getString('twilio_access_token') ?? '';
    final identity = _lastIdentity ?? prefs.getString('twilio_client_identity') ?? '';

    if (identity.isEmpty) {
      debugPrint('CALL_FLOW: ❌ Missing twilio_client_identity (VoIP not initialized?)');
      return false;
    }

    try {
      // Huawei/Honor: bypass Telecom completely via native Voice.connect
      if (Platform.isAndroid && isHuaweiOrHonor && accessToken.isNotEmpty) {
        debugPrint('CALL_FLOW: Huawei detected → trying native directPlace first');
        try {
          final placedNative = await const MethodChannel('com.superpartybyai.app/call_actions')
              .invokeMethod<bool>('directPlace', {
            'accessToken': accessToken,
            'to': normalizedTo,
          });
          if (placedNative == true) {
            debugPrint('CALL_FLOW: ✅ directPlace SUCCESS (native Voice.connect)');
            return true;
          }
          debugPrint('CALL_FLOW: ⚠️ directPlace returned false → fallback to call.place');
        } catch (e) {
          debugPrint('CALL_FLOW: ❌ directPlace exception: $e → fallback to call.place');
        }
      }

      // Non-Huawei path (or Huawei fallback)
      debugPrint('CALL_FLOW: registerPhoneAccount() (non-fatal)');
      try { await TwilioVoice.instance.registerPhoneAccount(); } catch (e) {
        debugPrint('CALL_FLOW: registerPhoneAccount failed (non-fatal): $e');
      }

      if (Platform.isAndroid) {
        final ok = await const MethodChannel('com.superpartybyai.app/diag').invokeMethod('isCallCapable');
        if (ok != true) debugPrint('CALL_FLOW: ❌ PhoneAccount disabled (ignoring due to UX update).');
      }

      debugPrint('CALL_FLOW: await TwilioVoice.instance.call.place()');
      final result = await TwilioVoice.instance.call.place(
        to: normalizedTo,
        from: identity,
      );
      debugPrint('CALL_FLOW: Call placed result: $result');
      return result == true;
    } catch (e, st) {
      debugPrint('CALL_FLOW: ❌ Call error in try/catch: $e\n$st');
      return false;
    }
  }

  Future<void> hangUp() async {
    try {
      await TwilioVoice.instance.call.hangUp();
      await const MethodChannel('com.superpartybyai.app/call_actions').invokeMethod('directHangup');
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
