// ============================================================
// SCHERMATA HOME
// ============================================================

// Stato globale condiviso tra i moduli (semplice, senza framework)
const AppState = {
  socket: null,
  clientToken: null,
  player: null,
  round: null,
  game: null,
  adminSessionToken: null,
  selectedAdminGame: null,
  boundaryWaypoints: [],
  boundaryMap: null,
  boundaryMarkers: [],
  boundaryPolyline: null,
  huntingMap: null,
  huntingMapMarkers: {},
  captureTargetId: null,
  stopPositionReporting: null,
};

function initHomeScreen() {
  document.getElementById('btn-join-round').addEventListener('click', async () => {
    const roundId = document.getElementById('input-round-id').value.trim();
    const nickname = document.getElementById('input-nickname').value.trim();

    if (!roundId || !nickname) {
      showToast('Inserisci codice round e nickname', 'danger');
      return;
    }

    await joinRound(roundId, nickname);
  });

  document.getElementById('btn-go-admin').addEventListener('click', () => {
    Router.show('screen-admin-unlock');
  });

  document.getElementById('btn-back-home-1').addEventListener('click', () => {
    Router.show('screen-home');
  });

  document.getElementById('btn-back-home-2').addEventListener('click', () => {
    window.location.reload(); // reset pulito dello stato client a fine round
  });
}

async function joinRound(roundId, nickname) {
  AppState.clientToken = getOrCreateClientToken();
  AppState.socket = io(CONFIG.SERVER_URL);

  AppState.socket.emit('join_round', {
    roundId,
    nickname,
    clientToken: AppState.clientToken,
  }, (response) => {
    if (response.error) {
      showToast(response.error, 'danger');
      return;
    }

    AppState.player = response.player;
    AppState.round = response.round;

    setupGlobalSocketListeners();

    // Entra nella schermata giusta in base allo stato attuale del round
    // (utile anche per la riconnessione a metà partita)
    if (response.round.status === 'lobby') {
      Router.show('screen-lobby');
      updateLobbyMyInfo();
    } else if (response.round.status === 'hiding') {
      enterHidingPhase();
    } else if (response.round.status === 'hunting') {
      enterHuntingPhase();
    } else if (response.round.status === 'finished') {
      showRoundEndScreen(response.round);
    }
  });
}
