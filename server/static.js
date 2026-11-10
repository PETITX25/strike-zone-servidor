// Servidor de archivos estáticos con MIME, gzip (cacheado en memoria) y cabeceras de caché.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.wasm': 'application/wasm', '.map': 'application/json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt', '.md', '.map']);
const BLOCK = /(^|\/)(\.git|server|node_modules|shots|tools)(\/|$)|\.zip$/;

export function makeStatic(root) {
  const gzCache = new Map();   // path -> { mtime, buf }
  return function serve(req, res) {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
    if (p.endsWith('/')) p += 'index.html';
    const rel = path.normalize(p).replace(/^([/\\])+/, '');
    if (rel.startsWith('..') || BLOCK.test(rel.replace(/\\/g, '/'))) { res.writeHead(404); return res.end('No encontrado'); }
    const file = path.join(root, rel);
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
      const ext = path.extname(file).toLowerCase();
      const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
      const noCache = ext === '.html' || path.basename(file) === 'sw.js' || ext === '.webmanifest';
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream', ETag: etag,
        'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff',
      };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
      const gz = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && st.size > 512;
      if (gz) {
        headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding';
        const c = gzCache.get(file);
        const done = (buf) => { headers['Content-Length'] = buf.length; res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : buf); };
        if (c && c.mtime === st.mtimeMs) return done(c.buf);
        fs.readFile(file, (e, data) => {
          if (e) { res.writeHead(500); return res.end(); }
          zlib.gzip(data, { level: 6 }, (e2, buf) => {
            if (e2) { res.writeHead(500); return res.end(); }
            gzCache.set(file, { mtime: st.mtimeMs, buf }); done(buf);
          });
        });
        return;
      }
      headers['Content-Length'] = st.size;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  };
}
