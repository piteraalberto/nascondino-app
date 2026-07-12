# 🙈 Nascondino GPS

App web per giocare a nascondino con geolocalizzazione reale tra amici. Backend Node.js + Socket.io + Postgres, frontend vanilla JS con mappa Leaflet/OpenStreetMap.

---

## 🧩 Come funziona il gioco (riassunto)

1. **Tu (admin)** crei una partita, disegni i confini dell'area su mappa, crei un round con le impostazioni (tempi, raggio offuscamento).
2. **I giocatori** aprono il link, inseriscono un nickname, entrano in lobby.
3. **Tu estrai (o assegni)** 2 cercatori + il resto in coppie nascoste.
4. **Fase nascondimento**: timer condiviso, i nascosti si posizionano.
5. **Fase caccia**: i cercatori vedono una mappa con le posizioni **camuffate** (cerchio impreciso) di ogni nascosto; i nascosti vedono solo il proprio timer e se sono stati presi.
6. **Cattura**: il cercatore deve essere a meno di 50m REALI (controllo lato server, non falsificabile), sceglie il target, scatta una foto. La foto arriva a te nel pannello admin: approvi o rifiuti.
7. Se approvi, il giocatore risulta eliminato e **tutti** ricevono una notifica.
8. Il round finisce quando tutti i nascosti sono presi, o allo scadere del tempo.

---

## 💰 Costi: tutto gratuito

| Servizio | A cosa serve | Costo | Carta richiesta? |
|---|---|---|---|
| [Render.com](https://render.com) | Ospita il backend (server + database) | Gratis | No |
| [Cloudinary](https://cloudinary.com) | Salva le foto delle catture | Gratis fino a 25GB/mese | No |
| OpenStreetMap / Leaflet | Mappa e disegno confini | Sempre gratis | Non serve nemmeno registrarsi |
| OSRM (router.project-osrm.org) | Aggancia i confini alle strade | Gratis (servizio pubblico) | No |

**Nessuna chiave Google Maps richiesta.** L'unica chiave API che ti serve davvero è quella di Cloudinary, gratuita.

### ⚠️ Limite da conoscere: il server "dorme"

Il piano gratuito di Render mette il server in pausa dopo 15 minuti senza richieste. Quando qualcuno riapre l'app dopo una pausa, il server impiega 30-60 secondi a "svegliarsi" (la prima richiesta sarà lenta, poi tutto torna normale). **Consiglio pratico**: apri il pannello admin 2-3 minuti prima di iniziare a far entrare i giocatori nella lobby, così il server è già sveglio.

Il database Postgres gratuito scade dopo 30 giorni e va ricreato (perdendo lo storico vecchio, ma non il funzionamento) — per giocare qualche sera con gli amici è ampiamente sufficiente.

---

## 🚀 Deploy — Passo per passo

### 1. Crea un account Cloudinary (per le foto)

1. Vai su [cloudinary.com](https://cloudinary.com) e registrati gratis
2. Nella Dashboard trovi subito **Cloud Name**, **API Key**, **API Secret** — tienili a portata di mano

### 2. Carica il progetto su GitHub

Render fa il deploy leggendo da un repository GitHub. Se non hai già un repository:

```bash
cd nascondino-app
git init
git add .
git commit -m "Prima versione Nascondino GPS"
```

Poi crea un repository vuoto su [github.com/new](https://github.com/new) e segui le istruzioni per collegarlo (`git remote add origin ...` e `git push`).

### 3. Deploy su Render con Blueprint (metodo consigliato, un click)

1. Vai su [dashboard.render.com](https://dashboard.render.com)
2. Clicca **New** → **Blueprint**
3. Collega il tuo repository GitHub
4. Render legge automaticamente `render.yaml` e propone di creare sia il **web service** che il **database Postgres** insieme
5. Conferma. Il primo deploy richiede qualche minuto.
6. Una volta completato, vai su **Environment** del web service `nascondino-server` e imposta manualmente queste variabili (quelle segnate `sync: false` nel blueprint):
   - `ADMIN_UNLOCK_CODE` → scegli un codice numerico che userai tu per sbloccare le impostazioni
   - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` → dal passo 1
7. Salva: Render rifà automaticamente il deploy con le nuove variabili
8. Copia l'URL pubblico del tuo servizio (tipo `https://nascondino-server-xxxx.onrender.com`)

### 4. Collega il frontend al backend

Apri `client/js/config.js` e sostituisci:

```js
: 'https://TUO-BACKEND.onrender.com', // <-- SOSTITUISCI dopo il deploy su Render
```

con l'URL vero copiato al passo precedente.

### 5. Metti online il frontend

Il frontend è solo HTML/CSS/JS statico, quindi hai varie opzioni gratuite. La più semplice:

**Opzione A — Render Static Site (stesso account, comodo)**
1. Su Render: **New** → **Static Site**
2. Collega lo stesso repository, imposta come **Root Directory** la cartella `client`
3. Build command: vuoto (non serve build, è già HTML puro)
4. Publish directory: `.` (la cartella stessa)
5. Deploy — ottieni un secondo URL, questo è il link da condividere con gli amici

**Opzione B — Netlify Drop (ancora più veloce, drag & drop)**
1. Vai su [app.netlify.com/drop](https://app.netlify.com/drop)
2. Trascina la cartella `client` nella pagina
3. Ottieni subito un URL pubblico, senza nemmeno bisogno di un account

Entrambe sono gratuite e senza carta di credito.

---

## 🎮 Come si gioca (per te, organizzatore)

1. Apri il link del frontend, clicca **"Sono l'organizzatore"**, inserisci il tuo `ADMIN_UNLOCK_CODE`
2. Tab **Partite** → crea una nuova partita con un nome
3. Selezionala, poi tab **Confini mappa** → clicca sulla mappa per aggiungere i waypoint dell'area di gioco (minimo 3 punti). La linea si aggancia automaticamente alle strade. Salva.
4. Tab **Gestione round** → imposta i tempi (default 10min nascondersi, 30min cercare, 250m raggio offuscamento, 3min intervallo posizione, 50m distanza cattura) → **Crea round**
5. Condividi il **codice round** mostrato con i tuoi amici — loro lo inseriscono nella home dell'app insieme al proprio nickname
6. Quando tutti sono in lobby: **Estrai ruoli casualmente** (oppure assegna manualmente)
7. **Avvia partita** — parte il timer di nascondimento, poi automaticamente quello di caccia
8. Quando arrivano foto di cattura, le vedi nella tab **Foto da approvare**: guardi la foto e la distanza registrata, poi approvi o rifiuti
9. A fine round tutti vedono chi ha vinto

---

## 🛠️ Sviluppo locale (opzionale, se vuoi testare prima del deploy)

### Backend
```bash
cd server
npm install
cp .env.example .env
# modifica .env con un DATABASE_URL Postgres locale o remoto, e le chiavi Cloudinary
npm run dev
```

### Frontend
Basta aprire `client/index.html` con un server statico qualsiasi (es. estensione "Live Server" di VS Code), oppure:
```bash
cd client
npx serve
```
Assicurati che `config.js` punti a `http://localhost:3001` (è già così di default quando l'hostname è `localhost`).

**Nota**: la geolocalizzazione del browser richiede HTTPS per funzionare, TRANNE su `localhost` dove è permessa anche in HTTP — quindi lo sviluppo locale funziona senza certificati, ma il sito online deve essere per forza servito in HTTPS (Render e Netlify lo fanno automaticamente).

---

## 📁 Struttura del progetto

```
nascondino-app/
├── render.yaml              # Config per deploy automatico su Render
├── server/                  # Backend Node.js
│   ├── index.js              # Server Express + Socket.io, tutta la logica real-time
│   ├── db/
│   │   ├── schema.sql         # Schema Postgres (partite, round, giocatori, catture)
│   │   └── pool.js            # Connessione database
│   ├── game/
│   │   └── roundManager.js    # Logica fasi round, estrazione team
│   └── utils/
│       └── geo.js             # Calcoli geografici (distanza reale, offuscamento, confini)
└── client/                  # Frontend statico
    ├── index.html             # Tutte le schermate dell'app
    ├── css/style.css
    └── js/
        ├── config.js           # URL del backend
        ├── api.js              # Chiamate REST
        ├── geo-client.js       # Identità persistente, wake lock, GPS
        ├── router.js           # Cambio schermata
        ├── home.js             # Home + join
        ├── admin.js            # Pannello organizzatore
        ├── lobby.js            # Lobby + listener socket globali
        ├── game-hiding.js      # Fase nascondimento
        ├── game-hunting-seeker.js  # Fase caccia, vista cercatore
        ├── game-hunting-hider.js   # Fase caccia, vista nascosto
        ├── photo-capture.js    # Scatto foto cattura
        └── main.js             # Avvio app
```

---

## 🔒 Note su sicurezza e anti-cheat

- La **distanza per la cattura** viene sempre calcolata lato server usando le posizioni GPS reali salvate nel database, mai fidandosi di un valore mandato dal client — questo impedisce di falsificare la propria distanza.
- C'è un **cooldown di 5 secondi** tra un tentativo di cattura e l'altro dallo stesso cercatore, per impedire lo spam di foto ravvicinate.
- La **posizione reale** di ogni giocatore non viene mai inviata al client di nessun altro giocatore: solo la versione offuscata (per i cercatori) o nessuna (per i nascosti, che non vedono le posizioni altrui).
- L'accesso admin è protetto da codice, ma è un sistema semplice pensato per uso tra amici, non per un contesto con utenti potenzialmente ostili.
