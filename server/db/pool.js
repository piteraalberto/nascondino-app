import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

// Render fornisce DATABASE_URL automaticamente quando colleghi un Postgres al web service.
// In locale, usa un .env con DATABASE_URL=postgres://...
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
});

/**
 * Esegue lo schema.sql all'avvio, se le tabelle non esistono già.
 * CREATE TABLE IF NOT EXISTS rende l'operazione sicura da rieseguire ad ogni deploy.
 *
 * Eseguiamo uno statement alla volta (invece di mandare l'intero file come
 * un'unica query) così, se qualcosa fallisce, il messaggio di errore indica
 * esattamente quale CREATE TABLE/INDEX ha dato problemi invece di un errore
 * generico sull'intero blocco.
 */
export async function initDatabase() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaRaw = fs.readFileSync(schemaPath, 'utf-8');

  // Rimuove le righe di commento prima di splittare sui ';', altrimenti uno split
  // naive rischierebbe di scartare uno statement se il blocco di commento sopra
  // di esso finisse nello stesso "pezzo" dopo lo split.
  const schemaNoComments = schemaRaw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const statements = schemaNoComments.split(';').map((s) => s.trim()).filter((s) => s.length > 0);

  for (const statement of statements) {
    try {
      await pool.query(statement);
    } catch (err) {
      console.error(`Errore eseguendo lo statement SQL:\n${statement}\n`);
      throw err;
    }
  }

  // Imposta un codice admin di default se non esiste ancora nessuna riga
  const { rows } = await pool.query('SELECT * FROM admin_config WHERE id = 1');
  if (rows.length === 0) {
    const defaultCode = process.env.ADMIN_UNLOCK_CODE || '123456';
    await pool.query(
      'INSERT INTO admin_config (id, unlock_code) VALUES (1, $1)',
      [defaultCode]
    );
    console.log(`Codice admin di default impostato: ${defaultCode} (cambialo con la variabile ADMIN_UNLOCK_CODE)`);
  }

  console.log('Database inizializzato correttamente.');
}
