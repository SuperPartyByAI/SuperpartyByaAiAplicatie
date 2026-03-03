// Session Store - Salvează Baileys sessions în Database pentru persistență
const database = require('../supabase/database');
const fs = require('fs');
const path = require('path');

class SessionStore {
  constructor() {
    this.db = null;
  }

  async initialize() {
    if (!database.db) {
      await database.initialize();
    }
    this.db = database.db;
  }

  /**
   * Salvează session în Database
   * @param {string} accountId
   * @param {string} sessionPath - Path la .baileys_auth/{accountId}
   */
  async saveSession(accountId, sessionPath) {
    try {
      if (!this.db) await this.initialize();

      const credsPath = path.join(sessionPath, 'creds.json');

      if (!fs.existsSync(credsPath)) {
        console.log(`⚠️ [${accountId}] No creds.json found, skipping save`);
        return;
      }

      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

      // Salvează în Database
      await this.db.collection('whatsapp_sessions').doc(accountId).set({
        accountId,
        creds: creds,
        updatedAt: new Date().toISOString(),
        savedAt: database.admin.database.FieldValue.serverTimestamp(),
      });

      console.log(`💾 [${accountId}] Session saved to Database`);
    } catch (error) {
      console.error(`❌ [${accountId}] Failed to save session:`, error.message);
    }
  }

  /**
   * Restaurează session din Database
   * @param {string} accountId
   * @param {string} sessionPath - Path la .baileys_auth/{accountId}
   */
  async restoreSession(accountId, sessionPath) {
    try {
      if (!this.db) await this.initialize();

      const doc = await this.db.collection('whatsapp_sessions').doc(accountId).get();

      if (!doc.exists) {
        console.log(`ℹ️ [${accountId}] No saved session in Database`);
        return false;
      }

      const data = doc.data();

      // Creează director dacă nu există
      if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
      }

      // Scrie creds.json
      const credsPath = path.join(sessionPath, 'creds.json');
      fs.writeFileSync(credsPath, JSON.stringify(data.creds, null, 2));

      console.log(`✅ [${accountId}] Session restored from Database`);
      return true;
    } catch (error) {
      console.error(`❌ [${accountId}] Failed to restore session:`, error.message);
      return false;
    }
  }

  /**
   * Șterge session din Database
   * @param {string} accountId
   */
  async deleteSession(accountId) {
    try {
      if (!this.db) await this.initialize();

      await this.db.collection('whatsapp_sessions').doc(accountId).delete();
      console.log(`🗑️ [${accountId}] Session deleted from Database`);
    } catch (error) {
      console.error(`❌ [${accountId}] Failed to delete session:`, error.message);
    }
  }

  /**
   * Listează toate sessions salvate
   */
  async listSessions() {
    try {
      if (!this.db) await this.initialize();

      const snapshot = await this.db.collection('whatsapp_sessions').get();
      const sessions = [];

      snapshot.forEach(doc => {
        sessions.push({
          accountId: doc.id,
          ...doc.data(),
        });
      });

      return sessions;
    } catch (error) {
      console.error('❌ Failed to list sessions:', error.message);
      return [];
    }
  }
}

module.exports = new SessionStore();
