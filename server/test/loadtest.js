// Prueba de carga headless: N clientes WebSocket falsos (cliente WS propio de ../ws.js).
//  1) Unidad: horario de zona.  2) BR con N (=100) humanos: cola, inicio, avión, salto, combate, snapshots,
//  daño/derribo/kill/fin, anti-trampas, medición de CPU por tick y ancho de banda.
//  3) BR privada con 2 humanos + 98 bots: host, bots, desconexión/reconexión, migración de host.
//  4) Rondas 4v4 privada: compra, fases, rondas hasta 4, fin.
// Uso: node server/test/loadtest.js [N=100] [segundosBR=45]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { connect } from '../ws.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const N = +(process.argv[2] || 100);
const BR_SECONDS = +(process.argv[3] || 45);
const PORT = 18000 + Math.floor(Math.random() * 2000);
const URL_WS = `ws://127.0.0.1:${PORT}/ws`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✔', msg); else { failures++; console.log('  ✘', msg); } }
function health() {
  return new Promise((res, rej) => http.get(`http://127.0.0.1:${PORT}/health`, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));
}
const M4 = { damage: 26, headMult: 1.9, falloff: [45, 170, 0.72] };
function dmgAt(d) { const [a, b, m] = M4.falloff; if (d <= a) return M4.damage; if (d >= b) return M4.damage * m; return M4.damage * (1 - (1 - m) * (d - a) / (b - a)); }

class Bot {
  constructor(name) { this.name = name; this.log = []; this.count = {}; this.bytes = 0; this.snapBytes = 0; this.snaps = 0; this.world = new Map(); this.waiters = []; }
  async open() {
    this.ws = await connect(URL_WS);
    this.ws.on('message', (s) => {
      this.bytes += s.length + 2;
      let m; try { m = JSON.parse(s); } catch { return; }
      this.count[m.t] = (this.count[m.t] || 0) + 1;
      if (m.t === 'snap') { this.snaps++; this.snapBytes += s.length; for (const e of m.e) this.world.set(e[0], { p: [e[1], e[2], e[3]], st: e[6], hp: e[9], at: Date.now() }); }
      else this.log.push(m);
      this.onMsg?.(m);
      for (let i = this.waiters.length - 1; i >= 0; i--) if (this.waiters[i].f(m)) { this.waiters[i].res(m); this.waiters.splice(i, 1); }
    });
    return this;
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(f, ms = 8000) {
    if (typeof f === 'string') { const t = f; f = (m) => m.t === t; }
    const found = this.log.find(f); if (found) return Promise.resolve(found);
    return new Promise((res, rej) => { const w = { f, res }; this.waiters.push(w); setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); rej(new Error(`${this.name}: timeout esperando`)); } }, ms); });
  }
  async hello(extra = {}) { this.send({ t: 'hello', name: this.name, operatorId: 'halcon', version: 1, ...extra }); const w = await this.wait('welcome'); this.id = w.id; this.token = w.token; return w; }
  close() { this.ws.terminate(); }
}

// ---------------------------------------------------------------- 1) unidad: zona
async function unitZone() {
  console.log('\n[1] Horario de zona / avión (unidad)');
  process.env.QUIET = '1';
  const { Room } = await import('../room.js');
  const { loadRules } = await import('../rules.js'); await loadRules(() => { });
  const r = new Room('br'); r.t0 = Date.now(); r.rand = (await import('../rules.js')).rng(1234); r._initBR();
  check(r.zones.length === 8 && r.zones[0].r === 560 && r.zones[7].r === 0, 'zonas: 7 fases + colapso final (radios 560 … 12, 0)');
  const z0 = r.zoneNow(5); r.zoneIdx = 0;
  const zA = (() => { r.zoneIdx = 0; return r.zoneNow(4 + 108 + 72); })();
  check(Math.abs(z0.r - 924) < 0.01 && zA.r === 560 && zA.dps === 1, `fase 1: r 924 → 560 (dps ${zA.dps})`);
  r.zoneIdx = 1; const zB = r.zoneNow(4 + 180 + 10);
  check(zB.r === 560 && zB.dps === 1, 'fase 2 en espera: r 560, dps de la fase anterior');
  const total = r.zoneSched.at(-1).shrinkEnd; r.zoneIdx = 7;
  check(r.zoneNow(total + 1).r === 0 && r.zoneNow(total + 1).dps === 20, `colapso final a los ${total.toFixed(0)} s, dps 20`);
  const pl = r.plane; check(Math.abs(Math.hypot(pl.to[0] - pl.from[0], pl.to[1] - pl.from[1]) - 2030) < 1 && Math.abs(pl.dur - 2030 / 60) < 0.1, `avión: ${pl.dur}s a ${pl.alt} m`);
}

// ---------------------------------------------------------------- 2) BR con N humanos
async function testBR() {
  console.log(`\n[2] Battle Royale con ${N} clientes`);
  const bots = [];
  for (let i = 0; i < N; i++) bots.push(new Bot('C' + i));
  const tc = Date.now();
  await Promise.all(bots.map(b => b.open()));
  await Promise.all(bots.map(b => b.hello()));
  check(true, `${N} conexiones + hello en ${Date.now() - tc} ms`);
  for (const b of bots) b.send({ t: 'queue', mode: 'br' });
  const starts = await Promise.all(bots.map(b => b.wait('start', 15000)));
  check(bots.every(b => b.count.lobby > 0), 'todos recibieron lobby');
  const st0 = starts[0];
  check(starts.every(s => s.seed === st0.seed && s.roster.length === 100), `start: misma semilla y roster de 100 (${starts[0].roster.filter(r => r.bot).length} bots)`);
  check(st0.zones.length === 8 && st0.plane && st0.plane.dur > 0 && st0.host === bots[0].id, 'start incluye avión, zonas y host = primer jugador');
  const teamOf = new Map(st0.roster.map(r => [r.id, r.team]));
  const counts = {}; for (const r of st0.roster) counts[r.team] = (counts[r.team] || 0) + 1;
  check(Object.keys(counts).length === 25 && Object.values(counts).every(c => c === 4), '25 escuadras de 4');
  for (let i = 0; i < N; i++) bots[i].team = starts[i].you.team;

  const pl = st0.plane, t0 = st0.t0;
  const planeAt = (t) => { const k = Math.max(0, Math.min(1, (t - pl.start) / pl.dur)); return [pl.from[0] + (pl.to[0] - pl.from[0]) * k, pl.alt, pl.from[1] + (pl.to[1] - pl.from[1]) * k]; };
  // objetivo de aterrizaje: escuadras por parejas alrededor del centro de la ruta
  const mid = planeAt(pl.start + pl.dur * 0.5);
  for (const b of bots) {
    const pair = Math.floor(b.team / 2), side = b.team % 2 ? 1 : -1;
    const a = pair / 13 * Math.PI * 2;
    b.target = [mid[0] + Math.cos(a) * 90 + side * 12 + Math.random() * 4, 0, mid[2] + Math.sin(a) * 90 + Math.random() * 4];
    b.state = 'plane'; b.p = [...planeAt(0)]; b.seq = 0; b.lastFire = 0; b.jumpAt = pl.start + 1 + Math.random() * 3; b.hp = 100;
  }
  // anti-trampas: C99 intentará teletransportarse y disparar demasiado rápido / con daño excesivo
  const cheater = bots[N - 1];
  const t1 = Date.now();
  const h0 = await health();
  const cpu0 = process.cpuUsage();
  let stopped = false, frame = 0;
  const mine = new Set(bots.map(b => b.id));
  const step = () => {
    if (stopped) return;
    frame++;
    const t = (Date.now() - t0) / 1000, dt = 1 / 15;
    for (const b of bots) {
      if (b.dead) continue;
      if (b.state === 'plane') {
        b.p = planeAt(t);
        if (t >= b.jumpAt) { b.send({ t: 'jump' }); b.state = 'freefall'; b.p = planeAt(t); b.p[0] -= 5; }
      } else if (b.state === 'freefall' || b.state === 'parachute') {
        const dx = b.target[0] - b.p[0], dz = b.target[2] - b.p[2], d = Math.hypot(dx, dz), hs = Math.min(d, 40 * dt);
        if (d > 0.01) { b.p[0] += dx / d * hs; b.p[2] += dz / d * hs; }
        b.p[1] = Math.max(0, b.p[1] - 45 * dt);
        if (b.p[1] < 120) b.state = 'parachute';
        if (b.p[1] <= 0) b.state = 'alive';
      } else if (b.state === 'alive' && b.reviving) { /* quieto mientras reanima */
      } else if (b.state === 'alive') {
        // buscar enemigo más cercano en el mundo replicado
        let best = null, bd = 1e9;
        for (const [id, e] of b.world) {
          if (teamOf.get(id) === b.team || (e.st !== 'alive' && e.st !== 'knocked') || Date.now() - e.at > 1500) continue;
          const d = Math.hypot(e.p[0] - b.p[0], e.p[2] - b.p[2]); if (d < bd) { bd = d; best = { id, e }; }
        }
        if (best && bd > 25) { const dx = best.e.p[0] - b.p[0], dz = best.e.p[2] - b.p[2]; b.p[0] += dx / bd * 6 * dt; b.p[2] += dz / bd * 6 * dt; }
        else { b.p[0] += (Math.random() - 0.5) * 0.4; b.p[2] += (Math.random() - 0.5) * 0.4; }
        if (best && bd < 120 && Date.now() - b.lastFire > 200) {
          b.lastFire = Date.now();
          const head = Math.random() < 0.2;
          const d = [best.e.p[0] - b.p[0], 0, best.e.p[2] - b.p[2]].map(v => v / Math.max(bd, 0.01));
          b.send({ t: 'fire', w: 'm4', o: [b.p[0], 1.6, b.p[2]], d, hits: Math.random() < 0.6 ? [{ target: best.id, dmg: +dmgAt(bd).toFixed(2), head, pt: best.e.p }] : [] });
          b.shots = (b.shots || 0) + 1;
        }
      }
      if (b.state === 'knocked') { /* quieto */ }
      b.send({ t: 'state', seq: b.seq++, p: b.p.map(v => +v.toFixed(2)), v: [0, 0, 0], yaw: 0.5, pitch: 0, st: b.state, cr: 0, ads: 0, w: b.state === 'alive' ? 'm4' : 'm1911' });
    }
  };
  // seguir estados autoritativos
  for (const b of bots) b.onMsg = (m) => {
    if ((m.t === 'knock' && m.victim === b.id)) b.state = 'knocked';
    if (m.t === 'kill' && m.victim === b.id) { b.state = 'dead'; b.dead = true; }
    if (m.t === 'revived' && m.target === b.id) b.state = 'alive';
    if (m.t === 'correct' && m.id === b.id) b.p = [...m.p];
  };
  const iv = setInterval(step, 1000 / 15);
  // a los 12 s: trampas
  await sleep(12000);
  if (cheater.state === 'alive') {
    cheater.p = [cheater.p[0] + 300, 0, cheater.p[2]];   // teletransporte
    cheater.send({ t: 'state', seq: cheater.seq++, p: cheater.p, v: [0, 0, 0], yaw: 0, pitch: 0, st: 'alive', cr: 0, ads: 0, w: 'm4' });
  }
  // revivir: los compañeros cercanos a un derribado lo reaniman (prueba de reanimación)
  const revIv = setInterval(() => {
    for (const b of bots) if (b.state === 'alive') for (const o of bots) if (o !== b && o.team === b.team && o.state === 'knocked' && Math.hypot(o.p[0] - b.p[0], o.p[2] - b.p[2]) < 8 && !b.reviving) {
      b.p = [o.p[0] + 1, o.p[1], o.p[2]]; b.reviving = true; setTimeout(() => { b.send({ t: 'revive', target: o.id, phase: 'start' }); setTimeout(() => b.reviving = false, 6000); }, 400);
    }
  }, 500);
  const endP = Promise.race(bots.map(b => b.wait('end', BR_SECONDS * 1000).catch(() => null)));
  const endMsg = await endP;
  const t2 = Date.now();
  stopped = true; clearInterval(iv); clearInterval(revIv);
  const cpu1 = process.cpuUsage(cpu0);
  const h1 = await health();
  const secs = (t2 - t1) / 1000;
  const totalSnapBytes = bots.reduce((a, b) => a + b.snapBytes, 0), totalBytes = bots.reduce((a, b) => a + b.bytes, 0);
  const snaps = bots.reduce((a, b) => a + b.snaps, 0);
  const all = bots.flatMap(b => b.log);
  const dmgs = bots.flatMap(b => b.log.filter(m => m.t === 'dmg'));
  const kills = bots[0].log.filter(m => m.t === 'kill'), knocks = bots[0].log.filter(m => m.t === 'knock');
  check(snaps > N * secs * 5, `snapshots fluyen: ${(snaps / N / secs).toFixed(1)} snaps/s por cliente`);
  check(dmgs.length > 50 && dmgs.every(d => d.amount >= 0 && d.amount <= 26 * 1.9 + 0.01 && d.hp >= 0 && d.hp <= 100), `${dmgs.length} eventos dmg válidos (amount ≤ máx. M4)`);
  check(knocks.length > 0 && kills.length > 0, `derribos=${knocks.length} kills=${kills.length} (killfeed difundido)`);
  check(kills.every(k => teamOf.get(k.attacker) !== teamOf.get(k.victim) || k.attacker == null), 'sin kills por fuego amigo');
  const revs = bots[0].log.filter(m => m.t === 'revived').length;
  const revStarts = all.filter(m => m.t === 'reviveState' && m.phase === 'start').length;
  check(revStarts > 0, `reanimaciones iniciadas=${revStarts}, completadas=${revs}`);
  check(bots.some(b => b.log.some(m => m.t === 'credits' && m.amount === 100)), 'créditos por kill (+100)');
  check(bots[0].log.filter(m => m.t === 'squadOut').length > 0, `escuadras eliminadas: ${bots[0].log.filter(m => m.t === 'squadOut').length}`);
  check(bots[0].log.some(m => m.t === 'lootSpawn' && m.crate?.kind === 'death'), 'caja de botín al morir (lootSpawn)');
  check(cheater.log.some(m => m.t === 'correct') || cheater.dead, 'teletransporte del tramposo corregido (correct)');
  if (endMsg) check(endMsg.placements[0].place === 1 && Object.keys(endMsg.stats).length === 100, `end: ganador escuadra ${endMsg.winnerTeam}, ${endMsg.placements.length} posiciones`);
  else check(false, `end no recibido en ${BR_SECONDS}s`);
  // loot: dos clientes reclaman el mismo id → solo uno gana
  // (la sala ya terminó; se prueba en el test 3)
  const ticks = h1.ticks - h0.ticks, tickMs = (h1.tickMsTotal - h0.tickMsTotal) / Math.max(1, ticks);
  const scpu = ((h1.cpu.user + h1.cpu.system) - (h0.cpu.user + h0.cpu.system)) / 1000;
  const report = {
    clients: N, seconds: +secs.toFixed(1),
    serverOutKBps: +(((h1.bytesOutTotal - h0.bytesOutTotal) / secs) / 1024).toFixed(1),
    perClientKBps: +((totalBytes / N / secs) / 1024).toFixed(2), perClientSnapKBps: +((totalSnapBytes / N / secs) / 1024).toFixed(2),
    serverInKBps: +(((h1.bytesInTotal - h0.bytesInTotal) / secs) / 1024).toFixed(1),
    tickAvgMs: +tickMs.toFixed(3), tickMaxMs: h1.tickMaxMs, serverCpuPct: +(scpu / (secs * 1000) * 100).toFixed(1), testerCpuPct: +((cpu1.user + cpu1.system) / 1000 / (secs * 1000) * 100).toFixed(1),
    dmgEvents: dmgs.length, kills: kills.length, knocks: knocks.length, rejectedHits: h1.rooms.find(r => r.mode === 'br')?.rejectedHits,
  };
  console.log('  métricas:', JSON.stringify(report));
  for (const b of bots) b.close();
  await sleep(300);
  return report;
}

// ---------------------------------------------------------------- 3) BR privada: host, bots, loot, reconexión, migración
async function testHost() {
  console.log('\n[3] BR privada 2 humanos + 98 bots: host, bots, loot, reconexión, migración');
  const A = await new Bot('Ana').open(), B = await new Bot('Beto').open();
  await A.hello(); await B.hello();
  A.send({ t: 'queue', mode: 'br', room: 'new' });
  const lob = await A.wait(m => m.t === 'lobby' && m.code);
  B.send({ t: 'queue', mode: 'br', room: lob.code });
  await B.wait(m => m.t === 'lobby' && m.players.length === 2);
  const sA = await A.wait('start', 10000), sB = await B.wait('start', 10000);
  check(sA.roster.filter(r => r.bot && r.hostSim).length === 98 && sA.host === A.id, 'sala privada: 98 bots simulados por el host (Ana)');
  check(sA.you.team === sB.you.team, 'amigos con código en la misma escuadra');
  // BR sin entrada a mitad de partida
  const C = await new Bot('Carla').open(); await C.hello();
  C.send({ t: 'queue', mode: 'br', room: lob.code });
  const err = await C.wait('error'); check(err.code === 'started', 'BR: no se permite entrar con la partida empezada');
  C.close();
  // salir del avión y posicionarse
  await sleep(Math.max(0, sA.t0 + 4300 - Date.now()));
  const enemyBot = sA.roster.find(r => r.bot && r.team !== sA.you.team);
  const pl = sA.plane; const k = ((Date.now() - sA.t0) / 1000 - 4) / pl.dur;
  const pp = [pl.from[0] + (pl.to[0] - pl.from[0]) * k, 420, pl.from[1] + (pl.to[1] - pl.from[1]) * k];
  for (const X of [A, B]) X.send({ t: 'jump' });
  await sleep(50);
  // el host informa de los bots; el bot enemigo pasa a "alive" junto a Beto
  const send = () => {
    A.send({ t: 'state', seq: 1, p: pp, v: [0, 0, 0], yaw: 0, pitch: 0, st: 'alive', cr: 0, ads: 0, w: 'm1911' });
    B.send({ t: 'state', seq: 1, p: pp, v: [0, 0, 0], yaw: 0, pitch: 0, st: 'alive', cr: 0, ads: 0, w: 'm1911' });
    A.send({ t: 'bots', b: [{ id: enemyBot.id, p: [pp[0] + 10, pp[1], pp[2]], v: [0, 0, 0], yaw: 0, pitch: 0, st: 'alive', cr: 0, w: 'ak' }] });
  };
  send(); await sleep(200); send(); await sleep(200);
  // Beto dispara al bot: el host debe recibir el dmg
  B.send({ t: 'fire', w: 'm1911', o: pp, d: [1, 0, 0], hits: [{ target: enemyBot.id, dmg: 28, head: false }] });
  const d = await A.wait(m => m.t === 'dmg' && m.target === enemyBot.id).catch(() => null);
  check(d && d.amount === 28 && d.hp === 72, `daño a bot llega al host (hp ${d?.hp})`);
  // daño excesivo recortado
  await sleep(250);
  B.send({ t: 'fire', w: 'm1911', o: pp, d: [1, 0, 0], hits: [{ target: enemyBot.id, dmg: 999, head: false }] });
  const d2 = await A.wait(m => m.t === 'dmg' && m.target === enemyBot.id && m.hp < 72).catch(() => null);
  check(d2 && d2.amount <= 28 * 1.15 + 0.01, `daño excesivo (999) recortado a ${d2?.amount}`);
  // cadencia: ráfaga de 20 disparos de M1911 en el mismo instante → la mayoría rechazados
  const before = (await health()).rooms.find(r => r.private)?.rejectedHits || 0;
  for (let i = 0; i < 20; i++) B.send({ t: 'fire', w: 'm1911', o: pp, d: [1, 0, 0], hits: [] });
  await sleep(300);
  const after = (await health()).rooms.find(r => r.private)?.rejectedHits || 0;
  check(after - before >= 15, `cadencia: ${after - before}/20 disparos rechazados en ráfaga`);
  // derribo y reanimación: el host dispara como bot enemigo a Beto (4 × 31) → derribado; Ana lo reanima en 5 s
  for (let i = 0; i < 4; i++) { A.send({ t: 'fire', id: enemyBot.id, w: 'ak', o: pp, d: [-1, 0, 0], hits: [{ target: B.id, dmg: 31, head: false }] }); await sleep(120); }
  const kn = await B.wait(m => m.t === 'knock' && m.victim === B.id).catch(() => null);
  check(!!kn && kn.attacker === enemyBot.id, 'disparo de bot (vía host) derriba a Beto (aliado en pie → knock)');
  A.send({ t: 'revive', target: B.id, phase: 'start' });
  const rs = await B.wait(m => m.t === 'reviveState' && m.phase === 'start').catch(() => null);
  const rv = await B.wait(m => m.t === 'revived' && m.target === B.id, 7000).catch(() => null);
  check(!!rs && !!rv && rv.by === A.id, 'reanimación 5 s → revived {target, by}');
  // loot: ambos reclaman el id 42 → primero gana
  A.send({ t: 'pickup', item: 42 }); B.send({ t: 'pickup', item: 42 });
  await sleep(300);
  const la = A.log.filter(m => m.t === 'loot' && m.item === 42), lb = B.log.filter(m => m.t === 'loot' && m.item === 42);
  const wins = [...la, ...lb].filter(m => m.ok); if (process.env.DBG) console.log(la, lb);
  check(new Set(wins.map(m => m.by)).size === 1 && [...la, ...lb].some(m => !m.ok), 'loot: primera reclamación gana, la segunda se deniega');
  // reconexión de Beto
  B.close();
  const left = await A.wait(m => m.t === 'left' && m.id === B.id).catch(() => null);
  check(!!left && left.hostSim, 'desconexión → left {hostSim:true} al host');
  const B2 = await new Bot('Beto').open();
  B2.send({ t: 'hello', name: 'Beto', operatorId: 'halcon', version: 1, rejoin: { id: B.id, token: B.token } });
  const w = await B2.wait('welcome'); const s2 = await B2.wait('start').catch(() => null);
  check(w.rejoined && w.id === B.id && s2 && s2.you.id === B.id, 'reconexión por id+token: welcome {rejoined} + start');
  check(!!(await A.wait(m => m.t === 'back' && m.id === B.id).catch(() => null)), 'el host recibe back {id}');
  // migración de host
  A.close();
  const hm = await B2.wait(m => m.t === 'host' && m.id === B.id).catch(() => null);
  check(!!hm, 'host se va → migración: host {id: Beto}');
  // basura / robustez
  B2.ws.send('{malformado'); B2.ws.send(JSON.stringify({ t: 'fire', hits: 'x' })); B2.ws.send(JSON.stringify({ t: 'state', p: ['a'] })); B2.ws.send(JSON.stringify([1, 2]));
  B2.send({ t: 'ping', c: 7 });
  const pong = await B2.wait(m => m.t === 'pong' && m.c === 7).catch(() => null);
  check(!!pong, 'mensajes malformados no tumban el servidor (pong recibido)');
  B2.close();
}

// ---------------------------------------------------------------- 4) Rondas
async function testRounds() {
  console.log('\n[4] Rondas 4v4 (sala privada)');
  const P = []; for (let i = 0; i < 8; i++) P.push(await new Bot('R' + i).open());
  for (const p of P) await p.hello();
  for (const p of P) p.send({ t: 'queue', mode: 'rounds', room: 'TESTR' });
  const st = await Promise.all(P.map(p => p.wait('start', 10000)));
  check(st.every(s => s.roster.length === 8 && s.roster.every(r => !r.bot)), 'start con 8 humanos, sin bots');
  const tc = [0, 0]; for (const s of st) tc[s.you.team]++;
  check(tc[0] === 4 && tc[1] === 4, '4v4');
  P.forEach((p, i) => { p.team = st[i].you.team; p.idx = i; });
  // compra en fase de compra
  await P[0].wait(m => m.t === 'round' && m.phase === 'buy');
  P[0].send({ t: 'buy', item: 'armor2' });
  const bo = await P[0].wait('bought');
  check(bo.ok && bo.total === 150 && bo.armorLevel === 2, `compra armor2 (800 → ${bo.total} créditos)`);
  P[1].send({ t: 'buy', item: 'w_awm' });
  const bf = await P[1].wait('bought'); check(!bf.ok, 'compra sin créditos suficientes denegada');
  let stop = false;
  const pos = (p) => [p.team ? 10 : -10, 0, (p.idx % 4) * 2];
  const loop = setInterval(() => {
    if (stop) return;
    for (const p of P) {
      p.send({ t: 'state', seq: 0, p: pos(p), v: [0, 0, 0], yaw: 0, pitch: 0, st: 'alive', cr: 0, ads: 0, w: 'm4' });
      if (p.fight && !p.dead && Date.now() - (p.lf || 0) > 150) {
        p.lf = Date.now();
        // equipo 0 apunta mejor para que el resultado sea determinista
        const enemy = P.find(o => o.team !== p.team && !o.dead);
        if (enemy && (p.team === 0 || Math.random() < 0.3)) p.send({ t: 'fire', w: 'm4', o: pos(p), d: [1, 0, 0], hits: [{ target: enemy.id, dmg: 26, head: false }] });
      }
    }
  }, 66);
  for (const p of P) p.onMsg = (m) => {
    if (m.t === 'round') { p.fight = m.phase === 'fight'; if (m.phase === 'buy') p.dead = false; }
    if (m.t === 'kill' && m.victim === p.id) p.dead = true;
  };
  const end = await P[0].wait('end', 90000).catch(() => null);
  stop = true; clearInterval(loop);
  const rounds = P[0].log.filter(m => m.t === 'round' && m.winnerTeam != null);
  check(rounds.length >= 4, `rondas jugadas: ${rounds.length} (marcadores ${rounds.map(r => r.scores.join('-')).join(', ')})`);
  check(end && end.winnerTeam === 0 && end.scores[0] === 4, `end: gana equipo ${end?.winnerTeam} ${end?.scores?.join('-')}`);
  check(P[0].log.some(m => m.t === 'credits' && (m.amount === 1500 || m.amount === 900)), 'créditos de fin de ronda (1500/900)');
  check(P.some(p => p.log.some(m => m.t === 'credits' && m.amount === 200)), 'kill en rondas: +200 créditos');
  for (const p of P) p.close();
}

// ---------------------------------------------------------------- main
const child = spawn(process.execPath, [path.join(HERE, '..', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), LOBBY_BR: '3', LOBBY_ROUNDS: '2', ROUND_BUY: '2', ROUND_END: '1', ROUND_FIGHT: '30', QUIET: process.env.VERBOSE ? '0' : '1', END_LINGER_MS: '3000' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
child.on('exit', (c) => { if (c && !done) { console.error('servidor terminó con código', c); process.exit(2); } });
let done = false;
try {
  for (let i = 0; i < 50; i++) { try { await health(); break; } catch { await sleep(100); } }
  await unitZone();
  const rep = await testBR();
  await testHost();
  await testRounds();
  const h = await health();
  check(h.ok, `servidor sigue vivo (badMsgs=${h.badMsgs})`);
  console.log(`\nRESULTADO: ${failures ? failures + ' FALLOS' : 'TODO OK'}  | ${N} clientes: ${rep.perClientKBps} KB/s por cliente (snapshots ${rep.perClientSnapKBps}), servidor ${rep.serverOutKBps} KB/s salida, tick medio ${rep.tickAvgMs} ms (máx ${rep.tickMaxMs}), CPU servidor ${rep.serverCpuPct} %`);
} catch (e) { failures++; console.error('ERROR', e); }
done = true; child.kill();
process.exit(failures ? 1 : 0);
