import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ilkphpidhuytucxlglqi.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlsa3BocGlkaHV5dHVjeGxnbHFpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjM0MjU1NiwiZXhwIjoyMDg3OTE4NTU2fQ.zsCNAng5tlP_k9_pt5hSvtOkA2B_H6T63ie5XhjUSIU'; // I need to get this from the environment

if (!SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_SERVICE_KEY");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function migrate() {
    console.log("Fetching all conversations with null account_id...");
    
    // Fetch broken conversations (the ones created by the session-manager sync error)
    const { data: brokenConvos, error: errC } = await supabase
        .from('conversations')
        .select('*')
        .is('account_id', null);

    if (errC) {
        console.error("Error fetching conversations:", errC);
        return;
    }

    console.log(`Found ${brokenConvos.length} broken conversations.`);

    for (const broken of brokenConvos) {
        // Find if there is a 'correct' conversation for this JID (where account_id is not null)
        // Usually, the JID is the 'id' in the broken row
        const jid = broken.id; // e.g., 40769029474@s.whatsapp.net
        
        // Let's find proper conversation(s) that match this phone number/jid
        const { data: correctConvos, error: errMatch } = await supabase
            .from('conversations')
            .select('id, account_id')
            .neq('account_id', null)
            .like('id', `%${jid}`);

        if (errMatch) {
            console.error("Error matching:", errMatch);
            continue;
        }

        if (correctConvos.length === 0) {
            // There is no correct conversation yet. We can't automatically assign an account_id
            // because we don't know which account it belongs to! We leave it alone for now, 
            // or we could delete it if it's completely orphaned. Let's just skip.
            // Actually, we should probably delete it if there are no messages for it, but let's be safe.
            continue;
        }

        // We assume the first correct conversation is the one we want to merge into.
        const targetConvoId = correctConvos[0].id; // e.g. K22..._4076...
        const targetAccountId = correctConvos[0].account_id;

        console.log(`Migrating messages from ${jid} to ${targetConvoId}`);

        // Update all related messages from the broken conversation to the target conversation
        const { error: errUpdateMsg } = await supabase
            .from('messages')
            .update({ 
                conversation_id: targetConvoId
            })
            .eq('conversation_id', jid); // messages where conversation_id was just the JID
            
        // Also update any messages that were saved as 'unknown' somehow associated? Hard to know which 'unknown' belongs to which if the JID is lost.

        if (errUpdateMsg) {
            console.error(`Failed to migrate messages for ${jid}:`, errUpdateMsg);
        } else {
            console.log(`Successfully migrated messages for ${jid}. Now deleting duplicate conversation...`);
            // Now we can safely delete the broken conversation
            await supabase
                .from('conversations')
                .delete()
                .eq('id', jid);
        }
    }
    
    // Cleanup 'unknown' conversation messages
    console.log("Cleaning up 'unknown' conversation messages...");
    await supabase.from('messages').delete().eq('conversation_id', 'unknown');

    console.log("Migration complete!");
}

migrate();
