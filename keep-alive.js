const axios = require('axios');

// URL del servidor que queremos mantener activo
const SERVER_URL = 'https://gerenciar-backend-production-1e06.up.railway.app/api/ping';

// Intervalo en milisegundos (10 minutos)
const INTERVAL = 10 * 60 * 1000; 

// Función para hacer ping al servidor
async function pingServer() {
  try {
    const startTime = new Date();
    console.log(`[${startTime.toISOString()}] Enviando ping a ${SERVER_URL}`);
    
    const response = await axios.get(SERVER_URL, { timeout: 10000 });
    const endTime = new Date();
    const duration = endTime - startTime;
    
    console.log(`[${endTime.toISOString()}] Respuesta recibida en ${duration}ms: ${JSON.stringify(response.data)}`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error al hacer ping:`, error.message);
  }
}

// Ejecutar el ping inmediatamente y luego cada INTERVAL
pingServer();
setInterval(pingServer, INTERVAL);

console.log(`Script de keep-alive iniciado. Haciendo ping cada ${INTERVAL / 1000 / 60} minutos.`);