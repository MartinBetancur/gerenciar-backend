const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const app = express();
const PORT = process.env.PORT || 5000;

// Dominios permitidos
const ALLOWED_ORIGINS = [
  'https://contactoempresarial.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
];

// Configuración CORS mejorada
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(null, true); // Permitimos todo por ahora en producción
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  credentials: true,
  maxAge: 86400 // Preflight válido por 24 horas
}));

// Middleware para responder rápidamente a OPTIONS (preflight)
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, X-Requested-With');
  res.header('Access-Control-Max-Age', '86400');
  res.status(204).end();
});

// Middleware para registrar solicitudes importantes solamente
app.use((req, res, next) => {
  if (req.path !== '/api/ping') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Origin: ${req.headers.origin || 'No origin'}`);
  }
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, X-Requested-With');
  next();
});

// Cache en memoria para los contactos
let contactsCache = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 60 * 1000; // 1 minuto de TTL para el cache

// Middleware para parsear JSON
app.use(bodyParser.json({ limit: '100kb' }));

// Ping endpoint más eficiente
app.get('/api/ping', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

// Ruta CORS test simplificada
app.get('/api/test-cors', (req, res) => {
  res.status(200).json({ status: 'ok', origin: req.headers.origin || 'none' });
});

// Constantes y rutas para el archivo CSV
const csvFilePath = path.join(__dirname, 'contactos.csv');
const csvHeaders = ['companyId', 'companyName', 'gpgName', 'timestamp', 'isContacted'];

// Asegurar que el archivo CSV existe con los encabezados correctos
function ensureCsvExists() {
  try {
    const directory = path.dirname(csvFilePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    if (!fs.existsSync(csvFilePath)) {
      const headerLine = stringify([csvHeaders]);
      fs.writeFileSync(csvFilePath, headerLine);
      return true;
    }
    
    const content = fs.readFileSync(csvFilePath, 'utf8').trim();
    if (!content) {
      const headerLine = stringify([csvHeaders]);
      fs.writeFileSync(csvFilePath, headerLine);
      return true;
    }

    return true;
  } catch (err) {
    console.error('Error asegurando archivo CSV:', err);
    return false;
  }
}

// Cargar contactos con mejor manejo de errores
function loadContactsFromCSV(force = false) {
  const now = Date.now();
  if (!force && contactsCache.length > 0 && (now - lastCacheUpdate) < CACHE_TTL) {
    return contactsCache;
  }
  
  try {
    ensureCsvExists();
    
    if (!fs.existsSync(csvFilePath)) {
      return [];
    }

    const fileContent = fs.readFileSync(csvFilePath, 'utf8').trim();
    if (!fileContent) {
      return [];
    }

    contactsCache = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      cast: (value, context) => {
        if (context.column === 'isContacted') {
          return value.toLowerCase() === 'true';
        }
        return value;
      }
    });
    
    lastCacheUpdate = now;
    return contactsCache;
  } catch (error) {
    console.error('Error leyendo CSV:', error);
    return [];
  }
}

// Precarga inicial
loadContactsFromCSV();

// Ruta GET optimizada
app.get('/api/contact/:companyId', (req, res) => {
  const { companyId } = req.params;

  // Validación del parámetro companyId
  if (!companyId || isNaN(companyId)) {
    return res.status(400).json({ error: 'ID de compañía inválido' });
  }

  try {
    const contacts = loadContactsFromCSV();
    let companyContact = null;

    for (let i = contacts.length - 1; i >= 0; i--) {
      const contact = contacts[i];
      if (contact.companyId === companyId.toString() && contact.isContacted) {
        companyContact = contact;
        break;
      }
    }

    if (companyContact) {
      return res.status(200).json({
        isContacted: true,
        gpgName: companyContact.gpgName
      });
    } else {
      return res.status(200).json({ isContacted: false });
    }
  } catch (error) {
    console.error('Error verificando contacto:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta POST optimizada
app.post('/api/contact', (req, res) => {
  const { companyId, companyName, gpgName } = req.body;
  
  if (!companyId) {
    return res.status(400).json({ error: 'Falta ID de empresa' });
  }
  
  if (!companyName) {
    return res.status(400).json({ error: 'Falta nombre de empresa' });
  }
  
  if (!gpgName) {
    return res.status(400).json({ error: 'Falta nombre de contacto' });
  }

  try {
    const contacts = loadContactsFromCSV();
    const existing = contacts.find(c => 
      c.companyId === companyId.toString() && c.isContacted
    );

    if (existing) {
      return res.status(200).json({
        message: 'Empresa ya contactada',
        isContacted: true,
        gpgName: existing.gpgName
      });
    }

    const timestamp = new Date().toISOString();
    const newRecord = {
      companyId: companyId.toString(),
      companyName,
      gpgName,
      timestamp,
      isContacted: true
    };

    contactsCache.push(newRecord);
    
    try {
      const recordForCsv = { ...newRecord, isContacted: 'true' };
      const line = stringify([recordForCsv], { header: false });
      fs.appendFileSync(csvFilePath, line);
    } catch (fsError) {
      console.error('Error guardando en CSV:', fsError);
    }

    return res.status(201).json({
      message: 'Contacto registrado',
      isContacted: true,
      gpgName
    });
  } catch (error) {
    console.error('Error guardando contacto:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta catch-all para 404
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Iniciar servidor
const server = app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
});

// Manejo de cierre del proceso
process.on('SIGTERM', () => {
  console.log('SIGTERM recibido, cerrando servidor...');
  server.close(() => {
    console.log('Servidor cerrado correctamente');
    process.exit(0);
  });
});
