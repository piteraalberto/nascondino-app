// ============================================================
// FASE NASCONDIMENTO
// ============================================================

let hidingTimerInterval = null;

function enterHidingPhase() {
  Router.show('screen-hiding');

  const roleInfo = document.getElementById('hiding-role-info');
  roleInfo.textContent = AppState.player.role === 'seeker'
    ? '🔍 Sei un CERCATORE. Aspetta che gli altri si nascondano...'
    : '🙈 Sei un NASCOSTO. Trova un buon posto prima che scada il tempo!';

  // Durante il nascondimento inviamo comunque la posizione periodicamente
  // (serve per avere già un dato fresco appena inizia la caccia).
  const intervalSeconds = AppState.round.position_interval_seconds;
  if (AppState.stopPositionReporting) AppState.stopPositionReporting();
  AppState.stopPositionReporting = startPositionReporting(AppState.socket, intervalSeconds);

  startHidingCountdown(AppState.round.hide_time_seconds);
}

function startHidingCountdown(totalSeconds) {
  let remaining = totalSeconds;
  const timerEl = document.getElementById('hiding-timer');
  timerEl.textContent = formatTime(remaining);

  if (hidingTimerInterval) clearInterval(hidingTimerInterval);
  hidingTimerInterval = setInterval(() => {
    remaining--;
    timerEl.textContent = formatTime(Math.max(0, remaining));
    if (remaining <= 0) clearInterval(hidingTimerInterval);
  }, 1000);
}
