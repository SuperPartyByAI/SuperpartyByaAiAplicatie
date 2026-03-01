const express = require('express');
const router = express.Router();
const { db, FieldValue } = require('../firebase');
const { createSession } = require('../whatsapp/sessionManager');

// Create Account
router.post('/', async (req, res) => {
    try {
        const { label } = req.body;
        const newRef = db.collection('wa_accounts').doc();
        const accountId = newRef.id;

        await newRef.set({
            id: accountId,
            label: label || 'New Account',
            createdAt: FieldValue.serverTimestamp(),
            status: 'created',
            updatedAt: FieldValue.serverTimestamp()
        });

        // Trigger session creation (QR gen)
        createSession(accountId);

        res.json({ accountId, message: 'Account init started' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// Get Accounts
router.get('/', async (req, res) => {
    try {
        const snapshot = await db.collection('wa_accounts').orderBy('createdAt', 'desc').get();
        const accounts = snapshot.docs.map(doc => {
            const data = doc.data();
            // Convert timestamps if needed, or send as is
            return data;
        });
        res.json(accounts);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get QR (Optional if listening to Firestore)
router.get('/:id/qr', async (req, res) => {
    try {
        const doc = await db.collection('wa_accounts').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Not found' });
        
        const data = doc.data();
        res.json({ 
            qr: data.qrCode, 
            status: data.status, 
            updatedAt: data.updatedAt 
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Update Label/Color
router.patch('/:id', async (req, res) => {
    try {
        const { label, color } = req.body;
        await db.collection('wa_accounts').doc(req.params.id).update({
            label,
            color,
            updatedAt: FieldValue.serverTimestamp()
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
