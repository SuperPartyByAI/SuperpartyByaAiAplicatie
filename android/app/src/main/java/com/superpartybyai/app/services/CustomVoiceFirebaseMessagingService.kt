package com.superpartybyai.app.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.superpartybyai.app.ui.IncomingCallActivity
import com.twilio.voice.CallException
import com.twilio.voice.CallInvite
import com.twilio.voice.CancelledCallInvite
import com.twilio.voice.MessageListener
import com.twilio.voice.Voice
import com.twilio.twilio_voice.service.TVConnectionService
import com.twilio.twilio_voice.receivers.TVBroadcastReceiver
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import java.net.HttpURLConnection
import java.net.URL

/**
 * Custom FCM service — the SOLE service registered for MESSAGING_EVENT.
 *
 * CRITICAL FIX (v41): Firebase dispatches FCM to only ONE service (highest
 * priority). Previously, Twilio's VoiceFirebaseMessagingService was registered
 * at priority=0 but NEVER received messages because this service (priority=1)
 * consumed them. This meant Voice.handleMessage() was never called, no
 * CallInvite was created, activeCall was always null, and answer() always failed.
 *
 * FIX: This service now:
 * 1. Shows our custom IMPORTANCE_HIGH full-screen notification (as before)
 * 2. Calls Voice.handleMessage() to let the Twilio SDK create the CallInvite
 * 3. Forwards the CallInvite to TVConnectionService (same as plugin's service)
 * 4. Sends local broadcast to TVBroadcastReceiver (same as plugin's service)
 *
 * Twilio's VoiceFirebaseMessagingService has been REMOVED from AndroidManifest.
 */
class CustomVoiceFirebaseMessagingService : FirebaseMessagingService(), MessageListener {

    companion object {
        private const val TAG = "[CustomVoiceFCM]"
        const val CHANNEL_ID = "superparty_voip_calls_v2"
        const val CHANNEL_NAME = "Apeluri VoIP Superparty"
        const val NOTIFICATION_ID = 9001

        private const val NATIVE_RINGING_SID_KEY   = "flutter.native_ringing_call_sid"
        private const val NATIVE_RINGING_UNTIL_KEY = "flutter.native_ringing_until"
        private const val NATIVE_RINGING_TTL_MS    = 45_000L

        private fun markNativeRinging(context: Context, callSid: String) {
            if (callSid.isEmpty()) return
            val prefs = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
            val now = System.currentTimeMillis()
            prefs.edit()
                .putString(NATIVE_RINGING_SID_KEY, callSid)
                .putLong(NATIVE_RINGING_UNTIL_KEY, now + NATIVE_RINGING_TTL_MS)
                .apply()
        }

        private fun isNativeRingingDuplicate(context: Context, callSid: String): Boolean {
            if (callSid.isEmpty()) return false
            val prefs = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
            val sid = prefs.getString(NATIVE_RINGING_SID_KEY, null)
            val until = prefs.getLong(NATIVE_RINGING_UNTIL_KEY, 0L)
            val now = System.currentTimeMillis()
            return (sid == callSid && now < until)
        }

        private fun clearNativeRinging(context: Context, callSid: String) {
            val prefs = context.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
            val sid = prefs.getString(NATIVE_RINGING_SID_KEY, null)
            if (sid == callSid) {
                prefs.edit()
                    .remove(NATIVE_RINGING_SID_KEY)
                    .remove(NATIVE_RINGING_UNTIL_KEY)
                    .apply()
            }
        }

        // Static storage for pending CallInvite – allows direct accept() without TelecomManager
        @Volatile
        var pendingCallInvite: com.twilio.voice.CallInvite? = null

        // Anti-Loop Auto-Answer Interceptor
        @Volatile
        var autoAnswerUntil: Long? = null

        // Anti-Loop Block for Hetzner Wake-Up Redundancy
        val answeredCallSids = mutableSetOf<String>()

        private val autoAnswerListener = object : com.twilio.voice.Call.Listener {
            override fun onConnectFailure(call: com.twilio.voice.Call, error: com.twilio.voice.CallException) {}
            override fun onRinging(call: com.twilio.voice.Call) {}
            override fun onConnected(call: com.twilio.voice.Call) {
                Log.d(TAG, "✅ Auto-Answer successful natively for sid=${call.sid}")
            }
            override fun onReconnecting(call: com.twilio.voice.Call, error: com.twilio.voice.CallException) {}
            override fun onReconnected(call: com.twilio.voice.Call) {}
            override fun onDisconnected(call: com.twilio.voice.Call, error: com.twilio.voice.CallException?) {
                Log.d(TAG, "Auto-Answer Disconnected: ${error?.message}")
            }
        }

        /**
         * Accept the stored CallInvite directly, bypassing TelecomManager entirely.
         * Used on Huawei/Honor devices where TelecomManager is blocked.
         */
        fun acceptPendingCallInvite(context: Context, listener: com.twilio.voice.Call.Listener): com.twilio.voice.Call? {
            val invite = pendingCallInvite ?: return null
            pendingCallInvite = null 
            Log.d(TAG, "✅ acceptPendingCallInvite: accepting sid=${invite.callSid} directly via Twilio SDK")

            return invite.accept(context, listener)
        }

        /**
         * Create (or recreate) the IMPORTANCE_HIGH call notification channel.
         * Deletes any prior channel with same ID to bypass userSet=DEFAULT.
         * Safe to call from MainActivity.onCreate() and Application.onCreate().
         */
        fun createCallChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

                // ALWAYS delete and recreate — ensures sound/importance are correct.
                // Android ignores importance+sound updates on existing channels.
                nm.deleteNotificationChannel(CHANNEL_ID)
                Log.d(TAG, "Deleted old channel '$CHANNEL_ID', recreating with sound...")

                val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                val soundAttrs = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()

                val chan = NotificationChannel(
                    CHANNEL_ID,
                    CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Canal full-screen pentru apeluri VoIP"
                    setSound(ringtoneUri, soundAttrs)
                    enableLights(true)
                    lightColor = Color.GREEN
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 400, 200, 400, 200, 400)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                    setBypassDnd(true)
                    setShowBadge(false)
                }
                nm.createNotificationChannel(chan)
                Log.d(TAG, "✅ Channel '$CHANNEL_ID' created IMPORTANCE_HIGH + sound=$ringtoneUri")
            }
        }

        fun showFullScreenCallNotification(context: Context, callerName: String, callSid: String = "") {
            val now = System.currentTimeMillis()
            val until = autoAnswerUntil
            if (answeredCallSids.contains(callSid) || (until != null && now < until)) {
                Log.d(TAG, "🔕 Suppressing duplicate FullScreenNotification for sid=$callSid (already answered/in progress)")
                return
            }
            
            if (isNativeRingingDuplicate(context, callSid)) {
                Log.d(TAG, "🔕 Suppressing duplicate native ringing UI for sid=$callSid (already ringing)")
                return
            }

            createCallChannel(context)
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            val fullScreenIntent = Intent(context, IncomingCallActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("from", callerName)
                putExtra("twilio_call_sid", callSid)
            }
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val fullScreenPi = PendingIntent.getActivity(context, 0, fullScreenIntent, flags)

            val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)

            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setContentTitle("📞 Apel Superparty")
                .setContentText("Apel de la: $callerName")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setSound(ringtoneUri)
                .setFullScreenIntent(fullScreenPi, true)
                .setContentIntent(fullScreenPi)
                .setOngoing(true)
                .setAutoCancel(false)
                .build()

            val notifId = if (callSid.isNotEmpty()) callSid.hashCode() else NOTIFICATION_ID
            Log.d(TAG, "📲 Firing full-screen notification for: $callerName (ID: $notifId)")
            
            markNativeRinging(context, callSid)
            nm.notify(notifId, notification)
        }

        fun dismissCallNotification(context: Context, callSid: String = "") {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val notifId = if (callSid.isNotEmpty()) callSid.hashCode() else NOTIFICATION_ID
            nm.cancel(notifId)
            
            if (callSid.isNotEmpty()) clearNativeRinging(context, callSid)
        }
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "FCM token refreshed: ${token.take(20)}...")
        // Forward new token event so Twilio plugin can re-register
        val intent = Intent("ACTION_NEW_TOKEN").also {
            it.putExtra("token", token)
        }
        sendBroadcast(intent)
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        Log.d(TAG, "[ROUTE_C_NATIVE_FCM_RECEIVE] onMessageReceived data=${remoteMessage.data}")

        val data = remoteMessage.data

        if (data.isNotEmpty()) {
            val msgType = data["twi_message_type"] ?: ""
            
            // ── CRITICAL FIX P0-1: ALWAYS pass native Twilio payloads to SDK to generate CallInvites! ──
            if (msgType.startsWith("twilio.voice.")) {
                Log.d(TAG, "[ROUTE_C2_NATIVE_TWILIO_HANDLE_MESSAGE] Passing payload to Twilio Voice.handleMessage...")
                val validTwilio = Voice.handleMessage(applicationContext, data, this)
                if (!validTwilio) {
                    Log.w(TAG, "⚠️ Twilio Voice.handleMessage rejected payload.")
                }
            }

            if (msgType == "twilio.voice.call") {
                val rawFrom = data["twi_from"] ?: data["From"] ?: data["from"] ?: "Superparty"
                val from = rawFrom.removePrefix("client:").removePrefix("+")
                val callSid = data["twi_call_sid"] ?: ""
                Log.d(TAG, "🔔 VOICE CALL from=$from callSid=$callSid — Firing Custom Android Notification (Bypassing telecom blocker)")
                
                // CRITICAL FIX: We MUST fire this custom Full-Screen Intent notification.
                // On Huawei/Honor, Telecom Manager is completely disabled ("PhoneAccount missing").
                showFullScreenCallNotification(applicationContext, from, callSid)
            } else if (data["target_action"] == "CANCEL_RINGING_UI" || data["type"] == "CANCEL_RINGING_UI") {
                val callSid = data["twi_call_sid"] ?: data["callSid"] ?: ""
                Log.d(TAG, "📴 CANCEL_RINGING_UI received from backend for callSid=$callSid")
                dismissCallNotification(applicationContext, callSid)
                
                Intent("com.superpartybyai.app/CALL_CANCELLED").apply {
                    putExtra("callSid", callSid)
                }.also { LocalBroadcastManager.getInstance(applicationContext).sendBroadcast(it) }
                return
            } else if (data["type"] == "incoming_call") {
                val rawFrom = data["callerNumber"] ?: data["from"] ?: "Superparty"
                val from = rawFrom.removePrefix("client:").removePrefix("+")
                val callSid = data["callSid"] ?: ""
                val ackToken = data["ackToken"]

                if (!ackToken.isNullOrEmpty() && callSid.isNotEmpty()) {
                    val prefs = applicationContext.getSharedPreferences("FlutterSharedPreferences", Context.MODE_PRIVATE)
                    val identity = prefs.getString("flutter.twilio_client_identity", "")
                    if (!identity.isNullOrEmpty()) {
                        Thread {
                            try {
                                val url = java.net.URL("https://voice.superparty.ro/api/voice/push-ack")
                                val conn = url.openConnection() as java.net.HttpURLConnection
                                conn.requestMethod = "POST"
                                conn.setRequestProperty("Content-Type", "application/json")
                                conn.doOutput = true
                                val payload = """{"callSid":"$callSid","identity":"$identity","ackToken":"$ackToken"}"""
                                conn.outputStream.write(payload.toByteArray(Charsets.UTF_8))
                                conn.responseCode
                                Log.d(TAG, "🚀 Native Push-ACK sent to PBX for $callSid!")
                            } catch (e: Exception) {
                                Log.e(TAG, "❌ Failed to send Push-ACK natively: ${e.message}")
                            }
                        }.start()
                    }
                }
                
                Log.d(TAG, "🔔 HETZNER WAKE-UP EVENT: from=$from callSid=$callSid — Firing Native IncomingCallActivity Over Lock Screen!")
                showFullScreenCallNotification(applicationContext, from, callSid)

                Log.d(TAG, "🚫 Skipped forwarding incoming_call FCM payload to Flutter plugin to ensure Single Native Owner.")
                return
            }

        }
    }

    // ── MessageListener implementation ──────────────────────────────────────
    // Replicates the logic from twilio_voice plugin's VoiceSupabaseMessagingService

    override fun onCallInvite(callInvite: CallInvite) {
        Log.d(TAG, "✅ onCallInvite: sid=${callInvite.callSid} from=${callInvite.from} to=${callInvite.to}")

        // Store CallInvite statically so we can accept it directly on Huawei (no TelecomManager)
        pendingCallInvite = callInvite
        Log.d(TAG, "📦 Stored pendingCallInvite for direct accept on restrictive device")

        // ── ANTI-LOOP INTERCEPTOR ──
        val now = System.currentTimeMillis()
        val until = autoAnswerUntil
        if (until != null && now < until) {
            Log.d(TAG, "⚡️ RACE CONDITION WON! Auto-answering CallInvite...")
            autoAnswerUntil = null // consume 
            answeredCallSids.add(callInvite.callSid) // mask the new SID so it doesn't loop via other vectors
            callInvite.accept(applicationContext, autoAnswerListener)
            // MUST return here to prevent TVConnectionService/TelecomManager from ringing!
            return 
        }

        // Try to forward to TVConnectionService (except on Huawei/Honor to prevent crash loop)
        try {
            val m = Build.MANUFACTURER.lowercase()
            val isHuawei = m.contains("huawei") || m.contains("honor")
            if (isHuawei) {
                Log.d(TAG, "🚫 Huawei/Honor detected! Skipping TVConnectionService completely to prevent crash loop.")
            } else {
                Intent(applicationContext, TVConnectionService::class.java).apply {
                    action = TVConnectionService.ACTION_INCOMING_CALL
                    putExtra("callSid", callInvite.callSid)
                    putExtra("from", callInvite.from)
                    applicationContext.startService(this)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "TVConnectionService unavailable: ${e.message}")
        }

        // Notify Flutter via TVBroadcastReceiver (fires CallEvent.incoming)
        Intent(applicationContext, TVBroadcastReceiver::class.java).apply {
            action = TVBroadcastReceiver.ACTION_INCOMING_CALL
            putExtra("callSid", callInvite.callSid)
            putExtra("from", callInvite.from)
            putExtra(TVBroadcastReceiver.EXTRA_CALL_HANDLE, callInvite.callSid)
            LocalBroadcastManager.getInstance(applicationContext).sendBroadcast(this)
        }
    }

    override fun onCancelledCallInvite(cancelledCallInvite: CancelledCallInvite, callException: CallException?) {
        Log.d(TAG, "📴 onCancelledCallInvite: ${callException?.message}")

        // Dismiss our custom notification using dynamic mapping
        dismissCallNotification(applicationContext, cancelledCallInvite.callSid)

        // Forward to TVConnectionService
        Intent(applicationContext, TVConnectionService::class.java).apply {
            action = TVConnectionService.ACTION_CANCEL_CALL_INVITE
            putExtra("callSid", cancelledCallInvite.callSid)
            applicationContext.startService(this)
        }
        
        // Broadcast CALL_CANCELLED so Flutter can dismiss UI 
        // (Handled automatically if flutter listens, or fallback handled purely internally)
        Intent("com.superpartybyai.app/CALL_CANCELLED").apply {
            putExtra("callSid", cancelledCallInvite.callSid)
        }.also { LocalBroadcastManager.getInstance(applicationContext).sendBroadcast(it) }
    }
}
