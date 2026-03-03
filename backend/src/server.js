const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { initSessions } = require('./whatsapp/sessionManager');
const requireSupabaseAuth = require('./middleware/auth');
const requireApprovedEmployee = require('./middleware/requireApprovedEmployee');
const waAccountsParam = require('./routes/waAccounts');
const conversationsParam = require('./routes/conversations');
const employeesRoutes = require('./routes/employees');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors()); // Configure origin in production!
app.use(express.json());

// Public health check
app.get('/health', (req, res) => res.send('OK'));

// Protected API Routes
app.use('/api', requireSupabaseAuth);

// Modular Routes
app.use('/api/employees', employeesRoutes); // Auth required, Approval dependent on route (request vs others)
app.use('/api/wa-accounts', requireApprovedEmployee, waAccountsParam);
app.use('/api/conversations', requireApprovedEmployee, conversationsParam);

// Start Server
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    // Restore sessions
    await initSessions();
});
