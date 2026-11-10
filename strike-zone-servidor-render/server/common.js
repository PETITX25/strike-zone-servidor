// Configuración (variables de entorno), log y datos de operadores.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = (k, d) => (process.env[k] != null && process.env[k] !== '' ? Number(process.env[k]) : d);
export const cfg = {
  PORT: env('PORT', 8080),
  TICK_HZ: env('TICK_HZ', 15),
  LOBBY_BR: env('LOBBY_BR', 30),            // s de cuenta atrás de lobby
  LOBBY_ROUNDS: env('LOBBY_ROUNDS', 15),
  REJOIN_MS: env('REJOIN_MS', 30000),
  HEARTBEAT_MS: env('HEARTBEAT_MS', 30000), // sin datos del cliente → desconectar
  END_LINGER_MS: env('END_LINGER_MS', 15000),
  NEAR: env('NEAR', 150), FAR: env('FAR', 350),
  BUDGET: env('SNAP_BUDGET', 32000),        // bytes/s por cliente antes de recortar snapshots
  MSG_RATE: env('MSG_RATE', 120),           // mensajes/s por cliente (ráfaga = 2x)
  MAX_MSG: env('MAX_MSG', 65536),           // bytes por mensaje JSON
  MAX_CLIENTS: env('MAX_CLIENTS', 2000),
  QUIET: process.env.QUIET === '1',
};

export function log(...a) { if (!cfg.QUIET) console.log(new Date().toISOString().slice(11, 19), ...a); }

export let BOT_NAMES = ['Lobo_77', 'Coyote', 'Tormenta', 'Kaiser', 'Vibora', 'Draco', 'Toro', 'Nova', 'Cuervo', 'Titán'];
export let OPERATOR_IDS = ['halcon', 'muro', 'fantasma', 'medica', 'trueno'];
export async function loadOperators() {
  try {
    const f = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'data', 'operators.js');
    const m = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(f, 'utf8')).toString('base64'));
    if (m.BOT_NAMES?.length) BOT_NAMES = m.BOT_NAMES;
    if (m.OPERATOR_IDS?.length) OPERATOR_IDS = m.OPERATOR_IDS;
  } catch (e) { log('[rules] operators.js no disponible:', e.message); }
}
