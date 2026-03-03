const { db } = require('../supabase');

const requireApprovedEmployee = async (req, res, next) => {
  try {
    const user = req.user; // Set by requireSupabaseAuth

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 1. Check Custom Claims (Fastest)
    if (user.approved === true) {
      return next();
    }

    // 2. Check Database (Fallback/Source of Truth)
    const employeeDoc = await db.collection('employees').doc(user.uid).get();

    if (!employeeDoc.exists) {
        return res.status(403).json({ error: 'PENDING_APPROVAL', message: 'Account not found or not approved.' });
    }

    const data = employeeDoc.data();

    if (data.approved === true) {
      // Attach role and details to request for downstream use
      req.user.role = data.role;
      req.user.approved = true;
      next();
    } else {
      return res.status(403).json({ error: 'PENDING_APPROVAL', message: 'Your account is pending approval.' });
    }

  } catch (error) {
    console.error('Approval Check Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

module.exports = requireApprovedEmployee;
