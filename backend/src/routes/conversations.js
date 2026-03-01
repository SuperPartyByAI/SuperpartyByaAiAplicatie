const express = require('express');
const router = express.Router();
const { db, FieldValue } = require('../supabase');
const { getSessionSocket } = require('../whatsapp/sessionManager');

// List Conversations
router.get('/', async (req, res) => {
    try {
        // Basic listing - ideally pagination needed
        const snapshot = await db.collection('conversations')
            .orderBy('lastMessageAt', 'desc')
            .limit(50)
            .get();
        
        const conversations = snapshot.docs.map(doc => doc.data());
        res.json(conversations);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// Get Messages
router.get('/:id/messages', async (req, res) => {
    try {
        const snapshot = await db.collection('conversations').doc(req.params.id)
            .collection('messages')
            .orderBy('timestamp', 'asc') // or desc for pagination
            .limit(100)
            .get();
            
        const messages = snapshot.docs.map(doc => doc.data());
        res.json(messages);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Send Message
router.post('/:id/messages', async (req, res) => {
    const conversationId = req.params.id;
    const { text } = req.body;
    const employeeId = req.user.uid; // From Auth Middleware

    if (!text) return res.status(400).json({ error: 'Text required' });

    try {
        const convRef = db.collection('conversations').doc(conversationId);

        // 1. Transaction: Auto-Assign
        await db.runTransaction(async (t) => {
            const convDoc = await t.get(convRef);
            if (!convDoc.exists) throw new Error('Conversation not found');

            const data = convDoc.data();
            
            // Logic: If null, assign. If set, check owner.
            if (!data.assignedEmployeeId) {
                t.update(convRef, { 
                    assignedEmployeeId: employeeId,
                    assignedAt: FieldValue.serverTimestamp()
                });
            } else if (data.assignedEmployeeId !== employeeId) {
                // Determine if we allow "override" or just strict.
                // Requirement: "DOAR assignedEmployeeId poate trimite messages"
                // But also: "POST /api/conversations/:id/assign (manual override)" implies strictly only assignee.
                throw new Error('FORBIDDEN_NOT_ASSIGNED');
            }
        });

        // 2. Retrieve Account/Client Details
        // We need accountId and clientId to send via Baileys. 
        // We can get them from conversation doc (read again or optimized above)
        // Let's read it (outside transaction for simplicity/speed)
        const doc = await convRef.get();
        const { accountId, clientId } = doc.data();

        const sock = getSessionSocket(accountId);
        if (!sock) throw new Error('WhatsApp session not connected');

        // 3. Send via Baileys
        const sentMsg = await sock.sendMessage(clientId, { text });
        
        // 4. Save Outbound Message
        const messagesRef = convRef.collection('messages').doc(); // Auto-ID or use wa ID?
        // Using Database Auto-ID for our internal record, store WA ID inside
        await messagesRef.set({
            direction: 'outbound',
            text,
            accountId,
            clientId,
            employeeId,
            timestamp: FieldValue.serverTimestamp(),
            waMessageId: sentMsg.key.id || null
        });

        // Update Conversation Last Message
        await convRef.update({
            lastMessageAt: FieldValue.serverTimestamp(),
            lastMessagePreview: text.slice(0, 200)
        });

        res.json({ success: true, messageId: messagesRef.id });

    } catch (e) {
        console.error(e);
        if (e.message === 'FORBIDDEN_NOT_ASSIGNED') {
            return res.status(403).json({ error: 'Conversation reserved by another employee' });
        }
        res.status(500).json({ error: e.message });
    }
});

// Manual Assign
router.post('/:id/assign', async (req, res) => {
    const { employeeId } = req.body; 
    const targetId = employeeId || req.user.uid;

    try {
        // Admin Check
        const isAdmin = req.user.admin === true; // or check DB role
        // Ideally checking 'role' from token claims which we set in requireApprovedEmployee
        const isWhitelisted = (process.env.ADMIN_UIDS || '').includes(req.user.uid) || req.user.role === 'admin';

        if (!isWhitelisted) {
            return res.status(403).json({ error: 'Forbidden: Admins only' });
        }

        await db.collection('conversations').doc(req.params.id).update({
            assignedEmployeeId: targetId,
            assignedAt: FieldValue.serverTimestamp()
        });
        res.json({ success: true, assignedTo: targetId });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Self-Reserve (Employee)
router.post('/:id/reserve', async (req, res) => {
    const conversationId = req.params.id;
    const employeeId = req.user.uid;

    try {
        const convRef = db.collection('conversations').doc(conversationId);

        await db.runTransaction(async (t) => {
            const doc = await t.get(convRef);
            if (!doc.exists) throw new Error('NOT_FOUND');
            
            const data = doc.data();
            
            // If already assigned to ME, success (idempotent)
            if (data.assignedEmployeeId === employeeId) {
                return;
            }

            // If assigned to SOMEONE ELSE, error
            if (data.assignedEmployeeId) {
                throw new Error('ALREADY_ASSIGNED');
            }

            // If NULL, assign to ME
            t.update(convRef, {
                assignedEmployeeId: employeeId,
                assignedAt: FieldValue.serverTimestamp(),
                assignedEmployeeName: req.user.name || req.user.email // Optional helpful info
            });
        });

        res.json({ success: true, assignedTo: employeeId });
    } catch (e) {
        if (e.message === 'ALREADY_ASSIGNED') {
            return res.status(409).json({ error: 'Conversation already reserved by another employee' });
        }
        res.status(500).json({ error: e.message });
    }
});

// Unassign (Release)
router.post('/:id/unassign', async (req, res) => {
    const conversationId = req.params.id;
    const employeeId = req.user.uid;

    try {
        const convRef = db.collection('conversations').doc(conversationId);
        
        await db.runTransaction(async (t) => {
            const doc = await t.get(convRef);
            if (!doc.exists) throw new Error('NOT_FOUND');
            
            const data = doc.data();
            
            // Only Assignee or Admin can unassign
            // We'll check Admin role again roughly or rely on strict Assignee check
            const isAdmin = req.user.role === 'admin' || (process.env.ADMIN_UIDS || '').includes(employeeId);

            if (data.assignedEmployeeId !== employeeId && !isAdmin) {
                throw new Error('FORBIDDEN');
            }

            t.update(convRef, {
                assignedEmployeeId: null,
                unassignedAt: FieldValue.serverTimestamp()
            });
        });

        res.json({ success: true });
    } catch (e) {
        if (e.message === 'FORBIDDEN') {
            return res.status(403).json({ error: 'You can only unassign conversations reserved by you.' });
        }
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
