const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const app = express();
const PORT = process.env.PORT || 5000;

// Configurar CORS según entorno
const allowedOrigin = process.env.NODE_ENV === 'production'
  ? process.env.FRONTEND_URL || 'https://contactoempresarial.vercel.app'
  : 'http://localhost:3000';

app.use(cors({
  origin: allowedOrigin
}));

app.use(bodyParser.json());

// CSV Path
const csvFilePath = path.join(__dirname, 'contactos.csv');
const csvHeaders = ['companyId', 'companyName', 'gpgName', 'timestamp', 'isContacted'];

// Ensure CSV exists
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

// Read contacts helper
function readContactsFromCSV() {
  try {
    if (!fs.existsSync(csvFilePath)) return [];

    const fileContent = fs.readFileSync(csvFilePath, 'utf8').trim();
    if (!fileContent) return [];

    const records = parse(fileContent, {
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
    return records;

  } catch (error) {
    console.error('Error reading CSV:', error);
    return [];
  }
}

// API - Get contact status
app.get('/api/contact/:companyId', (req, res) => {
  const { companyId } = req.params;
  
  try {
    const contacts = readContactsFromCSV();
    let companyContact = null;

    for (let i = contacts.length - 1; i >= 0; i--) {
      if (contacts[i].companyId === companyId.toString() && contacts[i].isContacted === true) {
        companyContact = contacts[i];
        break;
      }
    }

    if (companyContact) {
      console.log(`Company ${companyId} was contacted by ${companyContact.gpgName}`);
      res.json({
        message: 'Company already contacted',
        isContacted: true,
        gpgName: companyContact.gpgName
      });
    } else {
      console.log(`Company ${companyId} was NOT contacted`);
      res.json({
        message: 'Company not contacted yet',
        isContacted: false
      });
    }

  } catch (error) {
    console.error('Error fetching contact:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API - Register contact
app.post('/api/contact', (req, res) => {
  const { companyId, companyName, gpgName } = req.body;

  if (!companyId || !companyName || !gpgName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const newContact = {
    companyId: companyId.toString(),
    companyName,
    gpgName,
    timestamp: new Date().toISOString(),
    isContacted: true
  };

  try {
    const contacts = readContactsFromCSV();
    contacts.push(newContact);

    const csvContent = stringify(contacts, { header: true, columns: csvHeaders });
    fs.writeFileSync(csvFilePath, csvContent);

    console.log(`Registered contact for company ${companyId} by ${gpgName}`);

    res.json({
      message: 'Contact registered successfully',
      isContacted: true,
      gpgName: gpgName
    });

  } catch (error) {
    console.error('Error saving contact:', error);
    res.status(500).json({ error: 'Failed to save contact' });
  }
});

// Server start
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
