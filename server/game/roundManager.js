import { pool } from '../db/pool.js';

/**
 * Mischia un array (Fisher-Yates) per l'estrazione casuale dei ruoli/team.
 */
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Estrae casualmente 2 cercatori e raggruppa i restanti giocatori in coppie (team).
 * Se il numero di "nascosti" è dispari, l'ultimo team ha 1 solo membro (non si può evitare).
 * Ritorna la lista di aggiornamenti da scrivere sul DB: [{playerId, role, teamId}]
 */
export function assignRolesRandomly(playerIds) {
  const shuffled = shuffle(playerIds);
  const seekers = shuffled.slice(0, 2);
  const hiders = shuffled.slice(2);

  const updates = seekers.map((id) => ({ playerId: id, role: 'seeker', teamId: null }));

  // Raggruppa gli hider in coppie
  let teamCounter = 1;
  for (let i = 0; i < hiders.length; i += 2) {
    const teamId = teamCounter++;
    updates.push({ playerId: hiders[i], role: 'hider', teamId });
    if (hiders[i + 1] !== undefined) {
      updates.push({ playerId: hiders[i + 1], role: 'hider', teamId });
    }
  }

  return updates;
}

/**
 * Applica assegnazioni di ruolo/team scelte MANUALMENTE dall'admin.
 * `assignments` è un array di {playerId, role, teamId} già deciso a mano.
 * Questa funzione fa solo da passthrough esplicito, per chiarezza di codice
 * e per lasciare un unico punto dove in futuro aggiungere validazioni
 * (es. controllare che ogni team abbia coerentemente lo stesso ruolo 'hider').
 */
export function assignRolesManually(assignments) {
  return assignments;
}

export async function applyRoleAssignments(roundId, updates) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      await client.query(
        'UPDATE players SET role = $1, team_id = $2 WHERE id = $3 AND round_id = $4',
        [u.role, u.teamId, u.playerId, roundId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Avvia la fase di nascondimento: segna il round come 'hiding' e registra l'orario di inizio.
 * Il timer vero e proprio viene gestito lato server in index.js con setTimeout,
 * questa funzione si occupa solo dello stato persistito.
 */
export async function startHidingPhase(roundId) {
  const { rows } = await pool.query(
    `UPDATE rounds SET status = 'hiding', hiding_started_at = NOW() WHERE id = $1 RETURNING *`,
    [roundId]
  );
  return rows[0];
}

export async function startHuntingPhase(roundId) {
  const { rows } = await pool.query(
    `UPDATE rounds SET status = 'hunting', hunting_started_at = NOW() WHERE id = $1 RETURNING *`,
    [roundId]
  );
  return rows[0];
}

export async function finishRound(roundId, winner) {
  const { rows } = await pool.query(
    `UPDATE rounds SET status = 'finished', finished_at = NOW(), winner = $2 WHERE id = $1 RETURNING *`,
    [roundId, winner]
  );
  return rows[0];
}

/**
 * Controlla se tutti gli hider di un round sono eliminati.
 * Usata per far terminare il round SUBITO quando non resta nessuno da trovare,
 * invece di aspettare lo scadere del timer (come richiesto).
 */
export async function areAllHidersEliminated(roundId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) as remaining FROM players
     WHERE round_id = $1 AND role = 'hider' AND is_eliminated = FALSE`,
    [roundId]
  );
  return parseInt(rows[0].remaining, 10) === 0;
}
