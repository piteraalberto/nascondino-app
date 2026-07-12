import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { nanoid } from 'nanoid';
import 'dotenv/config';

import { pool, initDatabase } from './db/pool.js';
import {
  haversineDistanceMeters,
  computeObfuscatedPosition,
  isPointInPolygon,
} from './utils/geo.js';
import {
  assignRolesRandomly,
  applyRoleAssignments,
  startHidingPhase,
  startHuntingPhase,
  finishRound,
  areAllHidersEliminated,
} from './game/roundManager.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }, // in produzione conviene restringere all'origine del frontend
  maxHttpBufferSize: 8e6, // 8MB, per le foto inviate via socket in base64
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Cloudinary per lo storage delle foto di cattura (free tier, non serve carta di credito)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const upload = multer({ storage: multer.memoryStorage() });

// ============================================================
// STATO IN MEMORIA (timer attivi per round, per poterli cancellare/modificare)
// Lo stato di gioco "vero" è sempre nel DB; questi sono solo riferimenti
// ai setTimeout/setInterval attivi, persi se il server riparte (accettabile:
// un riavvio a metà round è un caso limite raro per un'app da usare tra amici).
// ============================================================
const activeTimers = new Map(); // roundId -> { hidingTimeout, huntingTimeout, positionReminderInterval }
const lastCaptureAttemptBySeeker = new Map(); // seekerId -> timestamp, per anti-spam foto

const CAPTURE_ATTEMPT_COOLDOWN_MS = 5000; // anti-spam: non più di un tentativo ogni 5s per cercatore

function clearRoundTimers(roundId) {
  const timers = activeTimers.get(roundId);
  if (timers) {
    if (timers.hidingTimeout) clearTimeout(timers.hidingTimeout);
    if (timers.huntingTimeout) clearTimeout(timers.huntingTimeout);
    if (timers.positionReminderInterval) clearInterval(timers.positionReminderInterval);
  }
  activeTimers.delete(roundId);
}

// ============================================================
// HELPER: recupero dati round/player con query riusate spesso
// ============================================================
async function getRound(roundId) {
  const { rows } = await pool.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
  return rows[0];
}

async function getGameForRound(roundId) {
  const { rows } = await pool.query(
    `SELECT g.* FROM games g JOIN rounds r ON r.game_id = g.id WHERE r.id = $1`,
    [roundId]
  );
  return rows[0];
}

async function getPlayersForRound(roundId) {
  const { rows } = await pool.query('SELECT * FROM players WHERE round_id = $1', [roundId]);
  return rows;
}

async function getPlayerByToken(roundId, clientToken) {
  const { rows } = await pool.query(
    'SELECT * FROM players WHERE round_id = $1 AND client_token = $2',
    [roundId, clientToken]
  );
  return rows[0];
}

/**
 * Costruisce la "vista" della board che riceve chi CERCA: posizioni offuscate
 * di tutti gli hider vivi, più stato eliminati. Non include mai le coordinate reali.
 */
async function buildSeekerView(roundId) {
  const players = await getPlayersForRound(roundId);
  const round = await getRound(roundId);
  return {
    round,
    players: players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      role: p.role,
      teamId: p.team_id,
      isEliminated: p.is_eliminated,
      // Il cercatore vede SOLO fake_lat/fake_lng/fake_radius per gli hider, mai real_lat/real_lng
      fakeLat: p.role === 'hider' ? p.fake_lat : null,
      fakeLng: p.role === 'hider' ? p.fake_lng : null,
      fakeRadiusM: p.role === 'hider' ? p.fake_radius_m : null,
      lastPositionAt: p.last_position_at,
    })),
  };
}

/**
 * Vista che riceve chi SCAPPA: solo il proprio cerchio camuffato (per capire quanto
 * è "sfocato" agli occhi altrui) e lo stato di eliminazione di tutti, MAI le posizioni
 * altrui né quelle dei cercatori (chi scappa non deve sapere dove sono i cercatori).
 */
async function buildHiderView(roundId, playerId) {
  const players = await getPlayersForRound(roundId);
  const round = await getRound(roundId);
  const self = players.find((p) => p.id === playerId);
  return {
    round,
    self: self
      ? {
          id: self.id,
          nickname: self.nickname,
          isEliminated: self.is_eliminated,
          fakeLat: self.fake_lat,
          fakeLng: self.fake_lng,
          fakeRadiusM: self.fake_radius_m,
        }
      : null,
    // Stato eliminazione di tutti (per sapere se il proprio team/altri sono stati presi),
    // ma senza nessuna posizione.
    eliminationStatus: players
      .filter((p) => p.role === 'hider')
      .map((p) => ({ id: p.id, nickname: p.nickname, isEliminated: p.is_eliminated, teamId: p.team_id })),
  };
}

async function broadcastGameState(roundId) {
  const players = await getPlayersForRound(roundId);
  const seekerView = await buildSeekerView(roundId);

  for (const p of players) {
    if (!p.socket_id) continue;
    if (p.role === 'seeker') {
      io.to(p.socket_id).emit('game_state', seekerView);
    } else {
      const hiderView = await buildHiderView(roundId, p.id);
      io.to(p.socket_id).emit('game_state', hiderView);
    }
  }
}

// ============================================================
// GESTIONE FASI E TIMER DI ROUND
// ============================================================

async function beginHidingPhase(roundId) {
  const round = await startHidingPhase(roundId);
  io.to(`round:${roundId}`).emit('phase_changed', { phase: 'hiding', round });

  const timers = activeTimers.get(roundId) || {};
  timers.hidingTimeout = setTimeout(() => {
    beginHuntingPhase(roundId).catch(console.error);
  }, round.hide_time_seconds * 1000);
  activeTimers.set(roundId, timers);
}

async function beginHuntingPhase(roundId) {
  const round = await startHuntingPhase(roundId);
  io.to(`round:${roundId}`).emit('phase_changed', { phase: 'hunting', round });

  const timers = activeTimers.get(roundId) || {};

  // Timer di fine caccia allo scadere del tempo (vince chi si nasconde se qualcuno resta libero)
  timers.huntingTimeout = setTimeout(() => {
    endRound(roundId, 'hiders').catch(console.error);
  }, round.hunt_time_seconds * 1000);

  // Promemoria periodico per il reminder "riapri l'app per mandare la posizione",
  // dato che non possiamo forzare l'invio in background su browser mobile.
  timers.positionReminderInterval = setInterval(() => {
    io.to(`round:${roundId}`).emit('position_reminder');
  }, round.position_interval_seconds * 1000);

  activeTimers.set(roundId, timers);
  await broadcastGameState(roundId);
}

async function endRound(roundId, winner) {
  clearRoundTimers(roundId);
  const round = await finishRound(roundId, winner);
  io.to(`round:${roundId}`).emit('round_finished', { winner, round });
}

// ============================================================
// SOCKET.IO — EVENTI GIOCATORE
// ============================================================

io.on('connection', (socket) => {
  /**
   * join_round: un giocatore entra in un round con un nickname.
   * clientToken è generato la prima volta dal client e salvato in localStorage,
   * così se il browser si ricarica (o il telefono va in sleep) il giocatore
   * si riconnette come SE STESSO invece di risultare un nuovo player.
   */
  socket.on('join_round', async ({ roundId, nickname, clientToken }, callback) => {
    try {
      const round = await getRound(roundId);
      if (!round) return callback({ error: 'Round non trovato' });

      let player = await getPlayerByToken(roundId, clientToken);

      if (player) {
        // Riconnessione: aggiorna solo il socket_id, mantieni ruolo/stato esistenti
        await pool.query('UPDATE players SET socket_id = $1 WHERE id = $2', [socket.id, player.id]);
      } else {
        if (round.status !== 'lobby') {
          return callback({ error: 'La partita è già iniziata, non puoi unirti ora' });
        }
        const { rows } = await pool.query(
          `INSERT INTO players (round_id, nickname, socket_id, client_token, role)
           VALUES ($1, $2, $3, $4, 'hider') RETURNING *`,
          [roundId, nickname, socket.id, clientToken]
        );
        player = rows[0];
      }

      socket.join(`round:${roundId}`);
      socket.data.playerId = player.id;
      socket.data.roundId = roundId;

      const players = await getPlayersForRound(roundId);
      io.to(`round:${roundId}`).emit('lobby_update', { players });

      callback({ player, round });
    } catch (err) {
      console.error(err);
      callback({ error: 'Errore interno' });
    }
  });

  /**
   * update_position: il client manda la posizione REALE ad intervalli regolari.
   * Il server:
   * 1. Salva la posizione reale (mai esposta ai client)
   * 2. Controlla se il giocatore è uscito dai confini -> squalifica automatica
   * 3. Calcola la posizione camuffata per gli hider e la ridistribuisce
   */
  socket.on('update_position', async ({ lat, lng }) => {
    try {
      const playerId = socket.data.playerId;
      const roundId = socket.data.roundId;
      if (!playerId || !roundId) return;

      const round = await getRound(roundId);
      const game = await getGameForRound(roundId);
      if (!round || (round.status !== 'hunting' && round.status !== 'hiding')) return;

      // Controllo confini (regola numero 1): se il giocatore è fuori dall'area, squalificato.
      const boundary = game.boundary_waypoints;
      if (boundary && boundary.length >= 3 && !isPointInPolygon(lat, lng, boundary)) {
        await pool.query(
          `UPDATE players SET is_eliminated = TRUE, eliminated_at = NOW(), real_lat = $1, real_lng = $2
           WHERE id = $3`,
          [lat, lng, playerId]
        );
        io.to(`round:${roundId}`).emit('player_eliminated', {
          playerId,
          reason: 'out_of_bounds',
        });
        await broadcastGameState(roundId);
        await checkRoundEndCondition(roundId);
        return;
      }

      const { rows } = await pool.query('SELECT * FROM players WHERE id = $1', [playerId]);
      const player = rows[0];
      if (!player || player.is_eliminated) return;

      let fakePos = { fakeLat: null, fakeLng: null, fakeRadiusM: null };
      if (player.role === 'hider') {
        const computed = computeObfuscatedPosition(lat, lng, round.max_obfuscation_radius_m);
        fakePos = computed;
      }

      await pool.query(
        `UPDATE players SET real_lat = $1, real_lng = $2, fake_lat = $3, fake_lng = $4,
         fake_radius_m = $5, last_position_at = NOW() WHERE id = $6`,
        [lat, lng, fakePos.fakeLat, fakePos.fakeLng, fakePos.fakeRadiusM, playerId]
      );

      await broadcastGameState(roundId);
    } catch (err) {
      console.error(err);
    }
  });

  /**
   * capture_attempt: un cercatore tenta di catturare un target.
   * Il server valida SEMPRE la distanza usando le posizioni reali salvate,
   * non fidandosi di nessun dato "distanza" eventualmente mandato dal client
   * (questo blocca il cheat di chi spoofa la propria distanza).
   * La foto viene caricata su Cloudinary e l'esito resta 'pending' finché
   * l'admin non approva o rifiuta dal pannello.
   */
  socket.on('capture_attempt', async ({ targetId, photoBase64 }, callback) => {
    try {
      const seekerId = socket.data.playerId;
      const roundId = socket.data.roundId;
      if (!seekerId || !roundId) return callback({ error: 'Sessione non valida' });

      // Anti-spam: blocca tentativi troppo ravvicinati dallo stesso cercatore
      const lastAttempt = lastCaptureAttemptBySeeker.get(seekerId) || 0;
      if (Date.now() - lastAttempt < CAPTURE_ATTEMPT_COOLDOWN_MS) {
        return callback({ error: 'Aspetta qualche secondo prima di riprovare' });
      }
      lastCaptureAttemptBySeeker.set(seekerId, Date.now());

      const round = await getRound(roundId);
      if (round.status !== 'hunting') return callback({ error: 'La caccia non è attiva' });

      const { rows: seekerRows } = await pool.query('SELECT * FROM players WHERE id = $1', [seekerId]);
      const { rows: targetRows } = await pool.query('SELECT * FROM players WHERE id = $1', [targetId]);
      const seeker = seekerRows[0];
      const target = targetRows[0];

      if (!seeker || seeker.role !== 'seeker') return callback({ error: 'Non sei un cercatore' });
      if (!target || target.role !== 'hider') return callback({ error: 'Target non valido' });
      if (target.is_eliminated) return callback({ error: 'Questo giocatore è già stato eliminato' });
      if (!seeker.real_lat || !target.real_lat) {
        return callback({ error: 'Posizione non disponibile, riprova tra poco' });
      }

      // Distanza REALE calcolata lato server: questo è il controllo anti-cheat fondamentale.
      const distanceM = haversineDistanceMeters(
        seeker.real_lat, seeker.real_lng,
        target.real_lat, target.real_lng
      );

      if (distanceM > round.capture_distance_m) {
        return callback({
          error: `Troppo lontano per catturare (${Math.round(distanceM)}m, serve essere entro ${round.capture_distance_m}m)`,
        });
      }

      // Upload foto su Cloudinary (free tier)
      const uploadResult = await cloudinary.uploader.upload(
        `data:image/jpeg;base64,${photoBase64}`,
        { folder: 'nascondino-catture' }
      );

      const { rows } = await pool.query(
        `INSERT INTO capture_attempts (round_id, seeker_id, target_id, photo_url, distance_at_capture_m, status)
         VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
        [roundId, seekerId, targetId, uploadResult.secure_url, distanceM]
      );

      // Notifica l'admin (nella room admin) che c'è una nuova foto da revisionare,
      // e notifica il cercatore che la richiesta è "in valutazione" (per mostrare l'animazione).
      io.to(`admin:${roundId}`).emit('new_capture_pending', { attempt: rows[0], seekerNickname: seeker.nickname, targetNickname: target.nickname });
      callback({ success: true, status: 'pending' });
    } catch (err) {
      console.error(err);
      callback({ error: 'Errore durante il caricamento della foto' });
    }
  });

  socket.on('disconnect', () => {
    // Non rimuoviamo il player dal DB: la riconnessione avviene tramite clientToken,
    // così se il telefono va in sleep e si riapre il browser il giocatore ritrova
    // il proprio ruolo/stato invece di perdere il posto in partita.
  });
});

async function checkRoundEndCondition(roundId) {
  // La condizione "tutti gli hider eliminati -> vincono i cercatori" ha senso
  // solo durante la caccia vera e propria. Se scattasse anche durante la fase
  // di nascondimento (es. un hider squalificato per uscita dai confini prima
  // ancora che i cercatori possano muoversi), terminerebbe una partita che
  // di fatto non è mai iniziata a livello di caccia.
  const round = await getRound(roundId);
  if (!round || round.status !== 'hunting') return;

  const allEliminated = await areAllHidersEliminated(roundId);
  if (allEliminated) {
    await endRound(roundId, 'seekers');
  }
}

// ============================================================
// SOCKET.IO — EVENTI ADMIN (protetti da codice di sblocco, validato via REST prima di entrare)
// ============================================================

io.on('connection', (socket) => {
  /**
   * admin_join: entra nella room admin di un round specifico, per ricevere
   * le foto da revisionare. L'autenticazione col codice avviene via REST
   * (endpoint /api/admin/verify) PRIMA che il client tenti questa join;
   * qui richiediamo comunque il token di sessione admin per sicurezza minima.
   */
  socket.on('admin_join', async ({ roundId, adminSessionToken }) => {
    if (adminSessionToken !== global.currentAdminSessionToken) return;
    socket.join(`admin:${roundId}`);
  });

  /**
   * admin_review_capture: l'admin approva o rifiuta una foto di cattura.
   * Se approvata: il target viene marcato eliminato e viene notificato A TUTTI
   * (broadcast) con il nome del giocatore preso, come richiesto.
   * Se rifiutata: il cercatore può ritentare (nessun blocco aggiuntivo oltre
   * al normale cooldown anti-spam).
   */
  socket.on('admin_review_capture', async ({ attemptId, approved, adminSessionToken }) => {
    if (adminSessionToken !== global.currentAdminSessionToken) return;

    const { rows } = await pool.query('SELECT * FROM capture_attempts WHERE id = $1', [attemptId]);
    const attempt = rows[0];
    if (!attempt || attempt.status !== 'pending') return;

    const newStatus = approved ? 'approved' : 'rejected';
    await pool.query(
      'UPDATE capture_attempts SET status = $1, reviewed_at = NOW() WHERE id = $2',
      [newStatus, attemptId]
    );

    const { rows: targetRows } = await pool.query('SELECT * FROM players WHERE id = $1', [attempt.target_id]);
    const target = targetRows[0];

    if (approved) {
      // Se nel frattempo il target è già stato eliminato da un'altra foto approvata
      // in parallelo (es. due cercatori hanno fotografato lo stesso giocatore quasi
      // insieme), evitiamo un secondo broadcast "eliminato" ridondante e confuso.
      if (target.is_eliminated) {
        return;
      }
      await pool.query(
        'UPDATE players SET is_eliminated = TRUE, eliminated_at = NOW() WHERE id = $1',
        [attempt.target_id]
      );
      // Notifica broadcast a TUTTI i giocatori del round, come richiesto esplicitamente.
      io.to(`round:${attempt.round_id}`).emit('player_eliminated', {
        playerId: attempt.target_id,
        nickname: target.nickname,
        reason: 'captured',
      });
      await broadcastGameState(attempt.round_id);
      await checkRoundEndCondition(attempt.round_id);
    } else {
      // Notifica solo il cercatore che la foto non è stata accettata, così può riprovare.
      const { rows: seekerRows } = await pool.query('SELECT * FROM players WHERE id = $1', [attempt.seeker_id]);
      const seeker = seekerRows[0];
      if (seeker?.socket_id) {
        io.to(seeker.socket_id).emit('capture_rejected', { attemptId, targetNickname: target.nickname });
      }
    }
  });
});

// ============================================================
// REST API — Setup partita, round, admin
// ============================================================

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

/**
 * Verifica il codice admin e restituisce un token di sessione temporaneo
 * (semplice, valido finché il server resta acceso — sufficiente per l'uso
 * previsto, non è un sistema multi-utente con permessi granulari).
 */
app.post('/api/admin/verify', async (req, res) => {
  const { code } = req.body;
  const { rows } = await pool.query('SELECT unlock_code FROM admin_config WHERE id = 1');
  if (rows[0]?.unlock_code === code) {
    global.currentAdminSessionToken = global.currentAdminSessionToken || nanoid(32);
    return res.json({ success: true, adminSessionToken: global.currentAdminSessionToken });
  }
  res.status(401).json({ success: false, error: 'Codice errato' });
});

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== global.currentAdminSessionToken) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }
  next();
}

// Crea una nuova "partita" (contenitore persistente per più round)
app.post('/api/admin/games', requireAdmin, async (req, res) => {
  const { name } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO games (name) VALUES ($1) RETURNING *',
    [name]
  );
  res.json(rows[0]);
});

app.get('/api/admin/games', requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM games ORDER BY created_at DESC');
  res.json(rows);
});

// Salva i confini dell'area di gioco (waypoint disegnati sulla mappa dall'admin)
app.put('/api/admin/games/:gameId/boundary', requireAdmin, async (req, res) => {
  const { waypoints } = req.body; // array di {lat, lng}
  const { rows } = await pool.query(
    'UPDATE games SET boundary_waypoints = $1 WHERE id = $2 RETURNING *',
    [JSON.stringify(waypoints), req.params.gameId]
  );
  res.json(rows[0]);
});

// Crea un nuovo round dentro una partita esistente, con le impostazioni (modificabili rispetto ai default)
app.post('/api/admin/games/:gameId/rounds', requireAdmin, async (req, res) => {
  const gameId = req.params.gameId;
  const { rows: gameRows } = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
  const game = gameRows[0];

  const {
    hideTimeSeconds = game.default_hide_time_seconds,
    huntTimeSeconds = game.default_hunt_time_seconds,
    maxObfuscationRadiusM = game.default_max_obfuscation_radius_m,
    positionIntervalSeconds = game.default_position_interval_seconds,
    captureDistanceM = game.capture_distance_m,
  } = req.body;

  const { rows } = await pool.query(
    `INSERT INTO rounds (game_id, hide_time_seconds, hunt_time_seconds, max_obfuscation_radius_m,
     position_interval_seconds, capture_distance_m)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [gameId, hideTimeSeconds, huntTimeSeconds, maxObfuscationRadiusM, positionIntervalSeconds, captureDistanceM]
  );
  res.json(rows[0]);
});

app.get('/api/rounds/:roundId', async (req, res) => {
  const round = await getRound(req.params.roundId);
  if (!round) return res.status(404).json({ error: 'Round non trovato' });
  const game = await getGameForRound(req.params.roundId);
  res.json({ round, game });
});

// Estrazione ruoli casuale (2 cercatori + coppie di nascosti)
app.post('/api/admin/rounds/:roundId/assign-random', requireAdmin, async (req, res) => {
  const roundId = req.params.roundId;
  const players = await getPlayersForRound(roundId);
  const updates = assignRolesRandomly(players.map((p) => p.id));
  await applyRoleAssignments(roundId, updates);
  const updatedPlayers = await getPlayersForRound(roundId);
  io.to(`round:${roundId}`).emit('lobby_update', { players: updatedPlayers });
  res.json({ players: updatedPlayers });
});

// Estrazione manuale: l'admin passa direttamente l'assegnazione {playerId, role, teamId}[]
app.post('/api/admin/rounds/:roundId/assign-manual', requireAdmin, async (req, res) => {
  const roundId = req.params.roundId;
  const { assignments } = req.body;
  await applyRoleAssignments(roundId, assignments);
  const updatedPlayers = await getPlayersForRound(roundId);
  io.to(`round:${roundId}`).emit('lobby_update', { players: updatedPlayers });
  res.json({ players: updatedPlayers });
});

// Avvia la partita: fa partire la fase di nascondimento
app.post('/api/admin/rounds/:roundId/start', requireAdmin, async (req, res) => {
  await beginHidingPhase(req.params.roundId);
  res.json({ success: true });
});

app.get('/api/admin/rounds/:roundId/pending-captures', requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ca.*, s.nickname as seeker_nickname, t.nickname as target_nickname
     FROM capture_attempts ca
     JOIN players s ON s.id = ca.seeker_id
     JOIN players t ON t.id = ca.target_id
     WHERE ca.round_id = $1 AND ca.status = 'pending'
     ORDER BY ca.created_at ASC`,
    [req.params.roundId]
  );
  res.json(rows);
});

const PORT = process.env.PORT || 3001;

initDatabase()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`Server in ascolto sulla porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Errore inizializzazione database:', err);
    process.exit(1);
  });
