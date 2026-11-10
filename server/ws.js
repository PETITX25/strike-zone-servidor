// WebSocket RFC 6455 mínimo y sin dependencias: servidor (sobre http 'upgrade') y cliente (para tests).
import crypto from 'node:crypto';
import net from 'node:net';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const MAX_FRAME = 1 << 20;          // 1 MB por frame / mensaje
const HIGH_WATER = 256 * 1024;             // por encima: descartar mensajes "droppable"

export class WSConn extends EventEmitter {
  constructor(socket, { client = false, maxPayload = MAX_FRAME } = {}) {
    super();
    this.socket = socket; this.client = client; this.maxPayload = maxPayload;
    this.buf = Buffer.alloc(0); this.frag = null; this.fragOp = 0;
    this.open = true; this.closeSent = false;
    this.bytesOut = 0; this.bytesIn = 0;
    socket.setNoDelay?.(true);
    socket.on('data', (d) => { try { this._onData(d); } catch (e) { this._fail(1002, 'protocol'); } });
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
    socket.on('drain', () => this.emit('drain'));
  }
  get buffered() { return this.socket.writableLength || 0; }

  _onData(d) {
    this.bytesIn += d.length;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, rsv = b[0] & 0x70, op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (rsv) return this._fail(1002, 'rsv');
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        const hi = b.readUInt32BE(2), lo = b.readUInt32BE(6);
        if (hi > 0) return this._fail(1009, 'too big');
        len = lo; off = 10;
      }
      if (len > this.maxPayload) return this._fail(1009, 'too big');
      if (!this.client && !masked) return this._fail(1002, 'unmasked');
      let mask = null;
      if (masked) { if (b.length < off + 4) return; mask = b.subarray(off, off + 4); off += 4; }
      if (b.length < off + len) return;
      let payload = Buffer.from(b.subarray(off, off + len));
      this.buf = b.subarray(off + len);
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      if (op >= 8) {                        // control
        if (!fin || len > 125) return this._fail(1002, 'ctrl');
        if (op === 8) {
          const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
          if (!this.closeSent) this._sendFrame(8, payload.subarray(0, 2));
          this.closeSent = true; this.open = false;
          this.emit('closeFrame', code);
          this.socket.end();
          return;
        }
        if (op === 9) { this._sendFrame(10, payload); continue; }
        if (op === 10) { this.emit('pong', payload); continue; }
        return this._fail(1002, 'op');
      }
      if (op === 0) {
        if (!this.frag) return this._fail(1002, 'cont');
        this.frag.push(payload); this.fragLen += payload.length;
        if (this.fragLen > this.maxPayload) return this._fail(1009, 'too big');
        if (fin) { const full = Buffer.concat(this.frag); const fop = this.fragOp; this.frag = null; this._deliver(fop, full); }
      } else if (op === 1 || op === 2) {
        if (this.frag) return this._fail(1002, 'frag');
        if (fin) this._deliver(op, payload);
        else { this.frag = [payload]; this.fragLen = payload.length; this.fragOp = op; }
      } else return this._fail(1002, 'op');
    }
  }
  _deliver(op, data) { this.emit('message', op === 1 ? data.toString('utf8') : data, op === 2); }

  _sendFrame(op, payload) {
    if (this.socket.destroyed) return false;
    const len = payload.length;
    const hl = (len < 126 ? 2 : len < 65536 ? 4 : 10) + (this.client ? 4 : 0);
    const h = Buffer.allocUnsafe(hl);
    h[0] = 0x80 | op;
    let o = 2;
    if (len < 126) h[1] = len;
    else if (len < 65536) { h[1] = 126; h.writeUInt16BE(len, 2); o = 4; }
    else { h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); o = 10; }
    if (this.client) {
      h[1] |= 0x80; const m = crypto.randomBytes(4); m.copy(h, o);
      payload = Buffer.from(payload); for (let i = 0; i < len; i++) payload[i] ^= m[i & 3];
    }
    this.bytesOut += hl + len;
    this.socket.write(h); return this.socket.write(payload);
  }
  // droppable = true: se descarta si el socket va atascado (snapshots); devuelve false si se descartó.
  send(str, droppable = false) {
    if (!this.open) return false;
    if (droppable && this.buffered > HIGH_WATER) return false;
    if (this.buffered > HIGH_WATER * 8) { this._fail(1008, 'slow consumer'); return false; }
    this._sendFrame(1, Buffer.from(str, 'utf8')); return true;
  }
  ping(data = Buffer.alloc(0)) { if (this.open) this._sendFrame(9, data); }
  close(code = 1000, reason = '') {
    if (!this.open) return;
    const p = Buffer.alloc(2 + Buffer.byteLength(reason)); p.writeUInt16BE(code, 0); p.write(reason, 2);
    this._sendFrame(8, p); this.closeSent = true; this.open = false;
    setTimeout(() => this.socket.destroy(), 1000).unref?.();
  }
  _fail(code, reason) { this.close(code, reason); this.socket.end(); }
  terminate() { this.open = false; this.socket.destroy(); }
  _closed() { if (this._done) return; this._done = true; this.open = false; this.emit('close'); }
}

// Servidor: manejar evento 'upgrade' de http.Server
export function acceptUpgrade(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const ws = new WSConn(socket);
  if (head && head.length) ws._onData(head);
  return ws;
}

// Cliente mínimo (tests de carga): connect('ws://host:port/ws') -> Promise<WSConn>
export function connect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const sock = net.connect(+u.port || 80, u.hostname);
    const key = crypto.randomBytes(16).toString('base64');
    let acc = Buffer.alloc(0);
    sock.once('error', reject);
    sock.on('connect', () => sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    const onData = (d) => {
      acc = Buffer.concat([acc, d]);
      const i = acc.indexOf('\r\n\r\n'); if (i < 0) return;
      sock.off('data', onData);
      const head = acc.subarray(0, i).toString();
      const exp = crypto.createHash('sha1').update(key + GUID).digest('base64');
      if (!/^HTTP\/1\.1 101/.test(head) || !head.includes(exp)) { sock.destroy(); return reject(new Error('handshake: ' + head.split('\r\n')[0])); }
      const ws = new WSConn(sock, { client: true, maxPayload: 16 << 20 });
      const rest = acc.subarray(i + 4); if (rest.length) ws._onData(rest);
      resolve(ws);
    };
    sock.on('data', onData);
  });
}
