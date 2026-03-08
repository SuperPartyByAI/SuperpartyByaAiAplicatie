package com.superpartybyai.app.voicev2

import android.content.Context
import android.util.Log

object VoiceV2FlutterBridge {
    private const val TAG = "[VoiceV2FlutterBridge]"

    // Called exclusively from Native to notify Flutter of the purely visual states
    fun sendStateToFlutter(context: Context, state: String, callSid: String) {
        Log.d(TAG, "Syncing UI State to Flutter: $state for callSid=$callSid")
        
        // This is a placeholder for sending Intent Broadcasts
        // or MethodChannel messages back to Dart logic.
        // E.g., sending an ACTION_VOICE_V2_STATE_SYNC with extras.
        val intent = android.content.Intent("com.superpartybyai.app/VOICE_V2_STATE_SYNC")
        intent.putExtra("state", state)
        intent.putExtra("callSid", callSid)
        
        androidx.localbroadcastmanager.content.LocalBroadcastManager
            .getInstance(context)
            .sendBroadcast(intent)
    }

    fun syncRinging(context: Context, callSid: String) = sendStateToFlutter(context, "ringing", callSid)
    fun syncConnected(context: Context, callSid: String) = sendStateToFlutter(context, "connected", callSid)
    fun syncEnded(context: Context, callSid: String) = sendStateToFlutter(context, "ended", callSid)
}
