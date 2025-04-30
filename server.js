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

// CORS: configuración mejorada
const FRONTEND_URL = process.env.FRONTEND_URL;
console.log('Frontend URL configurado:', FRONTEND_URL || 'No definido, usando CORS abierto');

// Configuración de CORS más permisiva para desarrollo
app.use(cors({
  origin: function(origin, callback) {
    // Permitir solicitudes sin origen (como herramientas de API)
    if (!origin) return callback(null, true);
    
    // Si tenemos un FRONTEND_URL configurado, verificamos
    if (FRONTEND_URL) {
      // Permitir el origen configurado y localhost para desarrollo
      const allowedOrigins = [
        FRONTEND_URL,
        'http://localhost:3000',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173'
      ];
      
      if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
        callback(null, true);
      } else {
        console.warn(`Origen bloqueado por CORS: ${origin}`);
        callback(null, false);
      }
    } else {
      // Si no hay FRONTEND_URL, permitimos cualquier origen
      callback(null, true);
    }
  },
  credentials: true, // Permitir cookies en solicitudes cross-origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
}));

// Middleware para registrar todas las solicitudes
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Origin: ${req.headers.origin || 'No origin'}`);
  next();
});

app.use(bodyParser.json());

// CSV Path
const csvFilePath = path.join(__dirname, 'contactos.csv');
const csvHeaders = ['companyId', 'companyName', 'gpgName', 'timestamp', 'isContacted'];

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

function readContactsFromCSV() {
  try {
    if (!fs.existsSync(csvFilePath)) {
      console.log('CSV file does not exist.');
      return [];
    }

    const fileContent = fs.readFileSync(csvFilePath, 'utf8').trim();
    if (!fileContent) {
      console.log('CSV file is empty.');
      return [];
    }

    return parse(fileContent, {
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
  } catch (error) {
    console.error('Error reading or parsing CSV:', error);
    return [];
  }
}

// Ruta de prueba para verificar que el servidor está funcionando
app.get('/api/ping', (req, res) => {
  res.status(200).json({ message: 'API funcionando correctamente', timestamp: new Date().toISOString() });
});

app.get('/api/contact/:companyId', (req, res) => {
  const { companyId } = req.params;

  try {
    const contacts = readContactsFromCSV();
    let companyContact = null;

    for (let i = contacts.length - 1; i >= 0; i--) {
      if (contacts[i].companyId === companyId.toString() && contacts[i].isContacted) {
        companyContact = contacts[i];
        break;
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
    const contacts = readContactsFromCSV();
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
      isContacted: 'true'
    };

    const line = stringify([newRecord], { header: false });
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

app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
  if (FRONTEND_URL) {
    console.log(`CORS habilitado para: ${FRONTEND_URL}`);
  } else {
    console.log('CORS habilitado para todos los orígenes (modo desarrollo)');
  }
});