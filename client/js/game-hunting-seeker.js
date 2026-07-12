// ============================================================
// FASE CACCIA — VISTA CERCATORE
// ============================================================

let huntTimerIntervalSeeker = null;

// Palette di colori distinti per differenziare i team ad occhio sulla mappa,
// come richiesto ("cerchi di diverso colore per i vari player dei vari team")
const TEAM_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#0891b2', '#db2777', '#65a30d'];

function colorForTeam(teamId) {
  if (!teamId) return '#64748b';
  return TEAM_COLORS[(teamId - 1) % TEAM_COLORS.length];
}

async function enterHuntingPhase() {
  if (AppState.player.role === 'seeker') {
    Router.show('screen-hunting-seeker');
    await WakeLockManager.request('wake-lock-indicator-seeker');
    WakeLockManager.setupAutoReacquire('wake-lock-indicator-seeker');
    initHuntingMap();
    setupDashboardToggle();
    setupCaptureFlow();
  } else {
    Router.show('screen-hunting-hider');
    await WakeLockManager.request('wake-lock-indicator-hider');
    WakeLockManager.setupAutoReacquire('wake-lock-indicator-hider');
  }

  const intervalSeconds = AppState.round.position_interval_seconds;
  if (AppState.stopPositionReporting) AppState.stopPositionReporting();
  AppState.stopPositionReporting = startPositionReporting(AppState.socket, intervalSeconds);

  startHuntCountdown(AppState.round.hunt_time_seconds);
}

function startHuntCountdown(totalSeconds) {
  let remaining = totalSeconds;
  const timerElSeeker = document.getElementById('hunt-timer-seeker');
  const timerElHider = document.getElementById('hunt-timer-hider');

  const update = () => {
    const text = formatTime(Math.max(0, remaining));
    if (timerElSeeker) timerElSeeker.textContent = text;
    if (timerElHider) timerElHider.textContent = text;
  };
  update();

  if (huntTimerIntervalSeeker) clearInterval(huntTimerIntervalSeeker);
  huntTimerIntervalSeeker = setInterval(() => {
    remaining--;
    update();
    if (remaining <= 0) clearInterval(huntTimerIntervalSeeker);
  }, 1000);
}

function initHuntingMap() {
  if (AppState.huntingMap) {
    AppState.huntingMap.remove();
    AppState.huntingMap = null;
  }
  AppState.huntingMap = L.map('map-hunting').setView([45.0703, 7.6869], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(AppState.huntingMap);

  AppState.huntingMapMarkers = {};
}

/**
 * Aggiorna la mappa e la dashboard del cercatore con lo stato ricevuto dal server.
 * Mostra un cerchio per ogni hider vivo, colorato per team, con nickname in etichetta.
 * Gli hider eliminati NON vengono più mostrati sulla mappa (non serve più cercarli).
 */
function updateSeekerView(state) {
  const { players } = state;
  let mapCentered = false;

  players.filter((p) => p.role === 'hider').forEach((p) => {
    const existingMarker = AppState.huntingMapMarkers[p.id];

    if (p.isEliminated) {
      if (existingMarker) {
        AppState.huntingMap.removeLayer(existingMarker.circle);
        AppState.huntingMap.removeLayer(existingMarker.label);
        delete AppState.huntingMapMarkers[p.id];
      }
      return;
    }

    if (p.fakeLat == null || p.fakeLng == null) return; // nessuna posizione ricevuta ancora

    const color = colorForTeam(p.teamId);

    if (existingMarker) {
      existingMarker.circle.setLatLng([p.fakeLat, p.fakeLng]);
      existingMarker.circle.setRadius(p.fakeRadiusM);
      existingMarker.label.setLatLng([p.fakeLat, p.fakeLng]);
    } else {
      const circle = L.circle([p.fakeLat, p.fakeLng], {
        radius: p.fakeRadiusM,
        color,
        fillColor: color,
        fillOpacity: 0.25,
        weight: 2,
      }).addTo(AppState.huntingMap);

      const label = L.marker([p.fakeLat, p.fakeLng], {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:${color};color:white;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.3);">${escapeHtml(p.nickname)}</div>`,
          iconAnchor: [0, 0],
        }),
      }).addTo(AppState.huntingMap);

      AppState.huntingMapMarkers[p.id] = { circle, label };
    }

    if (!mapCentered) {
      AppState.huntingMap.panTo([p.fakeLat, p.fakeLng]);
      mapCentered = true;
    }
  });

  renderSeekerDashboard(players);
}

function renderSeekerDashboard(players) {
  const container = document.getElementById('players-status-list');
  container.innerHTML = '';

  players.filter((p) => p.role === 'hider').forEach((p) => {
    const item = document.createElement('div');
    item.className = `list-item ${p.isEliminated ? 'eliminated' : ''}`;
    const lastSeen = p.lastPositionAt
      ? `aggiornata ${Math.round((Date.now() - new Date(p.lastPositionAt).getTime()) / 1000)}s fa`
      : 'nessuna posizione ancora';
    item.innerHTML = `
      <span>${escapeHtml(p.nickname)} ${p.teamId ? `(team ${p.teamId})` : ''}</span>
      ${p.isEliminated
        ? '<span class="badge badge-eliminated">Eliminato</span>'
        : `<span style="font-size:11px;color:var(--color-text-muted);">${lastSeen}</span>`}
    `;
    container.appendChild(item);
  });
}

function setupDashboardToggle() {
  const toggle = document.getElementById('dashboard-toggle');
  const content = document.getElementById('dashboard-content');
  const arrow = document.getElementById('dashboard-arrow');

  // Rimuove listener duplicati in caso di rientro nella schermata
  const newToggle = toggle.cloneNode(true);
  toggle.replaceWith(newToggle);

  newToggle.addEventListener('click', () => {
    content.classList.toggle('expanded');
    document.getElementById('dashboard-arrow').textContent =
      content.classList.contains('expanded') ? '▲' : '▼';
  });
}

// ---------------- FLUSSO CATTURA ----------------

function setupCaptureFlow() {
  const captureBtn = document.getElementById('btn-capture-mode');
  const newBtn = captureBtn.cloneNode(true);
  captureBtn.replaceWith(newBtn);
  newBtn.addEventListener('click', showTargetSelection);

  const cancelBtn = document.getElementById('btn-cancel-target-selection');
  const newCancelBtn = cancelBtn.cloneNode(true);
  cancelBtn.replaceWith(newCancelBtn);
  newCancelBtn.addEventListener('click', () => Router.show('screen-hunting-seeker'));
}

function showTargetSelection() {
  const state = AppState.latestGameState;
  const container = document.getElementById('target-selection-list');
  container.innerHTML = '';

  const aliveHiders = (state?.players || []).filter((p) => p.role === 'hider' && !p.isEliminated);

  if (aliveHiders.length === 0) {
    container.innerHTML = '<p class="hint">Nessun giocatore da catturare al momento.</p>';
  }

  aliveHiders.forEach((p) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.style.cursor = 'pointer';
    item.innerHTML = `<span>${escapeHtml(p.nickname)}</span><span style="color:var(--color-primary);">Seleziona →</span>`;
    item.addEventListener('click', () => {
      AppState.captureTargetId = p.id;
      document.getElementById('capture-target-name').textContent = p.nickname;
      Router.show('screen-photo-capture');
      startCameraPreview();
    });
    container.appendChild(item);
  });

  Router.show('screen-select-target');
}
