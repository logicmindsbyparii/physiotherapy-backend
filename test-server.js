const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Login endpoint (returns dummy token)
app.post('/api/auth/login', (req, res) => {
  console.log('Login called with:', req.body);
  res.json({ token: 'dummy-token-for-test', clinicId: 1 });
});

const PORT = 5000;
app.listen(PORT, () => console.log(`Test backend running on port ${PORT}`));