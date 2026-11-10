// Sala de partida autoritativa: lobby, roster, host, avión, zona, daño, derribos, loot, rondas, snapshots.
import {
  WEAPONS, ITEMS, damageAtDistance, EXPLOSIVES, ARMOR_ABSORB, HELMET_REDUCE, ZONE_PHASES, FINAL_WAIT, FINAL_COLLAPSE,
  FINAL_DPS, MAP_HALF, PLANE_ALT, PLANE_SPEED, BR, RD, ROUND_WEAPON_PRICES, ROUND_ITEM_PRICES, BR_ITEM_PRICES, SPEED, rng,
} from './rules.js';
import { BOT_NAMES, OPERATOR_IDS, log, cfg } from './common.js';

const UP = new Set(['alive', 'freefall', 'parachute', 'plane']);
const isUp = (e) => UP.has(e.st);
const inGame = (e) => UP.has(e.st) || e.st === 'knocked';
const ORDER = { plane: 0, freefall: 1, parachute: 2, alive: 3 };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const r2 = (v) => Math.round(v * 100) / 100;
const OP_ABILITY = { halcon: 'scan', muro: 'shield', fantasma: 'dash', medica: 'heal', trueno: 'strike' };
const OP_COOLDOWN = { scan: 30, shield: 35, dash: 18, heal: 40, strike: 45 };
const MED_TIME = { bandage: 3, medkit: 6, shield: 4, adrenaline: 2 };

let ROOM_SEQ = 1;
export let ENT_SEQ = 1;
export function nextEntId() { return ENT_SEQ++; }

export function randomCode() { let s = ''; for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }

export class Room {
  constructor(mode, { code = null, isPrivate = false } = {}) {
    this.id = 'R' + (ROOM_SEQ++);
    this.mode = mode; this.code = code || randomCode(); this.isPrivate = isPrivate;
    this.cap = mode === 'br' ? BR.SQUADS * BR.SQUAD : 8;
    this.teamSize = mode === 'br' ? BR.SQUAD : 4;
    this.state = 'lobby';
    this.created = Date.now();
    this.countdownEnd = this.created + (mode === 'br' ? cfg.LOBBY_BR : cfg.LOBBY_ROUNDS) * 1000;
    this.members = [];           // sesiones en lobby / partida (orden de llegada)
    this.ents = new Map();       // id -> entidad
    this.host = null;
    this.tickN = 0; this._lastLobbySend = 0;
    this.claimed = new Set(); this.drops = new Map(); this.dropSeq = 1; this.crateSeq = 1;
    this.revives = [];
    this.eliminated = new Set(); this.placements = new Map();
    this.closed = false;
    this.stats = { dmgEvents: 0, kills: 0, rejectedHits: 0, speedViolations: 0 };
  }

  // ------------------------------------------------------------ utilidades de envío
  sendTo(sess, obj) { if (sess && sess.ws && sess.room === this) sess.send(obj); }
  controller(e) { return e.sess && e.sess.ws ? e.sess : (e.hostSim ? this.hostSess() : null); }
  hostSess() { const h = this.host != null ? this.ents.get(this.host) : null; return h?.sess?.ws ? h.sess : null; }
  humans() { const out = []; for (const e of this.ents.values()) if (e.sess && e.sess.ws && e.sess.room === this) out.push(e.sess); return out; }
  broadcast(obj, except = null) {
    const s = JSON.stringify(obj);
    if (this.state === 'lobby') { for (const m of this.members) if (m !== except && m.ws) m.sendRaw(s); return; }
    for (const h of this.humans()) if (h !== except) h.sendRaw(s);
  }
  sendSet(set, obj) { const s = JSON.stringify(obj); for (const x of set) if (x && x.ws && x.room === this) x.sendRaw(s); }
  teamSessions(team) { const out = []; for (const e of this.ents.values()) if (e.team === team && e.sess?.ws && e.sess.room === this) out.push(e.sess); return out; }
  now() { return Date.now(); }
  elapsed() { return (Date.now() - this.t0) / 1000; }

  // ------------------------------------------------------------ lobby
  canJoin() { return this.state === 'lobby' && this.members.length < this.cap; }
  addMember(sess) {
    this.members.push(sess); sess.room = this;
    if (this.members.length >= this.cap) this.countdownEnd = Math.min(this.countdownEnd, Date.now() + 1000);
    this.sendLobby();
  }
  removeMember(sess) {
    const i = this.members.indexOf(sess); if (i >= 0) this.members.splice(i, 1);
    if (sess.room === this) sess.room = null;
    if (this.state === 'lobby') { this.sendLobby(); if (!this.members.length) this.closed = true; return; }
    const e = sess.ent;
    if (e && e.sess === sess) this.onDisconnect(e, true);
  }
  lobbyTeams() {
    // equipo previsto por orden de llegada
    return this.members.map((m, i) => this.mode === 'br' ? Math.floor(i / BR.SQUAD) : (this.isPrivate ? (i < 4 ? 0 : 1) : i % 2));
  }
  sendLobby() {
    const teams = this.lobbyTeams();
    const players = this.members.map((m, i) => ({ id: m.id, name: m.name, op: m.op, team: teams[i] }));
    this.broadcast({ t: 'lobby', room: this.id, mode: this.mode, players, countdown: Math.max(0, Math.ceil((this.countdownEnd - Date.now()) / 1000)), code: this.isPrivate ? this.code : null, cap: this.cap });
    this._lastLobbySend = Date.now();
  }

  // ------------------------------------------------------------ inicio
  start() {
    this.state = 'live';
    this.seed = (Math.random() * 2 ** 31) >>> 0;
    this.rand = rng(this.seed);
    this.t0 = Date.now();
    const teams = this.lobbyTeams();
    const names = [...BOT_NAMES].sort(() => this.rand() - 0.5);
    let bi = 0;
    const mk = (sess, team) => {
      const id = sess ? sess.id : nextEntId();
      const e = {
        id, team, sess: sess || null, bot: !sess, hostSim: !sess,
        name: sess ? sess.name : (names[bi++ % names.length] || 'Bot'), op: sess ? sess.op : OPERATOR_IDS[Math.floor(this.rand() * OPERATOR_IDS.length)],
        p: null, v: [0, 0, 0], yaw: 0, pitch: 0, st: this.mode === 'br' ? 'plane' : 'alive', cr: 0, ads: 0, w: this.mode === 'br' ? 'm1911' : 'm1911',
        hp: 100, armor: 0, armorLevel: 0, helmetLevel: 0, downHealth: 100,
        kills: 0, damage: 0, deaths: 0, credits: this.mode === 'br' ? BR.START_CREDITS : RD.START_CREDITS,
        lastStateAt: 0, grace: 0, fire: { tokens: 3, t: 0, w: null }, expl: [], dashUntil: 0, abilityAt: {}, medAt: 0, equipAt: 0, regen: 0,
        outside: false, knockedBy: null, diedAt: null, corrAt: 0, viol: 0, joinedAt: Date.now(), discAt: null,
      };
      this.ents.set(id, e);
      if (sess) sess.ent = e;
      return e;
    };
    this.members.forEach((m, i) => mk(m, teams[i]));
    const nTeams = this.mode === 'br' ? BR.SQUADS : 2;
    const counts = new Array(nTeams).fill(0);
    for (const e of this.ents.values()) counts[e.team]++;
    for (let t = 0; t < nTeams; t++) while (counts[t] < this.teamSize) { mk(null, t); counts[t]++; }
    this.host = this.members[0]?.id ?? null;

    if (this.mode === 'br') this._initBR(); else this._initRounds();
    for (const m of this.members) this.sendStart(m);
    log(`[sala ${this.id}] inicio ${this.mode} humanos=${this.members.length} bots=${this.ents.size - this.members.length} seed=${this.seed}`);
    if (this.mode === 'rounds') this._startRound();
  }

  _initBR() {
    const R = this.rand;
    // avión (Plane.randomRoute)
    const a = R() * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    const off = (R() * 2 - 1) * MAP_HALF * 0.38, ext = MAP_HALF * 1.45;
    const px = -dz * off, pz = dx * off;
    const from = [r2(px - dx * ext), r2(pz - dz * ext)], to = [r2(px + dx * ext), r2(pz + dz * ext)];
    const dur = Math.hypot(to[0] - from[0], to[1] - from[1]) / PLANE_SPEED;
    this.plane = { from, to, dur: r2(dur), alt: PLANE_ALT, speed: PLANE_SPEED, start: BR.PREP };
    // zonas (Zone._chooseNext con PRNG)
    let c = { x: 0, z: 0 }, r = MAP_HALF * 1.32;
    this.zone0 = { c: [0, 0], r };
    this.zones = [];
    for (let i = 0; i < ZONE_PHASES.length; i++) {
      const ph = ZONE_PHASES[i];
      const maxOff = Math.max(0, r - ph.radius);
      let best = null;
      for (let k = 0; k < 24; k++) {
        const ang = R() * Math.PI * 2, rr = Math.sqrt(R()) * maxOff * (i === 0 ? 0.35 : 0.9);
        const x = c.x + Math.cos(ang) * rr, z = c.z + Math.sin(ang) * rr, lim = MAP_HALF * 0.82;
        if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
        best = { x, z }; break;
      }
      best = best || { ...c };
      this.zones.push({ c: [r2(best.x), r2(best.z)], r: ph.radius, wait: ph.wait, shrink: ph.shrink, dps: ph.dps });
      c = best; r = ph.radius;
    }
    // fase final: colapso a 0 en el mismo centro
    this.zones.push({ c: [r2(c.x), r2(c.z)], r: 0, wait: FINAL_WAIT, shrink: FINAL_COLLAPSE, dps: FINAL_DPS, final: true });
    // horario absoluto (s desde t0)
    let t = BR.PREP; let pc = this.zone0.c, pr = this.zone0.r;
    this.zoneSched = this.zones.map((z, i) => {
      const s = { i, phase: i + 1, from: { c: pc, r: pr }, to: z, waitStart: t, shrinkStart: t + z.wait, shrinkEnd: t + z.wait + z.shrink };
      t = s.shrinkEnd; pc = z.c; pr = z.r; return s;
    });
    this.zoneIdx = -1; this.zoneStage = null; this.zoneAcc = 0;
    this.airdropsDone = new Set();
  }
  _initRounds() { this.round = 0; this.scores = [0, 0]; this.rphase = 'idle'; this.rEnd = 0; }

  startPayload(sess) {
    const e = sess.ent;
    const roster = [...this.ents.values()].map(x => ({ id: x.id, name: x.name, op: x.op, team: x.team, bot: x.bot, hostSim: x.hostSim }));
    const msg = { t: 'start', seed: this.seed, mode: this.mode, you: { id: e.id, team: e.team }, roster, host: this.host, t0: this.t0, serverTime: Date.now(), room: this.id, code: this.isPrivate ? this.code : null };
    if (this.mode === 'br') { msg.plane = this.plane; msg.zones = this.zones; msg.zone0 = this.zone0; msg.prep = BR.PREP; msg.claimed = [...this.claimed]; msg.drops = [...this.drops.values()].filter(d => !d.taken).map(d => d.pub); }
    else { msg.round = this.round; msg.scores = this.scores; }
    return msg;
  }
  sendStart(sess) { this.sendTo(sess, this.startPayload(sess)); }

  // ------------------------------------------------------------ conexión / host
  onDisconnect(e, permanent = false) {
    if (e.sess && e.sess.ent === e && !permanent) { /* mantener vínculo para reconexión */ }
    e.discAt = Date.now();
    e.hostSim = true;
    const wasHost = this.host === e.id;
    e.sess = permanent ? null : e.sess;
    if (wasHost) this.migrateHost();
    this.broadcast({ t: 'left', id: e.id, hostSim: true });
  }
  migrateHost() {
    let best = null;
    for (const x of this.ents.values()) if (!x.bot && x.sess?.ws && x.sess.room === this && !x.hostSim) { if (!best || x.joinedAt < best.joinedAt) best = x; }
    const old = this.host; this.host = best ? best.id : null;
    if (this.host !== old) { this.broadcast({ t: 'host', id: this.host }); log(`[sala ${this.id}] host ${old} -> ${this.host}`); }
  }
  // Reconexión (o entrada a mitad de partida en rondas, tomando el hueco de un bot)
  attach(sess, e, isNew = false) {
    e.sess = sess; sess.ent = e; sess.room = this; e.hostSim = false; e.discAt = null; e.grace = Date.now() + 3000; e.graceDist = 30;
    if (isNew) { e.bot = false; e.name = sess.name; e.op = sess.op; e.joinedAt = Date.now(); }
    if (!this.members.includes(sess)) this.members.push(sess);
    if (this.host == null || !this.hostSess()) this.migrateHost();
    this.sendStart(sess);
    this.broadcast(isNew ? { t: 'join', id: e.id, name: e.name, op: e.op, team: e.team } : { t: 'back', id: e.id }, sess);
    if (this.mode === 'br' && this.zoneIdx >= 0) this.sendTo(sess, this.zoneMsg());
    if (this.mode === 'rounds') this.sendTo(sess, this.roundMsg());
    this.sendTo(sess, { t: 'credits', id: e.id, amount: 0, total: e.credits });
  }
  findBotSlot() { for (const e of this.ents.values()) if (e.bot && !e.sess && this.mode === 'rounds') return e; return null; }

  // ------------------------------------------------------------ mensajes de juego
  handle(sess, m) {
    if (this.state !== 'live') return;
    const me = sess.ent; if (!me || me.sess !== sess) return;
    switch (m.t) {
      case 'state': return this.onState(me, m, sess);
      case 'bots': if (this.host === me.id && Array.isArray(m.b || m.bots || m.list)) for (const b of (m.b || m.bots || m.list).slice(0, 128)) { const e = this.ents.get(b?.id); if (e && e.hostSim) this.onState(e, b, null); } return;
      case 'fire': return this.onFire(me, m);
      case 'pickup': return this.onPickup(me, m);
      case 'useItem': return this.onUseItem(this.actor(me, m.by), m);
      case 'buy': return this.onBuy(this.actor(me, m.by), m);
      case 'revive': return this.onRevive(this.actor(me, m.by ?? m.id), m);
      case 'jump': return this.onJump(this.actor(me, m.id ?? m.by));
      case 'ability': return this.onAbility(this.actor(me, m.by ?? m.id), m);
      case 'grenade': return this.onGrenade(this.actor(me, m.id), m);
      case 'ping:map': return this.onPingMap(this.actor(me, m.by), m);
      case 'chat': return this.onChat(this.actor(me, m.by), m);
      case 'drop': return this.onDrop(this.actor(me, m.id ?? m.by), m);
    }
  }
  // Entidad sobre la que actúa el mensaje: yo, o un bot/desconectado si soy host.
  actor(me, id) {
    if (id == null || id === me.id) return me;
    const e = this.ents.get(id);
    return e && e.hostSim && this.host === me.id ? e : null;
  }
  ctrlBy(e, me) { return e === me || (e && e.hostSim && this.host === me.id); }

  onState(e, m, sess) {
    const now = Date.now();
    const p = m.p;
    if (!Array.isArray(p) || p.length < 3 || !p.every(Number.isFinite)) return;
    if (Math.abs(p[0]) > 2000 || Math.abs(p[2]) > 2000 || p[1] < -50 || p[1] > 2000) return;
    // transición de estado
    let st = typeof m.st === 'string' ? m.st : e.st;
    const prev = e.st;
    if (prev === 'knocked' || prev === 'dead') st = (prev === 'dead' && st === 'spectate') ? 'spectate' : prev;
    else if (prev === 'spectate') st = 'spectate';
    else if (st in ORDER && prev in ORDER) {
      if (ORDER[st] < ORDER[prev]) st = prev;                     // no retroceder
      if (prev === 'plane' && st !== 'plane' && !this.canLeavePlane()) st = 'plane';
    } else if (!(st in ORDER)) st = prev;
    // salida del avión: debe aparecer cerca del avión (≤ 80 m)
    if (prev === 'plane' && st !== 'plane' && e.p && Math.hypot(p[0] - e.p[0], p[2] - e.p[2]) > 80) {
      e.viol++; this.stats.speedViolations++;
      if (sess && now - e.corrAt > 1000) { e.corrAt = now; this.sendTo(sess, { t: 'correct', id: e.id, p: e.p }); }
      return;
    }
    if (prev === 'plane' && st !== 'plane') e.lastStateAt = now;
    // durante la gracia (teletransporte de ronda / salida forzosa) se acepta un salto ≤ graceDist
    const inGrace = now < e.grace;
    if (inGrace && e.p && Math.hypot(p[0] - e.p[0], p[2] - e.p[2]) > (e.graceDist || 1e9)) { this.stats.speedViolations++; e.lastStateAt = now; return; }
    // velocidad
    if (e.p && prev !== 'plane' && !inGrace && e.lastStateAt) {
      const dt = Math.max(0.05, (now - e.lastStateAt) / 1000);
      const lim = (now < e.dashUntil ? SPEED.dash : (SPEED[st] ?? 12)) * dt * 1.3 + 1.5;
      const d = Math.hypot(p[0] - e.p[0], p[2] - e.p[2]);
      const up = p[1] - e.p[1];
      if (d > lim || (st === 'alive' && up > 14 * dt + 2)) {
        e.viol++; this.stats.speedViolations++;
        if (sess && now - e.corrAt > 1000) { e.corrAt = now; this.sendTo(sess, { t: 'correct', id: e.id, p: e.p }); }
        e.lastStateAt = now;
        return;
      }
    }
    if (inGrace && e.graceDist < 1e8) e.grace = 0;          // gracia de un solo uso
    e.p = [p[0], p[1], p[2]];
    if (Array.isArray(m.v) && m.v.length >= 3 && m.v.every(Number.isFinite)) e.v = m.v.slice(0, 3);
    if (Number.isFinite(m.yaw)) e.yaw = m.yaw;
    if (Number.isFinite(m.pitch)) e.pitch = m.pitch;
    e.cr = (m.cr | 0) & 3; e.ads = m.ads ? 1 : 0;
    if (typeof m.w === 'string' && (WEAPONS[m.w] || m.w === '')) e.w = m.w;
    e.st = st; e.lastStateAt = now;
  }
  canLeavePlane() { return this.mode !== 'br' || this.elapsed() >= BR.PREP; }

  onJump(e) {
    if (!e || this.mode !== 'br' || e.st !== 'plane' || !this.canLeavePlane()) return;
    e.st = 'freefall'; e.p = this.planePos(); e.lastStateAt = Date.now(); e.grace = Date.now() + 1500; e.graceDist = 60;
  }
  planePos() {
    const pl = this.plane; const k = Math.max(0, Math.min(1, (this.elapsed() - pl.start) / pl.dur));
    return [pl.from[0] + (pl.to[0] - pl.from[0]) * k, PLANE_ALT, pl.from[1] + (pl.to[1] - pl.from[1]) * k];
  }

  frozen() { return this.mode === 'rounds' && this.rphase !== 'fight'; }

  onFire(me, m) {
    const sh = this.ents.get(m.id ?? me.id);
    if (!sh || !this.ctrlBy(sh, me)) return;
    const now = Date.now();
    const w = m.w;
    const o = Array.isArray(m.o) && m.o.length >= 3 && m.o.every(Number.isFinite) ? m.o : sh.p;
    // explosivos
    if (w === 'frag' || w === 'strike') return this.onExplosion(sh, w, o, m.hits);
    const def = WEAPONS[w];
    if (!def) return;
    // relé visual
    if (sh.p && Array.isArray(m.d)) {
      const fx = JSON.stringify({ t: 'fx', kind: 'shot', id: sh.id, w, o: o.map(r2), d: m.d.slice(0, 3).map(v => Math.round(v * 1000) / 1000) });
      for (const h of this.humans()) { if (h === me.sess) continue; const he = h.ent; if (!he?.p) continue; if (Math.hypot(he.p[0] - sh.p[0], he.p[2] - sh.p[2]) <= cfg.FAR) h.sendRaw(fx, true); }
    }
    // cadencia: cubo de fichas con 15 % de tolerancia
    const f = sh.fire;
    const rate = def.rpm / 60 * 1.15;
    if (f.w !== w) { f.w = w; f.tokens = Math.max(f.tokens, 1); }
    f.tokens = Math.min(3, f.tokens + (now - f.t) / 1000 * rate); f.t = now;
    if (f.tokens < 1) { this.reject(sh, 'cadencia'); return; }
    f.tokens -= 1;
    if (sh.st !== 'alive' || this.frozen()) return;
    if (!Array.isArray(m.hits) || !m.hits.length) return;
    if (m.hits.length > (def.pellets || 1)) { this.reject(sh, 'perdigones'); return; }
    for (const h of m.hits) {
      const v = this.ents.get(h?.target);
      if (!v || v === sh || !inGame(v) || v.st === 'plane' || v.team === sh.team || !v.p || !sh.p) { this.stats.rejectedHits++; continue; }
      const dist = Math.hypot(v.p[0] - sh.p[0], v.p[1] - sh.p[1], v.p[2] - sh.p[2]);
      if (dist > def.range * 1.15 + 12) { this.reject(sh, 'alcance'); continue; }
      const maxBase = damageAtDistance(def, Math.max(0, dist - 10)) * 1.15;
      let dmg = Number(h.dmg); if (!Number.isFinite(dmg) || dmg <= 0) continue;
      if (dmg > def.damage * 1.15) { this.reject(sh, 'daño'); dmg = def.damage; }
      dmg = Math.min(dmg, maxBase);
      this.applyDamage(v, dmg, sh, { head: !!h.head, w, type: 'bullet', headMult: def.headMult });
    }
  }
  reject(e, why) { e.viol++; this.stats.rejectedHits++; if (e.viol % 20 === 1) log(`[sala ${this.id}] rechazo ${why} de ${e.id} (${e.name}) total=${e.viol}`); }

  onGrenade(e, m) {
    if (!e || !isUp(e) || e.st !== 'alive') return;
    const type = m.type === 'smoke' ? 'smoke' : 'frag';
    if (type === 'frag') { e.expl.push({ w: 'frag', until: Date.now() + 9000, n: 1 }); if (e.expl.length > 6) e.expl.shift(); }
    this.relayNear(e, { t: 'fx', kind: 'grenade', id: e.id, type, o: m.o, v: m.v });
  }
  onExplosion(sh, w, o, hits) {
    const now = Date.now();
    const tok = sh.expl.find(x => x.w === w && x.until > now && x.n > 0);
    if (!tok) { this.reject(sh, 'explosión sin origen'); return; }
    tok.n--;
    if (!Array.isArray(hits) || this.frozen()) return;
    const ex = EXPLOSIVES[w];
    this.relayNear(sh, { t: 'fx', kind: 'explosion', id: sh.id, w, o: o.map(r2) });
    for (const h of hits.slice(0, 40)) {
      const v = this.ents.get(h?.target);
      if (!v || !inGame(v) || v.st === 'plane' || !v.p) continue;
      if (v !== sh && v.team === sh.team) continue;
      if (Math.hypot(v.p[0] - o[0], v.p[1] - o[1], v.p[2] - o[2]) > ex.radius + 4) { this.stats.rejectedHits++; continue; }
      const dmg = Math.min(Number(h.dmg) || 0, ex.damage * 1.05);
      if (dmg > 0) this.applyDamage(v, dmg, sh, { w, type: 'explosion' });
    }
  }

  // Combat.applyDamage (portado)
  applyDamage(v, amount, att, opts = {}) {
    if (!v || amount <= 0) return null;
    if (v.st === 'dead' || v.st === 'plane' || v.st === 'spectate') return null;
    const type = opts.type || 'bullet';
    if (att && att !== v && att.team === v.team && type !== 'zone') return null;
    if (this.frozen()) return null;
    const enemy = att && att !== v && att.team !== v.team;
    const out = { damage: 0, knocked: false, dead: false };
    if (v.st === 'knocked') {
      const d = Math.min(v.downHealth, amount);
      v.downHealth -= amount; out.damage = d;
      if (enemy) att.damage += d;
      if (v.downHealth <= 0) { v.downHealth = 0; this.kill(v, att || this.ents.get(v.knockedBy) || null, opts); out.dead = true; }
      if (type !== 'bleed') this.emitDmg(v, att, out, opts);
      return out;
    }
    let dmg = amount;
    if (opts.head && type === 'bullet') {
      const hm = opts.headMult || 1.8; const extra = dmg * hm - dmg;
      dmg = dmg + extra * (1 - (HELMET_REDUCE[v.helmetLevel | 0] || 0));
    } else if ((type === 'bullet' || type === 'explosion') && v.armor > 0 && v.armorLevel > 0) {
      const taken = Math.min(v.armor, ARMOR_ABSORB[Math.min(3, v.armorLevel)] * dmg);
      v.armor -= taken; dmg -= taken; if (v.armor <= 0.01) v.armor = 0;
      out.damage += taken;
    }
    out.damage += Math.min(v.hp, dmg);
    v.hp -= dmg;
    if (enemy) att.damage += out.damage;
    if (v.hp <= 0) {
      v.hp = 0;
      if (this.canKnock(v)) {
        v.st = 'knocked'; v.downHealth = 100; v.knockedBy = att ? att.id : null; v.knockedAt = Date.now(); out.knocked = true;
        this.cancelRevivesFor(v);
        if (enemy) this.giveCredits(att, 50);
        this.broadcast({ t: 'knock', attacker: att ? att.id : null, victim: v.id, w: opts.w || null });
      } else { this.kill(v, att, opts); out.dead = true; }
    }
    this.emitDmg(v, att, out, opts);
    return out;
  }
  emitDmg(v, att, out, opts) {
    this.stats.dmgEvents++;
    const msg = { t: 'dmg', target: v.id, attacker: att ? att.id : null, amount: r2(out.damage), head: !!opts.head, hp: r2(v.st === 'knocked' ? v.downHealth : v.hp), armor: r2(v.armor), armorLevel: v.armorLevel, knocked: out.knocked || v.st === 'knocked', dead: v.st === 'dead', w: opts.w || opts.type || null };
    const set = new Set(this.teamSessions(v.team));
    set.add(this.controller(v));
    if (att) set.add(this.controller(att));
    if (v.hostSim || att?.hostSim) set.add(this.hostSess());
    set.delete(null);
    this.sendSet(set, msg);
  }
  canKnock(v) {
    if (this.mode !== 'br') return false;
    for (const o of this.ents.values()) if (o !== v && o.team === v.team && isUp(o)) return true;
    return false;
  }
  kill(v, att, opts = {}) {
    if (v.st === 'dead') return;
    v.st = 'dead'; v.hp = 0; v.downHealth = 0; v.diedAt = Date.now(); v.deaths++;
    this.cancelRevivesFor(v);
    const enemy = att && att !== v && att.team !== v.team;
    if (enemy) { att.kills++; this.giveCredits(att, this.mode === 'rounds' ? 200 : 100); }
    this.stats.kills++;
    this.broadcast({ t: 'kill', attacker: att ? att.id : null, victim: v.id, w: opts.w || opts.type || null, head: !!opts.head });
    if (this.mode === 'br') this.spawnDeathCrate(v);
  }
  giveCredits(e, amount) {
    const before = e.credits;
    e.credits = Math.max(0, Math.min(this.mode === 'rounds' ? RD.MAX_CREDITS : 1e6, e.credits + amount));
    this.sendTo(this.controller(e), { t: 'credits', id: e.id, amount: e.credits - before, total: e.credits });
  }

  // ------------------------------------------------------------ loot
  onPickup(me, m) {
    const e = this.actor(me, m.by); if (!e) return;
    const item = m.item;
    const ok0 = (typeof item === 'number' && Number.isInteger(item) && item >= 0 && item < 1e6) || (typeof item === 'string' && this.drops.has(item));
    let ok = ok0 && isUp(e) && e.st === 'alive' && !this.claimed.has(item);
    if (ok && typeof item === 'string') {
      const d = this.drops.get(item);
      if (d.pub.pos[1] != null && e.p && Math.hypot(e.p[0] - d.pub.pos[0], e.p[2] - d.pub.pos[2]) > 6) ok = false;
    }
    if (ok) { this.claimed.add(item); if (this.drops.has(item)) this.drops.get(item).taken = true; this.broadcast({ t: 'loot', item, by: e.id, ok: true }); }
    else this.sendTo(me.sess, { t: 'loot', item, by: e.id, ok: false });
  }
  spawnDrops(crateKind, pos, entries, owner = null, crateId = null) {
    const crate = crateId || 'C' + (this.crateSeq++);
    const items = entries.map(x => {
      const id = 'S' + (this.dropSeq++);
      const pub = { id, kind: x.kind, defId: x.defId, amount: x.amount || 1, pos: pos.map(v => v == null ? null : r2(v)), crate };
      if (x.armor != null) pub.armor = x.armor;
      this.drops.set(id, { pub, taken: false });
      return pub;
    });
    if (!items.length) return null;
    const msg = { t: 'lootSpawn', crate: { id: crate, kind: crateKind, pos: pos.map(v => v == null ? null : r2(v)), owner }, items };
    this.broadcast(msg);
    return crate;
  }
  spawnDeathCrate(v) {
    if (!v.p) return;
    const ent = [];
    const def = WEAPONS[v.w];
    if (def && v.w !== 'm1911') ent.push({ kind: 'weapon', defId: v.w });
    ent.push({ kind: 'weapon', defId: 'm1911' });
    if (def) ent.push({ kind: 'ammo', defId: 'ammo_' + (def.ammo || 'pistol'), amount: 30 });
    if (v.armorLevel > 0 && v.armor > 1) ent.push({ kind: 'armor', defId: 'armor' + v.armorLevel, armor: r2(v.armor) });
    if (v.helmetLevel > 0) ent.push({ kind: 'helmet', defId: 'helmet' + v.helmetLevel });
    v.armor = 0; v.armorLevel = 0; v.helmetLevel = 0;
    v.crate = this.spawnDrops('death', v.p, ent, v.id);
    v.crateAt = Date.now();
  }
  // contenido extra declarado por el dueño (≤ 3 s tras morir)
  onDrop(e, m) {
    if (!e || e.st !== 'dead' && e.st !== 'spectate' || !e.crateAt || Date.now() - e.crateAt > 3000 || e.dropDone || !Array.isArray(m.items)) return;
    e.dropDone = true;
    const ok = m.items.slice(0, 16).filter(x => x && typeof x.kind === 'string' && typeof x.id === 'string' && ['ammo', 'med', 'grenade', 'attachment', 'weapon'].includes(x.kind))
      .map(x => ({ kind: x.kind, defId: x.id.slice(0, 24), amount: Math.max(1, Math.min(300, x.amount | 0 || 1)) }));
    if (ok.length) this.spawnDrops('death', e.p, ok, e.id, e.crate || null);
  }

  onUseItem(e, m) {
    if (!e || e.st !== 'alive') return;
    const now = Date.now();
    const id = String(m.id || '');
    if (m.kind === 'armor' || m.kind === 'helmet') {
      const lvl = +id.slice(-1);
      if (!(lvl >= 1 && lvl <= 3) || now - e.equipAt < 400) return;
      e.equipAt = now;
      if (m.kind === 'armor') { e.armorLevel = lvl; e.armor = Math.min(lvl * 50, Number.isFinite(m.armor) ? Math.max(0, m.armor) : lvl * 50); }
      else e.helmetLevel = lvl;
    } else if (m.kind === 'med' && MED_TIME[id]) {
      if (now - e.medAt < MED_TIME[id] * 850) { this.reject(e, 'curación rápida'); return; }
      e.medAt = now;
      if (id === 'bandage') e.hp = Math.max(e.hp, Math.min(75, e.hp + 15));
      else if (id === 'medkit') e.hp = 100;
      else if (id === 'shield') e.armor = Math.min(e.armorLevel * 50, e.armor + 50);
      else if (id === 'adrenaline') { e.hp = Math.min(100, e.hp + 25); e.regen = 50; }
    } else return;
    this.sendTo(this.controller(e), { t: 'dmg', target: e.id, attacker: null, amount: 0, head: false, hp: r2(e.hp), armor: r2(e.armor), armorLevel: e.armorLevel, knocked: false, dead: false, w: 'heal' });
  }

  onBuy(e, m) {
    if (!e) return;
    const item = String(m.item || '');
    let price = null, equip = null;
    if (this.mode === 'rounds') {
      if (this.rphase !== 'buy') return this.buyReply(e, item, false, 'fuera de fase de compra');
      if (item.startsWith('w_')) price = ROUND_WEAPON_PRICES[item.slice(2)];
      else if (item === 'loadout') price = Math.max(1000, Math.min(9000, Number(m.price) || 0));
      else price = ROUND_ITEM_PRICES[item];
    } else {
      if (!isUp(e) || e.st !== 'alive') return this.buyReply(e, item, false, 'no disponible');
      price = ITEMS[item]?.price ?? BR_ITEM_PRICES[item];
    }
    if (price == null) return this.buyReply(e, item, false, 'artículo desconocido');
    if (e.credits < price) return this.buyReply(e, item, false, 'Créditos insuficientes');
    if (item === 'respawn') {
      const dead = [...this.ents.values()].find(x => x.team === e.team && x !== e && (x.st === 'dead' || x.st === 'spectate'));
      if (!dead || this.eliminated.has(e.team)) return this.buyReply(e, item, false, 'Ningún aliado que reaparecer');
      dead.st = 'freefall'; dead.hp = 100; dead.downHealth = 100; dead.armor = 0; dead.armorLevel = 0; dead.helmetLevel = 0;
      dead.p = e.p ? [e.p[0], e.p[1] + 260, e.p[2]] : dead.p; dead.grace = Date.now() + 3000; dead.graceDist = 1e9; dead.crateAt = null; dead.dropDone = false;
      this.broadcast({ t: 'respawn', id: dead.id, by: e.id, pos: dead.p.map(r2) });
    }
    const mm = /^(armor|helmet)(\d)$/.exec(item);
    if (mm) equip = { kind: mm[1], lvl: +mm[2] };
    if (equip) { if (equip.kind === 'armor') { e.armorLevel = equip.lvl; e.armor = equip.lvl * 50; } else e.helmetLevel = equip.lvl; }
    if (item === 'medkit' && this.mode === 'rounds') { /* se usa luego con useItem */ }
    this.giveCredits(e, -price);
    this.buyReply(e, item, true);
  }
  buyReply(e, item, ok, reason) { this.sendTo(this.controller(e), { t: 'bought', id: e.id, item, ok, reason: reason || null, total: e.credits, armor: r2(e.armor), armorLevel: e.armorLevel, helmetLevel: e.helmetLevel }); }

  // ------------------------------------------------------------ reanimación
  onRevive(r, m) {
    if (!r || this.mode !== 'br') return;
    const v = this.ents.get(m.target);
    if (m.phase === 'cancel') { this.cancelRevivesFor(r); return; }
    if (!v || r.st !== 'alive' || v.st !== 'knocked' || r.team !== v.team || !r.p || !v.p) return this.reviveMsg(r, v, 'denied');
    if (Math.hypot(r.p[0] - v.p[0], r.p[1] - v.p[1], r.p[2] - v.p[2]) > BR.REVIVE_DIST + 0.8) return this.reviveMsg(r, v, 'denied');
    if (this.revives.some(x => x.v === v || x.r === r)) return;
    this.revives.push({ r, v, t: Date.now() });
    this.reviveMsg(r, v, 'start');
  }
  reviveMsg(r, v, phase) {
    const msg = { t: 'reviveState', target: v ? v.id : null, by: r.id, phase };
    if (phase === 'denied') return this.sendTo(this.controller(r), msg);
    const set = new Set(this.teamSessions(r.team)); set.add(this.hostSess()); set.delete(null); this.sendSet(set, msg);
  }
  cancelRevivesFor(e) {
    for (let i = this.revives.length - 1; i >= 0; i--) { const x = this.revives[i]; if (x.r === e || x.v === e) { this.revives.splice(i, 1); this.reviveMsg(x.r, x.v, 'cancel'); } }
  }

  // ------------------------------------------------------------ habilidades / fx
  onAbility(e, m) {
    if (!e || e.st !== 'alive' || this.frozen()) return;
    const ab = OP_ABILITY[e.op] || m.ab; if (!ab) return;
    const now = Date.now();
    if (now - (e.abilityAt[ab] || 0) < (OP_COOLDOWN[ab] || 15) * 850) { this.reject(e, 'habilidad'); return; }
    e.abilityAt[ab] = now;
    if (ab === 'dash') e.dashUntil = now + 700;
    if (ab === 'strike') e.expl.push({ w: 'strike', until: now + 7000, n: EXPLOSIVES.strike.count });
    if (ab === 'heal' && e.p) {
      for (const o of this.ents.values()) if (o.team === e.team && o.st === 'alive' && o.p && Math.hypot(o.p[0] - e.p[0], o.p[2] - e.p[2]) <= 6.5) o.regen = Math.max(o.regen, 40);
    }
    this.relayNear(e, { t: 'fx', kind: 'ability', id: e.id, ab, data: m.data ?? null }, true);
  }
  onPingMap(e, m) {
    if (!e || !Array.isArray(m.pos)) return;
    const now = Date.now(); if (now - (e.pingAt || 0) < 500) return; e.pingAt = now;
    this.sendSet(this.teamSessions(e.team), { t: 'fx', kind: 'ping', id: e.id, pos: m.pos.slice(0, 3), mk: String(m.kind || '').slice(0, 16) });
  }
  onChat(e, m) {
    if (!e) return;
    const now = Date.now(); if (now - (e.chatAt || 0) < 800) return; e.chatAt = now;
    const text = String(m.text || '').replace(/[<>]/g, '').slice(0, 80); if (!text) return;
    this.sendSet(this.teamSessions(e.team), { t: 'fx', kind: 'chat', id: e.id, text });
  }
  relayNear(e, msg, team = false) {
    const s = JSON.stringify(msg);
    for (const h of this.humans()) {
      const he = h.ent; if (!he || he === e) continue;
      if ((team && he.team === e.team) || (he.p && e.p && Math.hypot(he.p[0] - e.p[0], he.p[2] - e.p[2]) <= cfg.FAR)) h.sendRaw(s);
    }
  }

  // ------------------------------------------------------------ tick
  tick(dt) {
    this.tickN++;
    const now = Date.now();
    if (this.state === 'lobby') {
      if (!this.members.length) { this.closed = true; return; }
      if (now >= this.countdownEnd) this.start();
      else if (now - this._lastLobbySend >= 1000) this.sendLobby();
      return;
    }
    if (this.state === 'ended') { if (now > this.closeAt || !this.humans().length) this.closed = true; return; }
    // sin humanos conectados: esperar ventana de reconexión y cerrar
    const hs = this.humans();
    if (!hs.length) { if (!this.emptySince) this.emptySince = now; if (now - this.emptySince > cfg.REJOIN_MS) { this.closed = true; log(`[sala ${this.id}] cerrada (vacía)`); } return; }
    this.emptySince = 0;
    if (!this.hostSess()) this.migrateHost();
    // regeneración
    for (const e of this.ents.values()) if (e.regen > 0 && e.st === 'alive') { const r = Math.min(e.regen, 5 * dt); e.regen -= r; e.hp = Math.min(100, e.hp + r); }
    if (this.mode === 'br') this.tickBR(dt); else this.tickRounds(dt);
    if (this.state === 'live') this.sendSnapshots();
  }

  tickBR(dt) {
    const t = this.elapsed();
    const pl = this.plane;
    // avión
    if (t >= pl.start) {
      const pp = this.planePos();
      for (const e of this.ents.values()) if (e.st === 'plane') e.p = pp;
      if (t >= pl.start + pl.dur * 0.97) for (const e of this.ents.values()) if (e.st === 'plane') { e.st = 'freefall'; e.grace = Date.now() + 2000; e.graceDist = 80; }
    } else { const pp = [pl.from[0], PLANE_ALT, pl.from[1]]; for (const e of this.ents.values()) if (e.st === 'plane') e.p = pp; }
    // zona
    this.updateZone(t);
    this.zoneAcc += dt;
    if (this.zoneAcc >= 1 && this.zoneIdx >= 0) {
      this.zoneAcc -= 1;
      const z = this.zoneNow(t);
      for (const e of this.ents.values()) {
        if ((e.st !== 'alive' && e.st !== 'knocked') || !e.p) continue;
        const out = Math.hypot(e.p[0] - z.c[0], e.p[2] - z.c[1]) > z.r;
        e.outside = out;
        if (out) this.applyDamage(e, Math.max(1, z.dps), null, { type: 'zone', w: 'zone' });
      }
    }
    // sangrado
    const now = Date.now();
    for (const e of this.ents.values()) {
      if (e.st !== 'knocked' || this.revives.some(x => x.v === e)) continue;
      e.downHealth -= 100 / BR.BLEED * dt;
      if (e.downHealth <= 0) this.kill(e, this.ents.get(e.knockedBy) || null, { type: 'bleed' });
    }
    // reanimaciones
    for (let i = this.revives.length - 1; i >= 0; i--) {
      const x = this.revives[i];
      const far = !x.r.p || !x.v.p || Math.hypot(x.r.p[0] - x.v.p[0], x.r.p[1] - x.v.p[1], x.r.p[2] - x.v.p[2]) > BR.REVIVE_CANCEL + 0.7;
      if (x.r.st !== 'alive' || x.v.st !== 'knocked' || far) { this.revives.splice(i, 1); this.reviveMsg(x.r, x.v, 'cancel'); continue; }
      if (now - x.t >= BR.REVIVE * 1000) {
        this.revives.splice(i, 1);
        const v = x.v; v.st = 'alive'; v.hp = 30; v.downHealth = 100; v.knockedBy = null;
        this.broadcast({ t: 'revived', target: v.id, by: x.r.id });
      }
    }
    this.checkEliminations();
  }

  zoneNow(t) {
    const s = this.zoneSched[Math.max(0, this.zoneIdx)];
    if (!s) return { c: [0, 0], r: 0, dps: FINAL_DPS };
    if (t >= this.zoneSched[this.zoneSched.length - 1].shrinkEnd) return { c: s.to.c, r: 0, dps: FINAL_DPS, finished: true };
    if (t < s.shrinkStart) {
      const prev = ZONE_PHASES[Math.max(0, s.i - 1)];
      return { c: s.from.c, r: s.from.r, dps: s.to.final ? ZONE_PHASES[6].dps : prev.dps };
    }
    const k = Math.min(1, (t - s.shrinkStart) / (s.shrinkEnd - s.shrinkStart));
    return { c: [s.from.c[0] + (s.to.c[0] - s.from.c[0]) * k, s.from.c[1] + (s.to.c[1] - s.from.c[1]) * k], r: s.from.r + (s.to.r - s.from.r) * k, dps: s.to.dps };
  }
  updateZone(t) {
    const sched = this.zoneSched;
    let idx = -1; for (let i = 0; i < sched.length; i++) if (t >= sched[i].waitStart) idx = i;
    if (idx < 0) return;
    const s = sched[idx];
    const stage = t >= sched[sched.length - 1].shrinkEnd ? 'finished' : t >= s.shrinkStart ? 'shrink' : 'wait';
    if (idx !== this.zoneIdx || stage !== this.zoneStage) {
      // fin de fase → +200 créditos a los que siguen en pie
      if (this.zoneStage === 'shrink' && (idx !== this.zoneIdx || stage === 'finished')) for (const e of this.ents.values()) if (isUp(e)) this.giveCredits(e, 200);
      this.zoneIdx = idx; this.zoneStage = stage;
      this.broadcast(this.zoneMsg());
      if (stage === 'wait' && (s.phase === 2 || s.phase === 4) && !this.airdropsDone.has(s.phase)) { this.airdropsDone.add(s.phase); this.spawnAirdrop(s); }
    }
  }
  zoneMsg() {
    const t = this.elapsed(); const s = this.zoneSched[this.zoneIdx]; const z = this.zoneNow(t);
    const left = this.zoneStage === 'wait' ? s.shrinkStart - t : this.zoneStage === 'shrink' ? s.shrinkEnd - t : 0;
    return { t: 'zone', phase: s.phase, stage: this.zoneStage, c: z.c.map(r2), r: r2(z.r), nc: s.to.c, nr: s.to.r, wait: s.to.wait, shrink: s.to.shrink, dps: z.dps, timeLeft: r2(Math.max(0, left)), shrinking: this.zoneStage === 'shrink' };
  }
  spawnAirdrop(s) {
    const R = this.rand; const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * s.to.r * 0.8;
    const pos = [s.to.c[0] + Math.cos(a) * rr, null, s.to.c[1] + Math.sin(a) * rr];
    const w = R() < 0.5 ? 'awm' : 'scar';
    this.spawnDrops('airdrop', pos, [{ kind: 'weapon', defId: w }, { kind: 'ammo', defId: w === 'awm' ? 'ammo_sniper' : 'ammo_ar', amount: w === 'awm' ? 20 : 90 }, { kind: 'armor', defId: 'armor3' }, { kind: 'helmet', defId: 'helmet3' }, { kind: 'med', defId: 'medkit' }]);
  }

  teamStatus() {
    const st = new Map();
    for (const e of this.ents.values()) { let s = st.get(e.team); if (!s) st.set(e.team, s = { up: 0, members: [] }); s.members.push(e); if (isUp(e)) s.up++; }
    return st;
  }
  checkEliminations() {
    const st = this.teamStatus();
    let alive = 0; for (const [team] of st) if (!this.eliminated.has(team)) alive++;
    for (const [team, s] of st) {
      if (this.eliminated.has(team) || s.up > 0) continue;
      for (const m of s.members) if (m.st === 'knocked') this.kill(m, this.ents.get(m.knockedBy) || null, { type: 'bleed' });
      this.eliminated.add(team); this.placements.set(team, alive);
      this.broadcast({ t: 'squadOut', team, placement: alive });
      alive--;
    }
    if (alive <= 1 && this.state === 'live') {
      let winner = null; for (const [team] of st) if (!this.eliminated.has(team)) winner = team;
      if (winner !== null) this.placements.set(winner, 1);
      this.endMatch(winner);
    }
  }

  // ------------------------------------------------------------ rondas
  roundMsg() { return { t: 'round', round: this.round, scores: [...this.scores], phase: this.rphase, timeLeft: r2(Math.max(0, (this.rEnd - Date.now()) / 1000)) }; }
  _startRound() {
    this.round++; this.rphase = 'buy'; this.rEnd = Date.now() + RD.BUY * 1000;
    for (const e of this.ents.values()) {
      const survived = e.keep && e.st === 'alive';
      e.st = 'alive'; e.hp = 100; e.downHealth = 100; e.grace = Date.now() + RD.BUY * 1000 + 1500; e.graceDist = 1e9; e.regen = 0; e.expl = [];
      if (!survived) { e.armor = 0; e.armorLevel = 0; e.helmetLevel = 0; }
    }
    this.revives = [];
    this.broadcast(this.roundMsg());
  }
  tickRounds() {
    const now = Date.now();
    if (this.rphase === 'buy' && now >= this.rEnd) { this.rphase = 'fight'; this.rEnd = now + RD.FIGHT * 1000; this.broadcast(this.roundMsg()); }
    else if (this.rphase === 'fight') {
      const a = [0, 0]; for (const e of this.ents.values()) if (isUp(e)) a[e.team ? 1 : 0]++;
      if (a[0] === 0 || a[1] === 0) this._endRound(a[0] > 0 ? 0 : 1);
      else if (now >= this.rEnd) {
        const hp = [0, 0]; for (const e of this.ents.values()) if (isUp(e)) hp[e.team ? 1 : 0] += e.hp + e.armor;
        this._endRound(hp[0] > hp[1] ? 0 : hp[1] > hp[0] ? 1 : (a[0] >= a[1] ? 0 : 1));
      }
    } else if (this.rphase === 'end' && now >= this.rEnd) {
      if (this.scores[0] >= RD.WIN || this.scores[1] >= RD.WIN) { this.rphase = 'over'; this.endMatch(this.scores[0] >= RD.WIN ? 0 : 1); }
      else this._startRound();
    }
    if (this.tickN % 75 === 0 && this.rphase !== 'over') this.broadcast(this.roundMsg());
  }
  _endRound(winner) {
    this.rphase = 'end'; this.rEnd = Date.now() + RD.END * 1000; this.scores[winner]++;
    for (const e of this.ents.values()) { const t = e.team ? 1 : 0; this.giveCredits(e, t === winner ? 1500 : 900); e.keep = isUp(e); }
    this.broadcast({ ...this.roundMsg(), winnerTeam: winner });
  }

  // ------------------------------------------------------------ fin
  endMatch(winner) {
    this.state = 'ended'; this.closeAt = Date.now() + cfg.END_LINGER_MS;
    const placements = this.mode === 'br'
      ? [...this.placements.entries()].map(([team, place]) => ({ team, place })).sort((a, b) => a.place - b.place)
      : [{ team: winner, place: 1 }, { team: 1 - winner, place: 2 }];
    const stats = {};
    for (const e of this.ents.values()) stats[e.id] = { kills: e.kills, damage: Math.round(e.damage), deaths: e.deaths, credits: e.credits, timeAlive: Math.round(((e.diedAt || Date.now()) - this.t0) / 1000), place: this.mode === 'br' ? (this.placements.get(e.team) || null) : (e.team === winner ? 1 : 2) };
    this.broadcast({ t: 'end', winnerTeam: winner, placements, stats, scores: this.scores || null });
    log(`[sala ${this.id}] fin ${this.mode} ganador=${winner} duración=${this.elapsed().toFixed(0)}s kills=${this.stats.kills} rechazos=${this.stats.rejectedHits} vel=${this.stats.speedViolations}`);
  }

  // ------------------------------------------------------------ snapshots (gestión de interés)
  sendSnapshots() {
    const n = this.tickN; const now = Date.now();
    const near2 = cfg.NEAR * cfg.NEAR, far2 = cfg.FAR * cfg.FAR;
    // filas serializadas una vez por tick y entidad
    const rows = new Map();
    for (const e of this.ents.values()) {
      if (!e.p) continue;
      const flags = e.cr | (e.ads << 2) | (e.outside ? 8 : 0) | (this.revives.some(x => x.v === e) ? 16 : 0) | (e.hostSim ? 32 : 0);
      rows.set(e.id, `[${e.id},${r2(e.p[0])},${r2(e.p[1])},${r2(e.p[2])},${r2(e.yaw)},${r2(e.pitch)},"${e.st}",${flags},"${e.w}",${Math.round(e.st === 'knocked' ? e.downHealth : e.hp)},${Math.round(e.armor)}]`);
    }
    const tStr = '{"t":"snap","ts":' + now + ',"e":[';
    for (const h of this.humans()) {
      const me = h.ent; if (!me) continue;
      // punto de vista: yo, o un compañero si estoy muerto/observando
      let vp = me.p;
      if ((me.st === 'dead' || me.st === 'spectate') || !vp) { for (const o of this.ents.values()) if (o.team === me.team && isUp(o) && o.p) { vp = o.p; break; } }
      if (!vp) continue;
      const over = h.budgetOver(now);           // >0: recortar
      const parts = [];
      for (const e of this.ents.values()) {
        const row = rows.get(e.id); if (!row) continue;
        if (e === me) { if ((n + e.id) % 5 === 0) parts.push(row); continue; }
        if (e.st === 'plane') { if ((n + e.id) % 15 === 0) parts.push(row); continue; }
        if (e.team === me.team) { parts.push(row); continue; }
        if (e.st === 'dead' || e.st === 'spectate') { if ((n + e.id) % 15 === 0) parts.push(row); continue; }
        const dx = e.p[0] - vp[0], dz = e.p[2] - vp[2], d2 = dx * dx + dz * dz;
        if (d2 <= near2) { if (over < 2 || (n + e.id) % 2 === 0) parts.push(row); }
        else if (d2 <= far2) { if (!over && (n + e.id) % 3 === 0) parts.push(row); }
      }
      if (!parts.length) continue;
      // nombre de campo "t" queda para el tipo; marca de tiempo del servidor en "ts"
      h.sendRaw(tStr + parts.join(',') + ']}', true);
    }
  }
}
