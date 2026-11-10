// Ítems de loot y tienda.
export const ITEMS = {
  bandage:   { id: 'bandage', type: 'med', name: 'Venda', heal: 15, max: 75, useTime: 3.0, stack: 10, rarity: 0, price: 50 },
  medkit:    { id: 'medkit', type: 'med', name: 'Botiquín', heal: 100, max: 100, useTime: 6.0, stack: 3, rarity: 2, price: 250 },
  shield:    { id: 'shield', type: 'med', name: 'Batería de escudo', armor: 50, useTime: 4.0, stack: 5, rarity: 1, price: 150 },
  adrenaline:{ id: 'adrenaline', type: 'med', name: 'Adrenalina', heal: 25, regen: 50, speed: 1.12, useTime: 2.0, stack: 2, rarity: 3, price: 300 },
  armor1:    { id: 'armor1', type: 'armor', level: 1, name: 'Chaleco Nv. 1', rarity: 0, price: 200 },
  armor2:    { id: 'armor2', type: 'armor', level: 2, name: 'Chaleco Nv. 2', rarity: 2, price: 450 },
  armor3:    { id: 'armor3', type: 'armor', level: 3, name: 'Chaleco Nv. 3', rarity: 3, price: 900 },
  helmet1:   { id: 'helmet1', type: 'helmet', level: 1, name: 'Casco Nv. 1', rarity: 0, price: 150 },
  helmet2:   { id: 'helmet2', type: 'helmet', level: 2, name: 'Casco Nv. 2', rarity: 2, price: 350 },
  helmet3:   { id: 'helmet3', type: 'helmet', level: 3, name: 'Casco Nv. 3', rarity: 3, price: 700 },
  frag:      { id: 'frag', type: 'grenade', name: 'Granada de fragmentación', stack: 3, rarity: 1, price: 150 },
  smoke:     { id: 'smoke', type: 'grenade', name: 'Granada de humo', stack: 3, rarity: 0, price: 100 },
  ammo_ar:   { id: 'ammo_ar', type: 'ammo', ammo: 'ar', amount: 60, name: 'Munición 7.62', rarity: 0, price: 80 },
  ammo_smg:  { id: 'ammo_smg', type: 'ammo', ammo: 'smg', amount: 60, name: 'Munición 9mm', rarity: 0, price: 70 },
  ammo_sniper:{ id: 'ammo_sniper', type: 'ammo', ammo: 'sniper', amount: 10, name: 'Munición .338', rarity: 1, price: 120 },
  ammo_shotgun:{ id: 'ammo_shotgun', type: 'ammo', ammo: 'shotgun', amount: 15, name: 'Cartuchos 12G', rarity: 0, price: 70 },
  ammo_pistol:{ id: 'ammo_pistol', type: 'ammo', ammo: 'pistol', amount: 30, name: 'Munición .45', rarity: 0, price: 40 },
  respawn:   { id: 'respawn', type: 'special', name: 'Ficha de reaparición', desc: 'Reaparece a un aliado eliminado', rarity: 4, price: 600, shopOnly: true },
  scan:      { id: 'scan', type: 'special', name: 'Radar de zona', desc: 'Revela enemigos cercanos 10 s', rarity: 3, price: 350, shopOnly: true },
};
export const MAX_AMMO = { ar: 240, smg: 240, sniper: 40, shotgun: 60, pistol: 120 };
// Tienda: listado ordenado
export const SHOP_ITEMS = ['armor2', 'armor3', 'helmet2', 'helmet3', 'medkit', 'bandage', 'shield', 'adrenaline', 'frag', 'smoke', 'ammo_ar', 'ammo_smg', 'ammo_sniper', 'ammo_shotgun', 'respawn', 'scan'];
// Pesos de loot por tier (1 = casas, 3 = base militar)
export const LOOT_TABLE = {
  weapon: { 1: ['mp5', 'm1911', 'm870', 'm4', 'ak', 'vector', 's12'], 2: ['m4', 'ak', 'vector', 's12', 'sks', 'mp5', 'deagle'], 3: ['scar', 'awm', 'sks', 'm4', 'ak', 'vector', 'deagle'] },
};
