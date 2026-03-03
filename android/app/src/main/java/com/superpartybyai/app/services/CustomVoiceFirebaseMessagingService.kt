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

        // Static storage for pending CallInvite – allows direct accept() without TelecomManager
        @Volatile
        var pendingCallInvite: com.twilio.voice.CallInvite? = null

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
            nm.notify(notifId, notification)
        }

        fun dismissCallNotification(context: Context, callSid: String = "") {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val notifId = if (callSid.isNotEmpty()) callSid.hashCode() else NOTIFICATION_ID
            nm.cancel(notifId)
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
        Log.d(TAG, "onMessageReceived data=${remoteMessage.data}")

        val data = remoteMessage.data

        if (data.isNotEmpty()) {
            val msgType = data["twi_message_type"] ?: ""
            if (msgType == "twilio.voice.call") {
                val rawFrom = data["twi_from"] ?: data["From"] ?: data["from"] ?: "Superparty"
                val from = rawFrom.removePrefix("client:").removePrefix("+")
                val callSid = data["twi_call_sid"] ?: ""
                Log.d(TAG, "🔔 VOICE CALL from=$from callSid=$callSid — Firing Custom Android Notification (Bypassing telecom blocker)")
                
                // CRITICAL FIX: We MUST fire this custom Full-Screen Intent notification.
                // On Huawei/Honor, Telecom Manager is completely disabled ("PhoneAccount missing").
                showFullScreenCallNotification(applicationContext, from, callSid)
            } else if (data["target_action"] == "CANCEL_RINGING_UI") {
                val callSid = data["twi_call_sid"] ?: ""
                Log.d(TAG, "📴 CANCEL_RINGING_UI received from backend for callSid=$callSid")
                dismissCallNotification(applicationContext, callSid)
                
                Intent("com.superpartybyai.app/CALL_CANCELLED").apply {
                    putExtra("callSid", callSid)
                }.also { LocalBroadcastManager.getInstance(applicationContext).sendBroadcast(it) }
                return // Explicitly return so we don't pass our custom payload to Twilio
            } else if (data["type"] == "incoming_call") {
                Log.d(TAG, "Forwarding custom incoming_call FCM payload to Flutter plugin...")
                val intent = Intent("com.google.android.c2dm.intent.RECEIVE")
                intent.setPackage(applicationContext.packageName)
                intent.putExtras(remoteMessage.toIntent().extras ?: android.os.Bundle())
                sendBroadcast(intent)
                return
            }

            // ── STEP 2: Forward to Twilio Voice SDK for CallInvite processing ─
            // This is the CRITICAL step that was missing before. Without this,
            // the Twilio SDK never creates a CallInvite, activeCall is always null,
            // and answer() always fails.
            val valid = Voice.handleMessage(applicationContext, data, this)
            Log.d(TAG, "Voice.handleMessage valid=$valid")

            if (!valid) {
                Log.d(TAG, "Not a valid Twilio Voice payload — ignoring")
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

        // Try to forward to TVConnectionService (will fail silently on Huawei – that's OK)
        try {
            Intent(applicationContext, TVConnectionService::class.java).apply {
                action = TVConnectionService.ACTION_INCOMING_CALL
                putExtra(TVConnectionService.EXTRA_INCOMING_CALL_INVITE, callInvite)
                applicationContext.startService(this)
            }
        } catch (e: Exception) {
            Log.w(TAG, "TVConnectionService unavailable (expected on Huawei): ${e.message}")
        }

        // Notify Flutter via TVBroadcastReceiver (fires CallEvent.incoming)
        Intent(applicationContext, TVBroadcastReceiver::class.java).apply {
            action = TVBroadcastReceiver.ACTION_INCOMING_CALL
            putExtra(TVBroadcastReceiver.EXTRA_CALL_INVITE, callInvite)
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
            putExtra(TVConnectionService.EXTRA_CANCEL_CALL_INVITE, cancelledCallInvite)
            applicationContext.startService(this)
        }
        
        // Broadcast CALL_CANCELLED so Flutter can dismiss UI 
        // (Handled automatically if flutter listens, or fallback handled purely internally)
        Intent("com.superpartybyai.app/CALL_CANCELLED").apply {
            putExtra("callSid", cancelledCallInvite.callSid)
        }.also { LocalBroadcastManager.getInstance(applicationContext).sendBroadcast(it) }
    }
}
