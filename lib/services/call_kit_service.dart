import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:twilio_voice/twilio_voice.dart';
import 'package:uuid/uuid.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// navigatorKey is defined in main.dart — imported via global access
import '../main.dart' show navigatorKey, answerIncomingCall;
import '../screens/active_call_screen.dart';

class CallKitService {
  static final CallKitService _instance = CallKitService._internal();
  factory CallKitService() => _instance;
  CallKitService._internal();

  final Uuid _uuid = const Uuid();
  String? _currentCallId;
  String _currentCallerId = '';

  Future<void> init() async {
    FlutterCallkitIncoming.onEvent.listen((event) async {
      debugPrint('[CallKit] Event: ${event?.event}');

      switch (event?.event) {
        case Event.actionCallIncoming:
          debugPrint('[CallKit] 📲 Incoming call ringing on screen');
          break;

        case Event.actionCallAccept:
          // User tapped "Răspunde" on the CallKit notification UI.
          debugPrint('[CallKit] ✅ ACCEPT tapped — routing to centralized answerCall handler');
          // Delegate to the global event handler defined in main.dart which handles
          // waiting for activeCall initialization from cold start and retry logic.
          answerIncomingCall(_currentCallerId, '');
          
          final ctx = navigatorKey.currentContext;
          if (ctx != null) {
            Navigator.of(ctx).push(
              MaterialPageRoute(
                builder: (_) => ActiveCallScreen(
                  remoteId: _currentCallerId.isNotEmpty
                      ? _currentCallerId
                      : 'Superparty',
                  isOutgoing: false,
                ),
              ),
            );
          }
          break;
          break;

        case Event.actionCallDecline:
          // User tapped "Refuză" on the CallKit UI.
          debugPrint('[CallKit] ❌ DECLINE tapped — hanging up');
          try {
            await TwilioVoice.instance.call.hangUp();
          } catch (e) {
            debugPrint('[CallKit] hangUp() error: $e');
          }
          if (_currentCallId != null) {
            await FlutterCallkitIncoming.endCall(_currentCallId!);
          }
          break;

        case Event.actionCallEnded:
          debugPrint('[CallKit] 📴 Call ended');
          try {
            await TwilioVoice.instance.call.hangUp();
          } catch (_) {}
          break;

        case Event.actionCallTimeout:
          debugPrint('[CallKit] ⏱ Call timeout — missed');
          break;

        default:
          break;
      }
    });
  }

  /// Show native incoming call UI (full screen on Android lock screen,
  /// notification banner in foreground). Works for all app states.
  Future<void> showIncomingCall(String callerId, String callerName,
      {String? handle}) async {
    _currentCallId = _uuid.v4();
    _currentCallerId = callerId;

    final params = CallKitParams(
      id: _currentCallId,
      nameCaller: callerName.isNotEmpty ? callerName : 'Superparty',
      appName: 'Superparty',
      handle: handle ?? callerId,
      type: 0, // 0 = Audio
      textAccept: 'Răspunde',
      textDecline: 'Refuză',
      duration: 45000, // 45s ring timeout
      missedCallNotification: const NotificationParams(
        showNotification: true,
        isShowCallback: false,
        subtitle: 'Apel pierdut de la Superparty',
      ),
      android: const AndroidParams(
        // FIX: isCustomNotification: false uses a standard high-priority
        // notification with full-screen intent instead of launching a custom
        // Activity with FLAG_ACTIVITY_CLEAR_TASK (which "kicks" app out).
        isCustomNotification: false,
        isShowLogo: false,
        ringtonePath: 'system_ringtone_default',
        backgroundColor: '#0A0A0A',
        actionColor: '#00C853',
        incomingCallNotificationChannelName: 'Apeluri Superparty',
        missedCallNotificationChannelName: 'Apeluri Pierdute',
        // Show full-screen on lock screen via fullScreenIntent notification
        isShowFullLockedScreen: true,
      ),
      ios: const IOSParams(
        handleType: 'number',
        supportsVideo: false,
        maximumCallGroups: 1,
        maximumCallsPerCallGroup: 1,
        audioSessionMode: 'voiceChat',
        audioSessionActive: true,
        supportsDTMF: true,
        supportsHolding: false,
        supportsGrouping: false,
        supportsUngrouping: false,
        ringtonePath: 'system_ringtone_default',
      ),
    );

    debugPrint(
        '[CallKit] 📞 Showing incoming call UI — caller: $callerId (id: $_currentCallId)');
    try {
      await FlutterCallkitIncoming.showCallkitIncoming(params);
    } catch (e) {
      debugPrint('[CallKit] ⚠️ showCallkitIncoming error (non-fatal): $e');
    }
  }

  Future<void> endCall() async {
    try {
      if (_currentCallId != null) {
        await FlutterCallkitIncoming.endCall(_currentCallId!);
        _currentCallId = null;
      }
      await FlutterCallkitIncoming.endAllCalls();
    } catch (e) {
      debugPrint('[CallKit] endCall error (non-fatal): $e');
    }
  }
}
