// Reglas compartidas con el cliente: armas (js/data/weapons.js), ítems (js/data/items.js), zona, tiempos.
// Los módulos ES del cliente se cargan como data: URL (no dependen de package.json "type"); si fallan,
// se usa una copia mínima.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'js', 'data');

async function loadEsm(file) {
  const src = fs.readFileSync(path.join(DATA, file), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}

const FALLBACK_WEAPONS = {
  ak: { damage: 31, headMult: 1.9, rpm: 600, range: 220, falloff: [40, 160, 0.7], pellets: 1, mag: 30 },
  m4: { damage: 26, headMult: 1.9, rpm: 760, range: 220, falloff: [45, 170, 0.72], pellets: 1, mag: 30 },
  scar: { damage: 36, headMult: 1.9, rpm: 520, range: 240, falloff: [50, 180, 0.72], pellets: 1, mag: 20 },
  vector: { damage: 19, headMult: 1.6, rpm: 1100, range: 90, falloff: [15, 60, 0.55], pellets: 1, mag: 25 },
  mp5: { damage: 22, headMult: 1.6, rpm: 800, range: 100, falloff: [18, 70, 0.6], pellets: 1, mag: 30 },
  awm: { damage: 120, headMult: 2.5, rpm: 42, range: 800, falloff: [300, 800, 0.85], pellets: 1, mag: 5 },
  sks: { damage: 52, headMult: 2.1, rpm: 300, range: 500, falloff: [120, 450, 0.8], pellets: 1, mag: 10 },
  s12: { damage: 14, headMult: 1.4, rpm: 240, range: 40, falloff: [6, 30, 0.2], pellets: 9, mag: 8 },
  m870: { damage: 22, headMult: 1.4, rpm: 70, range: 35, falloff: [5, 25, 0.2], pellets: 9, mag: 5 },
  m1911: { damage: 28, headMult: 1.8, rpm: 380, range: 60, falloff: [12, 45, 0.6], pellets: 1, mag: 8 },
  deagle: { damage: 55, headMult: 2.0, rpm: 200, range: 80, falloff: [15, 60, 0.6], pellets: 1, mag: 7 },
};

export let WEAPONS = FALLBACK_WEAPONS;
export let ITEMS = {};
export async function loadRules(log = console.log) {
  try { const m = await loadEsm('weapons.js'); if (m.WEAPONS?.ak) WEAPONS = m.WEAPONS; log('[rules] armas cargadas de js/data/weapons.js'); }
  catch (e) { log('[rules] usando tabla de armas interna:', e.message); }
  try { const m = await loadEsm('items.js'); if (m.ITEMS) ITEMS = m.ITEMS; }
  catch (e) { log('[rules] items.js no disponible:', e.message); }
}

export function damageAtDistance(s, dist) {
  const [a, b, m] = s.falloff;
  if (dist <= a) return s.damage;
  if (dist >= b) return s.damage * m;
  return s.damage * (1 - (1 - m) * (dist - a) / (b - a));
}

// Explosivos (Combat.explode / Abilities.strike)
export const EXPLOSIVES = { frag: { damage: 125, radius: 8 }, strike: { damage: 95, radius: 6.5, count: 3 } };

export const ARMOR_ABSORB = [0, 0.55, 0.65, 0.75];
export const HELMET_REDUCE = [0, 0.2, 0.35, 0.5];

// Zone.js
export const ZONE_PHASES = [
  { wait: 108, shrink: 72, radius: 560, dps: 1 },
  { wait: 90, shrink: 60, radius: 380, dps: 2 },
  { wait: 72, shrink: 54, radius: 240, dps: 3 },
  { wait: 60, shrink: 48, radius: 145, dps: 5 },
  { wait: 48, shrink: 36, radius: 80, dps: 8 },
  { wait: 36, shrink: 30, radius: 38, dps: 12 },
  { wait: 24, shrink: 24, radius: 12, dps: 16 },
];
export const FINAL_WAIT = 8, FINAL_COLLAPSE = 40, FINAL_DPS = 20;
export const MAP_HALF = 700;
// Plane.js
export const PLANE_ALT = 420, PLANE_SPEED = 60;
// BattleRoyale.js
export const BR = { PREP: 4, BLEED: 60, REVIVE: 5, REVIVE_DIST: 2.3, REVIVE_CANCEL: 2.8, START_CREDITS: 300, SQUADS: 25, SQUAD: 4 };
// RoundsMode.js / Shop.js
const envN = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
export const RD = { BUY: envN('ROUND_BUY', 10), FIGHT: envN('ROUND_FIGHT', 100), END: envN('ROUND_END', 4.5), WIN: 4, START_CREDITS: 800, MAX_CREDITS: 9000 };
export const ROUND_WEAPON_PRICES = { m1911: 0, deagle: 600, mp5: 1200, vector: 1500, m870: 1100, s12: 1400, m4: 2300, ak: 2400, scar: 2900, sks: 2200, awm: 4200 };
export const ROUND_ITEM_PRICES = { armor1: 300, armor2: 650, armor3: 1000, helmet1: 200, helmet2: 400, helmet3: 650, frag: 300, smoke: 200, shield: 250, medkit: 350 };
export const BR_ITEM_PRICES = { armor1: 200, armor2: 450, armor3: 900, helmet1: 150, helmet2: 350, helmet3: 700, bandage: 50, medkit: 250, shield: 150, adrenaline: 300, frag: 150, smoke: 100, ammo_ar: 80, ammo_smg: 70, ammo_sniper: 120, ammo_shotgun: 70, ammo_pistol: 40, respawn: 600, scan: 350 };
export const STATES = ['plane', 'freefall', 'parachute', 'alive', 'knocked', 'dead', 'spectate'];

// Límites de velocidad horizontal/vertical (m/s) por estado, para el anti-trampas.
export const SPEED = { alive: 12, knocked: 4, plane: 1e9, freefall: 70, parachute: 30, dead: 0.5, spectate: 1e9, dash: 40 };

// PRNG con semilla (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
