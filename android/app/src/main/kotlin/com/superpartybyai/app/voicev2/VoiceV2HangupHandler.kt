package com.superpartybyai.app.voicev2

import android.content.Context
import android.util.Log

object VoiceV2HangupHandler {
    private const val TAG = "[V2HangupHandler]"

    fun rejectCall(context: Context, callSid: String) {
        Log.d(TAG, "${VoiceV2RouteFingerprint.V2_NATIVE_HANGUP_OWNER} Rejecting call: $callSid")
        
        val invite = VoiceV2Coordinator.pendingCallInvite
        if (invite != null && invite.callSid == callSid) {
            invite.reject(context)
            Log.d(TAG, "Twilio Invite rejected.")
            VoiceV2Coordinator.clearInvite()
        } else {
            Log.w(TAG, "No matching Twilio invite found for reject on $callSid")
        }
        
        // Notify PBX Backend that we're rejecting (to avoid further ringing or waiting)
        triggerNetworkReject(callSid)
        
        cleanupState(context, callSid)
    }

    fun handleRemoteHangup(context: Context, callSid: String) {
        Log.d(TAG, "${VoiceV2RouteFingerprint.V2_CLOSED} Remote PBX/Twilio Hangup received for $callSid")
        cleanupState(context, callSid)
    }

    private fun triggerNetworkReject(callSid: String) {
        // Here we can spawn an async network call to /api/voice/reject-native if PBX needs it,
        // or just let Twilio SDK's underlying .reject() handle the SIP side.
        Log.d(TAG, "Network Reject triggered or delegated to PBX.")
    }

    private fun cleanupState(context: Context, callSid: String) {
        VoiceV2StateStore.clearAll(context)
        VoiceV2FlutterBridge.syncEnded(context, callSid)
        
        // Broadcast to close the Native IncomingCallActivity UI
        androidx.localbroadcastmanager.content.LocalBroadcastManager
            .getInstance(context)
            .sendBroadcast(android.content.Intent("com.superpartybyai.app/CALL_CANCELLED"))
            
        Log.d(TAG, "State cleaned. Call Activity closed.")
    }
}
