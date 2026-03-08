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
import com.superpartybyai.app.voicev2.VoiceV2AcceptHandler
import com.superpartybyai.app.voicev2.VoiceV2HangupHandler
import androidx.localbroadcastmanager.content.LocalBroadcastManager

class IncomingCallActivity : Activity() {

    companion object {
        private const val TAG = "[IncomingCallUIV2]"
    }

    private var ringtone: Ringtone? = null
    private var vibrator: Vibrator? = null

    private val callActionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                "com.superpartybyai.app/CALL_CANCELLED" -> {
                    Log.d(TAG, "Received broadcast CALL_CANCELLED — closing Activity")
                    stopRinging()
                    finish()
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "IncomingCallActivity onCreate")

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

        val callerFrom = intent?.getStringExtra("callerNumber") ?: "Superparty"
        val callSid = intent?.getStringExtra("callSid") ?: ""
        Log.d(TAG, "Incoming call SID=$callSid FROM=$callerFrom")

        startRinging()

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
            text = "SuperParty VoIP V2"
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
                Log.d(TAG, "Accept tapped! answering SID=$callSid")
                stopRinging()
                CustomVoiceFirebaseMessagingService.dismissCallNotification(applicationContext, callSid)

                val m = Build.MANUFACTURER.lowercase()
                val isHuawei = m.contains("huawei") || m.contains("honor")
                if (isHuawei) {
                    VoiceV2AcceptHandler.acceptCall(applicationContext, callSid)
                } else {
                    Log.d(TAG, "Non-Huawei Accept clicked. Not fully V2 handled yet.")
                }

                // Push UI back to main app so Flutter gets focus, 
                // but Flutter MUST NOT execute Twilio SDK commands on Huawei
                val mainIntent = Intent(applicationContext, MainActivity::class.java).apply {
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

        val spacer2 = View(this).apply { minimumHeight = 24 }

        val btnReject = Button(this).apply {
            text = "❌ Respinge"
            setBackgroundColor(Color.parseColor("#FFF44336"))
            setTextColor(Color.WHITE)
            textSize = 16f
            setOnClickListener {
                Log.d(TAG, "Reject tapped for SID=$callSid")
                stopRinging()
                CustomVoiceFirebaseMessagingService.dismissCallNotification(applicationContext, callSid)

                val m = Build.MANUFACTURER.lowercase()
                val isHuawei = m.contains("huawei") || m.contains("honor")
                if (isHuawei) {
                    VoiceV2HangupHandler.rejectCall(applicationContext, callSid)
                }

                finish()
            }
        }

        layout.addView(appLabel)
        layout.addView(callerView)
        layout.addView(spacer1)
        layout.addView(btnAccept)
        layout.addView(spacer2)
        layout.addView(btnReject)

        setContentView(layout)

        LocalBroadcastManager.getInstance(this)
            .registerReceiver(callActionReceiver, IntentFilter("com.superpartybyai.app/CALL_CANCELLED"))
    }

    override fun onDestroy() {
        super.onDestroy()
        stopRinging()
        LocalBroadcastManager.getInstance(this).unregisterReceiver(callActionReceiver)
        Log.d(TAG, "IncomingCallActivity destroyed")
    }

    private fun startRinging() {
        try {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            audioManager.mode = AudioManager.MODE_RINGTONE

            val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ringtone = RingtoneManager.getRingtone(applicationContext, ringtoneUri)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                ringtone?.audioAttributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            }
            ringtone?.play()
            Log.d(TAG, "Ringtone started natively")

            startVibration()
        } catch (e: Exception) {
            Log.e(TAG, "Error starting ringtone: ${e.message}")
        }
    }

    private fun startVibration() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vibrator = vibratorManager.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }

            val pattern = longArrayOf(0, 1000, 1000)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(pattern, 0)
            }
            Log.d(TAG, "Vibration started")
        } catch (e: Exception) {
            Log.e(TAG, "Error starting vibration: ${e.message}")
        }
    }

    private fun stopRinging() {
        try {
            ringtone?.let {
                if (it.isPlaying) it.stop()
            }
            vibrator?.cancel()
            Log.d(TAG, "Ringtone and vibration stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping ringtone/vibration: ${e.message}")
        }
    }
}
