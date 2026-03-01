import os
import time
import json
import logging
import subprocess
from fastapi import FastAPI, Request, Header, HTTPException

app = FastAPI()

# Setup Logging
logging.basicConfig(level=logging.INFO, filename='/var/log/voip-orch.log', format='%(asctime)s - %(levelname)s - %(message)s')

ORCH_SECRET = os.getenv("ORCH_SECRET")
DRY_RUN = os.getenv("DRY_RUN", "true").lower() == "true"
SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL")
DOMAIN = os.getenv("DOMAIN", "https://api.superparty.ro")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN")
COOLDOWN_SECONDS = int(os.getenv("COOLDOWN_SECONDS", "600"))

def post_slack(message: str):
    if SLACK_WEBHOOK_URL:
        # Simple curl wrapper for Slack webhook
        cmd = ["curl", "-X", "POST", "-H", "Content-Type: application/json",
               "-d", json.dumps({"text": message}), SLACK_WEBHOOK_URL]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    logging.info(f"Slack Notification: {message}")

@app.post("/api/alerts")
async def receive_alert(request: Request, x_orch_secret: str = Header(None)):
    if ORCH_SECRET and x_orch_secret != ORCH_SECRET:
        logging.warning("Unauthorized alert payload received.")
        raise HTTPException(status_code=403, detail="Unauthorized")

    payload = await request.json()
    alerts = payload.get("alerts", [])

    for alert in alerts:
        alertname = alert.get("labels", {}).get("alertname")
        instance = alert.get("labels", {}).get("instance")
        starts_at = alert.get("startsAt")

        if alertname not in ["VoIPCallFailureHigh", "VoIPCallFailureSpike"]:
            logging.info(f"Ignoring non-VoIP alert: {alertname}")
            continue

        lock_file_path = f"/tmp/remediate_{alertname}.lock"
        
        # Check Cooldown
        if os.path.exists(lock_file_path):
            with open(lock_file_path, "r") as f:
                last_run = float(f.read().strip())
                if time.time() - last_run < COOLDOWN_SECONDS:
                    logging.info(f"Alert {alertname} within cooldown. Skipping remediation.")
                    continue
        
        # Determine Remediation execution
        logging.info(f"Executing remediation for {alertname} on instance {instance}. Dry_run: {DRY_RUN}")
        
        if not DRY_RUN:
            # Command to check and restart docker or PM2 logic. Assuming PM2 as per backend.
            restart_cmd = ["sudo", "systemctl", "restart", "superparty-backend"]
            
            try:
                subprocess.run(["pm2", "restart", "whatsapp-integration-v6"], check=False) # Fallback to pm2
            except Exception as e:
                logging.error(f"Restart step failed: {e}")
            
            time.sleep(10)
            
            # Smoke test logic
            smoke_test_cmd = f"BASE_URL={DOMAIN} ADMIN_TOKEN={ADMIN_TOKEN} /opt/superparty/smoke-test.sh --quick"
            res = subprocess.run(smoke_test_cmd, shell=True, capture_output=True, text=True)
            
            if res.returncode == 0:
                post_slack(f"✅ Auto-remediation SUCCESS for {alertname}.\nBackend restarted and smoke test passed.")
            else:
                post_slack(f"❌ Auto-remediation FAILED for {alertname}.\nBackend restarted but smoke test failed!\nSnippet: {res.stdout[:200]}")
            
            # Write Cooldown
            with open(lock_file_path, "w") as f:
                f.write(str(time.time()))
        else:
            post_slack(f"⚠️ [DRY RUN] Would have executed remediation for {alertname}.")
            with open(lock_file_path, "w") as f:
                f.write(str(time.time()))

    return {"status": "ok"}
