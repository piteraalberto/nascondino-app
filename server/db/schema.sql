-- ============================================================
-- SCHEMA DATABASE - Nascondino GPS
-- ============================================================

-- Una "partita" è un contenitore che può avere più round nel tempo.
-- Serve a soddisfare il requisito "partite multiple salvate senza perdere lo storico".
CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Confini area di gioco: array di waypoint {lat, lng} in ordine, salvato come JSON
    boundary_waypoints JSONB DEFAULT '[]',
    -- Impostazioni di default per i round di questa partita (modificabili per singolo round)
    default_hide_time_seconds INTEGER DEFAULT 600,   -- 10 minuti
    default_hunt_time_seconds INTEGER DEFAULT 1800,  -- 30 minuti
    default_max_obfuscation_radius_m INTEGER DEFAULT 250,
    default_position_interval_seconds INTEGER DEFAULT 180, -- 3 minuti
    capture_distance_m INTEGER DEFAULT 50
);

-- Un "round" è una singola giocata dentro una partita (si può rigiocare più round nella stessa serata/partita)
CREATE TABLE IF NOT EXISTS rounds (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'lobby', -- lobby | hiding | hunting | finished
    created_at TIMESTAMPTZ DEFAULT NOW(),
    hide_time_seconds INTEGER NOT NULL,
    hunt_time_seconds INTEGER NOT NULL,
    max_obfuscation_radius_m INTEGER NOT NULL,
    position_interval_seconds INTEGER NOT NULL,
    capture_distance_m INTEGER NOT NULL,
    hiding_started_at TIMESTAMPTZ,
    hunting_started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    winner TEXT -- 'seekers' | 'hiders' | null se non finito
);

-- Giocatori collegati a un round specifico (ogni round riparte con nickname/ruoli freschi)
CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    socket_id TEXT, -- collegato alla sessione socket.io corrente (cambia ad ogni riconnessione)
    client_token TEXT NOT NULL, -- token persistente salvato lato client per riconnettersi allo stesso player
    role TEXT NOT NULL DEFAULT 'hider', -- 'seeker' | 'hider'
    team_id INTEGER, -- coppie di hider raggruppate insieme, null per i seeker
    is_eliminated BOOLEAN DEFAULT FALSE,
    eliminated_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    last_position_at TIMESTAMPTZ,
    -- ultima posizione reale nota (usata SOLO lato server per calcolo distanza cattura, mai esposta ai client)
    real_lat DOUBLE PRECISION,
    real_lng DOUBLE PRECISION,
    -- ultima posizione offuscata calcolata (quella mostrata ai seeker)
    fake_lat DOUBLE PRECISION,
    fake_lng DOUBLE PRECISION,
    fake_radius_m INTEGER, -- raggio del cerchio di incertezza mostrato (500m diametro = 250m raggio fisso sul punto fake)
    UNIQUE(round_id, client_token)
);

-- Storico tentativi di cattura, per audit e per gestire il flusso admin approva/rifiuta
CREATE TABLE IF NOT EXISTS capture_attempts (
    id SERIAL PRIMARY KEY,
    round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
    seeker_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
    target_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    distance_at_capture_m DOUBLE PRECISION NOT NULL, -- distanza reale calcolata lato server al momento dello scatto
    status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    created_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);

-- Codice di sblocco admin (semplice, una riga sola, lo cambi tu quando vuoi)
CREATE TABLE IF NOT EXISTS admin_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    unlock_code TEXT NOT NULL,
    CONSTRAINT single_row CHECK (id = 1)
);

CREATE INDEX IF NOT EXISTS idx_players_round ON players(round_id);
CREATE INDEX IF NOT EXISTS idx_capture_round ON capture_attempts(round_id);
CREATE INDEX IF NOT EXISTS idx_rounds_game ON rounds(game_id);
