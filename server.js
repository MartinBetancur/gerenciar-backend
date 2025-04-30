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

// CORS: restringe al dominio de tu frontend en Vercel
const FRONTEND_URL = process.env.FRONTEND_URL;
if (!FRONTEND_URL) {
  console.warn('⚠️  FRONTEND_URL no definido, CORS abierto a todos los orígenes');
}
app.use(cors({
  origin: FRONTEND_URL || '*'
}));

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

app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
  if (FRONTEND_URL) {
    console.log(`CORS habilitado para: ${FRONTEND_URL}`);
  }
});
