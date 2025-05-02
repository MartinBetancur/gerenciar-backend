// backend/server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync'); // Usaremos csv-parse para leer de forma más robusta
const { stringify } = require('csv-stringify/sync'); // Y csv-stringify para escribir

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// CSV Path
const csvFilePath = path.join(__dirname, 'contactos.csv'); // Mejor usar path.join
const csvHeaders = ['companyId', 'companyName', 'gpgName', 'timestamp', 'isContacted'];

// Ensure CSV file exists with headers
if (!fs.existsSync(csvFilePath)) {
  // Usa stringify para crear la línea de cabecera correctamente
  const headerLine = stringify([csvHeaders]);
  fs.writeFileSync(csvFilePath, headerLine);
  console.log('CSV file created with headers.');
} else {
   // Opcional: Verifica si la cabecera existe y es correcta, si no, la reescribe
   const content = fs.readFileSync(csvFilePath, 'utf8').trim();
   if (!content || !content.startsWith(csvHeaders.join(','))) {
     const headerLine = stringify([csvHeaders]);
     fs.writeFileSync(csvFilePath, headerLine);
     console.log('CSV file header corrected.');
   }
}


// Función auxiliar para leer los contactos del CSV de forma robusta
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

    // Usa csv-parse para manejar comillas, comas en campos, etc.
    const records = parse(fileContent, {
      columns: true, // Lee usando las cabeceras
      skip_empty_lines: true,
      trim: true,
      // Asegúrate que los tipos booleanos se interpreten correctamente
      cast: (value, context) => {
         if (context.column === 'isContacted') {
            // Convierte 'true' (string) a true (boolean)
            return value.toLowerCase() === 'true';
         }
         return value; // Devuelve otros valores como string
      }
    });
    
    console.log(`Read ${records.length} records from CSV.`);
    return records; // records es ahora un array de objetos [{companyId: '1', ...}, {...}]

  } catch (error) {
    console.error('Error reading or parsing CSV:', error);
    return []; // Devuelve array vacío en caso de error
  }
}

// Ruta para verificar si una empresa ha sido contactada (MODIFICADA)
app.get('/api/contact/:companyId', (req, res) => {
  const { companyId } = req.params;
  
  try {
    const contacts = readContactsFromCSV();
    
    // Buscar el ÚLTIMO registro para esta companyId
    // Iteramos al revés para encontrar la entrada más reciente primero
    let companyContact = null;
    for (let i = contacts.length - 1; i >= 0; i--) {
        if (contacts[i].companyId === companyId.toString() && contacts[i].isContacted === true) {
            companyContact = contacts[i];
            break; // Encontramos el más reciente que fue contactado
        }
    }
    
    if (companyContact) {
      // ¡Importante! Asegurarse que isContacted sea booleano en la respuesta JSON
      console.log(`Company ${companyId} WAS contacted by: ${companyContact.gpgName}`);
      return res.status(200).json({ 
        isContacted: true, // Enviar booleano
        gpgName: companyContact.gpgName 
      });
    } else {
      console.log(`Company ${companyId} has NOT been contacted yet or no record marked as true.`);
      return res.status(200).json({ isContacted: false }); // Enviar booleano
    }
  } catch (error) {
    console.error('Error checking contact status:', error);
    res.status(500).json({ error: 'Error interno del servidor al verificar contacto' });
  }
});


// Ruta para registrar un contacto (MODIFICADA para evitar duplicados)
app.post('/api/contact', async (req, res) => {
  const { companyId, companyName, gpgName } = req.body;

  if (!companyId || !companyName || !gpgName) {
    return res.status(400).json({ error: 'Faltan datos (companyId, companyName, gpgName)' });
  }

  try {
    const contacts = readContactsFromCSV(); // Leer estado actual

    // Verificar si ya existe un contacto MARCADO COMO TRUE para esta empresa
    const existingContact = contacts.find(contact => 
        contact.companyId === companyId.toString() && contact.isContacted === true 
    );

    if (existingContact) {
      console.log(`Company ${companyId} already marked as contacted by ${existingContact.gpgName}. No new entry added.`);
      // Devolver que ya está contactado, opcionalmente con el nombre
      return res.status(200).json({ 
          message: 'La empresa ya fue contactada previamente.',
          isContacted: true,
          gpgName: existingContact.gpgName
      });
    }

    // Si no existe o no está marcado como true, procedemos a añadirlo
    const timestamp = new Date().toISOString();
    const newRecord = { 
      companyId: companyId.toString(), 
      companyName, 
      gpgName, 
      timestamp, 
      isContacted: 'true' // Escribimos 'true' como string en el CSV
    };

    // Usa csv-stringify para añadir la nueva línea de forma segura
    // El modo 'a' (append) asegura que se añade al final
    const csvString = stringify([newRecord], { header: false }); // No añadir cabecera aquí
    fs.appendFileSync(csvFilePath, csvString); // appendFileSync es síncrono y más simple aquí

    console.log(`Contact registered for company ${companyId} by ${gpgName}`);
    res.status(201).json({ // 201 Created es más apropiado
        message: 'Contacto registrado exitosamente',
        isContacted: true, // Confirmamos el estado
        gpgName: gpgName 
    });

  } catch (error) {
    console.error('Error saving contact:', error);
    res.status(500).json({ error: 'Error interno del servidor al guardar contacto' });
  }
});

// Arrancamos el server
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});