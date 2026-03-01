require('dotenv').config();
const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

client.calls
  .create({
     twiml: '<Response><Say>Testing Twilio Incoming Call</Say></Response>',
     to: 'client:user_FBQUjlK2dFNjv9uvUOseV85uXmE3_dev_dbdc9263-984c-4c46-ba7c-0476cdc01a8a',
     from: process.env.TWILIO_PHONE_NUMBER
   })
  .then(call => console.log("Call initiated, SID:", call.sid))
  .catch(err => console.error(err));
