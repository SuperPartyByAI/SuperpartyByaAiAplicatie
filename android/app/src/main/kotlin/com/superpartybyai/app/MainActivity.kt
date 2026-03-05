package com.superpartybyai.app

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.telecom.TelecomManager
import android.util.Log
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import com.superpartybyai.app.services.CustomVoiceFirebaseMessagingService
import com.superpartybyai.app.ui.IncomingCallActivity
import com.twilio.twilio_voice.receivers.TVBroadcastReceiver as TwilioTVBroadcastReceiver
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {

    companion object {
        private const val TAG = "[MainActivity]"
        private const val CALL_CHANNEL  = "com.superpartybyai.app/call_actions"
        private const val AUDIO_CHANNEL = "com.superpartybyai.app/audio"
        private const val DIAG_CHANNEL  = "com.superpartybyai.app/diag"
    }

    private var callMethodChannel: MethodChannel? = null
    private var audioFocusRequest: AudioFocusRequest? = null

    // Intercepts Twilio SDK incoming call broadcast (WebSocket path) to store CallInvite
    private val callInviteInterceptor = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == TwilioTVBroadcastReceiver.ACTION_INCOMING_CALL) {
                val invite = intent.getParcelableExtra<com.twilio.voice.CallInvite>(
                    TwilioTVBroadcastReceiver.EXTRA_CALL_INVITE
                )
                if (invite != null) {
                    Log.d(TAG, "🎯 Intercepted CallInvite from WebSocket path: sid=${invite.callSid}")
                    CustomVoiceFirebaseMessagingService.pendingCallInvite = invite
                } else {
                    Log.w(TAG, "callInviteInterceptor: EXTRA_CALL_INVITE was null")
                }
            }
        }
    }
    data class PendingAction(val action: String, val from: String, val sid: String)
    private val pendingQueue = ArrayDeque<PendingAction>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CustomVoiceFirebaseMessagingService.createCallChannel(applicationContext)
        Log.d(TAG, "onCreate action=${intent?.action}")
        storePendingAction(intent)
    }

    override fun onResume() {
        super.onResume()
        val filter = IntentFilter(TwilioTVBroadcastReceiver.ACTION_INCOMING_CALL)
        LocalBroadcastManager.getInstance(this).registerReceiver(callInviteInterceptor, filter)
        Log.d(TAG, "callInviteInterceptor registered")
    }

    override fun onPause() {
        super.onPause()
        runCatching { LocalBroadcastManager.getInstance(this).unregisterReceiver(callInviteInterceptor) }
        Log.d(TAG, "callInviteInterceptor unregistered")
    }


    private var isFlutterReady = false

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // ── CALL ACTIONS CHANNEL ──────────────────────────────────────────────
        callMethodChannel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            CALL_CHANNEL
        ).also { ch ->
            ch.setMethodCallHandler { call, result ->
                when (call.method) {
                    "ping" -> result.success("pong")
                    "ready" -> {
                        Log.d(TAG, "Flutter signaled 'ready'. Dispatching pending actions immediately.")
                        isFlutterReady = true
                        dispatchPendingAction(ch)
                        result.success(true)
                    }
                    "directAnswer" -> {
                        // Bypass TVConnectionService entirely — accept stored CallInvite directly.
                        // Used on Huawei/Honor where TelecomManager is blocked.
                        Log.d(TAG, "directAnswer: attempting pendingCallInvite.accept()")
                        val directListener = object : com.twilio.voice.Call.Listener {
                            override fun onConnectFailure(c: com.twilio.voice.Call, e: com.twilio.voice.CallException) {
                                Log.e(TAG, "directAnswer onConnectFailure: ${e.message}")
                            }
                            override fun onRinging(c: com.twilio.voice.Call) { Log.d(TAG, "directAnswer onRinging") }
                            override fun onConnected(c: com.twilio.voice.Call) {
                                Log.d(TAG, "✅ directAnswer onConnected: ${c.sid}")
                                runOnUiThread { ch.invokeMethod("callConnected", mapOf("sid" to c.sid)) }
                            }
                            override fun onReconnecting(c: com.twilio.voice.Call, e: com.twilio.voice.CallException) {}
                            override fun onReconnected(c: com.twilio.voice.Call) {}
                            override fun onDisconnected(c: com.twilio.voice.Call, e: com.twilio.voice.CallException?) {
                                Log.d(TAG, "directAnswer onDisconnected: ${e?.message}")
                                runOnUiThread { ch.invokeMethod("callEnded", null) }
                            }
                        }
                        runOnUiThread {
                            val accepted = com.superpartybyai.app.services.CustomVoiceFirebaseMessagingService
                                .acceptPendingCallInvite(applicationContext, directListener)
                            if (accepted != null) {
                                Log.d(TAG, "✅ directAnswer: CallInvite accepted, sid=\${accepted.sid}")
                                result.success(true)
                            } else {
                                Log.w(TAG, "directAnswer: no pending CallInvite — falling back")
                                result.success(false)
                            }
                        }
                    }
                    else -> result.notImplemented()
                }
            }
        }

        // ── AUDIO CHANNEL ─────────────────────────────────────────────────────
        // Flutter calls this immediately after answer() to fix audio routing
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            AUDIO_CHANNEL
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "requestAudioFocusAndMode" -> {
                    result.success(requestAudioFocusAndMode())
                }
                "releaseAudioFocus" -> {
                    releaseAudioFocus()
                    result.success(true)
                }
                else -> result.notImplemented()
            }
        }
        Log.d(TAG, "Audio channel registered")

        // ── DIAG CHANNEL ──────────────────────────────────────────────────────
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            DIAG_CHANNEL
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "getNotificationChannelInfo" -> {
                    result.success(getNotificationChannelInfo())
                }
                "isCallCapable" -> {
                    result.success(isCallCapable())
                }
                "openCallingAccounts" -> {
                    openCallingAccounts()
                    result.success(true)
                }
                else -> result.notImplemented()
            }
        }
        Log.d(TAG, "Diag channel registered")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        Log.d(TAG, "onNewIntent action=${intent.action}")
        storePendingAction(intent)
        val ch = callMethodChannel
        if (ch != null && isFlutterReady) {
            dispatchPendingAction(ch)
        }
    }

    private fun storePendingAction(intent: Intent?) {
        val action = intent?.action ?: return
        if (action != IncomingCallActivity.ACTION_ANSWER && action != IncomingCallActivity.ACTION_REJECT) return
        val from = intent.getStringExtra("from") ?: "Superparty"
        val sid  = intent.getStringExtra("twilio_call_sid") ?: ""
        
        if (action == IncomingCallActivity.ACTION_ANSWER) {
            CustomVoiceFirebaseMessagingService.autoAnswerUntil = System.currentTimeMillis() + 15000
            Log.d(TAG, "✅ MAIN ACTIVITY ANSWER RECEIVED! [sid=$sid, from=$from]")
            Log.d(TAG, "⏰ Set autoAnswer window for 15s for sid=$sid")
        }

        pendingQueue.addLast(PendingAction(action, from, sid))
        Log.d(TAG, "Stored pending (queue size=${pendingQueue.size}): action=$action from=$from sid=$sid")
    }

    private fun dispatchPendingAction(channel: MethodChannel) {
        if (!isFlutterReady) {
            Log.d(TAG, "dispatchPendingAction: Flutter not yet ready. Waiting for 'ready' signal.")
            return
        }
        if (pendingQueue.isEmpty()) return
        val pending = pendingQueue.removeFirst()
        Log.d(TAG, "Dequeued pending (remaining=${pendingQueue.size}): action=${pending.action}")

        val flutterMethod = when (pending.action) {
            IncomingCallActivity.ACTION_ANSWER -> "answerCall"
            IncomingCallActivity.ACTION_REJECT -> "rejectCall"
            else -> return
        }

        Log.d(TAG, "→ invokeMethod '$flutterMethod' sid=${pending.sid}")
        channel.invokeMethod(flutterMethod, mapOf("from" to pending.from, "callSid" to pending.sid))
        
        // Dispatch remaining queued actions recursively
        if (pendingQueue.isNotEmpty()) {
            Handler(Looper.getMainLooper()).post {
                dispatchPendingAction(channel)
            }
        }
    }

    // ── NOTIFICATION CHANNEL DIAGNOSTICS ────────────────────────────────────

    /** Check if our PhoneAccount is in TelecomManager.callCapablePhoneAccounts. */
    private fun isCallCapable(): Boolean {
        return try {
            val telecom = getSystemService(Context.TELECOM_SERVICE) as TelecomManager
            val accounts = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                telecom.callCapablePhoneAccounts
            } else emptyList()
            // CRITICAL: We must specifically check if OUR app's PhoneAccount is enabled, 
            // not just if the phone has a SIM card!
            val capable = accounts.any { it.componentName.packageName == packageName }
            Log.d(TAG, "isCallCapable=$capable accounts=${accounts.size}")
            capable
        } catch (e: Exception) {
            Log.e(TAG, "isCallCapable error: $e")
            false
        }
    }

    /** Open the system calling accounts screen directly (from app, no manual navigation). */
    private fun openCallingAccounts() {
        try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent(TelecomManager.ACTION_CHANGE_PHONE_ACCOUNTS)
            } else {
                Intent(Settings.ACTION_MANAGE_ALL_APPLICATIONS_SETTINGS)
            }
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "openCallingAccounts fallback: $e")
            // Fallback: general app settings
            try {
                val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                fallback.data = android.net.Uri.fromParts("package", packageName, null)
                fallback.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                startActivity(fallback)
            } catch (e2: Exception) {
                Log.e(TAG, "openCallingAccounts fallback2: $e2")
            }
        }
    }

    private fun getNotificationChannelInfo(): Map<String, Any?> {
        return try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channelId = CustomVoiceFirebaseMessagingService.CHANNEL_ID
            val channel = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.getNotificationChannel(channelId)
            } else null

            val dndMode = nm.currentInterruptionFilter
            val dndOff  = dndMode == NotificationManager.INTERRUPTION_FILTER_ALL

            if (channel != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                mapOf(
                    "channelId"   to channelId,
                    "importance"  to channel.importance,   // 4=HIGH, 5=MAX
                    "sound"       to (channel.sound?.toString() ?: "none"),
                    "vibration"   to channel.shouldVibrate(),
                    "userSet"     to channel.importance,   // importance can be user-changed
                    "bypassDnd"   to channel.canBypassDnd(),
                    "dndMode"     to dndMode,
                    "dndOff"      to dndOff,
                )
            } else {
                mapOf(
                    "channelId"  to channelId,
                    "importance" to -1,
                    "dndMode"    to dndMode,
                    "dndOff"     to dndOff,
                    "note"       to "pre-Oreo device",
                )
            }
        } catch (e: Exception) {
            Log.e(TAG, "getNotificationChannelInfo error: $e")
            mapOf("error" to e.message)
        }
    }

    // ── AUDIO MANAGEMENT ─────────────────────────────────────────────────────

    /**
     * Request audio focus and switch AudioManager to MODE_IN_COMMUNICATION.
     * CRITICAL: without this, VoIP audio is not routed to earpiece/microphone.
     */
    private fun requestAudioFocusAndMode(): Boolean {
        return try {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            var focusGranted = false

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val focusReq = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                    )
                    .setAcceptsDelayedFocusGain(false)
                    .setOnAudioFocusChangeListener { focusChange ->
                        Log.d(TAG, "AudioFocus changed: $focusChange")
                        if (focusChange == AudioManager.AUDIOFOCUS_LOSS ||
                            focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                            Log.w(TAG, "⚠️ Audio focus LOST during call")
                        }
                    }
                    .build()
                audioFocusRequest = focusReq
                val result = audioManager.requestAudioFocus(focusReq)
                focusGranted = (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
                Log.d(TAG, "requestAudioFocus (API26+) result=$result granted=$focusGranted")
            } else {
                @Suppress("DEPRECATION")
                val result = audioManager.requestAudioFocus(
                    { focusChange -> Log.d(TAG, "AudioFocus changed (legacy): $focusChange") },
                    AudioManager.STREAM_VOICE_CALL,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
                )
                focusGranted = (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
                Log.d(TAG, "requestAudioFocus (legacy) result=$result granted=$focusGranted")
            }

            if (!focusGranted) {
                Log.e(TAG, "❌ Audio focus NOT granted — VoIP audio may not work")
                return false
            }

            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager.isSpeakerphoneOn = false
            Log.d(TAG, "✅ AudioManager mode=IN_COMMUNICATION speaker=false")
            true
        } catch (e: Exception) {
            Log.e(TAG, "requestAudioFocusAndMode error: $e")
            false
        }
    }

    private fun releaseAudioFocus() {
        try {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            audioManager.mode = AudioManager.MODE_NORMAL
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioFocusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            } else {
                @Suppress("DEPRECATION")
                audioManager.abandonAudioFocus(null)
            }
            Log.d(TAG, "Audio focus released, mode=NORMAL")
        } catch (e: Exception) {
            Log.e(TAG, "releaseAudioFocus error: $e")
        }
    }
}
