const express = require('express');
const router = express.Router();
const { db, auth, FieldValue } = require('../supabase');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim());

// Helper: Check if current user is admin
const isCallerAdmin = (req) => {
    const { email, uid, role } = req.user;
    return (role === 'admin') || ADMIN_EMAILS.includes(email); // || ADMIN_UIDS.includes(uid)
};

// GET /me - Check my status
router.get('/me', async (req, res) => {
    try {
        const { uid, email } = req.user;
        
        // Parallel fetch for speed
        const [empDoc, reqDoc] = await Promise.all([
            db.collection('employees').doc(uid).get(),
            db.collection('employee_requests').doc(uid).get()
        ]);

        let status = 'new';
        let role = 'guest';
        let approved = false;

        if (empDoc.exists) {
            const data = empDoc.data();
            approved = data.approved === true;
            role = data.role;
            status = approved ? 'approved' : 'suspended'; 
        } else if (reqDoc.exists) {
            const data = reqDoc.data();
            status = data.status; // pending, rejected
        }

        res.json({ uid, email, approved, role, status });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /request - Request access
router.post('/request', async (req, res) => {
    try {
        const { uid, email } = req.user;
        const { displayName, phone } = req.body;

        if (!displayName || !phone) {
            return res.status(400).json({ error: 'Missing fields: displayName, phone' });
        }

        // Check if already exists
        const empDoc = await db.collection('employees').doc(uid).get();
        if (empDoc.exists && empDoc.data().approved) {
            return res.json({ success: true, status: 'approved', message: 'Already approved' });
        }

        await db.collection('employee_requests').doc(uid).set({
            uid,
            email,
            displayName,
            phone,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp(), // Only set if new? merge will update it. careful.
            // Let's use merge but preserve createdAt if exists
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        
        // Ensure createdAt is there if it was missing (merge doesn't solve "insert if missing" for field specifically easily without logic, but okay for now)
        // Better:
        // await db.collection('employee_requests').doc(uid).set({ ... }, { merge: true }); 
        
        res.json({ success: true, status: 'pending' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// Admin Middleware for below routes
const requireAdmin = (req, res, next) => {
    if (!isCallerAdmin(req)) {
        return res.status(403).json({ error: 'Forbidden: Admin only' });
    }
    next();
};

// GET /requests - List pending (Admin only)
router.get('/requests', requireAdmin, async (req, res) => {
    try {
        const snapshot = await db.collection('employee_requests')
            .where('status', '==', 'pending')
            .orderBy('createdAt', 'desc')
            .get();
        
        const requests = snapshot.docs.map(doc => doc.data());
        res.json(requests);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /:uid/approve - Approve user (Admin only)
router.post('/:uid/approve', requireAdmin, async (req, res) => {
    try {
        const targetUid = req.params.uid;
        const adminEmail = req.user.email;

        // 1. Get request data
        const reqDoc = await db.collection('employee_requests').doc(targetUid).get();
        if (!reqDoc.exists) return res.status(404).json({ error: 'Request not found' });
        const requestData = reqDoc.data();

        // 2. Create Employee Profile
        const employeeData = {
            uid: targetUid,
            email: requestData.email,
            displayName: requestData.displayName,
            phone: requestData.phone,
            role: 'employee',
            approved: true,
            approvedAt: FieldValue.serverTimestamp(),
            approvedBy: adminEmail
        };

        await db.collection('employees').doc(targetUid).set(employeeData);

        // 3. Update Request Status
        await db.collection('employee_requests').doc(targetUid).update({
            status: 'approved',
            decidedAt: FieldValue.serverTimestamp(),
            decidedBy: adminEmail
        });

        // 4. Set Custom Claims (Crucial for performance/security)
        await auth.setCustomUserClaims(targetUid, { approved: true, role: 'employee' });

        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// POST /:uid/reject - Reject user (Admin only)
router.post('/:uid/reject', requireAdmin, async (req, res) => {
    try {
        const targetUid = req.params.uid;
        const adminEmail = req.user.email;

        await db.collection('employee_requests').doc(targetUid).update({
            status: 'rejected',
            decidedAt: FieldValue.serverTimestamp(),
            decidedBy: adminEmail
        });

        // Ensure no access
        await db.collection('employees').doc(targetUid).delete();
        await auth.setCustomUserClaims(targetUid, { approved: false });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
