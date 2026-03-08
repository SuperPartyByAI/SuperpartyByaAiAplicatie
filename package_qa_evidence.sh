#!/bin/bash
# Script utilitar pentru colectarea dovezilor QA (VoIP Inbound Answer)
set -eo pipefail

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
EVIDENCE_DIR="qa_evidence_$TIMESTAMP"

echo "==> Pregătesc directorul suport ($EVIDENCE_DIR)..."
mkdir -p "$EVIDENCE_DIR"

echo "==> 📱 Colectez ADB Logcat de pe Android..."
# Folosim timeout 15 secunde pt ca adb nu se oprește singur (sau se preia manual post-test)
echo "Atenție: Lasă testul final să ruleze pe telefon în acest timp (15 secunde)!"
timeout 15 adb logcat -v time | grep -E "\[main\]|\[VoIP\]|\[IncomingCallScreen\]|\[Voip Cleanup\]|\[ActiveCall\]" > "$EVIDENCE_DIR/android_voip_logs.txt" || true
echo "✔ Loguri Android extrase (sau timeout atins)."

echo "==> 🖥️  Extrag PM2 backend logs de pe PBX (89.167.123.174)..."
ssh aiops@89.167.123.174 "pm2 logs voice-backend --lines 500 --nostream | grep -E '/voice/accept|/voice/hangup|callConnectFailure|CA'" > "$EVIDENCE_DIR/server_pbx_logs.txt" || true
echo "✔ Loguri Server (Twilio Backend) extrase."

echo "==> 📦 Se asamblează arhiva pentru QA..."
# Dacă ai un video local filmat, pune-l în acest folder!
touch "$EVIDENCE_DIR/PUT_VIDEO_HERE_BEFORE_ZIPPING.txt"

zip -r "$EVIDENCE_DIR.zip" "$EVIDENCE_DIR"
echo "✅ SUCCES! Extrage arhiva '$EVIDENCE_DIR.zip', atasează secvența video și încarcă-le în Pull Request."
