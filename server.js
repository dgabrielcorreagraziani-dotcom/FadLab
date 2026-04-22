const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'db.json');

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve os arquivos do front-end (mesma pasta ou subpasta public)
app.use(express.static(path.join(__dirname, 'public')));

// ── Banco de dados simples em JSON ───────────────────────────
function readDb() {
  try {
    if (!fs.existsSync(DB_PATH)) return defaultDb();
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return defaultDb();
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function defaultDb() {
  return {
    users: [],
    messages: [],
    notifications: [],
    songs: [],
    scale: []
  };
}

// ── Rotas: leitura e escrita por chave ───────────────────────

// GET /api/:key  →  retorna o array da chave
app.get('/api/:key', (req, res) => {
  const { key } = req.params;
  const db = readDb();
  if (!(key in db)) return res.status(404).json({ error: 'Chave nao encontrada' });
  res.json(db[key]);
});

// PUT /api/:key  →  substitui o array inteiro da chave
app.put('/api/:key', (req, res) => {
  const { key } = req.params;
  const db = readDb();
  if (!(key in db)) return res.status(404).json({ error: 'Chave nao encontrada' });
  db[key] = req.body;
  writeDb(db);
  res.json({ ok: true });
});

// GET /api  →  retorna tudo (usado na sincronizacao inicial)
app.get('/api', (req, res) => {
  res.json(readDb());
});

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Rota fallback para o front-end ────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'indx.html'));
});

app.listen(PORT, () => {
  console.log(`FadLab backend rodando na porta ${PORT}`);
});
