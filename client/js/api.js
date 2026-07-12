// ============================================================
// API — wrapper per le chiamate REST al backend
// ============================================================

const API = {
  async post(path, body, adminToken = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (adminToken) headers['x-admin-token'] = adminToken;
    const res = await fetch(`${CONFIG.SERVER_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Errore di rete');
    return data;
  },

  async put(path, body, adminToken = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (adminToken) headers['x-admin-token'] = adminToken;
    const res = await fetch(`${CONFIG.SERVER_URL}${path}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Errore di rete');
    return data;
  },

  async get(path, adminToken = null) {
    const headers = {};
    if (adminToken) headers['x-admin-token'] = adminToken;
    const res = await fetch(`${CONFIG.SERVER_URL}${path}`, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Errore di rete');
    return data;
  },
};
