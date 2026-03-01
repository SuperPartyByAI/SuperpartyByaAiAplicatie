const fs = require('fs');
let code = fs.readFileSync('lib/main.dart', 'utf-8');

const targetFunction = `Future<void> answerIncomingCall(String from, String callSid) async {
  VoipLogger.instance.logEvent('ACCEPT_TAPPED', extra: {'from': from, 'callSid': callSid});
  if (callSid.isNotEmpty) VoipLogger.instance.setLastCallSid(callSid);

  // ── Navigate to ActiveCallScreen IMMEDIATELY so user sees the call UI ──
  final callerName = from.replaceFirst('client:', '').replaceFirst('+', '');
  final ctx = navigatorKey.currentContext;
  if (ctx != null) {
    Navigator.of(ctx).push(MaterialPageRoute(
      builder: (_) => ActiveCallScreen(remoteId: callerName.isNotEmpty ? callerName : 'Superparty', isOutgoing: false),
    ));
  } else {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final c = navigatorKey.currentContext;
      if (c != null) {
        Navigator.of(c).push(MaterialPageRoute(
          builder: (_) => ActiveCallScreen(remoteId: callerName.isNotEmpty ? callerName : 'Superparty', isOutgoing: false),
        ));
      }
    });
  }

  try {
    debugPrint('[main] 🚀 EXECUTING FAKE-ANSWER BYPASS FOR RESTRICTIVE DEVICES (HUAWEI)');
    
    // 1. Terminate the active Twilio Call (reject the VoIP push)
    final activeCall = TwilioVoice.instance.call.activeCall;
    if (activeCall != null) {
       await TwilioVoice.instance.call.hangUp();
       debugPrint('[main] ❌ Fake HangUp completed. Native Telecom UI should dismiss.');
    } else {
       debugPrint('[main] ⚠️ No activeCall to hang up, proceeding with bypass...');
    }

    // 2. Wait for Twilio Server to process the HangUp and execute <Redirect> 
    debugPrint('[main] ⏳ Waiting 1.5 seconds for backend parking...');
    await Future.delayed(const Duration(milliseconds: 1500));

    // 3. Initiate an OUTBOUND VoIP call to the bridge endpoint.
    debugPrint('[main] 📞 Initiating Outbound Call to bridge_' + callSid);
    await VoipService().makeCall('bridge_' + callSid);

    try {
      await const MethodChannel('com.superpartybyai.app/audio')
          .invokeMethod('requestAudioFocusAndMode');
    } catch (_) {}

    debugPrint('[main] ✨ Fake-Answer Bypass completed successfully.');

  } catch (e) {
    debugPrint('[main] answerCall handler error: ' + e.toString());
    VoipLogger.instance.logAuthError('answerCall_bypass_error', details: e.toString());
  }
}`;

// Find start of answerIncomingCall
const startIndex = code.indexOf('Future<void> answerIncomingCall(String from, String callSid) async {');
if (startIndex !== -1) {
  // Find the exact end of the whole function block. It ends right before "final GlobalKey<NavigatorState>"
  const endIndexString = 'final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();';
  const endIndex = code.indexOf(endIndexString);
  
  if (endIndex !== -1) {
    const before = code.substring(0, startIndex);
    const after = code.substring(endIndex);
    fs.writeFileSync('lib/main.dart', before + targetFunction + '\n\n' + after);
    console.log('SUCCESS');
  } else {
    console.log('FAIL: Could not find end flag');
  }
} else {
  console.log('FAIL: Could not find start signature');
}
