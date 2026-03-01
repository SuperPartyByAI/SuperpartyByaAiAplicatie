# Alerting Setup - Slack & Discord

## 🎯 Overview

Configure instant notifications for:

- ❌ Errors (Sentry)
- 📊 Logs (Better Stack)
- ✅ CI/CD (GitHub Actions)
- ⚠️ Uptime (Better Stack)

---

## 1️⃣ SLACK SETUP

### Step 1: Create Slack Webhook

1. Go to: https://api.slack.com/apps
2. Click **"Create New App"** → **"From scratch"**
3. Name: `SuperParty Alerts`
4. Workspace: Select your workspace
5. Click **"Incoming Webhooks"** → Enable
6. Click **"Add New Webhook to Workspace"**
7. Select channel: `#alerts` or `#monitoring`
8. Copy webhook URL: `https://hooks.slack.com/services/T.../B.../...`

### Step 2: Add to GitHub Secrets

```bash
# Go to: https://github.com/SuperPartyByAI/Aplicatie-SuperpartyByAi/settings/secrets/actions
# Add new secret:
Name: SLACK_WEBHOOK_URL
Value: https://hooks.slack.com/services/T.../B.../...
```

### Step 3: Configure Sentry → Slack

1. Go to: https://sentry.io/settings/integrations/slack/
2. Click **"Add to Slack"**
3. Select workspace and channel
4. Configure alert rules:
   - New issues
   - Issue frequency (> 10 events/hour)
   - Performance degradation

### Step 4: Configure Better Stack → Slack

1. Go to: https://betterstack.com/team/settings/integrations
2. Click **"Slack"** → **"Connect"**
3. Select channel: `#alerts`
4. Configure:
   - Log alerts (level: error)
   - Uptime alerts (service down)
   - Incident notifications

---

## 2️⃣ DISCORD SETUP

### Step 1: Create Discord Webhook

1. Open Discord server
2. Go to **Server Settings** → **Integrations** → **Webhooks**
3. Click **"New Webhook"**
4. Name: `SuperParty Alerts`
5. Channel: `#alerts` or `#monitoring`
6. Copy webhook URL: `https://discord.com/api/webhooks/.../...`

### Step 2: Add to GitHub Secrets

```bash
# Go to: https://github.com/SuperPartyByAI/Aplicatie-SuperpartyByAi/settings/secrets/actions
# Add new secret:
Name: DISCORD_WEBHOOK_URL
Value: https://discord.com/api/webhooks/.../...
```

### Step 3: Configure Sentry → Discord

1. Go to: https://sentry.io/settings/integrations/
2. Search for **"Discord"** or use webhook integration
3. Add webhook URL
4. Configure alert rules (same as Slack)

### Step 4: Configure Better Stack → Discord

1. Go to: https://betterstack.com/team/settings/integrations
2. Click **"Webhook"** → **"Add webhook"**
3. URL: Your Discord webhook URL
4. Events: Select all critical events

---

## 3️⃣ GITHUB ACTIONS NOTIFICATIONS

Already configured in `.github/workflows/notify.yml`

Notifications sent for:

- ✅ Successful deployments
- ❌ Failed deployments
- ⚠️ CI failures

---

## 4️⃣ TEST NOTIFICATIONS

### Test Slack:

```bash
curl -X POST YOUR_SLACK_WEBHOOK_URL \
  -H 'Content-Type: application/json' \
  -d '{"text":"🧪 Test notification from SuperParty"}'
```

### Test Discord:

```bash
curl -X POST YOUR_DISCORD_WEBHOOK_URL \
  -H 'Content-Type: application/json' \
  -d '{"content":"🧪 Test notification from SuperParty"}'
```

---

## 5️⃣ ALERT EXAMPLES

### Sentry Alert (Error):

```
🚨 New Error in Production
Project: superparty-frontend
Error: TypeError: Cannot read property 'id' of null
File: functions/index.js:84
Occurrences: 15 in last hour
Link: https://sentry.io/issues/...
```

### Better Stack Alert (Service Down):

```
⚠️ Service Down
Service: WhatsApp Backend
URL: https://whats-app-ompro.ro
Status: 503 Service Unavailable
Duration: 2 minutes
```

### GitHub Actions Alert (Deploy Failed):

```
❌ Deployment Failed
Workflow: Deploy Frontend to Supabase
Commit: 31d0116 - feat: add ESLint + Prettier
Branch: main
Error: Supabase deployment failed
Link: https://github.com/.../actions/runs/...
```

---

## 6️⃣ ALERT ROUTING

| Alert Type    | Severity    | Channel           | Response Time |
| ------------- | ----------- | ----------------- | ------------- |
| Service Down  | 🔴 Critical | #alerts + @oncall | < 5 min       |
| Error Spike   | 🟠 High     | #alerts           | < 15 min      |
| Deploy Failed | 🟡 Medium   | #deployments      | < 30 min      |
| Performance   | 🟢 Low      | #monitoring       | < 1 hour      |

---

## 7️⃣ ONCALL ROTATION (Optional)

Setup PagerDuty or Opsgenie for:

- 24/7 oncall rotation
- Escalation policies
- Phone call alerts for critical issues

---

## ✅ CHECKLIST

- [ ] Slack webhook created
- [ ] Discord webhook created
- [ ] GitHub secrets added (SLACK_WEBHOOK_URL, DISCORD_WEBHOOK_URL)
- [ ] Sentry → Slack/Discord configured
- [ ] Better Stack → Slack/Discord configured
- [ ] Test notifications sent
- [ ] Alert routing documented
- [ ] Team notified about alert channels

---

## 📞 SUPPORT

If alerts not working:

1. Check webhook URLs are correct
2. Verify GitHub secrets are set
3. Test webhooks with curl
4. Check Sentry/Better Stack integration status
5. Review workflow logs in GitHub Actions
