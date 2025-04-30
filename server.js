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

// Keep-alive para mantener el servidor activo
let keepAliveInterval;
const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutos

// Configuración CORS simplificada pero efectiva
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://contactoempresarial.vercel.app';
console.log('Frontend URL configurado:', FRONTEND_URL);

// Middleware para registrar todas las solicitudes
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Origin: ${req.headers.origin || 'No origin'}`);
  next();
});

// Configuración CORS simplificada
app.use(cors({
  origin: '*', // Permite cualquier origen
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
}));

// Middleware adicional para forzar los encabezados CORS en cada respuesta
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  
  // Manejo específico para OPTIONS (preflight request)
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Middleware para responder rápidamente a las solicitudes de ping
app.get('/api/ping', (req, res) => {
  res.status(200).json({ message: 'API funcionando correctamente', timestamp: new Date().toISOString() });
});

app.use(bodyParser.json());

// Función para cargar el archivo CSV en memoria
let contacts = [];
const csvFilePath = path.join(__dirname, 'contactos.csv');
const csvHeaders = ['companyId', 'companyName', 'gpgName', 'timestamp', 'isContacted'];

function ensureCsvExists() {
  // Ensure CSV file exists with headers
  if (!fs.existsSync(csvFilePath)) {
    const headerLine = stringify([csvHeaders]);
    fs.writeFileSync(csvFilePath, headerLine);
    console.log('CSV file created with headers.');
  } else {
    const content = fs.readFileSync(csvFilePath, 'utf8').trim();
    if (!content || !content.startsWith(csvHeaders.join(','))) {
      const headerLine = stringify([csvHeaders]);
      fs.writeFileSync(csvFilePath, headerLine);
      console.log('CSV file header corrected.');
    }
  }
}

function loadContactsFromCSV() {
  try {
    ensureCsvExists();
    
    if (!fs.existsSync(csvFilePath)) {
      console.log('CSV file does not exist after creation attempt.');
      return [];
    }

    const fileContent = fs.readFileSync(csvFilePath, 'utf8').trim();
    if (!fileContent) {
      console.log('CSV file is empty.');
      return [];
    }

    contacts = parse(fileContent, {
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
    
    console.log(`Loaded ${contacts.length} contacts from CSV.`);
    return contacts;
  } catch (error) {
    console.error('Error reading or parsing CSV:', error);
    return [];
  }
}

// Precarga contactos al inicializar
loadContactsFromCSV();

app.get('/api/contact/:companyId', (req, res) => {
  const { companyId } = req.params;

  try {
    // Buscamos en la memoria primero
    let companyContact = null;
    for (let i = contacts.length - 1; i >= 0; i--) {
      if (contacts[i].companyId === companyId.toString() && contacts[i].isContacted) {
        companyContact = contacts[i];
        break;
      }
    }

    // Si no lo encontramos en memoria, cargamos de nuevo del archivo
    if (!companyContact) {
      // Intentamos una sola vez recargar del archivo
      loadContactsFromCSV();
      
      // Buscamos nuevamente
      for (let i = contacts.length - 1; i >= 0; i--) {
        if (contacts[i].companyId === companyId.toString() && contacts[i].isContacted) {
          companyContact = contacts[i];
          break;
        }
      }
    }

    if (companyContact) {
      console.log(`Company ${companyId} WAS contacted by: ${companyContact.gpgName}`);
      return res.status(200).json({
        isContacted: true,
        gpgName: companyContact.gpgName
      });
    } else {
      console.log(`Company ${companyId} has NOT been contacted yet.`);
      return res.status(200).json({ isContacted: false });
    }
  } catch (error) {
    console.error('Error checking contact status:', error);
    return res.status(500).json({ error: 'Error interno del servidor al verificar contacto' });
  }
});

app.post('/api/contact', (req, res) => {
  const { companyId, companyName, gpgName } = req.body;
  
  console.log('Datos recibidos en POST /api/contact:', { companyId, companyName, gpgName });

  if (!companyId || !companyName || !gpgName) {
    return res.status(400).json({ error: 'Faltan datos (companyId, companyName, gpgName)' });
  }

  try {
    // Verificar si ya existe en memoria
    const existing = contacts.find(c =>
      c.companyId === companyId.toString() && c.isContacted
    );

    if (existing) {
      console.log(`Company ${companyId} already contacted by ${existing.gpgName}.`);
      return res.status(200).json({
        message: 'La empresa ya fue contactada previamente.',
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
      isContacted: true  // En memoria guardamos como boolean
    };

    // Agregamos al array en memoria
    contacts.push(newRecord);

    // Y guardamos en disco
    const recordForCsv = {
      ...newRecord,
      isContacted: 'true'  // En CSV guardamos como string
    };
    
    const line = stringify([recordForCsv], { header: false });
    fs.appendFileSync(csvFilePath, line);

    console.log(`Contact registered for company ${companyId} by ${gpgName}`);
    return res.status(201).json({
      message: 'Contacto registrado exitosamente',
      isContacted: true,
      gpgName
    });

  } catch (error) {
    console.error('Error saving contact:', error);
    return res.status(500).json({ error: 'Error interno del servidor al guardar contacto' });
  }
});

// Ruta catch-all para mostrar un error amigable
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    message: 'La ruta solicitada no existe en esta API'
  });
});

// Función para mantener vivo el servidor
function keepAlive() {
  console.log(`[${new Date().toISOString()}] Ejecutando keep-alive...`);
  try {
    // Operación básica para mantener activo el proceso
    loadContactsFromCSV();
  } catch (error) {
    console.error('Error en keep-alive:', error);
  }
}

// Iniciar el servidor y el keep-alive
const server = app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
  console.log(`CORS habilitado para todos los orígenes`);
  
  // Iniciar el intervalo de keep-alive
  keepAliveInterval = setInterval(keepAlive, KEEP_ALIVE_INTERVAL);
  console.log(`Keep-alive configurado para ejecutarse cada ${KEEP_ALIVE_INTERVAL / 1000 / 60} minutos`);
});

// Manejar la terminación del proceso
process.on('SIGTERM', () => {
  console.log('SIGTERM recibido, cerrando servidor...');
  clearInterval(keepAliveInterval);
  server.close(() => {
    console.log('Servidor cerrado correctamente');
    process.exit(0);
  });
});