import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:device_info_plus/device_info_plus.dart';

/// Centralized Crashlytics helper.
/// Sets custom keys (userId, env, build, requestId, routeName)
/// and provides convenience methods for recording errors.
class CrashlyticsHelper {
  CrashlyticsHelper._();
  static final CrashlyticsHelper instance = CrashlyticsHelper._();

  bool _initialized = false;

  /// Call once from main() after Firebase.initializeApp()
  Future<void> init() async {
    if (_initialized) return;

    // Collect and pass errors to Crashlytics in release mode
    FlutterError.onError = FirebaseCrashlytics.instance.recordFlutterFatalError;

    // Catch async errors not caught by Flutter framework
    PlatformDispatcher.instance.onError = (error, stack) {
      FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
      return true;
    };

    // Disable crash collection in debug mode
    await FirebaseCrashlytics.instance
        .setCrashlyticsCollectionEnabled(kReleaseMode);

    // Set default custom keys
    await setCustomKey('environment', kReleaseMode ? 'production' : 'debug');
    await setCustomKey(
        'buildNumber', const String.fromEnvironment('BUILD_NUMBER', defaultValue: 'dev'));

    // Device info
    try {
      final deviceInfo = DeviceInfoPlugin();
      if (Platform.isAndroid) {
        final android = await deviceInfo.androidInfo;
        await setCustomKey('device', '${android.manufacturer} ${android.model}');
        await setCustomKey('androidSdk', android.version.sdkInt.toString());
      } else if (Platform.isIOS) {
        final ios = await deviceInfo.iosInfo;
        await setCustomKey('device', '${ios.name} ${ios.model}');
        await setCustomKey('iosVersion', ios.systemVersion);
      }
    } catch (_) {}

    _initialized = true;
    debugPrint('[Crashlytics] ✅ Initialized');
  }

  /// Set the authenticated user ID
  Future<void> setUserId(String userId) async {
    await FirebaseCrashlytics.instance.setUserIdentifier(userId);
    await setCustomKey('userId', userId);
  }

  /// Set the latest requestId from backend API response
  Future<void> setRequestId(String requestId) async {
    await setCustomKey('lastRequestId', requestId);
  }

  /// Set current route/screen name
  Future<void> setRouteName(String routeName) async {
    await setCustomKey('routeName', routeName);
  }

  /// Set an arbitrary custom key
  Future<void> setCustomKey(String key, String value) async {
    await FirebaseCrashlytics.instance.setCustomKey(key, value);
  }

  /// Record a non-fatal error
  Future<void> recordError(
    dynamic error,
    StackTrace? stack, {
    String? reason,
    bool fatal = false,
  }) async {
    await FirebaseCrashlytics.instance.recordError(
      error,
      stack,
      reason: reason ?? 'non-fatal error',
      fatal: fatal,
    );
  }

  /// Log a message (breadcrumb) for debugging crashes
  Future<void> log(String message) async {
    await FirebaseCrashlytics.instance.log(message);
  }
}
