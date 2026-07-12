// ============================================================
// PANNELLO ADMIN
// ============================================================

function initAdminScreens() {
  document.getElementById('btn-unlock-admin').addEventListener('click', unlockAdmin);
  document.getElementById('btn-admin-logout').addEventListener('click', () => {
    AppState.adminSessionToken = null;
    Router.show('screen-home');
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');

      // Inizializza la mappa dei confini solo quando la tab diventa visibile
      // (Leaflet ha bisogno che il container sia visibile per calcolare le dimensioni)
      if (btn.dataset.tab === 'tab-boundary' && AppState.selectedAdminGame) {
        setTimeout(() => initBoundaryMap(), 100);
      }
    });
  });

  document.getElementById('btn-create-game').addEventListener('click', createGame);
  document.getElementById('btn-boundary-undo').addEventListener('click', undoLastWaypoint);
  document.getElementById('btn-boundary-clear').addEventListener('click', clearBoundary);
  document.getElementById('btn-boundary-save').addEventListener('click', saveBoundary);
  document.getElementById('btn-create-round').addEventListener('click', createRound);
  document.getElementById('btn-assign-random').addEventListener('click', assignRolesRandom);
  document.getElementById('btn-assign-manual').addEventListener('click', showManualAssignmentPanel);
  document.getElementById('btn-start-round').addEventListener('click', startRound);
}

async function unlockAdmin() {
  const code = document.getElementById('input-admin-code').value.trim();
  const errorEl = document.getElementById('admin-unlock-error');
  errorEl.textContent = '';

  try {
    const result = await API.post('/api/admin/verify', { code });
    AppState.adminSessionToken = result.adminSessionToken;
    Router.show('screen-admin-panel');
    await loadGamesList();
  } catch (err) {
    // TEMPORANEO per debug: mostriamo l'errore vero invece del messaggio fisso,
    // così si distingue un 401 reale ("Codice errato") da un fetch che non
    // raggiunge affatto il server (es. "Failed to fetch" = URL/dominio sbagliato).
    errorEl.textContent = `[DEBUG] ${err.message} — chiamando: ${CONFIG.SERVER_URL}`;
  }
}

// ---------------- GESTIONE PARTITE ----------------

async function createGame() {
  const name = document.getElementById('input-new-game-name').value.trim();
  if (!name) return showToast('Inserisci un nome per la partita', 'danger');

  try {
    await API.post('/api/admin/games', { name }, AppState.adminSessionToken);
    document.getElementById('input-new-game-name').value = '';
    await loadGamesList();
    showToast('Partita creata!', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function loadGamesList() {
  const games = await API.get('/api/admin/games', AppState.adminSessionToken);
  const container = document.getElementById('games-list');
  container.innerHTML = '';

  if (games.length === 0) {
    container.innerHTML = '<p class="hint">Nessuna partita ancora. Creane una qui sopra.</p>';
    return;
  }

  games.forEach((game) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.style.cursor = 'pointer';
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(game.name)}</strong><br>
        <span style="font-size:12px;color:var(--color-text-muted)">
          Creata il ${new Date(game.created_at).toLocaleDateString('it-IT')}
        </span>
      </div>
      <span style="color:var(--color-primary);font-weight:600;">Seleziona →</span>
    `;
    item.addEventListener('click', () => selectGame(game));
    container.appendChild(item);
  });
}

function selectGame(game) {
  AppState.selectedAdminGame = game;
  AppState.boundaryWaypoints = game.boundary_waypoints || [];

  document.getElementById('boundary-selected-game').textContent = `📍 ${game.name}`;
  document.getElementById('round-selected-game').textContent = `📍 ${game.name}`;

  showToast(`Partita "${game.name}" selezionata`, 'success');

  // Pre-carica le impostazioni di default della partita nei campi round
  document.getElementById('input-hide-time').value = Math.round(game.default_hide_time_seconds / 60);
  document.getElementById('input-hunt-time').value = Math.round(game.default_hunt_time_seconds / 60);
  document.getElementById('input-max-radius').value = game.default_max_obfuscation_radius_m;
  document.getElementById('input-position-interval').value = Math.round(game.default_position_interval_seconds / 60);
  document.getElementById('input-capture-distance').value = game.capture_distance_m;
}

// ---------------- CONFINI MAPPA (con snap alle strade via OSRM, gratuito) ----------------

function initBoundaryMap() {
  if (AppState.boundaryMap) {
    AppState.boundaryMap.remove();
  }

  // Centro iniziale: Torino come default ragionevole, l'admin può navigare liberamente
  AppState.boundaryMap = L.map('map-boundary').setView([45.0703, 7.6869], 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(AppState.boundaryMap);

  AppState.boundaryMap.on('click', (e) => {
    addBoundaryWaypoint(e.latlng.lat, e.latlng.lng);
  });

  redrawBoundary();
}

function addBoundaryWaypoint(lat, lng) {
  AppState.boundaryWaypoints.push({ lat, lng });
  redrawBoundary();
}

function undoLastWaypoint() {
  AppState.boundaryWaypoints.pop();
  redrawBoundary();
}

function clearBoundary() {
  AppState.boundaryWaypoints = [];
  redrawBoundary();
}

/**
 * Ridisegna marker e collegamenti tra i waypoint sulla mappa.
 * Usa il servizio OSRM pubblico (gratuito, nessuna chiave richiesta) per
 * agganciare il percorso tra i waypoint alle strade esistenti, tramite
 * il plugin Leaflet Routing Machine.
 */
function redrawBoundary() {
  // Pulisce marker e linee precedenti
  AppState.boundaryMarkers.forEach((m) => AppState.boundaryMap.removeLayer(m));
  AppState.boundaryMarkers = [];
  if (AppState.boundaryRoutingControl) {
    AppState.boundaryMap.removeControl(AppState.boundaryRoutingControl);
    AppState.boundaryRoutingControl = null;
  }

  AppState.boundaryWaypoints.forEach((wp, idx) => {
    const marker = L.circleMarker([wp.lat, wp.lng], {
      radius: 8,
      color: '#2563eb',
      fillColor: '#2563eb',
      fillOpacity: 1,
    }).addTo(AppState.boundaryMap);
    marker.bindTooltip(`Punto ${idx + 1}`, { permanent: false });
    AppState.boundaryMarkers.push(marker);
  });

  if (AppState.boundaryWaypoints.length >= 2) {
    // Leaflet Routing Machine con router OSRM pubblico gratuito: calcola il percorso
    // stradale reale tra i waypoint invece di una linea dritta, come richiesto
    // ("aggiusta la linea alle strade esistenti").
    const routeWaypoints = AppState.boundaryWaypoints.map((wp) => L.latLng(wp.lat, wp.lng));
    // Per chiudere il perimetro ad area, ricolleghiamo l'ultimo punto al primo
    routeWaypoints.push(L.latLng(AppState.boundaryWaypoints[0].lat, AppState.boundaryWaypoints[0].lng));

    AppState.boundaryRoutingControl = L.Routing.control({
      waypoints: routeWaypoints,
      router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
      addWaypoints: false,
      draggableWaypoints: false,
      fitSelectedRoutes: false,
      show: false, // nasconde il pannello testuale delle indicazioni, vogliamo solo la linea
      lineOptions: {
        styles: [{ color: '#dc2626', weight: 4, opacity: 0.8 }],
      },
      createMarker: () => null, // i marker li gestiamo noi sopra, evitiamo duplicati
    }).addTo(AppState.boundaryMap);
  }
}

async function saveBoundary() {
  if (!AppState.selectedAdminGame) {
    return showToast('Seleziona prima una partita dalla tab Partite', 'danger');
  }
  if (AppState.boundaryWaypoints.length < 3) {
    return showToast('Servono almeno 3 punti per definire un\'area', 'danger');
  }

  try {
    await API.put(
      `/api/admin/games/${AppState.selectedAdminGame.id}/boundary`,
      { waypoints: AppState.boundaryWaypoints },
      AppState.adminSessionToken
    );
    showToast('Confini salvati!', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// ---------------- GESTIONE ROUND ----------------

async function createRound() {
  if (!AppState.selectedAdminGame) {
    return showToast('Seleziona prima una partita dalla tab Partite', 'danger');
  }

  const settings = {
    hideTimeSeconds: parseInt(document.getElementById('input-hide-time').value, 10) * 60,
    huntTimeSeconds: parseInt(document.getElementById('input-hunt-time').value, 10) * 60,
    maxObfuscationRadiusM: parseInt(document.getElementById('input-max-radius').value, 10),
    positionIntervalSeconds: parseInt(document.getElementById('input-position-interval').value, 10) * 60,
    captureDistanceM: parseInt(document.getElementById('input-capture-distance').value, 10),
  };

  try {
    const round = await API.post(
      `/api/admin/games/${AppState.selectedAdminGame.id}/rounds`,
      settings,
      AppState.adminSessionToken
    );
    AppState.adminActiveRound = round;

    document.getElementById('round-management-card').style.display = 'block';
    document.getElementById('active-round-id').textContent = round.id;
    document.getElementById('round-code-display').textContent = round.id;

    connectAdminToRoundSocket(round.id);
    showToast('Round creato! Condividi il codice con i giocatori.', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

function connectAdminToRoundSocket(roundId) {
  if (!AppState.socket) {
    AppState.socket = io(CONFIG.SERVER_URL);
  }
  AppState.socket.emit('admin_join', { roundId, adminSessionToken: AppState.adminSessionToken });

  AppState.socket.on('lobby_update', ({ players }) => {
    renderLobbyPlayersAdmin(players);
  });

  AppState.socket.on('new_capture_pending', () => {
    loadPendingCaptures();
    showToast('📸 Nuova foto da approvare!', 'success');
  });

  AppState.socket.on('phase_changed', ({ phase }) => {
    document.getElementById('round-status-display').textContent =
      phase === 'hiding' ? '🙈 Fase nascondimento in corso...' : '🏃 Fase caccia in corso...';
  });

  AppState.socket.on('round_finished', ({ winner }) => {
    document.getElementById('round-status-display').textContent =
      `🏁 Round terminato! Ha vinto: ${winner === 'seekers' ? 'i cercatori' : 'i nascosti'}`;
  });

  // Polling leggero per la lista foto pendenti (semplice e affidabile)
  setInterval(() => {
    if (AppState.adminActiveRound) loadPendingCaptures();
  }, 5000);
}

function renderLobbyPlayersAdmin(players) {
  AppState.lastKnownPlayers = players; // usato anche dal pannello di assegnazione manuale
  const container = document.getElementById('lobby-players-list');
  container.innerHTML = '';
  players.forEach((p) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const roleBadge = p.role === 'seeker'
      ? '<span class="badge badge-seeker">Cercatore</span>'
      : `<span class="badge badge-hider">Nascosto${p.team_id ? ' - team ' + p.team_id : ''}</span>`;
    item.innerHTML = `<span>${escapeHtml(p.nickname)}</span>${roleBadge}`;
    container.appendChild(item);
  });
}

async function assignRolesRandom() {
  if (!AppState.adminActiveRound) return;
  try {
    await API.post(
      `/api/admin/rounds/${AppState.adminActiveRound.id}/assign-random`,
      {},
      AppState.adminSessionToken
    );
    showToast('Ruoli estratti casualmente!', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

/**
 * Mostra un pannello semplice per assegnare ruoli manualmente: per ogni giocatore,
 * un select con le opzioni Cercatore / Nascosto + numero team (per accoppiare gli hider).
 */
async function showManualAssignmentPanel() {
  if (!AppState.adminActiveRound) return;
  const panel = document.getElementById('manual-assignment-panel');
  panel.style.display = 'block';
  panel.innerHTML = '<h4 style="margin-bottom:8px;">Assegna manualmente:</h4>';

  // Usiamo l'ultima lista nota lato client, tenuta aggiornata da renderLobbyPlayersAdmin
  // ad ogni evento 'lobby_update' ricevuto dal server.
  const players = AppState.lastKnownPlayers || [];

  if (players.length === 0) {
    panel.innerHTML += '<p class="hint">Nessun giocatore ancora connesso alla lobby.</p>';
    return;
  }

  players.forEach((p) => {
    const row = document.createElement('div');
    row.style.marginBottom = '10px';
    row.innerHTML = `
      <label>${escapeHtml(p.nickname)}</label>
      <div style="display:flex;gap:8px;">
        <select data-player-id="${p.id}" class="manual-role-select" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--color-border);">
          <option value="seeker">Cercatore</option>
          <option value="hider" selected>Nascosto</option>
        </select>
        <input type="number" data-player-id="${p.id}" class="manual-team-input" placeholder="Team #" min="1" style="width:80px;padding:10px;border-radius:8px;border:1px solid var(--color-border);" />
      </div>
    `;
    panel.appendChild(row);
  });

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn-primary';
  confirmBtn.textContent = 'Conferma assegnazione manuale';
  confirmBtn.style.marginTop = '10px';
  confirmBtn.addEventListener('click', submitManualAssignment);
  panel.appendChild(confirmBtn);
}

async function submitManualAssignment() {
  const selects = document.querySelectorAll('.manual-role-select');
  const assignments = Array.from(selects).map((sel) => {
    const playerId = parseInt(sel.dataset.playerId, 10);
    const role = sel.value;
    const teamInput = document.querySelector(`.manual-team-input[data-player-id="${playerId}"]`);
    const teamId = role === 'hider' && teamInput.value ? parseInt(teamInput.value, 10) : null;
    return { playerId, role, teamId };
  });

  try {
    await API.post(
      `/api/admin/rounds/${AppState.adminActiveRound.id}/assign-manual`,
      { assignments },
      AppState.adminSessionToken
    );
    showToast('Assegnazione manuale salvata!', 'success');
    document.getElementById('manual-assignment-panel').style.display = 'none';
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function startRound() {
  if (!AppState.adminActiveRound) return;
  try {
    await API.post(
      `/api/admin/rounds/${AppState.adminActiveRound.id}/start`,
      {},
      AppState.adminSessionToken
    );
    showToast('Partita avviata! 🎉', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// ---------------- APPROVAZIONE FOTO ----------------

async function loadPendingCaptures() {
  if (!AppState.adminActiveRound) return;
  const captures = await API.get(
    `/api/admin/rounds/${AppState.adminActiveRound.id}/pending-captures`,
    AppState.adminSessionToken
  );
  const container = document.getElementById('pending-captures-list');
  container.innerHTML = '';

  if (captures.length === 0) {
    container.innerHTML = '<p class="hint">Nessuna foto in attesa al momento.</p>';
    return;
  }

  captures.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'card';
    item.innerHTML = `
      <p style="font-weight:600;margin-bottom:8px;">
        ${escapeHtml(c.seeker_nickname)} ha catturato ${escapeHtml(c.target_nickname)}?
      </p>
      <p style="font-size:12px;color:var(--color-text-muted);margin-bottom:10px;">
        Distanza al momento dello scatto: ${Math.round(c.distance_at_capture_m)}m
      </p>
      <img src="${c.photo_url}" style="width:100%;border-radius:10px;margin-bottom:10px;" />
      <div class="button-row">
        <button class="btn-secondary btn-reject-capture" data-id="${c.id}">❌ Rifiuta</button>
        <button class="btn-primary btn-approve-capture" data-id="${c.id}">✅ Approva</button>
      </div>
    `;
    container.appendChild(item);
  });

  document.querySelectorAll('.btn-approve-capture').forEach((btn) => {
    btn.addEventListener('click', () => reviewCapture(parseInt(btn.dataset.id, 10), true));
  });
  document.querySelectorAll('.btn-reject-capture').forEach((btn) => {
    btn.addEventListener('click', () => reviewCapture(parseInt(btn.dataset.id, 10), false));
  });
}

function reviewCapture(attemptId, approved) {
  AppState.socket.emit('admin_review_capture', {
    attemptId,
    approved,
    adminSessionToken: AppState.adminSessionToken,
  });
  showToast(approved ? 'Cattura approvata!' : 'Cattura rifiutata', approved ? 'success' : 'default');
  setTimeout(loadPendingCaptures, 500);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}