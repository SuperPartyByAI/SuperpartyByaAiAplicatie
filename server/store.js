import pino from 'pino';
import fs from 'fs';

export class CustomStore {
    constructor() {
        this.chats = new Map();
        this.messages = new Map();
        this.contacts = new Map();
        this.logger = pino({ level: 'silent' });
    }

    bind(ev) {
        ev.on('chats.upsert', (chats) => {
            for (const chat of chats) {
                const existing = this.chats.get(chat.id) || {};
                this.chats.set(chat.id, { ...existing, ...chat });
            }
        });

        ev.on('chats.update', (updates) => {
             for (const update of updates) {
                const existing = this.chats.get(update.id) || {};
                this.chats.set(update.id, { ...existing, ...update });
            }
        });

        ev.on('messages.upsert', ({ messages }) => {
            for (const msg of messages) {
                const jid = msg.key.remoteJid;
                if (!this.messages.has(jid)) {
                   this.messages.set(jid, []);
                }
                const list = this.messages.get(jid);
                
                // Deduplicate
                if (!list.find(m => m.key.id === msg.key.id)) {
                     list.push(msg);
                }

                // Update chat last message timestamp
                const chat = this.chats.get(jid) || { id: jid };
                chat.lastMessageRecvTimestamp = msg.messageTimestamp;
                chat.conversationTimestamp = msg.messageTimestamp; // Fix for sorting
                
                // Only increment unread if NOT from me
                if (!msg.key.fromMe) {
                    chat.unreadCount = (chat.unreadCount || 0) + 1;
                    if (jid.includes('153407742578775') || jid.includes('40737571397')) {
                         console.log(`[STORE] Incrementing unread for ${jid}. New count: ${chat.unreadCount}`);
                    }
                }
                
                this.chats.set(jid, chat);
                
                // Update contact pushName if available
                if (msg.pushName) {
                    const contact = this.contacts.get(jid) || { id: jid };
                    if (!contact.notify || msg.pushName !== contact.notify) {
                        contact.notify = msg.pushName;
                        this.contacts.set(jid, contact);
                    }
                }
            }
        });

        ev.on('contacts.upsert', (contacts) => {
            console.log(`Doing contacts.upsert for ${contacts.length} contacts`);
            for (const contact of contacts) {
                this.contacts.set(contact.id, Object.assign(this.contacts.get(contact.id) || {}, contact));
            }
        });

        ev.on('contacts.update', (updates) => {
            for (const update of updates) {
                if (update.imgUrl === 'changed') {
                    const contact = this.contacts.get(update.id);
                    if (contact) {
                        contact.imgUrl = update.imgUrl; // meaningful update
                    }
                } else {
                     Object.assign(this.contacts.get(update.id) || {}, update);
                }
            }
        });

        ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }) => {
            // Import Chats
            for (const chat of chats) {
                const existing = this.chats.get(chat.id) || {};
                this.chats.set(chat.id, { ...existing, ...chat });
            }

            // Import Contacts
            for (const contact of contacts) {
                 this.contacts.set(contact.id, Object.assign(this.contacts.get(contact.id) || {}, contact));
            }

            // Import Messages
            for (const msg of messages) {
                const jid = msg.key.remoteJid;
                if (!this.messages.has(jid)) {
                   this.messages.set(jid, []);
                }
                const list = this.messages.get(jid);
                if (!list.find(m => m.key.id === msg.key.id)) {
                     list.push(msg);
                }
            }
            this.logger.info(`Synced ${chats.length} chats, ${contacts.length} contacts and ${messages.length} messages`);
        });
    }

    // API-like methods
    getChats() {
        return Array.from(this.chats.values());
    }

    getMessages(jid) {
        return this.messages.get(jid) || [];
    }
    
    loadMessage(jid, id) {
        const list = this.messages.get(jid);
        if(list) return list.find(m => m.key.id === id);
        return null;
    }

    writeToFile(path) {
        try {
            const data = {
                chats: Array.from(this.chats.entries()),
                messages: Array.from(this.messages.entries()),
                contacts: Array.from(this.contacts.entries())
            };
            fs.writeFileSync(path, JSON.stringify(data));
        } catch(e) {
            console.error('Failed to write store', e);
        }
    }

    readFromFile(path) {
        try {
            if(fs.existsSync(path)) {
                const data = JSON.parse(fs.readFileSync(path));
                this.chats = new Map(data.chats);
                this.messages = new Map(data.messages);
                this.contacts = new Map(data.contacts);
                this.recoverContacts();
            }
        } catch(e) {
             console.error('Failed to read store', e);
        }
    }

    recoverContacts() {
        let recovered = 0;
        for (const [jid, messages] of this.messages) {
            for (const msg of messages) {
                if (msg.pushName) {
                    const contact = this.contacts.get(jid) || { id: jid };
                    if (!contact.notify || msg.pushName !== contact.notify) {
                        contact.notify = msg.pushName;
                        this.contacts.set(jid, contact);
                        recovered++;
                    }
                }
            }
        }
        if (recovered > 0) {
            this.logger.info(`Recovered ${recovered} contact names from message history`);
        }
    }
}

export function makeCustomStore() {
    return new CustomStore();
}
