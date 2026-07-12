// ============================================================
// CONFIGURAZIONE
// Cambia SERVER_URL con l'URL del tuo backend su Render dopo il deploy,
// es: 'https://nascondino-server.onrender.com'
// ============================================================
const CONFIG = {
  SERVER_URL: window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://TUO-BACKEND.onrender.com', // <-- SOSTITUISCI dopo il deploy su Render
};
