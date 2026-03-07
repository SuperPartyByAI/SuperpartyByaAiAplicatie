import 'dart:io';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:twilio_voice/twilio_voice.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'dart:convert';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'screens/incoming_call_screen.dart';
import 'services/auth_service.dart';
import 'widgets/global_inbox_badge.dart'; // GlobalInboxBadgeOverlay
import 'package:superparty_app/services/backend_service.dart';
import 'package:superparty_app/screens/team_management_screen.dart';
import 'services/voip_service.dart';
import 'services/call_kit_service.dart';
import 'services/voip_logger.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'services/supabase_service.dart';
import 'services/bg_gps_service.dart'; // NOU: Pilonul B1 Background GPS
import 'screens/login_screen.dart';
import 'screens/main_screen.dart';
import 'screens/logistics/staff_hours_screen.dart';
import 'screens/admin_trip_review_screen.dart';
import 'screens/location_required_screen.dart';
import 'services/location_compliance_service.dart';
import '../services/trips_api_service.dart';
import 'dart:async';
import 'screens/active_call_screen.dart';
import 'screens/pending_approval_screen.dart';
import 'screens/consent_screen.dart';
import 'package:in_app_update/in_app_update.dart';

const _kCallActionsChannel = 'com.superpartybyai.app/call_actions';
const _kAudioChannel       = 'com.superpartybyai.app/audio';
const _kDiagChannel        = 'com.superpartybyai.app/diag';


// ── Notifications ──
final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin = FlutterLocalNotificationsPlugin();

// ── FCM background handler (required by Twilio for incoming calls when app is background) ──
@pragma('vm:entry-point')
Future<void> _fcmBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  await VoipService.handleBackgroundMessage(message.data);
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await VoipService.ensureDeviceFlagsInitialized();

  // --- Android dedupe: if native UI is already active, suppress Flutter UI/notification ---
  try {
    if (Platform.isAndroid) {
      final prefs = await SharedPreferences.getInstance();
      final until = prefs.getInt('native_ringing_until') ?? 0;
      final now = DateTime.now().millisecondsSinceEpoch;
      if (now < until) {
        debugPrint('[main] 🔕 Cold start blocked: Android native ringing UI is currently active.');
        VoipService.isRingingOrActive = true;
      }
    }
  } catch (_) {}

  // Initialize FCM (Google Cloud Messaging) and Local Notifications
  try {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(_fcmBackgroundHandler);

    const AndroidInitializationSettings initializationSettingsAndroid =
        AndroidInitializationSettings('@mipmap/ic_launcher');
    final InitializationSettings initializationSettings =
        InitializationSettings(android: initializationSettingsAndroid);
    await flutterLocalNotificationsPlugin.initialize(
        settings: initializationSettings,
        onDidReceiveNotificationResponse: (NotificationResponse response) async {
      if (response.payload != null) {
        final data = jsonDecode(response.payload!);
        final ctx = navigatorKey.currentContext;
        if (ctx != null) {
          Navigator.of(ctx).push(MaterialPageRoute(
            builder: (_) => IncomingCallScreen(
              conf: data['conf'] ?? '',
              callSid: data['callSid'] ?? '',
              caller: data['caller'] ?? 'Unknown',
              sig: data['sig'] ?? '',
              expires: data['expires'] ?? '',
            ),
          ));
        }
      }
    });

    debugPrint('[FCM & Notifications] ✅ Initialized');
  } catch (e) {
    debugPrint('[FCM & Notifications] ❌ Init error (non-fatal): $e');
  }
  
  try {

    // ── Supabase: Initialize Supabase client ──
    await Supabase.initialize(
      url: 'https://ilkphpidhuytucxlglqi.supabase.co',
      anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlsa3BocGlkaHV5dHVjeGxnbHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNDI1NTYsImV4cCI6MjA4NzkxODU1Nn0.vO95CLAgt9M1vUr4za9CNVHjuEmeeQWW-qCMnY4_UPE',
    );
    await SupabaseService.initialize();
    debugPrint('[Supabase] ✅ Initialized');

    // Initialize CallKit
    await CallKitService().init();
  } catch (e) {
    debugPrint("App Initialization Error: $e");
  }



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
          VoipService.clearCallAnswered();
          // Send Hangup signal to PBX server synchronously BEFORE we tear down
          // the native local audio context to ensure it transmits correctly.
          await VoipService.rejectCallFromServer('', callSid);

          await TwilioVoice.instance.call.hangUp();
          debugPrint('[main] rejectCall done and transmitted to Server.');
        } catch (e) {
          debugPrint('[main] rejectCall error: $e');
        }
        break;

      case 'callEnded':
        // Huawei directPlace/directAnswer: native ends the call, Flutter must close UI
        debugPrint('[main] ✅ callEnded received from native — closing call UI');
        VoipService.clearCallAnswered();
        VoipService.isRingingOrActive = false;
        try { await WakelockPlus.disable(); } catch (_) {}
        try {
          final activeForEnd = TwilioVoice.instance.call.activeCall;
          if (activeForEnd != null) await TwilioVoice.instance.call.hangUp();
        } catch (_) {}
        final nav = navigatorKey.currentState;
        if (nav != null && nav.canPop()) nav.pop();
        break;

      case 'callConnectFailure':
        debugPrint('[main] ❌ callConnectFailure from native: ${args['message']}');
        VoipService.clearCallAnswered();
        VoipService.isRingingOrActive = false;
        try { await WakelockPlus.disable(); } catch (_) {}
        try {
          final activeForFail = TwilioVoice.instance.call.activeCall;
          if (activeForFail != null) await TwilioVoice.instance.call.hangUp();
        } catch (_) {}
        final nav2 = navigatorKey.currentState;
        if (nav2 != null && nav2.canPop()) nav2.pop();
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
  debugPrint('[main] 📞 answerCall received. from: $from, callSid: $callSid');
  VoipLogger.instance.logEvent('ACCEPT_TAPPED', extra: {'from': from, 'callSid': callSid});
  try {
    if (Platform.isAndroid) {
      await Permission.bluetoothConnect.request();
      await Permission.bluetoothScan.request();
    }
  } catch (_) {}
  if (callSid.isNotEmpty) VoipLogger.instance.setLastCallSid(callSid);

  VoipService.setCallAnswered();

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
    // Request audio focus immediately
    try {
      await const MethodChannel(_kAudioChannel).invokeMethod('requestAudioFocusAndMode');
    } catch (_) {}

    // 1️⃣ ATTEMPT NATIVE DIRECT ANSWER (Huawei Bypass)
    debugPrint('[main] 📞 directAnswer started...');
    bool directAccepted = false;
    try {
      directAccepted = await const MethodChannel('com.superpartybyai.app/call_actions').invokeMethod('directAnswer') ?? false;
      debugPrint('[main] 📞 directAnswer result: $directAccepted');
    } catch (e) {
      debugPrint('[main] ❌ directAnswer exception: $e');
    }
    
    if (directAccepted) {
       debugPrint('[main] ✅ directAnswer SUCCESS! Returning early.');
       debugPrint('[main] 🧹 cleanup invoked: no');
       return; 
    }

    // 2️⃣ NATIVE ANSWER ON EXISTING INVITE (Twilio SDK default answer)
    final activeCallBefore = TwilioVoice.instance.call.activeCall;
    bool activeCallPresent = activeCallBefore != null;
    debugPrint('[main] 📞 activeCall present before answer: ${activeCallPresent ? "yes" : "no"}');
    if (activeCallPresent) {
      debugPrint('[main] 📞 current activeCall: from=${activeCallBefore.from}, to=${activeCallBefore.to}, dir=${activeCallBefore.callDirection}');
    }

    debugPrint('[main] 📞 TwilioVoice.instance.call.answer() started...');
    bool answered = false;
    try {
      answered = await TwilioVoice.instance.call.answer() ?? false;
      debugPrint('[main] 📞 TwilioVoice.instance.call.answer() result: $answered');
    } catch(e) {
      debugPrint('[main] ❌ TwilioVoice.instance.call.answer() exception: $e');
    }

    if (!answered) {
      debugPrint('[main] ❌ Answer completely failed. No active invite found natively.');
      // Keep cleanup logs updated as requested
      debugPrint('[main] 🧹 cleanup invoked: yes');
      VoipService.clearCallAnswered();
      VoipService.isRingingOrActive = false;
      final nav = navigatorKey.currentState;
      if (nav != null && nav.canPop()) nav.pop();
    } else {
      debugPrint('[main] 🧹 cleanup invoked: no');
    }


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



class _ApprovalGateState extends State<ApprovalGate> with WidgetsBindingObserver {
  bool _loading = true;
  bool _approved = false;
  bool _isAdmin = false;
  bool _consentGiven = false;

  bool _isCompliant = true; // Assume true until fully checked to prevent red flash
  List<String> _complianceReasons = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _checkStatus();
    // Show the global inbox badge overlay above everything
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) GlobalInboxBadgeOverlay.show(context);
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if ((_approved || _isAdmin) && _consentGiven && !_loading) {
        _enforceCompliance();
      }
    }
  }

  Future<void> _enforceCompliance() async {
    final result = await LocationComplianceService.checkCompliance();
    if (mounted) {
      setState(() {
         _isCompliant = result.isCompliant;
         _complianceReasons = result.reasons;
      });
      if (!result.isCompliant) {
         debugPrint('[ApprovalGate] GPS gate failed: ${result.reasons}');
      } else {
         debugPrint('[ApprovalGate] GPS gate verified compliant.');
      }
    }
  }

  void _checkStatus() async {
    debugPrint('[_checkStatus] STARTED');
    final backend = Provider.of<BackendService>(context, listen: false);
    final auth = Provider.of<AuthService>(context, listen: false);
    
    try {
      // Fetch Employee Status and User Profile CONCURRENTLY to speed up app startup
      debugPrint('[_checkStatus] calling Future.wait...');
      final results = await Future.wait([
        backend.getMyStatus().catchError((e) {
          debugPrint('[_checkStatus] getMyStatus error: $e');
          return <String, dynamic>{};
        }),
        backend.getUserProfile().catchError((profileErr) {
          debugPrint('[_checkStatus] getUserProfile error: $profileErr');
          return <String, dynamic>{};
        }),
      ]);
      debugPrint('[_checkStatus] Future.wait COMPLETE');

      final employeeStatus = results[0] as Map<String, dynamic>;
      Map<String, dynamic> userProfile = results[1] as Map<String, dynamic>;
      
      if (mounted) {
        setState(() {
          _approved = employeeStatus['approved'] == true;
          _isAdmin = employeeStatus['role'] == 'admin' || auth.currentUser?.email == 'ursache.andrei1995@gmail.com' || auth.currentUser?.email == 'superpartybyai@gmail.com'; 
          
          final String? version = userProfile['latestConsentVersion'];
          // Admins bypass the consent screen restriction to prevent VoIP interruption
          _consentGiven = _isAdmin || version == 'v1' || userProfile.isEmpty;

          _loading = false;
          
          // 🚨 CRITICAL ASYNC BYPASS: If a call was answered natively while we were
          // waiting for these Futures to resolve, do NOT initialize VoIP (which kills
          // active calls) and temporarily grant consent to unblock the UI.
          if (VoipService.isRingingOrActive) {
             debugPrint("[App] Future resolved but VoIP is currently active. Bypassing gates.");
             // Force UI out of loading and consent directly into MainScreen
             _consentGiven = true;
             return;
          }

          if ((_approved || _isAdmin) && _consentGiven) {
             debugPrint("[App] User approved & consented. Initializing VoIP & GPS...");
             final user = auth.currentUser;
             final backend = Provider.of<BackendService>(context, listen: false);
             VoipService().init(backend);
             
             // Pornește Background GPS Tracking automat când userul este aprobat
             if (user != null) {
               auth.getIdToken().then((token) {
                 if (token != null) {
                   BgGpsService.initialize(token, user.id).then((_) {
                     BgGpsService.startTracking().then((_) {
                       _enforceCompliance();
                     });
                   });
                 } else {
                   _enforceCompliance();
                 }
               });
             } else {
               _enforceCompliance();
             }
          } else {
             // Will hit enforcement when consented.
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

            // Fallback GPS Initialize
            final user = auth.currentUser;
            if (user != null) {
               auth.getIdToken().then((token) {
                 if (token != null) {
                   BgGpsService.initialize(token, user.id).then((_) {
                     BgGpsService.startTracking().then((_) {
                       _enforceCompliance();
                     });
                   });
                 } else {
                   _enforceCompliance();
                 }
               });
            } else {
               _enforceCompliance();
            }
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

    final auth = Provider.of<AuthService>(context, listen: false);
    final user = auth.currentUser;
    if (user != null) {
       auth.getIdToken().then((token) {
         if (token != null) {
           BgGpsService.initialize(token, user.id).then((_) {
             BgGpsService.startTracking().then((_) {
               _enforceCompliance();
             });
           });
         } else {
           _enforceCompliance();
         }
       });
    } else {
       _enforceCompliance();
    }
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
      // 🚨 CRITICAL BYPASS: Do not show ConsentScreen if the app was just launched by an Incoming Call push.
      // If we render ConsentScreen, it will override the IncomingCallScreen layer.
      if (VoipService.isRingingOrActive) {
        debugPrint('[ApprovalGate] 🚨 Incoming Call detected! Bypassing ConsentScreen to allow IncomingCallScreen to render.');
        return const MainScreen();
      }
      return ConsentScreen(onConsentGiven: _onConsentSuccess);
    }

    // 3. Location Compliance Gate
    if (!_isCompliant) {
      return LocationRequiredScreen(
        reasons: _complianceReasons,
        onRetry: _enforceCompliance, // The user taps "Retry" to fire enforcement again
      );
    }

    // 4. Main App
    return const MainScreen();
  }
}
