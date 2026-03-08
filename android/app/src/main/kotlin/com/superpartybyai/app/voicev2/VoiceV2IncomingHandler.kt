package com.superpartybyai.app.voicev2

import android.content.Context
import android.util.Log

object VoiceV2IncomingHandler {
    private const val TAG = "[V2IncomingHandler]"

    fun onFCMIncomingCall(context: Context, payload: Map<String, String>) {
        val callSid = payload["callSid"] ?: return
        Log.d(TAG, "${VoiceV2RouteFingerprint.V2_NATIVE_INCOMING_OWNER} Handling incoming FCM for: $callSid")

        // Hard Dedupe: If we are already ringing this exact call, ignore it.
        val currentRingingSid = VoiceV2StateStore.getRingingCallSid(context)
        if (currentRingingSid == callSid) {
            Log.d(TAG, "Dedupe: Already ringing $callSid. Dropping duplicate incoming payload.")
            return
        }
        
        // Single UI Rule: If another call is ringing or connected, drop this one.
        if (currentRingingSid != null || VoiceV2StateStore.getActiveCallSid(context) != null) {
            Log.w(TAG, "System busy. Active or another ringing call exists. Dropping $callSid.")
            // Could optionally send a reject-busy here.
            return
        }

        VoiceV2StateStore.setRinging(context, callSid)
        VoiceV2FlutterBridge.syncRinging(context, callSid)
        VoiceV2Coordinator.startRingingUI(context, callSid, payload)
    }

    fun onTwilioCallInvite(context: Context, invite: com.twilio.voice.CallInvite) {
        val callSid = invite.callSid
        Log.d(TAG, "${VoiceV2RouteFingerprint.V2_NATIVE_INCOMING_OWNER} Handling Twilio CallInvite for: $callSid")

        // Store invite for Accept Handler
        VoiceV2Coordinator.setInvite(invite)

        // Deduplicate against the push-wake-up flow
        val currentRingingSid = VoiceV2StateStore.getRingingCallSid(context)
        if (currentRingingSid == callSid) {
            Log.d(TAG, "Dedupe: FCM wake-up already triggered ringing UI for $callSid. Invite saved.")
            return
        }
        
        // Single UI Rule: If busy, reject invite
        if (currentRingingSid != null || VoiceV2StateStore.getActiveCallSid(context) != null) {
            Log.w(TAG, "System busy. Rejecting Twilio Invite for $callSid.")
            invite.reject(context)
            return
        }

        VoiceV2StateStore.setRinging(context, callSid)
        VoiceV2FlutterBridge.syncRinging(context, callSid)
        
        // If we reach here, PBX push arrived AFTER Twilio Invite or PBX push was lost.
        // Start UI fallback.
        val fallbackPayload = mapOf("callSid" to callSid, "callerNumber" to (invite.from ?: "Superparty"))
        VoiceV2Coordinator.startRingingUI(context, callSid, fallbackPayload)
    }
}
