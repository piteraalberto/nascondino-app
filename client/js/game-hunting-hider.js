// ============================================================
// FASE CACCIA — VISTA NASCOSTO
// ============================================================

/**
 * Aggiorna la vista del giocatore nascosto: mostra solo il proprio stato
 * (libero/catturato) e lo stato della propria squadra, MAI le posizioni
 * di nessun altro giocatore, coerentemente con la regola "chi scappa non
 * sa dove sono quelli che cercano" (e nemmeno dove sono gli altri nascosti).
 */
function updateHiderView(state) {
  const { self, eliminationStatus } = state;
  if (!self) return;

  if (self.isEliminated) {
    showCaughtStatus();
  }

  // Mostra all'utente il proprio cerchio di incertezza, così capisce quanto
  // è "sfocata" la sua posizione agli occhi dei cercatori (come richiesto).
  const infoBox = document.getElementById('my-fake-position-info');
  if (self.fakeRadiusM) {
    infoBox.textContent = `I cercatori ti vedono in un'area di circa ${self.fakeRadiusM * 2}m di diametro attorno a un punto approssimativo.`;
  } else {
    infoBox.textContent = 'In attesa del primo invio della tua posizione...';
  }

  renderHiderTeamStatus(eliminationStatus);
}

function renderHiderTeamStatus(hidersStatus) {
  const container = document.getElementById('hider-team-status-list');
  container.innerHTML = '';

  hidersStatus.forEach((p) => {
    const item = document.createElement('div');
    item.className = `list-item ${p.isEliminated ? 'eliminated' : ''}`;
    const isMe = p.id === AppState.player.id;
    item.innerHTML = `
      <span>${escapeHtml(p.nickname)}${isMe ? ' (tu)' : ''} ${p.teamId ? `- team ${p.teamId}` : ''}</span>
      ${p.isEliminated ? '<span class="badge badge-eliminated">Catturato</span>' : '<span class="badge badge-hider">Libero</span>'}
    `;
    container.appendChild(item);
  });
}

function showCaughtStatus() {
  document.getElementById('hider-status-not-caught').style.display = 'none';
  document.getElementById('hider-status-caught').style.display = 'flex';
}
