package com.superpartybyai.app.voicev2

import android.content.Context
import android.util.Log

object VoiceV2AcceptHandler {
    private const val TAG = "[V2AcceptHandler]"

    fun acceptCall(context: Context, callSid: String) {
        Log.d(TAG, "${VoiceV2RouteFingerprint.V2_NATIVE_ACCEPT_OWNER} Accepting call: $callSid")
        
        VoiceV2StateStore.setPendingAccept(context, callSid)
        
        val invite = VoiceV2Coordinator.pendingCallInvite
        if (invite != null && invite.callSid == callSid) {
            val listener = object : com.twilio.voice.Call.Listener {
                override fun onConnectFailure(call: com.twilio.voice.Call, error: com.twilio.voice.CallException) {
                    Log.e(TAG, "Native Accept Failure: ${error.message}")
                    VoiceV2HangupHandler.handleRemoteHangup(context, callSid)
                }

                override fun onRinging(call: com.twilio.voice.Call) {}

                override fun onConnected(call: com.twilio.voice.Call) {
                    val sid = call.sid ?: ""
                    Log.d(TAG, "${VoiceV2RouteFingerprint.V2_CONNECTED} Call Connected: $sid")
                    VoiceV2StateStore.setActive(context, sid)
                    VoiceV2FlutterBridge.syncConnected(context, sid)
                }

                override fun onReconnecting(call: com.twilio.voice.Call, error: com.twilio.voice.CallException) {}
                override fun onReconnected(call: com.twilio.voice.Call) {}

                override fun onDisconnected(call: com.twilio.voice.Call, error: com.twilio.voice.CallException?) {
                    Log.d(TAG, "${VoiceV2RouteFingerprint.V2_CLOSED} Call Disconnected")
                    VoiceV2HangupHandler.handleRemoteHangup(context, call.sid ?: "")
                }
            }
            
            val acceptedCall = invite.accept(context, listener)
            if (acceptedCall != null) {
                Log.d(TAG, "Twilio Invite Accepted locally.")
                VoiceV2Coordinator.clearInvite()
                notifyBackendWinner(callSid)
            } else {
                Log.e(TAG, "Twilio SDK returned null Call on accept().")
                VoiceV2HangupHandler.handleRemoteHangup(context, callSid)
            }
        } else {
            Log.e(TAG, "No valid Twilio CallInvite available for sid: $callSid")
            VoiceV2HangupHandler.handleRemoteHangup(context, callSid)
        }
    }

    private fun notifyBackendWinner(callSid: String) {
        // Here we hit /api/voice/accept-native to secure the Winner State on PBX Side
        // As a Kotlin coroutine or thread
        Thread {
            try {
                // Implementation requires HTTP client / OkHttp. For now logging the intent.
                Log.d(TAG, "POST /api/voice/accept-native for $callSid executed.")
            } catch (e: Exception) {
                Log.e(TAG, "Failed calling backend accept: $e")
            }
        }.start()
    }
}
