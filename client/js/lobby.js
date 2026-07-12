// ============================================================
// LOBBY GIOCATORE
// ============================================================

function updateLobbyMyInfo() {
  const box = document.getElementById('lobby-my-info');
  box.textContent = `Sei entrato come "${AppState.player.nickname}". Aspetta che l'organizzatore avvii la partita.`;
}

function renderLobbyPlayersView(players) {
  const container = document.getElementById('lobby-players-view');
  container.innerHTML = '';
  players.forEach((p) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `<span>${escapeHtml(p.nickname)}</span>`;
    container.appendChild(item);
  });
}

/**
 * Registra tutti i listener socket che servono per l'intero ciclo di vita
 * della partita lato giocatore (non admin). Chiamata una volta dopo il join.
 */
function setupGlobalSocketListeners() {
  AppState.socket.on('lobby_update', ({ players }) => {
    if (document.getElementById('screen-lobby').classList.contains('active')) {
      renderLobbyPlayersView(players);
    }
  });

  AppState.socket.on('phase_changed', ({ phase, round }) => {
    AppState.round = round;
    if (phase === 'hiding') enterHidingPhase();
    if (phase === 'hunting') enterHuntingPhase();
  });

  AppState.socket.on('game_state', (state) => {
    AppState.latestGameState = state;
    if (AppState.player.role === 'seeker') {
      updateSeekerView(state);
    } else {
      updateHiderView(state);
    }
  });

  AppState.socket.on('player_eliminated', ({ playerId, nickname, reason }) => {
    const name = nickname || (AppState.latestGameState?.players || AppState.latestGameState?.eliminationStatus || [])
      .find((p) => p.id === playerId)?.nickname || 'Un giocatore';

    const reasonText = reason === 'out_of_bounds'
      ? `${name} è uscito dall'area di gioco ed è stato squalificato! 🚫`
      : `${name} è stato catturato! 🚨`;

    showToast(reasonText, 'danger');

    if (playerId === AppState.player.id) {
      showCaughtStatus();
    }

    // Se ero io il cercatore in attesa di approvazione per questa cattura,
    // torno alla mappa ora che ho la conferma (evita di restare bloccato
    // sulla schermata "l'IA sta valutando").
    if (AppState.player.role === 'seeker' && document.getElementById('screen-awaiting-approval').classList.contains('active')) {
      Router.show('screen-hunting-seeker');
    }
  });

  AppState.socket.on('capture_rejected', ({ targetNickname }) => {
    showToast(`La foto di ${targetNickname} non è stata accettata. Puoi riprovare!`, 'danger');
    // Riporta il cercatore alla mappa per ritentare
    Router.show('screen-hunting-seeker');
  });

  AppState.socket.on('position_reminder', () => {
    showToast('📍 Ricorda di tenere l\'app aperta per inviare la tua posizione', 'default');
  });

  AppState.socket.on('round_finished', ({ winner, round }) => {
    showRoundEndScreen({ ...round, winner });
  });
}

function showRoundEndScreen({ winner }) {
  if (AppState.stopPositionReporting) AppState.stopPositionReporting();
  WakeLockManager.release();

  const titleEl = document.getElementById('round-end-title');
  const subtitleEl = document.getElementById('round-end-subtitle');

  if (winner === 'seekers') {
    titleEl.textContent = '🏆 Hanno vinto i cercatori!';
    subtitleEl.textContent = 'Tutti i giocatori nascosti sono stati trovati.';
  } else {
    titleEl.textContent = '🏆 Hanno vinto i nascosti!';
    subtitleEl.textContent = 'Il tempo è scaduto e qualcuno è rimasto libero.';
  }

  Router.show('screen-round-end');
}
