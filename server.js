// backend/server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const app = express();
const PORT = process.env.PORT || 5000;

// Lista de orígenes permitidos
const ALLOWED_ORIGINS = [
  'https://contactoempresarial.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
];

// CORS correctamente configurado
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false // Si no estás usando cookies o auth headers, mejor en false
}));

// Middleware de logs
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(bodyParser.json());

// === CSV logic ===
const csvFilePath = path.join(__dirname, 'contactos.csv');
const csvHeaders = ['companyId', 'companyName', 'gpgName', 'timestamp', 'isContacted'];
let contacts = [];

function ensureCsvExists() {
  const dir = path.dirname(csvFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(csvFilePath)) {
    const headerLine = stringify([csvHeaders]);
    fs.writeFileSync(csvFilePath, headerLine);
  }
}

function loadContactsFromCSV() {
  try {
    ensureCsvExists();
    const content = fs.readFileSync(csvFilePath, 'utf8').trim();
    if (!content) return [];
    contacts = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      cast: (value, ctx) => ctx.column === 'isContacted' ? value === 'true' : value
    });
    return contacts;
  } catch (e) {
    console.error('Error cargando CSV:', e);
    return [];
  }
}

loadContactsFromCSV();

// === Rutas ===
app.get('/api/ping', (req, res) => {
  res.status(200).json({ message: 'API activa', timestamp: new Date().toISOString() });
});

app.get('/api/contact/:companyId', (req, res) => {
  const { companyId } = req.params;
  const contact = contacts.find(c => c.companyId === companyId && c.isContacted);
  if (contact) {
    return res.json({ isContacted: true, gpgName: contact.gpgName });
  }
  return res.json({ isContacted: false });
});

app.post('/api/contact', (req, res) => {
  const { companyId, companyName, gpgName } = req.body;
  if (!companyId || !companyName || !gpgName) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  const exists = contacts.find(c => c.companyId === companyId && c.isContacted);
  if (exists) {
    return res.json({ message: 'Ya fue contactada', isContacted: true, gpgName: exists.gpgName });
  }

  const newRecord = {
    companyId,
    companyName,
    gpgName,
    timestamp: new Date().toISOString(),
    isContacted: true
  };

  contacts.push(newRecord);
  const recordCsv = { ...newRecord, isContacted: 'true' };
  fs.appendFileSync(csvFilePath, stringify([recordCsv], { header: false }));

  res.status(201).json({ message: 'Contacto registrado', isContacted: true, gpgName });
});

// Ruta catch-all
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// === Keep-alive para evitar suspensión (Railway free tier) ===
setInterval(() => {
  console.log(`[KEEP ALIVE] ${new Date().toISOString()}`);
  loadContactsFromCSV();
}, 5 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
