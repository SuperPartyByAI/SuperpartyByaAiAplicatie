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
import com.twilio.voice.ConnectOptions
import com.twilio.voice.Voice
import com.superpartybyai.app.voicev2.VoiceV2Coordinator
import com.superpartybyai.app.voicev2.VoiceV2AcceptHandler
import com.superpartybyai.app.voicev2.VoiceV2HangupHandler

class MainActivity : FlutterActivity() {

    companion object {
        private const val TAG = "[MainActivity_V2]"
        private const val CALL_CHANNEL  = "com.superpartybyai.app/call_actions"
        private const val AUDIO_CHANNEL = "com.superpartybyai.app/audio"
        private const val DIAG_CHANNEL  = "com.superpartybyai.app/diag"
        const val ACTION_ANSWER = "com.superpartybyai.app.ACTION_ANSWER_CALL"
        const val ACTION_REJECT = "com.superpartybyai.app.ACTION_REJECT_CALL"

        @Volatile
        private var directOutboundCall: com.twilio.voice.Call? = null
    }

    private var callMethodChannel: MethodChannel? = null

    private val callInviteInterceptor = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == TwilioTVBroadcastReceiver.ACTION_INCOMING_CALL) {
                val invite = intent.getParcelableExtra<com.twilio.voice.CallInvite>(
                    TwilioTVBroadcastReceiver.EXTRA_CALL_INVITE
                )
                if (invite != null) {
                    Log.d(TAG, "🎯 Intercepted CallInvite from WebSocket path: sid=${invite.callSid}. Routing to V2Coordinator.")
                    VoiceV2Coordinator.setInvite(invite)
                }
            }
        }
    }
    
    data class PendingAction(val action: String, val from: String, val sid: String)
    private val pendingQueue = ArrayDeque<PendingAction>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "onCreate action=${intent?.action}")
        storePendingAction(intent)
    }

    override fun onResume() {
        super.onResume()
        val filter = IntentFilter(TwilioTVBroadcastReceiver.ACTION_INCOMING_CALL)
        LocalBroadcastManager.getInstance(this).registerReceiver(callInviteInterceptor, filter)
    }

    override fun onPause() {
        super.onPause()
        runCatching { LocalBroadcastManager.getInstance(this).unregisterReceiver(callInviteInterceptor) }
    }

    private var isFlutterReady = false

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        callMethodChannel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            CALL_CHANNEL
        ).also { ch ->
            ch.setMethodCallHandler { call, result ->
                when (call.method) {
                    "ping" -> result.success("pong")
                    "ready" -> {
                        isFlutterReady = true
                        dispatchPendingAction(ch)
                        result.success(true)
                    }
                    "directPlace" -> {
                        val args = call.arguments as? Map<*, *> ?: emptyMap<Any, Any>()
                        val accessToken = args["accessToken"] as? String ?: ""
                        val to = args["to"] as? String ?: ""
                        
                        val connectOptions = ConnectOptions.Builder(accessToken)
                            .params(mapOf("To" to to))
                            .build()

                        val c = Voice.connect(applicationContext, connectOptions, object : com.twilio.voice.Call.Listener {
                            override fun onConnectFailure(c: com.twilio.voice.Call, e: com.twilio.voice.CallException) {}
                            override fun onRinging(c: com.twilio.voice.Call) {}
                            override fun onConnected(c: com.twilio.voice.Call) {}
                            override fun onReconnecting(c: com.twilio.voice.Call, e: com.twilio.voice.CallException) {}
                            override fun onReconnected(c: com.twilio.voice.Call) {}
                            override fun onDisconnected(c: com.twilio.voice.Call, e: com.twilio.voice.CallException?) {
                                runOnUiThread { ch.invokeMethod("callEnded", null) }
                            }
                        })
                        directOutboundCall = c
                        result.success(c != null)
                    }
                    "directHangup" -> {
                        val sid = call.argument<String>("sid") ?: ""
                        runOnUiThread {
                            VoiceV2HangupHandler.rejectCall(applicationContext, sid)
                            directOutboundCall?.disconnect()
                            directOutboundCall = null
                            result.success(true)
                        }
                    }
                    "directAnswer" -> {
                        val sid = call.argument<String>("sid") ?: ""
                        runOnUiThread {
                            VoiceV2AcceptHandler.acceptCall(applicationContext, sid)
                            result.success(true)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
        }

        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            AUDIO_CHANNEL
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "requestAudioFocusAndMode" -> result.success(true)
                "releaseAudioFocus" -> result.success(true)
                else -> result.notImplemented()
            }
        }

        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            DIAG_CHANNEL
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "getNotificationChannelInfo" -> result.success(mapOf("channelId" to "superparty_voip_calls_v2"))
                "isCallCapable" -> result.success(true)
                "openCallingAccounts" -> result.success(true)
                else -> result.notImplemented()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        storePendingAction(intent)
        val ch = callMethodChannel
        if (ch != null && isFlutterReady) {
            dispatchPendingAction(ch)
        }
    }

    private fun storePendingAction(intent: Intent?) {
        val action = intent?.action ?: return
        if (action != ACTION_ANSWER && action != ACTION_REJECT) return
        val from = intent.getStringExtra("from") ?: "Superparty"
        val sid  = intent.getStringExtra("twilio_call_sid") ?: ""
        pendingQueue.addLast(PendingAction(action, from, sid))
    }

    private fun dispatchPendingAction(channel: MethodChannel) {
        if (!isFlutterReady || pendingQueue.isEmpty()) return
        val pending = pendingQueue.removeFirst()

        val flutterMethod = when (pending.action) {
            ACTION_ANSWER -> "answerCall"
            ACTION_REJECT -> "rejectCall"
            else -> return
        }

        channel.invokeMethod(flutterMethod, mapOf("from" to pending.from, "callSid" to pending.sid))
        if (pendingQueue.isNotEmpty()) {
            Handler(Looper.getMainLooper()).post { dispatchPendingAction(channel) }
        }
    }
}
