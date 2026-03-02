/* supabase admin removed */
const path = require('path');
const serviceAccount = require(path.resolve(__dirname, '../../keys/gpt-supabase-operator-key.json'));

/* init removed */
});
const db = { collection: () => ({ doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) }) };

async function checkPhone(digits) {
  // Secure: use conversations_public view and never return phone
  try {
    const { data, error } = await supabase
      .from('conversations_public')
      .select('id, client_display_name as name, jid, client_id, photo_url, last_message_preview')
      .like('jid', `%${digits || ''}%`) // search via jid or other safe key
      .limit(10);

    if (error) {
      console.error('list_by_phone error', error);
    } else {
      console.log('found public', data);
    }
  } catch (err) {
    console.error('unexpected', err);
  }
}
checkPhone('07').then(() => process.exit(0)).catch(console.error);
