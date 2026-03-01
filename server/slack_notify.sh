#!/bin/bash
WEBHOOK_URL="https://hooks.slack.com/services/XXXXXXXXX/XXXXXXXXX/XXXXXXXXXXXXXXXX"
MESSAGE="$1"
payload=$(jq -n --arg t "$MESSAGE" '{"text":$t}')
curl -s -X POST -H 'Content-type: application/json' --data "$payload" "$WEBHOOK_URL"
