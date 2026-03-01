import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:provider/provider.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:twilio_voice/twilio_voice.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:firebase_app_check/firebase_app_check.dart';


import 'services/auth_service.dart';
import 'widgets/global_inbox_badge.dart'; // GlobalInboxBadgeOverlay
import 'package:superparty_app/services/backend_service.dart';
import 'package:superparty_app/screens/team_management_screen.dart';
import 'services/voip_service.dart';
import 'services/call_kit_service.dart';
import 'services/voip_logger.dart';
import 'services/crashlytics_helper.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'services/supabase_service.dart';
import 'screens/login_screen.dart';
import 'screens/main_screen.dart';
import 'screens/active_call_screen.dart';
import 'screens/pending_approval_screen.dart';
import 'screens/consent_screen.dart';
import 'package:in_app_update/in_app_update.dart';

import 'firebase_options.dart';

const _kCallActionsChannel = 'com.superpartybyai.app/call_actions';
const _kAudioChannel       = 'com.superpartybyai.app/audio';
const _kDiagChannel        = 'com.superpartybyai.app/diag';

// TOP-LEVEL background handler
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // Ensure Firebase is initialized in the background isolate
  await Firebase.initializeApp();

  debugPrint('[FIREBASE BACKGROUND] messageId=${message.messageId}');
  debugPrint('[FIREBASE BACKGROUND] data=${message.data}');

  // Detect Twilio voice call push — log ONLY.
  // DO NOT call flutter_callkit_incoming from this background Dart isolate:
  // plugin platform channels are not available here and the call silently fails.
  // Twilio's native VoiceFirebaseMessagingService (registered in AndroidManifest)
  // will process the FCM push natively and fire CallEvent.incoming in the main
  // app process → VoipService listener → CallKitService().showIncomingCall() safely.
  final data = message.data;
  if (data['twi_message_type'] == 'twilio.voice.call') {
    final from = data['twi_from'] ?? 'Unknown';
    final callSid = data['twi_call_sid'] ?? '';
    debugPrint('[FIREBASE BACKGROUND] 📞 Twilio call from $from (sid=$callSid) — handled natively by Twilio SDK.');
    if (callSid.isNotEmpty) VoipLogger.instance.setLastCallSid(callSid);
    VoipLogger.instance.logCallInvite(from: from as String, to: 'superparty_admin', callSid: callSid as String?);
  }
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  try {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );

    // ── Supabase: Initialize Supabase client ──
    await Supabase.initialize(
      url: 'https://ilkphpidhuytucxlglqi.supabase.co',
      anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlsa3BocGlkaHV5dHVjeGxnbHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNDI1NTYsImV4cCI6MjA4NzkxODU1Nn0.vO95CLAgt9M1vUr4za9CNVHjuEmeeQWW-qCMnY4_UPE',
    );
    await SupabaseService.initialize();
    debugPrint('[Supabase] ✅ Initialized');

    // ── Crashlytics: Initialize global error handlers ──
    await CrashlyticsHelper.instance.init();

    // ── App Check: Activate with platform-appropriate provider ──
    await FirebaseAppCheck.instance.activate(
      androidProvider: kDebugMode
          ? AndroidProvider.debug
          : AndroidProvider.playIntegrity,
      appleProvider: kDebugMode
          ? AppleProvider.debug
          : AppleProvider.deviceCheck,
    );
    debugPrint('[AppCheck] ✅ Activated');
    
    // Request POST_NOTIFICATIONS at runtime on Android 13+ (API 33)
    if (Platform.isAndroid) {
      final settings = await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        provisional: false,
      );
      debugPrint('[FIREBASE PERM] authorizationStatus=${settings.authorizationStatus}');
      debugPrint('[FIREBASE PERM] alert=${settings.alert} sound=${settings.sound}');
    }

    // Initialize CallKit
    await CallKitService().init();
  } catch (e) {
    print("----------------------------------------------------------------");
    print("FIREBASE INIT FAILED: $e");
    print("----------------------------------------------------------------");
    VoipLogger.instance.logAuthError(e.toString().contains('network') ? 'firebase_auth/network-request-failed' : 'firebase_init_error', details: e.toString());
  }

  // Înregistrează handler-ul background (trebuie apelat înainte de runApp)
  FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

  // Foreground → show Flutter UI only when app is active
  FirebaseMessaging.onMessage.listen((RemoteMessage message) {
    debugPrint('[FIREBASE FOREGROUND] messageId=${message.messageId}');
    debugPrint('[FIREBASE FOREGROUND] data=${message.data}');
    if (message.notification != null) {
      debugPrint('[FIREBASE FOREGROUND] notification=${message.notification!.title} / ${message.notification!.body}');
    }
    // AppLifecycleState guard: only show Flutter incoming UI in foreground
    // When in background/killed, native ConnectionService handles the call UI
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    debugPrint('[FIREBASE FOREGROUND] lifecycleState=$lifecycle');
    // (VoipService handles CallEvent.incoming separately via Twilio SDK)
  });

  // Când utilizatorul deschide app din notificare
  FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
    debugPrint('[FIREBASE OPENEDAPP] messageId=${message.messageId}');
    debugPrint('[FIREBASE OPENEDAPP] data=${message.data}');
  });

  // Explicit Token Logging
  FirebaseMessaging.instance.getToken().then((token) {
    debugPrint("----------------------------------------------------------------");
    debugPrint("FCM TOKEN: $token");
    debugPrint("----------------------------------------------------------------");
  });

  // --- Automated Google Play In-App Updates ---
  // Only execute the Google Play check in release mode.
  // Sideloaded debug APKs will crash or show "Install Error" because they lack signatures.
  try {
    if (kReleaseMode && Platform.isAndroid) {
      final AppUpdateInfo updateInfo = await InAppUpdate.checkForUpdate();
      if (updateInfo.updateAvailability == UpdateAvailability.updateAvailable) {
        debugPrint('[IN_APP_UPDATE] Update available. Forcing immediate update UI...');
        await InAppUpdate.performImmediateUpdate();
      } else {
        debugPrint('[IN_APP_UPDATE] App is up to date.');
      }
    } else {
      debugPrint('[IN_APP_UPDATE] Skipped: Running in Debug mode or non-Android.');
    }
  } catch (e) {
    debugPrint('[IN_APP_UPDATE FAILED]: $e');
  }

  runApp(const MyApp());

  // ── STEP 1: Register phone account immediately on every cold-start ──
  // This is required by TVConnectionService to process ACTION_ANSWER.
  // Without it, answer() silently fails with "No call capable phone account".
  _twilioEarlyInit();

  // ── STEP 2: Register call actions handler IMMEDIATELY after runApp ──
  _registerCallActionsHandler();
}

/// Called on every cold-start to ensure Android TelecomManager knows about
/// our VoIP app before any incoming call answer attempt.
Future<void> _twilioEarlyInit() async {
  try {
    // Request phone permissions non-interactively (may already be granted)
    await TwilioVoice.instance.requestReadPhoneNumbersPermission();
    debugPrint('[main] requestReadPhoneNumbersPermission() done');
  } catch (e) {
    debugPrint('[main] requestReadPhoneNumbersPermission error: $e');
  }
  try {
    await TwilioVoice.instance.registerPhoneAccount();
    debugPrint('[main] ✅ Phone account registered at cold-start');
  } catch (e) {
    debugPrint('[main] registerPhoneAccount() error (non-fatal): $e');
  }
}

void _registerCallActionsHandler() {
  const channel = MethodChannel(_kCallActionsChannel);
  channel.setMethodCallHandler((call) async {
    debugPrint('[main] ← MethodChannel: ${call.method} args=${call.arguments}');
    final args = call.arguments as Map? ?? {};
    final from = (args['from'] as String? ?? 'Superparty').replaceFirst('client:', '');
    final callSid = args['callSid'] as String? ?? '';

    switch (call.method) {
      case 'answerCall':
        await answerIncomingCall(from, callSid);
        break;
      case 'rejectCall':
        try {
          await TwilioVoice.instance.call.hangUp();
          debugPrint('[main] rejectCall done');
        } catch (e) {
          debugPrint('[main] rejectCall error: $e');
        }
        break;
    }
  });

  // Signal Kotlin that Flutter is ready to receive pending actions
  channel.invokeMethod('ready').catchError((e) {
    debugPrint('[main] ready signal error: $e');
  });

  debugPrint('[main] ✅ Call actions MethodChannel handler registered');
}

Future<void> answerIncomingCall(String from, String callSid) async {
  VoipLogger.instance.logEvent('ACCEPT_TAPPED', extra: {'from': from, 'callSid': callSid});
  if (callSid.isNotEmpty) VoipLogger.instance.setLastCallSid(callSid);

  // ── Navigate to ActiveCallScreen IMMEDIATELY so user sees the call UI ──
  final callerName = from.replaceFirst('client:', '').replaceFirst('+', '');
  final ctx = navigatorKey.currentContext;
  if (ctx != null) {
    Navigator.of(ctx).push(MaterialPageRoute(
      builder: (_) => ActiveCallScreen(remoteId: callerName.isNotEmpty ? callerName : 'Superparty', isOutgoing: false, callSid: callSid.isNotEmpty ? callSid : null),
    ));
  } else {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final c = navigatorKey.currentContext;
      if (c != null) {
        Navigator.of(c).push(MaterialPageRoute(
          builder: (_) => ActiveCallScreen(remoteId: callerName.isNotEmpty ? callerName : 'Superparty', isOutgoing: false, callSid: callSid.isNotEmpty ? callSid : null),
        ));
      }
    });
  }

  try {
    // ── Set guard FIRST to block any concurrent VoIP re-init ──
    // This MUST happen before answer() to prevent the race condition where
    // ApprovalGate / login fires VoipService.init() → endAllCalls() → kills call.
    VoipService.setCallAnswered();
    debugPrint('[main] 🛡️ callAnsweredGuard SET — blocking VoIP re-init');

    // ── STEP 1: Try native directAnswer bypass (Huawei-safe) ──
    debugPrint('[main] 📞 Trying directAnswer bypass...');
    bool directAnswered = false;
    try {
      final directResult = await const MethodChannel(_kCallActionsChannel)
          .invokeMethod<bool>('directAnswer');
      directAnswered = directResult == true;
      debugPrint('[main] directAnswer result: $directAnswered');
    } catch (e) {
      debugPrint('[main] directAnswer channel error (non-fatal): $e');
    }

    // Request audio focus immediately
    try {
      await const MethodChannel(_kAudioChannel)
          .invokeMethod('requestAudioFocusAndMode');
    } catch (_) {}

    if (directAnswered) {
      debugPrint('[main] ✅ Call answered via directAnswer bypass!');
      return;
    }

    // ── STEP 2: Fallback to standard Twilio SDK answer() ──
    debugPrint('[main] directAnswer false — fallback to TwilioVoice.answer()...');
    final result = await TwilioVoice.instance.call.answer();
    debugPrint('[main] ✅ answer() result: $result');
    debugPrint('[main] ✨ Call answered successfully.');

  } catch (e) {
    VoipService.clearCallAnswered(); // Clear guard on failure
    debugPrint('[main] answerCall error: $e');
    VoipLogger.instance.logAuthError('answerCall_error', details: e.toString());
  }
}



final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthService()),
        ProxyProvider<AuthService, BackendService>(
          update: (_, auth, __) => BackendService(auth),
        ),
      ],
      child: MaterialApp(
        navigatorKey: navigatorKey,
        title: 'Superparty WhatsApp',
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF008069)),
          useMaterial3: true,
          textTheme: GoogleFonts.interTextTheme(),
        ),
        home: const AuthWrapper(),
      ),
    );
  }
}

class AuthWrapper extends StatelessWidget {
  const AuthWrapper({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthService>(context);
    print("DEBUG: [AuthWrapper] Rebuild. isLoading=${auth.isLoading}, isAuthenticated=${auth.isAuthenticated}, user=${auth.user?.id}");

    if (auth.isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    if (!auth.isAuthenticated) {
      return const LoginScreen();
    }

    // Authenticated -> Check Approval
    return const ApprovalGate();
  }
}

class ApprovalGate extends StatefulWidget {
  const ApprovalGate({super.key});

  @override
  State<ApprovalGate> createState() => _ApprovalGateState();
}



class _ApprovalGateState extends State<ApprovalGate> {
  bool _loading = true;
  bool _approved = false;
  bool _isAdmin = false;
  bool _consentGiven = false;

  @override
  void initState() {
    super.initState();
    _checkStatus();
    // Show the global inbox badge overlay above everything
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) GlobalInboxBadgeOverlay.show(context);
    });
  }

  void _checkStatus() async {
    final backend = Provider.of<BackendService>(context, listen: false);
    final auth = Provider.of<AuthService>(context, listen: false);
    
    try {
      // Fetch Employee Status and User Profile CONCURRENTLY to speed up app startup
      final results = await Future.wait([
        backend.getMyStatus().catchError((e) {
          debugPrint('Error getting my status: $e');
          return <String, dynamic>{};
        }),
        backend.getUserProfile().catchError((profileErr) {
          debugPrint('[App] getUserProfile failed: $profileErr');
          return <String, dynamic>{};
        }),
      ]);

      final employeeStatus = results[0] as Map<String, dynamic>;
      Map<String, dynamic> userProfile = results[1] as Map<String, dynamic>;
      
      if (mounted) {
        setState(() {
          _approved = employeeStatus['approved'] == true;
          _isAdmin = employeeStatus['role'] == 'admin' || auth.currentUser?.email == 'ursache.andrei1995@gmail.com'; 
          
          // Assume consent given if user profile fails since we're migrating
          final String? version = userProfile['latestConsentVersion'];
          _consentGiven = version == 'v1' || userProfile.isEmpty;

          _loading = false;
          
          if ((_approved || _isAdmin) && _consentGiven) {
             debugPrint("[App] User approved & consented. Initializing VoIP...");
             final user = auth.currentUser;
             if (user != null) {
               CrashlyticsHelper.instance.setUserId(user.id);
               CrashlyticsHelper.instance.setCustomKey('email', user.email ?? '');
             }
             final backend = Provider.of<BackendService>(context, listen: false);
             VoipService().init(backend);
          }
        });
      }
    } catch (e) {
      debugPrint("Status Check Failed: $e");
      // On total failure, try direct fallback
      try {
        final email = auth.currentUser?.email ?? '';
        bool isAdmin = email == 'ursache.andrei1995@gmail.com';
        bool hasConsent = true; // Temporary bypass during migration
        
        if (mounted) {
          setState(() {
            _approved = isAdmin;
            _isAdmin = isAdmin;
            _consentGiven = hasConsent;
            _loading = false;
          });
          if ((isAdmin) && hasConsent) {
            final backend = Provider.of<BackendService>(context, listen: false);
            VoipService().init(backend);
          }
        }
      } catch (_) {
        if (mounted) setState(() => _loading = false);
      }
    }
  }


  void _onConsentSuccess() {
    // User just agreed. Re-check status or manually set true and init VoIP
    setState(() {
      _consentGiven = true;
    });
    // Init VoIP now
    final backend = Provider.of<BackendService>(context, listen: false);
    VoipService().init(backend);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    // 1. Employee Approval Check
    if (!_approved && !_isAdmin) {
      return PendingApprovalScreen(onApproved: _checkStatus);
    }

    // 2. Consent Check (only if approved)
    if (!_consentGiven) {
      return ConsentScreen(onConsentGiven: _onConsentSuccess);
    }

    // 3. Main App
    return const MainScreen();
  }
}
