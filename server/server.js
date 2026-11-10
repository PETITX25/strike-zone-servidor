// Strike Zone — servidor HTTP (estáticos) + WebSocket /ws + GET /health. Cero dependencias.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { acceptUpgrade } from './ws.js';
import { makeStatic } from './static.js';
import { loadRules } from './rules.js';
import { cfg, log, loadOperators } from './common.js';
import { Room, nextEntId } from './room.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const ROOT = process.env.STATIC_DIR || (fs.existsSync(path.join(REPO, 'dist', 'index.html')) ? path.join(REPO, 'dist') : REPO);

const sessions = new Map();     // id -> Session
const rooms = new Map();        // id -> Room
const codes = new Map();        // código privado -> Room
const totals = { bytesOut: 0, bytesIn: 0, msgsIn: 0, badMsgs: 0, conns: 0, tickMs: 0, tickMax: 0, ticks: 0 };
let bwWindow = { t: Date.now(), out: 0, rate: 0 };

class Session {
  constructor(ws) {
    this.id = nextEntId(); this.ws = null; this.name = 'Jugador'; this.op = 'halcon'; this.version = null;
    this.token = crypto.randomBytes(12).toString('hex');
    this.room = null; this.ent = null; this.hello = false;
    this.lastSeen = Date.now(); this.discAt = null;
    this.bucket = cfg.MSG_RATE * 2; this.bucketT = Date.now(); this.dropped = 0;
    this.win = { t: Date.now(), bytes: 0, prev: 0 };
    this.bytesOut = 0;
    this.bind(ws);
  }
  bind(ws) {
    this.ws = ws; this.discAt = null; this.lastSeen = Date.now();
    ws.on('message', (data, bin) => onMessage(this, ws, data, bin));
    ws.on('close', () => onClose(this, ws));
    ws.on('pong', () => { this.lastSeen = Date.now(); });
  }
  sendRaw(s, droppable = false) {
    const ws = this.ws; if (!ws || !ws.open) return false;
    if (!ws.send(s, droppable)) return false;
    const n = Buffer.byteLength(s) + (s.length < 126 ? 2 : s.length < 65536 ? 4 : 10);
    this.bytesOut += n; this.win.bytes += n; totals.bytesOut += n; bwWindow.out += n;
    return true;
  }
  send(obj) { return this.sendRaw(JSON.stringify(obj)); }
  // 0 = dentro de presupuesto, 1 = recortar lejanos, 2 = recortar también cercanos
  budgetOver(now) {
    if (now - this.win.t >= 1000) { this.win.prev = this.win.bytes; this.win.bytes = 0; this.win.t = now; }
    const projected = Math.max(this.win.prev, this.win.bytes * 1000 / Math.max(100, now - this.win.t));
    return projected > cfg.BUDGET * 1.5 ? 2 : projected > cfg.BUDGET ? 1 : 0;
  }
}

function onMessage(sess, ws, data, bin) {
  if (sess.ws !== ws) return;
  sess.lastSeen = Date.now(); totals.msgsIn++; totals.bytesIn += data.length;
  // limitación de tasa (cubo de fichas)
  const now = Date.now();
  sess.bucket = Math.min(cfg.MSG_RATE * 2, sess.bucket + (now - sess.bucketT) / 1000 * cfg.MSG_RATE); sess.bucketT = now;
  if (sess.bucket < 1) { if (++sess.dropped % 200 === 1) log(`[rate] ${sess.id} descarta mensajes (${sess.dropped})`); if (sess.dropped > 5000) ws.close(1008, 'rate'); return; }
  sess.bucket -= 1;
  if (bin || typeof data !== 'string' || data.length > cfg.MAX_MSG) { totals.badMsgs++; return; }
  let m;
  try { m = JSON.parse(data); } catch { totals.badMsgs++; return; }
  if (!m || typeof m !== 'object' || Array.isArray(m) && m.t == null || typeof m.t !== 'string') { totals.badMsgs++; return; }
  try { route(sess, m); } catch (e) { totals.badMsgs++; log('[error] mensaje', m.t, e.stack || e); }
}

function route(sess, m) {
  switch (m.t) {
    case 'hello': return onHello(sess, m);
    case 'ping': return sess.send({ t: 'pong', c: m.c, s: Date.now() });
  }
  if (!sess.hello) return sess.send({ t: 'error', code: 'nohello', msg: 'Envía hello primero' });
  switch (m.t) {
    case 'queue': return onQueue(sess, m);
    case 'leaveQueue': case 'leave': return leaveRoom(sess);
    default: if (sess.room) sess.room.handle(sess, m);
  }
}

function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Jugador'; }

function onHello(sess, m) {
  // reconexión: hello {rejoin:{id, token}}
  const rj = m.rejoin;
  if (rj && sessions.has(rj.id) && sessions.get(rj.id) !== sess) {
    const old = sessions.get(rj.id);
    if (old.token === rj.token && old.room && !old.room.closed) {
      const ws = sess.ws; sess.ws = null; sessions.delete(sess.id);
      ws.removeAllListeners('message'); ws.removeAllListeners('close'); ws.removeAllListeners('pong');
      if (old.ws && old.ws !== ws) { const ow = old.ws; old.ws = null; ow.terminate(); }
      old.bind(ws); old.hello = true;
      old.send({ t: 'welcome', id: old.id, serverTime: Date.now(), token: old.token, rejoined: true });
      const r = old.room;
      if (r.state === 'lobby') r.sendLobby();
      else if (old.ent) r.attach(old, old.ent);
      log(`[ses ${old.id}] reconectado a ${r.id}`);
      return;
    }
    return sess.send({ t: 'error', code: 'rejoin', msg: 'No se pudo volver a la partida' });
  }
  sess.name = cleanName(m.name); sess.op = typeof m.operatorId === 'string' ? m.operatorId.slice(0, 16) : 'halcon';
  sess.version = m.version ?? null; sess.hello = true;
  sess.send({ t: 'welcome', id: sess.id, serverTime: Date.now(), token: sess.token });
}

function onQueue(sess, m) {
  const mode = m.mode === 'rounds' ? 'rounds' : 'br';
  if (sess.room) leaveRoom(sess);
  let room = null;
  if (m.room) {
    const code = String(m.room).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
    if (m.room === 'new' || code.length !== 5) {
      let c; do { c = randomCodeFree(); } while (codes.has(c));
      room = newRoom(mode, c, true);
    } else {
      room = codes.get(code);
      if (room && room.closed) room = null;
      if (room && room.mode !== mode) return sess.send({ t: 'error', code: 'mode', msg: 'La sala es de otro modo' });
      if (!room) room = newRoom(mode, code, true);
    }
    if (!room.canJoin()) {
      const slot = room.state === 'live' && room.findBotSlot();
      if (slot) { room.attach(sess, slot, true); return; }
      return sess.send({ t: 'error', code: room.state === 'lobby' ? 'full' : 'started', msg: room.state === 'lobby' ? 'Sala llena' : 'La partida ya ha empezado' });
    }
  } else {
    for (const r of rooms.values()) if (!r.isPrivate && r.mode === mode && r.canJoin() && !r.closed) { room = r; break; }
    if (!room && mode === 'rounds') {
      // entrada a mitad de partida en rondas: ocupar el hueco de un bot
      for (const r of rooms.values()) if (!r.isPrivate && r.mode === 'rounds' && r.state === 'live' && !r.closed) { const slot = r.findBotSlot(); if (slot) { r.attach(sess, slot, true); return; } }
    }
    if (!room) room = newRoom(mode, null, false);
  }
  room.addMember(sess);
}
function randomCodeFree() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }
function newRoom(mode, code, isPrivate) {
  const r = new Room(mode, { code: code || undefined, isPrivate });
  rooms.set(r.id, r); if (isPrivate) codes.set(r.code, r);
  log(`[sala ${r.id}] creada ${mode}${isPrivate ? ' privada ' + r.code : ''}`);
  return r;
}
function leaveRoom(sess) {
  const r = sess.room; if (!r) return;
  r.removeMember(sess);
  sess.room = null; sess.ent = null;
}

function onClose(sess, ws) {
  if (sess.ws !== ws) return;
  sess.ws = null; sess.discAt = Date.now(); totals.conns--;
  const r = sess.room;
  if (r && r.state === 'lobby') { leaveRoom(sess); }
  else if (r && sess.ent && r.state === 'live') r.onDisconnect(sess.ent, false);
}

// ---------------------------------------------------------------- bucle principal
const TICK = 1000 / cfg.TICK_HZ;
let lastTick = performance.now();
function loop() {
  const t0 = performance.now();
  const dt = Math.min(0.25, (t0 - lastTick) / 1000); lastTick = t0;
  const now = Date.now();
  for (const r of rooms.values()) {
    try { r.tick(dt); } catch (e) { log('[error] tick sala', r.id, e.stack || e); }
    if (r.closed) { rooms.delete(r.id); if (codes.get(r.code) === r) codes.delete(r.code); for (const m of r.members) if (m.room === r) { m.room = null; m.ent = null; } }
  }
  // sesiones: heartbeat y expiración de reconexión
  for (const s of sessions.values()) {
    if (s.ws && now - s.lastSeen > cfg.HEARTBEAT_MS) { log(`[ses ${s.id}] timeout`); s.ws.terminate(); }
    else if (!s.ws && s.discAt && now - s.discAt > cfg.REJOIN_MS) {
      sessions.delete(s.id);
      if (s.room && s.ent && s.ent.sess === s) s.ent.sess = null;
      if (s.room) { const i = s.room.members.indexOf(s); if (i >= 0) s.room.members.splice(i, 1); }
    }
  }
  if (now - bwWindow.t >= 1000) { bwWindow.rate = bwWindow.out * 1000 / (now - bwWindow.t); bwWindow.out = 0; bwWindow.t = now; }
  const ms = performance.now() - t0;
  totals.tickMs += ms; totals.ticks++; totals.tickMax = Math.max(totals.tickMax, ms);
  setTimeout(loop, Math.max(0, TICK - ms));
}
// ping WS de transporte cada 10 s
setInterval(() => { for (const s of sessions.values()) s.ws?.ping(); }, 10000).unref();

export function stats() {
  const rs = [...rooms.values()].map(r => ({ id: r.id, mode: r.mode, state: r.state, humans: r.state === 'lobby' ? r.members.length : r.humans().length, ents: r.ents.size, private: r.isPrivate, ...r.stats }));
  return {
    ok: true, uptime: Math.round(process.uptime()), sessions: sessions.size, rooms: rs,
    bytesOutPerSec: Math.round(bwWindow.rate), bytesOutTotal: totals.bytesOut, bytesInTotal: totals.bytesIn, msgsIn: totals.msgsIn, badMsgs: totals.badMsgs,
    tickMsTotal: +totals.tickMs.toFixed(3), tickAvgMs: totals.ticks ? +(totals.tickMs / totals.ticks).toFixed(3) : 0, tickMaxMs: +totals.tickMax.toFixed(3), ticks: totals.ticks,
    cpu: process.cpuUsage(), mem: process.memoryUsage().rss,
  };
}
export function resetTickStats() { totals.tickMs = 0; totals.ticks = 0; totals.tickMax = 0; }

export async function startServer(port = cfg.PORT) {
  await loadRules(log); await loadOperators();
  const serveStatic = makeStatic(ROOT);
  const server = http.createServer((req, res) => {
    try {
      if (req.url === '/health' || req.url.startsWith('/health?')) {
        const body = JSON.stringify(stats());
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        return res.end(body);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      serveStatic(req, res);
    } catch (e) { log('[error] http', e); try { res.writeHead(500); res.end(); } catch { } }
  });
  server.on('upgrade', (req, socket, head) => {
    try {
      if (!req.url.startsWith('/ws')) { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
      if (sessions.size >= cfg.MAX_CLIENTS) { socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
      socket.on('error', () => { });
      const ws = acceptUpgrade(req, socket, head); if (!ws) return;
      const s = new Session(ws); sessions.set(s.id, s); totals.conns++;
    } catch (e) { log('[error] upgrade', e); socket.destroy(); }
  });
  server.on('clientError', (e, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { } });
  await new Promise((res) => server.listen(port, res));
  log(`Strike Zone servidor en :${server.address().port} (estáticos: ${ROOT}) WS /ws`);
  lastTick = performance.now(); setTimeout(loop, TICK);
  return server;
}

process.on('uncaughtException', (e) => log('[fatal evitado]', e.stack || e));
process.on('unhandledRejection', (e) => log('[promesa]', e));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
