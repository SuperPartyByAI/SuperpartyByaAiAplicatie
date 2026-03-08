package com.superpartybyai.app.voicev2

import android.content.Context
import android.content.Intent
import android.util.Log
import com.superpartybyai.app.ui.IncomingCallActivity

object VoiceV2Coordinator {
    private const val TAG = "[V2Coordinator]"

    @Volatile
    var pendingCallInvite: com.twilio.voice.CallInvite? = null

    fun setInvite(invite: com.twilio.voice.CallInvite) {
        pendingCallInvite = invite
        Log.d(TAG, "New Twilio CallInvite cached. sid=${invite.callSid}")
    }

    fun clearInvite() {
        pendingCallInvite = null
        Log.d(TAG, "Twilio CallInvite cache cleared.")
    }

    fun startRingingUI(context: Context, callSid: String, payload: Map<String, String>) {
        Log.d(TAG, "Starting Native Ringing UI for $callSid")
        val intent = Intent(context, IncomingCallActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("callSid", callSid)
            putExtra("callerNumber", payload["callerNumber"] ?: "Superparty")
            putExtra("type", "incoming_call")
            
            // For PBX Winner-on-ACCEPT
            putExtra("conf", payload["conf"] ?: "")
            putExtra("sig", payload["sig"] ?: "")
            putExtra("expires", payload["expires"] ?: "")
        }
        
        try {
            context.startActivity(intent)
            Log.d(TAG, "IncomingCallActivity launched successfully.")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch IncomingCallActivity: ${e.message}")
        }
    }
}
