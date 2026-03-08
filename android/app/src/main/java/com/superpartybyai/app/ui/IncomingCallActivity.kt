package com.superpartybyai.app.ui

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.superpartybyai.app.MainActivity
import com.superpartybyai.app.services.CustomVoiceFirebaseMessagingService

class IncomingCallActivity : Activity() {

    companion object {
        private const val TAG = "[IncomingCallUI]"
        const val ACTION_ANSWER = "com.superpartybyai.app.ACTION_ANSWER_CALL"
        const val ACTION_REJECT = "com.superpartybyai.app.ACTION_REJECT_CALL"
    }

    private var ringtone: Ringtone? = null
    private var vibrator: Vibrator? = null

    private val callActionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                ACTION_ANSWER, ACTION_REJECT -> {
                    Log.d(TAG, "Received broadcast ${intent.action} — closing")
                    stopRinging()
                    finish()
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "IncomingCallActivity onCreate")

        // Show over lock screen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }

        val callerFrom = intent?.getStringExtra("from") ?: "Superparty"
        val callSid = intent?.getStringExtra("twilio_call_sid") ?: ""
        Log.d(TAG, "Incoming call from=$callerFrom sid=$callSid")

        // ── START RINGING ────────────────────────────────────────────────────
        startRinging()

        // Build UI programmatically
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#FF1A1A2E"))
            setPadding(64, 128, 64, 128)
        }

        val callerView = TextView(this).apply {
            text = "📞 Apel de la: $callerFrom"
            textSize = 22f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }

        val appLabel = TextView(this).apply {
            text = "SuperParty VoIP"
            textSize = 13f
            setTextColor(Color.parseColor("#99FFFFFF"))
            gravity = Gravity.CENTER
        }

        val spacer1 = View(this).apply { minimumHeight = 64 }

        val btnAccept = Button(this).apply {
            text = "✅ Răspunde"
            setBackgroundColor(Color.parseColor("#FF4CAF50"))
            setTextColor(Color.WHITE)
            textSize = 16f
            setOnClickListener {
                Log.d(TAG, "🟢 [ANSWER FLOW] Answer button clicked!")
                Log.d(TAG, "🟢 [ANSWER FLOW] callSid resolved: $callSid")
                Log.d(TAG, "🟢 [ANSWER FLOW] ACTION_ANSWER_CALL received: Persisting pending answer robustly...")
                
                stopRinging()
                CustomVoiceFirebaseMessagingService.dismissCallNotification(applicationContext, callSid)

                val prefs = applicationContext.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
                val identity = prefs.getString("flutter.twilio_client_identity", "") ?: ""
                
                prefs.edit()
                    .putString("robust_pending_answer_sid", callSid)
                    .putString("robust_pending_answer_from", callerFrom)
                    .putLong("robust_pending_answer_ts", System.currentTimeMillis())
                    .apply()

                // ── ETAPA 2: NATIVE HTTP ACCEPT DIRECT CĂTRE PBX ──
                Log.d(TAG, "🚀 [NATIVE ACCEPT START] Triggering backend /accept-native for $callSid (Identity: $identity)...")
                if (callSid.isNotEmpty() && identity.isNotEmpty()) {
                    Thread {
                        try {
                            val targetURL = "https://voice.superparty.ro/api/voice/accept-native"
                            val url = java.net.URL(targetURL)
                            Log.d(TAG, "🟢 ACCEPT target URL=$targetURL")
                            val conn = url.openConnection() as java.net.HttpURLConnection
                            conn.requestMethod = "POST"
                            conn.setRequestProperty("Content-Type", "application/json")
                            conn.doOutput = true
                            
                            val payload = """{"callSid":"$callSid","clientIdentity":"$identity"}"""
                            conn.outputStream.write(payload.toByteArray(Charsets.UTF_8))
                            
                            val sc = conn.responseCode
                            Log.d(TAG, "🟢 ACCEPT HTTP status=$sc")
                            val body = conn.inputStream.bufferedReader().use { it.readText() }
                            Log.d(TAG, "✅ [NATIVE ACCEPT SUCCESS] PBX confirmed accept HTTP status: $sc. Body: $body")
                        } catch (e: Exception) {
                            Log.e(TAG, "❌ [NATIVE ACCEPT FAIL] Failed hitting PBX native accept: ${e.message}")
                        }
                    }.start()
                }

                val invite = CustomVoiceFirebaseMessagingService.pendingCallInvite
                if (invite != null && invite.callSid == callSid) {
                    Log.d(TAG, "🚀 COLD-START FIX: Twilio native invite exists! Native accept IMMEDIATELY triggered!")
                    MainActivity.lastCallState = "connecting"
                    val listener = object : com.twilio.voice.Call.Listener {
                        override fun onConnectFailure(c: com.twilio.voice.Call, e: com.twilio.voice.CallException) {
                            Log.e(TAG, "Native Accept onConnectFailure: ${e.message}")
                            MainActivity.lastCallState = "failed"
                        }
                        override fun onRinging(c: com.twilio.voice.Call) {}
                        override fun onConnected(c: com.twilio.voice.Call) {
                            Log.d(TAG, "🟢 EXPECTED NATIVE ACCEPT -> SUCCESS [${c.sid}]")
                            MainActivity.lastCallState = "connected"
                            // Sincronizare vizuala cu Flutter
                            MainActivity.notifyFlutterCallState("callConnected", c.sid)
                        }
                        override fun onReconnecting(c: com.twilio.voice.Call, e: com.twilio.voice.CallException) {}
                        override fun onReconnected(c: com.twilio.voice.Call) {}
                        override fun onDisconnected(c: com.twilio.voice.Call, e: com.twilio.voice.CallException?) {
                            Log.d(TAG, "Native Accept onDisconnected")
                            MainActivity.lastCallState = "disconnected"
                            MainActivity.notifyFlutterCallState("callEnded", null)
                        }
                    }
                    val call = CustomVoiceFirebaseMessagingService.acceptPendingCallInvite(applicationContext, listener)
                    MainActivity.activeInboundCall = call
                    if (call != null) {
                        try {
                            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
                            audioManager.isSpeakerphoneOn = false
                            Log.d(TAG, "✅ Forced AudioManager MODE_IN_COMMUNICATION directly from Native Accept.")
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed setting audio mode natively: $e")
                        }
                    }
                } else {
                    Log.w(TAG, "⚠️ [HUAWEI MODE] Twilio native invite NOT found in memory right now! Setting async autoAnswerUntil to trap the late CallInvite...")
                    // Activeaza Anti-Loop Auto-Answer Interceptor in FCM Service cu un TTL generos pt timeout-uri de retea/VPN
                    CustomVoiceFirebaseMessagingService.autoAnswerUntil = System.currentTimeMillis() + 45000L
                }

                // Navigate to active call screen via MainActivity
                val mainIntent = Intent(applicationContext, MainActivity::class.java).apply {
                    action = ACTION_ANSWER
                    putExtra("from", callerFrom)
                    putExtra("twilio_call_sid", callSid)
                    addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                    )
                }
                startActivity(mainIntent)
                
                // ── DELAY FINISH ──
                // Prevent Huawei from blocking the microphone (Call Recording Privacy)
                // by keeping this Activity alive until MainActivity is fully foregrounded.
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    finish()
                }, 1500)
            }
        }

        val spacer2 = View(this).apply { minimumHeight = 24 }

        val btnReject = Button(this).apply {
            text = "❌ Respinge"
            setBackgroundColor(Color.parseColor("#FFF44336"))
            setTextColor(Color.WHITE)
            textSize = 16f
            setOnClickListener {
                Log.d(TAG, "Reject tapped")
                stopRinging()
                CustomVoiceFirebaseMessagingService.dismissCallNotification(applicationContext)
                val mainIntent = Intent(applicationContext, MainActivity::class.java).apply {
                    action = ACTION_REJECT
                    putExtra("from", callerFrom)
                    putExtra("twilio_call_sid", callSid)
                    addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                    )
                }
                startActivity(mainIntent)
                finish()
            }
        }

        layout.addView(callerView)
        layout.addView(appLabel)
        layout.addView(spacer1)
        layout.addView(btnAccept, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 150
        ))
        layout.addView(spacer2)
        layout.addView(btnReject, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 150
        ))
        setContentView(layout)

        // Listen for resolution from other sources
        val filter = IntentFilter().apply {
            addAction(ACTION_ANSWER)
            addAction(ACTION_REJECT)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(callActionReceiver, filter, RECEIVER_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(callActionReceiver, filter)
        }
    }

    private fun startRinging() {
        try {
            // Set audio mode to ringtone
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            audioManager.mode = AudioManager.MODE_RINGTONE

            // Play default ringtone
            val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ringtone = RingtoneManager.getRingtone(applicationContext, ringtoneUri)?.also { r ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    r.isLooping = true
                }
                r.audioAttributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
                r.play()
                Log.d(TAG, "✅ Ringtone started")
            }

            // Also vibrate
            startVibrating()
        } catch (e: Exception) {
            Log.e(TAG, "startRinging error: $e")
        }
    }

    private fun startVibrating() {
        try {
            val pattern = longArrayOf(0, 600, 400, 600, 400, 600)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vibrator = vm.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(pattern, 0)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Vibration error: $e")
        }
    }

    private fun stopRinging() {
        try {
            ringtone?.stop()
            ringtone = null
            vibrator?.cancel()
            vibrator = null
            Log.d(TAG, "Ringtone stopped")
        } catch (e: Exception) {
            Log.e(TAG, "stopRinging error: $e")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        stopRinging()
        runCatching { unregisterReceiver(callActionReceiver) }
    }
}
