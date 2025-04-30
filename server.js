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

// Configuración CORS simplificada
app.use(cors({
  origin: function(origin, callback) {
    callback(null, true); // Permitir cualquier origen por ahora
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  credentials: true
}));

// Middleware para parsear JSON
app.use(bodyParser.json({ limit: '100kb' }));

// Middleware para registrar solicitudes
app.use((req, res, next) => {
  if (req.path !== '/api/ping') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Origin: ${req.headers.origin || 'No origin'}`);
  }
  next();
});

// Constantes y rutas para el archivo CSV
const DATA_DIR = process.env.NODE_ENV === 'production' ? '/tmp' : __dirname;
const csvFilePath = path.join(DATA_DIR, 'contactos.csv');
const csvHeaders = ['companyId', 'companyName', 'gpgName', 'timestamp', 'isContacted'];

// Cache en memoria para los contactos
let contactsCache = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 60 * 1000; // 1 minuto de TTL para el cache

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
      console.log(`Archivo CSV creado en: ${csvFilePath}`);
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
ensureCsvExists();
loadContactsFromCSV(true);

// Ruta raíz para health checks
app.get('/', (req, res) => {
  res.status(200).send('API funcionando correctamente');
});

// Ping endpoint
app.get('/api/ping', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: Date.now(),
    environment: process.env.NODE_ENV || 'development',
    backendUrl: process.env.BACKEND_URL || 'not set'
  });
});

// Ruta CORS test
app.get('/api/test-cors', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    origin: req.headers.origin || 'none',
    headers: req.headers
  });
});

// Ruta para obtener todos los contactos (solo para debug)
app.get('/api/contacts', (req, res) => {
  try {
    const contacts = loadContactsFromCSV();
    res.status(200).json({
      count: contacts.length,
      contacts: contacts
    });
  } catch (error) {
    console.error('Error obteniendo contactos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta GET para verificar contacto
app.get('/api/contact/:companyId', (req, res) => {
  const { companyId } = req.params;

  // Validación del parámetro companyId
  if (!companyId || isNaN(companyId)) {
    return res.status(400).json({ error: 'ID de compañía inválido' });
  }

  // Agregamos un pequeño delay para simular carga de red (útil solo en desarrollo)
  // const artificialDelay = process.env.NODE_ENV === 'development' ? 500 : 0;
  
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

    // setTimeout(() => {
      if (companyContact) {
        return res.status(200).json({
          isContacted: true,
          gpgName: companyContact.gpgName
        });
      } else {
        return res.status(200).json({ isContacted: false });
      }
    // }, artificialDelay);
  } catch (error) {
    console.error('Error verificando contacto:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta POST para registrar contacto
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
      console.log(`Contacto guardado en CSV: ${companyName} (ID: ${companyId})`);
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

// Endpoint para verificar el sistema de archivos
app.get('/api/debug/filesystem', (req, res) => {
  try {
    const csvExists = fs.existsSync(csvFilePath);
    const fileStats = csvExists ? fs.statSync(csvFilePath) : null;
    const fileSize = fileStats ? fileStats.size : 0;
    const fileContent = csvExists && fileSize > 0 ? 
      fs.readFileSync(csvFilePath, 'utf8').substring(0, 500) + '...' : 
      'No hay contenido';
    
    res.status(200).json({
      dataDirectory: DATA_DIR,
      csvPath: csvFilePath,
      csvExists,
      fileSize,
      sampleContent: fileContent,
      contactsInCache: contactsCache.length
    });
  } catch (error) {
    console.error('Error comprobando sistema de archivos:', error);
    res.status(500).json({ 
      error: 'Error verificando sistema de archivos',
      message: error.message,
      stack: error.stack
    });
  }
});

// Ruta catch-all para 404
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Iniciar servidor
const server = app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
  console.log(`Modo: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Archivo CSV: ${csvFilePath}`);
});

// Manejo de cierre del proceso
process.on('SIGTERM', () => {
  console.log('SIGTERM recibido, cerrando servidor...');
  server.close(() => {
    console.log('Servidor cerrado correctamente');
    process.exit(0);
  });
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  console.error('Error no capturado:', error);
  // No cerramos el servidor para mantenerlo funcionando
});