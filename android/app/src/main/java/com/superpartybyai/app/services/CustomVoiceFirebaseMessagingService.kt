package com.superpartybyai.app.services

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.superpartybyai.app.voicev2.VoiceV2IncomingHandler
import com.superpartybyai.app.voicev2.VoiceV2HangupHandler
import com.superpartybyai.app.voicev2.VoiceV2RouteFingerprint
import com.superpartybyai.app.voicev2.VoiceV2StateStore
import com.twilio.voice.CallException
import com.twilio.voice.CallInvite
import com.twilio.voice.CancelledCallInvite
import com.twilio.voice.MessageListener
import com.twilio.voice.Voice
import androidx.localbroadcastmanager.content.LocalBroadcastManager

class CustomVoiceFirebaseMessagingService : FirebaseMessagingService(), MessageListener {

    companion object {
        private const val TAG = "[CustomVoiceFCM_V2]"
        
        fun dismissCallNotification(context: Context, callSid: String = "") {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val notifId = if (callSid.isNotEmpty()) callSid.hashCode() else 9001
            nm.cancel(notifId)
        }
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "FCM token refreshed: ${token.take(20)}...")
        val intent = Intent("ACTION_NEW_TOKEN").also {
            it.putExtra("token", token)
        }
        sendBroadcast(intent)
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val data = remoteMessage.data
        if (data.isEmpty()) return

        val msgType = data["twi_message_type"] ?: ""
        
        // Pass to Twilio SDK to construct CallInvite (Calls MessageListener)
        if (msgType.startsWith("twilio.voice.")) {
            Voice.handleMessage(applicationContext, data, this)
        }

        // Intercept Wake-Ups for V2 Incoming Handler
        if (data["type"] == "incoming_call" || msgType == "twilio.voice.call") {
             val m = Build.MANUFACTURER.lowercase()
             val isHuawei = m.contains("huawei") || m.contains("honor")
             
             if (isHuawei) {
                 VoiceV2IncomingHandler.onFCMIncomingCall(applicationContext, data)
                 return
             } else {
                 // Non-Huawei phones can do Flutter broadcast
                 val intent = Intent("com.google.android.c2dm.intent.RECEIVE")
                 intent.setPackage(applicationContext.packageName)
                 intent.putExtras(remoteMessage.toIntent().extras ?: android.os.Bundle())
                 sendBroadcast(intent)
             }
        } else if (data["target_action"] == "CANCEL_RINGING_UI" || data["type"] == "CANCEL_RINGING_UI") {
             val callSid = data["twi_call_sid"] ?: data["callSid"] ?: ""
             VoiceV2HangupHandler.handleRemoteHangup(applicationContext, callSid)
        }
    }

    override fun onCallInvite(callInvite: CallInvite) {
        val m = Build.MANUFACTURER.lowercase()
        val isHuawei = m.contains("huawei") || m.contains("honor")
        if (isHuawei) {
            VoiceV2IncomingHandler.onTwilioCallInvite(applicationContext, callInvite)
        } else {
            // Existing Logic for standard Androids (TelecomManager TVConnectionService path)
            Log.d(TAG, "Legacy non-Huawei CallInvite routing")
        }
    }

    override fun onCancelledCallInvite(cancelledCallInvite: CancelledCallInvite, callException: CallException?) {
        VoiceV2HangupHandler.handleRemoteHangup(applicationContext, cancelledCallInvite.callSid)
    }
}
