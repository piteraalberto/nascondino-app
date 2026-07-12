// ============================================================
// UTILITY GEOGRAFICHE
// Tutta la matematica delicata del gioco vive qui, isolata e testabile.
// ============================================================

const EARTH_RADIUS_M = 6371000;

/**
 * Distanza reale in metri tra due coordinate (formula di Haversine).
 * Usata SOLO lato server con le posizioni VERE per validare le catture.
 * Non fidarsi mai di una distanza calcolata o inviata dal client.
 */
export function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Sposta un punto (lat,lng) di `distanceM` metri in direzione `bearingDeg` (0=nord, 90=est...).
 * Serve per costruire il punto camuffato a partire dalla posizione reale.
 */
export function movePoint(lat, lng, distanceM, bearingDeg) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;

  const angularDistance = distanceM / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(lat);
  const lng1 = toRad(lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

/**
 * Calcola la posizione "camuffata" da mostrare ai cercatori, seguendo esattamente
 * la regola del gioco:
 * 1. Cerchio di raggio casuale R tra 0 e maxRadius (default 250m) attorno al punto reale
 * 2. Punto casuale sulla CIRCONFERENZA di quel cerchio (non dentro, proprio sul bordo)
 * 3. Nuovo cerchio centrato su quel punto casuale, con diametro 2*maxRadius (default 500m,
 *    quindi raggio 250m fisso) — questo è il cerchio che vede chi cerca.
 *
 * Il punto reale resta sempre nascosto: solo fakeLat/fakeLng + fakeRadius vengono esposti.
 */
export function computeObfuscatedPosition(realLat, realLng, maxRadiusM) {
  // Step 1: raggio casuale tra 0 e maxRadiusM
  const randomRadius = Math.random() * maxRadiusM;

  // Step 2: bearing casuale (0-360°) per trovare un punto sulla circonferenza di quel cerchio
  const randomBearing = Math.random() * 360;
  const circlePoint = movePoint(realLat, realLng, randomRadius, randomBearing);

  // Step 3: il cerchio finale mostrato ha come centro il punto casuale trovato,
  // e raggio pari a maxRadiusM (quindi diametro 2*maxRadiusM, es. 500m con default 250m)
  return {
    fakeLat: circlePoint.lat,
    fakeLng: circlePoint.lng,
    fakeRadiusM: maxRadiusM,
  };
}

/**
 * Ray casting algorithm: controlla se un punto è dentro un poligono (l'area di gioco).
 * `polygon` è un array di {lat, lng} che rappresentano i waypoint del confine, in ordine.
 * Se un giocatore è FUORI da questo poligono, va squalificato (regola numero 1).
 */
export function isPointInPolygon(lat, lng, polygon) {
  if (!polygon || polygon.length < 3) return true; // nessun confine impostato = nessun limite

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;

    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
