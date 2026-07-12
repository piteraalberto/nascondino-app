// ============================================================
// UTILITY CLIENT: identità persistente, wake lock, geolocalizzazione
// ============================================================

/**
 * Genera (o recupera) un token client persistente salvato in localStorage.
 * Questo è ciò che permette al giocatore di "restare se stesso" anche se
 * il browser si ricarica o il telefono va in sleep e si riapre: il server
 * lo riconosce tramite questo token invece di creare un giocatore nuovo.
 */
function getOrCreateClientToken() {
  let token = localStorage.getItem('nascondino_client_token');
  if (!token) {
    token = 'ct_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('nascondino_client_token', token);
  }
  return token;
}

/**
 * Wake Lock API: tiene lo schermo acceso finché la scheda è visibile.
 * È la mitigazione principale al problema "GPS si ferma se lo schermo si spegne"
 * di cui abbiamo parlato in fase di progettazione. Funziona su Chrome Android
 * e Safari iOS 16.4+; se non supportata, fallisce silenziosamente e l'app
 * mostra comunque il promemoria periodico lato server.
 */
const WakeLockManager = {
  lock: null,

  async request(indicatorElementId) {
    const indicator = document.getElementById(indicatorElementId);
    try {
      if ('wakeLock' in navigator) {
        this.lock = await navigator.wakeLock.request('screen');
        if (indicator) {
          indicator.className = 'wake-lock-indicator active';
        }
        this.lock.addEventListener('release', () => {
          if (indicator) indicator.className = 'wake-lock-indicator inactive';
        });
      } else if (indicator) {
        indicator.className = 'wake-lock-indicator inactive';
      }
    } catch (err) {
      // Su alcuni browser/situazioni (batteria bassa, tab non attiva) la richiesta fallisce.
      // Non è un errore bloccante: l'app continua a funzionare, semplicemente lo schermo
      // potrebbe spegnersi e l'utente dovrà riaprire l'app quando arriva il promemoria.
      console.warn('Wake lock non disponibile:', err.message);
      if (indicator) indicator.className = 'wake-lock-indicator inactive';
    }
  },

  async release() {
    if (this.lock) {
      await this.lock.release();
      this.lock = null;
    }
  },

  // Ri-richiede il wake lock quando la pagina torna visibile (es. utente riapre l'app),
  // dato che il lock si rilascia automaticamente quando la tab va in background.
  setupAutoReacquire(indicatorElementId) {
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        await this.request(indicatorElementId);
      }
    });
  },
};

/**
 * Ottiene la posizione GPS corrente del dispositivo (funziona sia su iPhone
 * che Android tramite la Geolocation API standard del browser, gratuita,
 * nessuna chiave richiesta). Richiede il permesso di localizzazione al primo uso.
 */
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error('Geolocalizzazione non supportata su questo dispositivo'));
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

/**
 * Avvia l'invio periodico della posizione al server ogni `intervalSeconds`.
 * Ritorna una funzione per fermare l'invio (da chiamare a fine round/fase).
 */
function startPositionReporting(socket, intervalSeconds) {
  async function sendPosition() {
    try {
      const pos = await getCurrentPosition();
      socket.emit('update_position', pos);
    } catch (err) {
      console.warn('Impossibile ottenere la posizione:', err.message);
    }
  }

  sendPosition(); // invio immediato all'avvio, poi a intervalli
  const intervalId = setInterval(sendPosition, intervalSeconds * 1000);
  return () => clearInterval(intervalId);
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'danger' ? 'toast-danger' : type === 'success' ? 'toast-success' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
