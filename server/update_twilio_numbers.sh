#!/bin/bash
export VOICE_URL="https://89.167.115.150:3001/api/voice/incoming"

echo "Fetching all Phone Numbers..."
NUMBERS_JSON=$(curl -s -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PageSize=100")

echo "$NUMBERS_JSON" | jq -r '.incoming_phone_numbers[] | .sid + " " + .phone_number' | while read -r SID NUMBER; do
  echo "Updating $NUMBER ($SID)..."
  curl -s -X POST -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" \
    "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/${SID}.json" \
    -d "VoiceUrl=${VOICE_URL}" -d "VoiceMethod=POST" > /dev/null
  echo "  Done."
done
echo "All numbers updated."
