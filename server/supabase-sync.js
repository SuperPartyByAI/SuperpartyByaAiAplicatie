const { createClient } = require('@supabase/supabase-js');

// Preluăm acreditările direct din variabilele de mediu (sau din fișier configurat anterior)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ilkphpidhuytucxlglqi.supabase.co';
// Folosim Service Role Key (dacă e disponibil) sau Anon Key pentru inserții sigure din backend.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlsa3BocGlkaHV5dHVjeGxnbHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNDI1NTYsImV4cCI6MjA4NzkxODU1Nn0.vO95CLAgt9M1vUr4za9CNVHjuEmeeQWW-qCMnY4_UPE';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Functie universala pentru a ridica orice mesaj (Text, Audio, Imagine, PDF) catre Supabase
 */
async function syncMessageToSupabase(msgData) {
    try {
        // Obținem mereu milisecunde (dacă Baileys ne dă secunde < 1e12, înmulțim cu 1000)
        let tsMs = Date.now();
        if (typeof msgData.timestamp === 'number') {
            tsMs = msgData.timestamp < 1e12 ? msgData.timestamp * 1000 : msgData.timestamp;
        }

        // Construct safe object with enforced schema rules (timestamp Ca BigInt Msec)
        const safeMsgData = {
            ...msgData,
            timestamp: tsMs
        };

        const { error } = await supabase
            .from('messages')
            .upsert(safeMsgData, { onConflict: 'id', ignoreDuplicates: false });

        if (error) {
            console.error('[Supabase Sync] Eroare la upsert mesaj:', error);
            return false;
        }
        console.log(`[Supabase Sync] Mesaj ${safeMsgData.id} salvat in conversatia ${safeMsgData.conversation_id}`);
        return true;
    } catch (err) {
        console.error('[Supabase Sync] Catch:', err);
        return false;
    }
}

/**
 * Sincronizeaza si creeaza conversatia ca fiind 'Activa' daca nu exista inca.
 */
async function syncConversationActivity(convId, previewText, timestamp) {
    try {
        let tsMs = Date.now();
        if (typeof timestamp === 'number') {
            tsMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
        }

        const { error } = await supabase
            .from('conversations')
            .upsert({
                id: convId,
                last_message_at: tsMs,
                last_message_preview: previewText || '',
                updated_at: tsMs
            }, { onConflict: 'id' });

        if (error) {
            console.error('[Supabase Sync] Eroare la upsert conversatie:', error);
        }
    } catch (err) {
        console.error('[Supabase Sync] Catch conv sync:', err);
    }
}

module.exports = {
    supabase,
    syncMessageToSupabase,
    syncConversationActivity
};
