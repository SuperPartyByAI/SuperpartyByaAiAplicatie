/**
 * Database-based auth state for Baileys
 * Full implementation: creds + keys persistence
 */

/* supabase admin removed */

// Binary encoding helpers
function encodeBinary(obj) {
  if (!obj) return obj;
  if (Buffer.isBuffer(obj)) return { _type: 'Buffer', data: obj.toString('base64') };
  if (obj instanceof Uint8Array)
    return { _type: 'Uint8Array', data: Buffer.from(obj).toString('base64') };
  if (Array.isArray(obj)) return obj.map(encodeBinary);
  if (typeof obj === 'object') {
    const encoded = {};
    for (const [key, value] of Object.entries(obj)) {
      encoded[key] = encodeBinary(value);
    }
    return encoded;
  }
  return obj;
}

function decodeBinary(obj) {
  if (!obj) return obj;
  if (obj._type === 'Buffer') return Buffer.from(obj.data, 'base64');
  if (obj._type === 'Uint8Array') return new Uint8Array(Buffer.from(obj.data, 'base64'));
  if (Array.isArray(obj)) return obj.map(decodeBinary);
  if (typeof obj === 'object' && !obj._type) {
    const decoded = {};
    for (const [key, value] of Object.entries(obj)) {
      decoded[key] = decodeBinary(value);
    }
    return decoded;
  }
  return obj;
}

/**
 * Create Database auth state handler
 * @param {string} accountId
 * @param {SupabaseDatabase.Database} db
 */
async function useDatabaseAuthState(accountId, db) {
  console.log(`[AUTH] Database auth-state for ${accountId}`);

  const sessionRef = db.collection('wa_sessions').doc(accountId);

  // Load existing session
  let creds = undefined;
  let keys = {};

  try {
    const sessionDoc = await sessionRef.get();

    if (sessionDoc.exists) {
      const data = sessionDoc.data();

      if (data.creds) {
        creds = decodeBinary(data.creds);
        console.log(`✅ [${accountId}] Loaded creds from Database`);
      }

      if (data.keys) {
        keys = decodeBinary(data.keys);
        console.log(
          `✅ [${accountId}] Loaded ${Object.keys(keys).length} key types from Database`
        );
      }
    } else {
      console.log(`🆕 [${accountId}] No session in Database, will generate QR`);
    }
  } catch (error) {
    console.error(`❌ [${accountId}] Failed to load session:`, error.message);
    // Continue with undefined creds to generate QR
  }

  // Create state object
  const state = {
    creds,
    keys: createKeysHandler(keys, accountId, sessionRef),
  };

  // Save credentials function
  const saveCreds = async () => {
    try {
      const update = {
        creds: encodeBinary(state.creds),
        keys: encodeBinary(keys),
        updatedAt: admin.database.new Date(),
        schemaVersion: 1,
      };

      await sessionRef.set(update, { merge: true });
      console.log(`💾 [${accountId}] Session saved to Database`);
    } catch (error) {
      console.error(`❌ [${accountId}] Save failed:`, error.message);
    }
  };

  return { state, saveCreds };
}

function createEmptyKeys() {
  return {
    get: async () => ({}),
    set: async () => {},
  };
}

function createKeysHandler(keys, accountId, sessionRef) {
  return {
    get: async (type, ids) => {
      if (!keys[type]) keys[type] = {};
      const data = keys[type];

      if (Array.isArray(ids)) {
        const result = {};
        for (const id of ids) {
          if (data[id]) result[id] = data[id];
        }
        return result;
      }
      return data;
    },
    set: async data => {
      // Merge keys
      for (const [type, typeData] of Object.entries(data)) {
        if (!keys[type]) keys[type] = {};
        Object.assign(keys[type], typeData);
      }

      // Save to Database
      try {
        await sessionRef.set(
          {
            keys: encodeBinary(keys),
            updatedAt: admin.database.new Date(),
          },
          { merge: true }
        );
        console.log(`💾 [${accountId}] Keys saved to Database (${Object.keys(data).join(', ')})`);
      } catch (error) {
        console.error(`❌ [${accountId}] Keys save failed:`, error.message);
      }
    },
  };
}

module.exports = { useDatabaseAuthState };
