import Twilio from 'twilio';

// Use lazily initialized client to ensure PM2 environment variables are picked up
let _client = null;
function getClient() {
  if (!_client && process.env.TWILIO_ACCOUNT_SID) {
    _client = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return _client;
}

export async function createTwilioCallAndJoin(conf, toNumber) {
  try {
    const client = getClient();
    if (!client) throw new Error('Twilio Credentials Missing');

    const call = await client.calls.create({
      to: toNumber,
      from: process.env.TWILIO_CALLER_ID,
      url: `${process.env.PUBLIC_URL || 'http://89.167.115.150:3001'}/api/voice/join-conference?conf=${encodeURIComponent(conf)}`
    });
    return { ok: true, sid: call.sid };
  } catch (err) {
    console.error('[twilioService] call create failed', err && err.code, err && err.message);
    return { ok: false, error: err.message, code: err.code };
  }
}
