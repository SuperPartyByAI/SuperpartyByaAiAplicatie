package com.superpartybyai.app.telecom

import android.content.Intent
import android.net.Uri
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccountHandle
import android.util.Log

class SuperpartyConnectionService : ConnectionService() {

    companion object {
        private const val TAG = "[SuperpartyCS]"
        var activeConnection: SuperpartyConnection? = null
    }

    override fun onCreateIncomingConnection(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?
    ): Connection {
        Log.d(TAG, "onCreateIncomingConnection")

        val from = request?.extras?.getString("from") ?: "Superparty"

        val connection = SuperpartyConnection(applicationContext).apply {
            setCallerDisplayName(from, 1) // 1 = PRESENTATION_ALLOWED
            setAddress(Uri.parse("tel:$from"), 1) // 1 = PRESENTATION_ALLOWED
            setConnectionCapabilities(Connection.CAPABILITY_MUTE)
            setRinging()
        }

        activeConnection = connection
        Log.d(TAG, "Connection RINGING: $from")
        return connection
    }

    override fun onCreateIncomingConnectionFailed(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?
    ) {
        Log.e(TAG, "onCreateIncomingConnectionFailed")
    }

    override fun onCreateOutgoingConnection(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest?
    ): Connection {
        Log.d(TAG, "onCreateOutgoingConnection")
        return SuperpartyConnection(applicationContext)
    }
}

class SuperpartyConnection(private val ctx: android.content.Context) : Connection() {

    companion object {
        private const val TAG = "[SuperpartyConn]"
    }

    override fun onAnswer() {
        Log.d(TAG, "onAnswer()")
        setActive()
        ctx.sendBroadcast(Intent("com.superpartybyai.app.ACTION_ACCEPT_CALL"))
    }

    override fun onReject() {
        Log.d(TAG, "onReject()")
        setDisconnected(DisconnectCause(DisconnectCause.REJECTED))
        destroy()
        ctx.sendBroadcast(Intent("com.superpartybyai.app.ACTION_REJECT_CALL"))
    }

    override fun onDisconnect() {
        Log.d(TAG, "onDisconnect()")
        setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
        destroy()
    }

    override fun onHold() {
        setOnHold()
    }

    override fun onUnhold() {
        setActive()
    }
}
