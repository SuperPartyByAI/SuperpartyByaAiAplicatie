package com.superpartybyai.app.voicev2

import android.content.Context
import android.content.SharedPreferences

object VoiceV2StateStore {
    private const val PREFS_NAME = "VoiceV2Preferences"
    private const val RINGING_CALL_SID_KEY = "v2.ringing_call_sid"
    private const val PENDING_ACCEPT_SID_KEY = "v2.pending_accept_sid"
    private const val ACTIVE_CALL_SID_KEY = "v2.active_call_sid"
    private const val LAST_STATE_KEY = "v2.last_state"
    private const val RINGING_TTL_MS = 45_000L
    private const val RINGING_EXPIRY_KEY = "v2.ringing_expiry"

    enum class V2State { IDLE, RINGING, ACCEPTING, CONNECTED, ENDED }

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun setRinging(context: Context, callSid: String) {
        val now = System.currentTimeMillis()
        getPrefs(context).edit()
            .putString(RINGING_CALL_SID_KEY, callSid)
            .putLong(RINGING_EXPIRY_KEY, now + RINGING_TTL_MS)
            .putString(LAST_STATE_KEY, V2State.RINGING.name)
            .apply()
    }

    fun getRingingCallSid(context: Context): String? {
        val prefs = getPrefs(context)
        val expiry = prefs.getLong(RINGING_EXPIRY_KEY, 0L)
        if (System.currentTimeMillis() > expiry) {
            clearRinging(context)
            return null
        }
        return prefs.getString(RINGING_CALL_SID_KEY, null)
    }

    fun clearRinging(context: Context) {
        getPrefs(context).edit()
            .remove(RINGING_CALL_SID_KEY)
            .remove(RINGING_EXPIRY_KEY)
            .apply()
    }

    fun setPendingAccept(context: Context, callSid: String) {
        getPrefs(context).edit()
            .putString(PENDING_ACCEPT_SID_KEY, callSid)
            .putString(LAST_STATE_KEY, V2State.ACCEPTING.name)
            .apply()
    }
    
    fun getPendingAcceptSid(context: Context): String? {
        return getPrefs(context).getString(PENDING_ACCEPT_SID_KEY, null)
    }

    fun setActive(context: Context, callSid: String) {
        getPrefs(context).edit()
            .remove(RINGING_CALL_SID_KEY)
            .remove(RINGING_EXPIRY_KEY)
            .remove(PENDING_ACCEPT_SID_KEY)
            .putString(ACTIVE_CALL_SID_KEY, callSid)
            .putString(LAST_STATE_KEY, V2State.CONNECTED.name)
            .apply()
    }

    fun getActiveCallSid(context: Context): String? {
        return getPrefs(context).getString(ACTIVE_CALL_SID_KEY, null)
    }

    fun clearAll(context: Context) {
        getPrefs(context).edit()
            .remove(RINGING_CALL_SID_KEY)
            .remove(RINGING_EXPIRY_KEY)
            .remove(PENDING_ACCEPT_SID_KEY)
            .remove(ACTIVE_CALL_SID_KEY)
            .putString(LAST_STATE_KEY, V2State.ENDED.name)
            .apply()
    }

    fun getLastState(context: Context): V2State {
        val stateStr = getPrefs(context).getString(LAST_STATE_KEY, V2State.IDLE.name)
        return try {
            V2State.valueOf(stateStr!!)
        } catch (e: Exception) {
            V2State.IDLE
        }
    }
}
