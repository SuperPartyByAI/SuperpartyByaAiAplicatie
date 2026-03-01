import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 1. Initialize Firebase Admin
try {
  let serviceAccount;
  try {
    const keyPath = join(__dirname, '../../keys/gpt-firebase-key.json');
    serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
  } catch(e) {
    if (process.env.FIREBASE_PROJECT_ID) {
      serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      };
    } else {
        console.error("No service account found for watchdog.");
        process.exit(1);
    }
  }

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} catch (error) {
  if (!/already exists/i.test(error.message)) {
    console.error('Firebase initialization error in watchdog:', error);
    process.exit(1);
  }
}

const db = admin.firestore();

// 2. DISCORD WEBHOOK URL
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1317130983196884992/3k6jR7A8f28hQWwzG9TcL8ZlY_Q0dJ_vX6QzJ5d-_sI_P9CjO-a7GjB_F4T1pMwQ0T1b'; // User's standard alert webhook from previous scripts

// Local Memory to avoid alert spamming
const failingAccounts = new Set();
const alertingCooldown = new Map(); // docId -> timestamp
const ALERT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes between repeated alerts for the SAME account

async function sendDiscordAlert(title, message, color = 16711680) {
    try {
        const payload = {
            embeds: [{
                title: title,
                description: message,
                color: color,
                timestamp: new Date().toISOString()
            }]
        };

        const fetch = (await import('node-fetch')).default;
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log(`[Discord] Alert sent: ${title}`);
    } catch(err) {
        console.error("Failed to send Discord alert:", err);
    }
}

async function sendAppInboxAlert(title, message, isRecovery = false) {
    try {
        await db.collection('app_inbox').add({
            title: title,
            body: message,
            type: isRecovery ? 'info' : 'error',
            source: 'system',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            readBy: [] // No admin has read this yet
        });
        console.log(`[AppInbox] Alert pushed to Firestore: ${title}`);
    } catch (err) {
        console.error("Failed to push AppInbox alert:", err);
    }
}

// 3. Monitor Function
async function monitorWhatsAppAccounts() {
    try {
        console.log(`[Watchdog] Checking wa_accounts collection...`);
        const snapshot = await db.collection('wa_accounts').get();
        
        const now = Date.now();
        let anyFailures = false;

        snapshot.forEach(doc => {
            const data = doc.data();
            const id = doc.id;
            const status = data.state || data.status || 'unknown';
            const label = data.label || 'Unknown Account';
            
            // Criteria for alert: Disconnected, needs_qr, logged_out, or not 'connected' for too long
            if (status !== 'connected') {
                anyFailures = true;
                
                const lastAlert = alertingCooldown.get(id) || 0;
                
                // If it's the very first time it fails OR 15 minutes have passed since last alert
                if (!failingAccounts.has(id) || (now - lastAlert) >= ALERT_INTERVAL_MS) {
                    const statusStr = typeof status === 'string' ? status.toUpperCase() : 'UNKNOWN';
                    console.log(`[Watchdog Warning] Account ${label} (${id}) is in BAD STATE: ${statusStr}`);
                    
                    const discordMsg = `🚨 **WhatsApp Alert** 🚨\n\n**Account:** ${label}\n**Current Status:** \`${statusStr}\`\n\nThe automation for this number is currently unresponsive or disconnected. Please check the Server Monitor in the Admin App.`;
                    sendDiscordAlert(`WhatsApp Connection Issue: ${label}`, discordMsg, 16711680 /* Red */);
                    
                    const inboxMsg = `Contul "${label}" a pierdut conexiunea. Status actual: ${statusStr}. Te rugăm să verifici meniul "Server Monitor".`;
                    sendAppInboxAlert(`Deconectare Sistem: ${label}`, inboxMsg, false);
                    
                    failingAccounts.add(id);
                    alertingCooldown.set(id, now);
                }
            } else {
                // Account is healthy
                if (failingAccounts.has(id)) {
                    console.log(`[Watchdog Recovery] Account ${label} (${id}) has RECOVERED.`);
                    
                    const discordMsg = `✅ **WhatsApp Recovered** ✅\n\n**Account:** ${label}\n**Status:** \`CONNECTED\`\n\nThe server successfully re-established the Baileys session for this number.`;
                    sendDiscordAlert(`WhatsApp Recovered: ${label}`, discordMsg, 65280 /* Green */);
                    
                    const inboxMsg = `Contul "${label}" s-a reconectat cu succes și este funcțional.`;
                    sendAppInboxAlert(`Reconectare Sistem: ${label}`, inboxMsg, true);
                    
                    failingAccounts.delete(id);
                    alertingCooldown.delete(id);
                }
            }
        });

    } catch(error) {
        console.error("Monitor loop error:", error);
    }
}

// 4. Start the continuous loop (Check every 60 seconds)
console.log("🛡️ Starting WhatsApp Discord Watchdog...");
sendDiscordAlert("Watchdog Deployed", "The WhatsApp Event Watchdog has been deployed to PM2 and is actively monitoring Firestore for connection drops.", 3447003 /* Blue */);

setInterval(monitorWhatsAppAccounts, 60000);
monitorWhatsAppAccounts(); // Run first check immediately
