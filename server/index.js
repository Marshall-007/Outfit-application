require('dotenv').config();
const path = require('path');
const express = require('express');

const tryonRouter = require('./routes/tryon');
const suggestRouter = require('./routes/suggest');

const app = express();
const PORT = process.env.PORT || 3000;

// Base64 images are large: a downscaled user photo (~250KB) + closet items must fit.
app.use(express.json({ limit: '25mb' }));

// CORS for /api/* and /mirror.js — the widget runs on the host site's origin
// (any retailer's domain) and fetches back to this server. No cookies are used
// anywhere, so a wildcard origin is safe for this POC.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// The widget — a single self-contained file, embedded by host pages via
// <script src="http://<this-server>/mirror.js" defer></script>
app.get('/mirror.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, '..', 'widget', 'mirror.js'));
});

app.get('/api/health', (req, res) => {
  const provider = require('./providers');
  res.json({ ok: true, provider: provider.name, demoMode: process.env.DEMO_MODE === 'true' });
});

app.use('/api/tryon', tryonRouter);
app.use('/api/suggest', suggestRouter);

// Static assets (catalog images, canned demo results) and the demo store.
app.use('/assets', express.static(path.join(__dirname, '..', 'public')));
app.use('/', express.static(path.join(__dirname, '..', 'store')));

app.listen(PORT, () => {
  const provider = require('./providers');
  console.log(`Mirror server on http://localhost:${PORT} — provider: ${provider.name}`);
});
