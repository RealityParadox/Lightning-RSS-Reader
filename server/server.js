// Lightning RSS Reader server. One process, zero dependencies:
// - serves the app files (WWW_DIR)
// - proxies /api/ to FreshRSS, so the browser sees the app and the API on the same origin (no CORS)
// - push notifier (/push/): periodically checks FreshRSS for new unread articles and sends Web Push notifications.
//   Payload encryption (RFC 8291) and VAPID (RFC 8292) are done with node:crypto.
'use strict';
const http = require('node:http'), https = require('node:https'), crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');

const env = process.env;
const UP = (env.FRESHRSS_URL || env.FRESHRSS_UPSTREAM || '').replace(/\/+$/, '');
const PORT = +env.PORT || 3000;
const WWW = path.resolve(env.WWW_DIR || path.join(__dirname, 'www'));
const DATA = env.DATA_DIR || '/data';
const NOTIFY = !/^(0|false|no|off)$/i.test(env.NOTIFICATIONS || '');
const SUBJECT = env.VAPID_SUBJECT || 'mailto:admin@example.com';
const MIN_INTERVAL = 5, MAX_INTERVAL = 1440, MAX_SUBS = 50, TICK = 60_000;
if (!UP) { console.error('FRESHRSS_URL is not set (e.g. http://freshrss:80)'); process.exit(1); }
const upstream = new URL(UP);
const API = UP + '/api/greader.php/reader/api/0/';

const b64u = b => Buffer.from(b).toString('base64url');
const unb64u = s => Buffer.from(s, 'base64url');
const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ---------- static files ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
function serveStatic(q, res) {
  if (q.method != 'GET' && q.method != 'HEAD') { res.writeHead(405); return res.end(); }
  let p;
  try { p = decodeURIComponent(q.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(WWW, path.normalize(p));
  if (!f.startsWith(WWW + path.sep) || /[\\/]\./.test(p)) { res.writeHead(404); return res.end(); }
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    /* always revalidate (stale app files were a problem in the past); the ETag keeps it cheap */
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const h = { ETag: etag, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    if (q.headers['if-none-match'] == etag) { res.writeHead(304, h); return res.end(); }
    res.writeHead(200, { ...h, 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size });
    if (q.method == 'HEAD') return res.end();
    fs.createReadStream(f).pipe(res);
  });
}

/* ---------- FreshRSS API proxy ---------- */
const HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'];
function proxy(q, res) {
  const h = { ...q.headers };
  HOP.forEach(k => delete h[k]);
  h.host = upstream.host;
  h['x-forwarded-for'] = (h['x-forwarded-for'] ? h['x-forwarded-for'] + ', ' : '') + q.socket.remoteAddress;
  h['x-forwarded-proto'] = h['x-forwarded-proto'] || 'https';
  const r = (upstream.protocol == 'https:' ? https : http).request({
    protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port, method: q.method,
    path: upstream.pathname.replace(/\/+$/, '') + q.url, headers: h, timeout: 60_000,
  }, up => {
    const rh = { ...up.headers }; HOP.forEach(k => delete rh[k]);
    res.writeHead(up.statusCode, rh); up.pipe(res);
  });
  r.on('timeout', () => r.destroy(new Error('timeout')));
  r.on('error', e => { log('proxy error:', e.message); if (!res.headersSent) res.writeHead(502); res.end(); });
  q.pipe(r);
}

/* ---------- push notifier ---------- */
const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const writeJson = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v), { mode: 0o600 }); fs.renameSync(f + '.tmp', f); };
let vapid, vapidKey, subs = {};
const SUBS = DATA + '/subscriptions.json';
const save = () => writeJson(SUBS, subs);

if (NOTIFY) {
  fs.mkdirSync(DATA, { recursive: true });
  /* VAPID key pair, generated on first start and kept in the data volume */
  vapid = readJson(DATA + '/vapid.json', null);
  if (!vapid) {
    const jwk = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
    vapid = { jwk, pub: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])) };
    writeJson(DATA + '/vapid.json', vapid);
    log('generated VAPID keys');
  }
  vapidKey = crypto.createPrivateKey({ key: vapid.jwk, format: 'jwk' });
  /* subscriptions, keyed by push endpoint:
     { sub:{endpoint,keys}, auth, interval (min), next (ms), max (newest article id seen), acc:{n,titles}, bad } */
  subs = readJson(SUBS, {});
  setInterval(tick, TICK);
}

function vapidAuth(endpoint) {
  const h = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const c = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT }));
  const sig = crypto.sign('sha256', Buffer.from(h + '.' + c), { key: vapidKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${vapid.pub}`;
}
const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
/* aes128gcm content encoding, single record (RFC 8188 + RFC 8291) */
function encrypt(keys, text) {
  const ua = unb64u(keys.p256dh), secret = unb64u(keys.auth);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const as = ecdh.getPublicKey(), shared = ecdh.computeSecret(ua);
  const ikm = hkdf(shared, secret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32);
  const salt = crypto.randomBytes(16);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const ci = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([ci.update(Buffer.concat([Buffer.from(text), Buffer.from([2])])), ci.final(), ci.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = as.length;
  return Buffer.concat([head, as, body]);
}
async function push(sub, msg) {
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal', Authorization: vapidAuth(sub.endpoint) },
    body: encrypt(sub.keys, JSON.stringify(msg)),
  });
  return r.status;
}

const fresh = (auth, p, body) => fetch(API + p, { method: body ? 'POST' : 'GET', body, headers: { Authorization: 'GoogleLogin auth=' + auth }, signal: AbortSignal.timeout(30_000) });
const idNum = x => { try { return BigInt(String(x).includes('/') ? '0x' + String(x).replace(/^.*\//, '') : x); } catch { return 0n; } };

async function check(endpoint, s) {
  const r = await fresh(s.auth, 'stream/items/ids?output=json&n=1000&s=user/-/state/com.google/reading-list&xt=user/-/state/com.google/read');
  if (r.status == 401 || r.status == 403) { s.bad = true; log('token rejected, waiting for the app to re-subscribe'); return; }
  if (!r.ok) { log('FreshRSS returned', r.status); return; }
  const ids = ((await r.json()).itemRefs || []).map(x => x.id);
  const max = ids.reduce((m, i) => { const n = idNum(i); return n > m ? n : m; }, 0n);
  /* FreshRSS ids grow with insertion time: "new" = newer than anything seen before (first check only sets the baseline) */
  const prev = s.max ? BigInt(s.max) : null;
  if (prev == null || max > prev) s.max = String(max);
  if (prev == null) return;
  const added = ids.filter(i => idNum(i) > prev).sort((a, b) => (idNum(b) > idNum(a) ? 1 : -1));
  if (!added.length) return;

  let titles = [];
  try {
    const q = new URLSearchParams(); added.slice(0, 5).forEach(i => q.append('i', i));
    const c = await fresh(s.auth, 'stream/items/contents?output=json', q);
    if (c.ok) titles = ((await c.json()).items || []).map(it => ((it.origin && it.origin.title) ? it.origin.title + ': ' : '') + (it.title || '')).map(t => t.slice(0, 140));
  } catch {}
  /* counts accumulate until the app reports it was opened (/push/seen) */
  const acc = s.acc || { n: 0, titles: [] };
  s.acc = { n: acc.n + added.length, titles: [...titles, ...acc.titles].slice(0, 5) };
  const n = s.acc.n;
  const st = await push(s.sub, { title: `${n} new article${n > 1 ? 's' : ''}`, body: s.acc.titles.join('\n'), unread: ids.length });
  if (st == 404 || st == 410) { delete subs[endpoint]; log('subscription expired, removed'); }
  else if (st >= 400) log('push service returned', st);
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    for (const [e, s] of Object.entries(subs)) {
      if (s.bad || now < (s.next || 0)) continue;
      s.next = now + s.interval * 60_000;
      try { await check(e, s); } catch (err) { log('check failed:', err.message); }
    }
    save();
  } catch (err) { log('tick failed:', err.message); } finally { running = false; }
}

function readBody(q) {
  return new Promise((ok, ko) => {
    let d = '';
    q.on('data', c => { d += c; if (d.length > 16384) { ko(new Error('too large')); q.destroy(); } });
    q.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { ko(e); } });
    q.on('error', ko);
  });
}
async function pushApi(q, res) {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj || {})); };
  if (!NOTIFY) return send(404, { error: 'notifications disabled' });
  try {
    const p = q.url.split('?')[0].replace(/^\/push/, '');
    if (q.method == 'GET' && p == '/key') return send(200, { key: vapid.pub });
    if (q.method != 'POST') return send(404);
    const b = await readBody(q);
    if (p == '/subscribe') {
      const { sub, auth, interval } = b;
      if (!sub || typeof sub.endpoint != 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys || typeof sub.keys.p256dh != 'string' || typeof sub.keys.auth != 'string' || typeof auth != 'string') return send(400);
      /* only accept subscriptions carrying a valid FreshRSS token */
      if (!(await fresh(auth, 'user-info?output=json')).ok) return send(401);
      const old = subs[sub.endpoint];
      if (!old && Object.keys(subs).length >= MAX_SUBS) return send(429);
      const iv = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(+interval) || 10));
      const same = old && old.auth == auth;
      subs[sub.endpoint] = {
        ...(same ? old : {}),
        sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        auth, interval: iv, bad: false,
        next: same ? Math.min(old.next || 0, Date.now() + iv * 60_000) : Date.now(),
      };
      save(); if (!old) log('new subscription, every', iv, 'min');
      return send(200);
    }
    if (p == '/unsubscribe') { if (subs[b.endpoint]) { delete subs[b.endpoint]; save(); log('subscription removed'); } return send(200); }
    if (p == '/seen') { const s = subs[b.endpoint]; if (s && s.acc) { s.acc = null; save(); } return send(200); }
    send(404);
  } catch (e) { send(500, { error: e.message }); }
}

/* ---------- routing ---------- */
http.createServer((q, res) => {
  if (q.url == '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (q.url.startsWith('/api/')) return proxy(q, res);
  if (q.url.startsWith('/push/')) return pushApi(q, res);
  serveStatic(q, res);
}).listen(PORT, () => log(`listening on ${PORT}, FreshRSS at ${UP}, notifications ${NOTIFY ? 'on' : 'off'}`));
