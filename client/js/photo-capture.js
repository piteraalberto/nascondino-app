// ============================================================
// SCATTO FOTO PER CATTURA
// ============================================================

let cameraStream = null;

async function startCameraPreview() {
  const video = document.getElementById('camera-preview');
  const photoButtons = document.getElementById('photo-buttons');
  const confirmButtons = document.getElementById('photo-confirm-buttons');
  const preview = document.getElementById('photo-preview');

  video.style.display = 'block';
  preview.style.display = 'none';
  photoButtons.style.display = 'flex';
  confirmButtons.style.display = 'none';

  try {
    // facingMode 'environment' = fotocamera posteriore, quella giusta per fotografare
    // qualcun altro invece del selfie. Funziona sia su iPhone che Android tramite
    // la MediaDevices API standard del browser, gratuita e senza chiavi.
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    video.srcObject = cameraStream;
  } catch (err) {
    showToast('Impossibile accedere alla fotocamera: ' + err.message, 'danger');
  }

  setupPhotoButtons();
}

function setupPhotoButtons() {
  const takeBtn = document.getElementById('btn-take-photo');
  const retakeBtn = document.getElementById('btn-retake-photo');
  const sendBtn = document.getElementById('btn-send-photo');
  const cancelBtn = document.getElementById('btn-cancel-photo');

  // Rimuove listener precedenti clonando i nodi (evita accumulo su rientri multipli)
  [takeBtn, retakeBtn, sendBtn, cancelBtn].forEach((btn) => {
    const clone = btn.cloneNode(true);
    btn.replaceWith(clone);
  });

  document.getElementById('btn-take-photo').addEventListener('click', capturePhotoFrame);
  document.getElementById('btn-retake-photo').addEventListener('click', startCameraPreview);
  document.getElementById('btn-send-photo').addEventListener('click', sendCapturePhoto);
  document.getElementById('btn-cancel-photo').addEventListener('click', () => {
    stopCameraStream();
    Router.show('screen-hunting-seeker');
  });
}

function capturePhotoFrame() {
  const video = document.getElementById('camera-preview');
  const canvas = document.getElementById('photo-canvas');
  const preview = document.getElementById('photo-preview');

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  preview.src = dataUrl;

  video.style.display = 'none';
  preview.style.display = 'block';
  document.getElementById('photo-buttons').style.display = 'none';
  document.getElementById('photo-confirm-buttons').style.display = 'flex';

  stopCameraStream();
}

function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
}

/**
 * Invia la foto al server per il tentativo di cattura. Il server valida
 * sempre la distanza reale lato suo prima di accettare (anti-cheat), quindi
 * anche se questa chiamata "sembra" andare a buon fine dal punto di vista
 * del client, il risultato finale dipende dalla validazione server + admin.
 */
function sendCapturePhoto() {
  const preview = document.getElementById('photo-preview');
  const base64 = preview.src.split(',')[1]; // rimuove il prefisso "data:image/jpeg;base64,"

  Router.show('screen-awaiting-approval');

  AppState.socket.emit('capture_attempt', {
    targetId: AppState.captureTargetId,
    photoBase64: base64,
  }, (response) => {
    if (response.error) {
      showToast(response.error, 'danger');
      Router.show('screen-hunting-seeker');
      return;
    }
    // A questo punto la foto è "pending": resta nella schermata di attesa
    // finché non arriva 'player_eliminated' (approvata) o 'capture_rejected' (rifiutata),
    // eventi già gestiti globalmente in lobby.js -> setupGlobalSocketListeners.
  });
}
