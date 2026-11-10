// Definiciones compartidas de armas y accesorios. Usado por Player, Bots, Combat, Loot, UI, Audio.
// damage = por bala (cuerpo). falloff: [distInicio, distFin, multMin]. rpm = cadencia.
// recoil: vertical (grados por disparo), horizontal (rango ±), recovery (grados/s), firstShotMult.
// spread: hip (grados), ads (grados), move (+grados al moverse), bloom (+grados por disparo, máx maxBloom).
export const WEAPONS = {
  ak:     { id: 'ak', name: 'AK-47', cls: 'ar', ammo: 'ar', damage: 31, headMult: 1.9, rpm: 600, auto: true,  mag: 30, reload: 2.4, reloadEmpty: 2.9, range: 220, falloff: [40, 160, 0.7], pellets: 1, velocity: 715, adsFov: 58, adsTime: 0.26, moveMult: 0.95, recoil: { v: 0.85, h: 0.45, recovery: 9, first: 1.2 }, spread: { hip: 3.4, ads: 0.18, move: 2.2, bloom: 0.35, maxBloom: 3 }, rarity: 2, sound: 'ar_heavy' },
  m4:     { id: 'm4', name: 'M4A1', cls: 'ar', ammo: 'ar', damage: 26, headMult: 1.9, rpm: 760, auto: true,  mag: 30, reload: 2.1, reloadEmpty: 2.6, range: 220, falloff: [45, 170, 0.72], pellets: 1, velocity: 880, adsFov: 60, adsTime: 0.22, moveMult: 1.0, recoil: { v: 0.55, h: 0.3, recovery: 11, first: 1.1 }, spread: { hip: 3.0, ads: 0.14, move: 2.0, bloom: 0.3, maxBloom: 2.6 }, rarity: 2, sound: 'ar_light' },
  scar:   { id: 'scar', name: 'SCAR-H', cls: 'ar', ammo: 'ar', damage: 36, headMult: 1.9, rpm: 520, auto: true, mag: 20, reload: 2.5, reloadEmpty: 3.0, range: 240, falloff: [50, 180, 0.72], pellets: 1, velocity: 760, adsFov: 56, adsTime: 0.28, moveMult: 0.93, recoil: { v: 0.95, h: 0.4, recovery: 9, first: 1.25 }, spread: { hip: 3.4, ads: 0.15, move: 2.3, bloom: 0.38, maxBloom: 3.2 }, rarity: 3, sound: 'ar_heavy' },
  vector: { id: 'vector', name: 'Vector', cls: 'smg', ammo: 'smg', damage: 19, headMult: 1.6, rpm: 1100, auto: true, mag: 25, reload: 1.8, reloadEmpty: 2.2, range: 90, falloff: [15, 60, 0.55], pellets: 1, velocity: 420, adsFov: 64, adsTime: 0.16, moveMult: 1.08, recoil: { v: 0.32, h: 0.28, recovery: 14, first: 1.0 }, spread: { hip: 2.4, ads: 0.35, move: 1.2, bloom: 0.2, maxBloom: 2.2 }, rarity: 2, sound: 'smg' },
  mp5:    { id: 'mp5', name: 'MP5', cls: 'smg', ammo: 'smg', damage: 22, headMult: 1.6, rpm: 800, auto: true, mag: 30, reload: 2.0, reloadEmpty: 2.4, range: 100, falloff: [18, 70, 0.6], pellets: 1, velocity: 400, adsFov: 64, adsTime: 0.17, moveMult: 1.07, recoil: { v: 0.36, h: 0.22, recovery: 13, first: 1.0 }, spread: { hip: 2.2, ads: 0.3, move: 1.1, bloom: 0.18, maxBloom: 2 }, rarity: 1, sound: 'smg' },
  awm:    { id: 'awm', name: 'AWM', cls: 'sniper', ammo: 'sniper', damage: 120, headMult: 2.5, rpm: 42, auto: false, bolt: true, mag: 5, reload: 3.2, reloadEmpty: 3.8, range: 800, falloff: [300, 800, 0.85], pellets: 1, velocity: 950, adsFov: 18, adsTime: 0.38, moveMult: 0.88, scope: 8, recoil: { v: 4.5, h: 0.8, recovery: 6, first: 1 }, spread: { hip: 9, ads: 0.0, move: 6, bloom: 0, maxBloom: 0 }, rarity: 4, sound: 'sniper' },
  sks:    { id: 'sks', name: 'SKS', cls: 'sniper', ammo: 'sniper', damage: 52, headMult: 2.1, rpm: 300, auto: false, mag: 10, reload: 2.8, reloadEmpty: 3.3, range: 500, falloff: [120, 450, 0.8], pellets: 1, velocity: 820, adsFov: 30, adsTime: 0.3, moveMult: 0.92, scope: 4, recoil: { v: 1.9, h: 0.6, recovery: 8, first: 1 }, spread: { hip: 5, ads: 0.05, move: 3.5, bloom: 0.6, maxBloom: 2 }, rarity: 3, sound: 'dmr' },
  s12:    { id: 's12', name: 'S12K', cls: 'shotgun', ammo: 'shotgun', damage: 14, headMult: 1.4, rpm: 240, auto: false, mag: 8, reload: 2.6, reloadEmpty: 3.0, range: 40, falloff: [6, 30, 0.2], pellets: 9, pelletSpread: 4.2, velocity: 360, adsFov: 66, adsTime: 0.2, moveMult: 1.0, recoil: { v: 2.6, h: 0.8, recovery: 8, first: 1 }, spread: { hip: 0.6, ads: 0.4, move: 0.6, bloom: 0, maxBloom: 0 }, rarity: 2, sound: 'shotgun' },
  m870:   { id: 'm870', name: 'M870', cls: 'shotgun', ammo: 'shotgun', damage: 22, headMult: 1.4, rpm: 70, auto: false, pump: true, mag: 5, reload: 0.55, perShell: true, range: 35, falloff: [5, 25, 0.2], pellets: 9, pelletSpread: 3.6, velocity: 360, adsFov: 66, adsTime: 0.22, moveMult: 1.0, recoil: { v: 4, h: 1, recovery: 7, first: 1 }, spread: { hip: 0.6, ads: 0.4, move: 0.6, bloom: 0, maxBloom: 0 }, rarity: 1, sound: 'shotgun' },
  m1911:  { id: 'm1911', name: 'M1911', cls: 'pistol', ammo: 'pistol', damage: 28, headMult: 1.8, rpm: 380, auto: false, mag: 8, reload: 1.5, reloadEmpty: 1.8, range: 60, falloff: [12, 45, 0.6], pellets: 1, velocity: 300, adsFov: 68, adsTime: 0.13, moveMult: 1.1, recoil: { v: 1.2, h: 0.4, recovery: 12, first: 1 }, spread: { hip: 1.8, ads: 0.4, move: 1, bloom: 0.5, maxBloom: 2.5 }, rarity: 1, sound: 'pistol' },
  deagle: { id: 'deagle', name: 'Desert Eagle', cls: 'pistol', ammo: 'pistol', damage: 55, headMult: 2.0, rpm: 200, auto: false, mag: 7, reload: 1.9, reloadEmpty: 2.2, range: 80, falloff: [15, 60, 0.6], pellets: 1, velocity: 470, adsFov: 66, adsTime: 0.15, moveMult: 1.08, recoil: { v: 3.2, h: 0.8, recovery: 9, first: 1 }, spread: { hip: 2.4, ads: 0.3, move: 1.4, bloom: 0.9, maxBloom: 3 }, rarity: 3, sound: 'pistol_heavy' },
};

export const WEAPON_CLASS_NAMES = { ar: 'Fusil de asalto', smg: 'Subfusil', sniper: 'Francotirador', shotgun: 'Escopeta', pistol: 'Pistola' };
export const AMMO_NAMES = { ar: 'Munición 7.62', smg: 'Munición 9mm', sniper: 'Munición .338', shotgun: 'Cartuchos 12G', pistol: 'Munición .45' };

// Accesorios: slot, clases compatibles, modificadores multiplicativos/aditivos.
export const ATTACHMENTS = {
  reddot:   { id: 'reddot', slot: 'optic', name: 'Mira punto rojo', classes: ['ar', 'smg', 'shotgun', 'pistol'], mods: { adsTime: 1.0 }, zoom: 1.15, rarity: 1 },
  holo:     { id: 'holo', slot: 'optic', name: 'Mira holográfica', classes: ['ar', 'smg', 'shotgun'], mods: {}, zoom: 1.2, rarity: 2 },
  scope3x:  { id: 'scope3x', slot: 'optic', name: 'Mira 3x', classes: ['ar', 'smg', 'sniper'], mods: { adsTime: 1.15 }, zoom: 3, rarity: 2 },
  scope6x:  { id: 'scope6x', slot: 'optic', name: 'Mira 6x', classes: ['ar', 'sniper'], mods: { adsTime: 1.25 }, zoom: 6, rarity: 3 },
  suppressor:{ id: 'suppressor', slot: 'muzzle', name: 'Silenciador', classes: ['ar', 'smg', 'sniper', 'pistol'], mods: { recoilV: 0.95 }, suppressed: true, rarity: 2 },
  compensator:{ id: 'compensator', slot: 'muzzle', name: 'Compensador', classes: ['ar', 'smg', 'sniper'], mods: { recoilV: 0.8, recoilH: 0.85 }, rarity: 2 },
  choke:    { id: 'choke', slot: 'muzzle', name: 'Estrangulador', classes: ['shotgun'], mods: { pelletSpread: 0.7 }, rarity: 2 },
  extmag:   { id: 'extmag', slot: 'mag', name: 'Cargador ampliado', classes: ['ar', 'smg', 'sniper', 'pistol'], mods: { magAdd: 0.5 }, rarity: 2 },
  quickmag: { id: 'quickmag', slot: 'mag', name: 'Cargador rápido', classes: ['ar', 'smg', 'sniper', 'pistol', 'shotgun'], mods: { reload: 0.75 }, rarity: 2 },
  tacstock: { id: 'tacstock', slot: 'stock', name: 'Culata táctica', classes: ['ar', 'smg', 'sniper'], mods: { recoilV: 0.9, adsTime: 0.95, spreadMove: 0.85 }, rarity: 2 },
  vgrip:    { id: 'vgrip', slot: 'grip', name: 'Empuñadura vertical', classes: ['ar', 'smg'], mods: { recoilV: 0.85 }, rarity: 1 },
  agrip:    { id: 'agrip', slot: 'grip', name: 'Empuñadura angular', classes: ['ar', 'smg'], mods: { recoilH: 0.75, adsTime: 0.9 }, rarity: 2 },
  laser:    { id: 'laser', slot: 'grip', name: 'Láser táctico', classes: ['ar', 'smg', 'pistol', 'shotgun'], mods: { spreadHip: 0.7 }, rarity: 2 },
};
export const ATTACHMENT_SLOTS = ['optic', 'muzzle', 'mag', 'stock', 'grip'];
export const SLOT_NAMES = { optic: 'Mira', muzzle: 'Cañón', mag: 'Cargador', stock: 'Culata', grip: 'Empuñadura' };

export const RARITY = [
  { name: 'Común', color: '#b8bcc2' }, { name: 'Poco común', color: '#4fd46b' }, { name: 'Raro', color: '#3aa0ff' },
  { name: 'Épico', color: '#b85cff' }, { name: 'Legendario', color: '#ffb52e' },
];

export function createWeapon(defId, attachments = {}) {
  const def = WEAPONS[defId];
  const att = { optic: null, muzzle: null, mag: null, stock: null, grip: null, ...attachments };
  const inst = { defId, mag: 0, attachments: att };
  inst.mag = getWeaponStats(inst).mag;
  return inst;
}

export function canAttach(defId, attId) {
  const a = ATTACHMENTS[attId], d = WEAPONS[defId];
  return !!(a && d && a.classes.includes(d.cls));
}

const _statsCache = new WeakMap();
// Devuelve stats efectivas (cacheadas por instancia + firma de accesorios).
export function getWeaponStats(inst) {
  const key = ATTACHMENT_SLOTS.map(s => inst.attachments[s] || '').join('|');
  const c = _statsCache.get(inst);
  if (c && c.key === key) return c.stats;
  const d = WEAPONS[inst.defId];
  const s = {
    ...d, recoil: { ...d.recoil }, spread: { ...d.spread }, zoom: 1, suppressed: false,
    optic: null,
  };
  for (const slot of ATTACHMENT_SLOTS) {
    const id = inst.attachments[slot]; if (!id) continue;
    const a = ATTACHMENTS[id]; if (!a || !a.classes.includes(d.cls)) continue;
    const m = a.mods || {};
    if (m.adsTime) s.adsTime *= m.adsTime;
    if (m.recoilV) s.recoil.v *= m.recoilV;
    if (m.recoilH) s.recoil.h *= m.recoilH;
    if (m.spreadMove) s.spread.move *= m.spreadMove;
    if (m.spreadHip) s.spread.hip *= m.spreadHip;
    if (m.pelletSpread && s.pelletSpread) s.pelletSpread *= m.pelletSpread;
    if (m.magAdd) s.mag = Math.round(d.mag * (1 + m.magAdd));
    if (m.reload) { s.reload *= m.reload; if (s.reloadEmpty) s.reloadEmpty *= m.reload; }
    if (a.suppressed) s.suppressed = true;
    if (slot === 'optic') { s.optic = id; s.zoom = a.zoom; }
  }
  if (d.scope && !s.optic) { s.zoom = d.scope; s.optic = 'builtin'; }
  // FOV al apuntar: zoom de la mira manda si es > 1.3
  s.adsFovEff = s.zoom > 1.3 ? Math.max(10, 78 / s.zoom) : d.adsFov;
  _statsCache.set(inst, { key, stats: s });
  return s;
}

export function damageAtDistance(stats, dist) {
  const [a, b, m] = stats.falloff;
  if (dist <= a) return stats.damage;
  if (dist >= b) return stats.damage * m;
  return stats.damage * (1 - (1 - m) * (dist - a) / (b - a));
}
