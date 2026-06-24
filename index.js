const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Routes
// We will define these shortly
// const servicesRouter = require('./routes/services');
// const appointmentsRouter = require('./routes/appointments');
// const leadsRouter = require('./routes/leads');

app.get('/api/health', (req, res) => {
  res.json({ status: 'success', message: 'Backend is running correctly' });
});

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});
