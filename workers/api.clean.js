/**
 * CYX - Cloudflare Workers API (v3 - )
 *
 *  D1 
 * - admins (TEXT id, username, password_hash)
 * - workers (TEXT id, name, password_hash, games JSON, status)
 * - announcements (TEXT id, title, content, category, is_pinned, is_active, INTEGER timestamps)
 * - orders (TEXT id, order_no, worker_id, preferred_worker, status, game, service_type INT, price, user_password, user_note, INTEGER timestamps)
 * - order_counter (date_key YYYYMMDD, counter)
 * - counter (id=1, count, sessions JSON)
 * - sessions (token TEXT PK, user_id TEXT, username TEXT, role TEXT, expires_at INT, created_at INT)
 */

// ============================================================
// 
// ============================================================

const COOKIE_NAME = 'cyx_session';
const SESSION_TTL = 7 * 86400; // 7 days in seconds
const COUNTER_SESSION_MS = 120000; // 2 minutes
const SALT = 'cyxclub_salt_2026';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_H = { 'Content-Type': 'application/json', ...CORS };

// ============================================================
// 
// ============================================================

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: JSON_H });
const ok = d => json({ success: true, data: d });
const err = (m, s = 400) => json({ success: false, error: m }, s);

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
const hashPwd = p => sha256(p + SALT);
const verifyPwd = (p, h) => hashPwd(p).then(ph => ph === h);

function genToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function now() { return Math.floor(Date.now() / 1000); }

function genId(prefix) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * 36)];
  return `${prefix}_${suffix}`;
}

// CYX + MMDD + (3) + (4) + (2)
function genOrderVC(dateStr, seq) {
  let h = 0;
  const s = dateStr + seq + 'cyx_order_2026';
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  h = Math.abs(h);
  for (let i = 0; i < 4; i++) { r += chars[h % chars.length]; h = Math.floor(h / chars.length); }
  return r;
}

// ============================================================
// SessionKV
// ============================================================

async function createSession(kv, userId, username, role) {
  const token = genToken();
  const exp = now() + SESSION_TTL;
  await kv.put(token, JSON.stringify({ user_id: userId, username, role, expires_at: exp }), { expirationTtl: SESSION_TTL });
  return token;
}

async function getSession(kv, token) {
  if (!token) return null;
  const raw = await kv.get(token);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (d.expires_at < now()) { await kv.delete(token); return null; }
    return d;
  } catch { return null; }
}

const getCookies = r => {
  const c = r.headers.get('Cookie');
  if (!c) return {};
  return Object.fromEntries(c.split(';').map(x => { const i = x.trim().indexOf('='); return [x.trim().slice(0, i), x.trim().slice(i + 1)]; }));
};
const getToken = r => getCookies(r)[COOKIE_NAME] || null;
const setCookie = t => `${COOKIE_NAME}=${t}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; SameSite=Lax; Secure`;
const clearCookie = () => `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;

// ============================================================
// 
// ============================================================

// ---  ---

async function hAnnouncements(db) {
  const r = await db.prepare("SELECT * FROM announcements WHERE is_active = 1 ORDER BY is_pinned DESC, created_at DESC LIMIT 20").all();
  return ok(r.results);
}

async function hCounter(db, req) {
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const t = Date.now();
  const row = await db.prepare("SELECT * FROM counter WHERE id = 1").first();
  let sessions = {}, count = 0;
  if (row) { try { sessions = JSON.parse(row.sessions || '{}'); } catch {} count = row.count || 0; }
  const active = {};
  for (const [k, ts] of Object.entries(sessions)) if (t - ts < COUNTER_SESSION_MS) active[k] = ts;
  if (!active[ip]) count++;
  active[ip] = t;
  const ns = JSON.stringify(active);
  if (row) await db.prepare("UPDATE counter SET count=?, sessions=?, updated_at=? WHERE id=1").bind(count, ns, now()).run();
  else await db.prepare("INSERT INTO counter (id, count, sessions, updated_at) VALUES (1,?,?,?)").bind(count, ns, now()).run();
  return ok({ total: count, online: Object.keys(active).length });
}

// ---  ---

async function hLogin(db, kv, req) {
  let body;
  try { body = await req.json(); } catch { return err('invalid json'); }
  const { username, password, role } = body;
  if (!username || !password) return err('username and password required');

  // 1) 
  const admin = await db.prepare("SELECT * FROM admins WHERE username = ?").bind(username).first();
  if (admin) {
    const hash = await hashPwd(password);
    if (hash !== admin.password_hash) return err('invalid password', 401);
    const token = await createSession(kv, admin.id, admin.username, 'admin');
    const res = ok({ user: { id: admin.id, username: admin.username, role: 'admin' } });
    res.headers.set('Set-Cookie', setCookie(token));
    return res;
  }

  // 2) 
  if (role === 'employee') {
    // workers  name 
    const worker = await db.prepare("SELECT * FROM workers WHERE name = ? AND status = 'active'").bind(username).first();
    if (!worker) return err('invalid credentials', 401);
    const hash = await hashPwd(password);
    if (hash !== worker.password_hash) return err('invalid password', 401);
    const token = await createSession(kv, worker.id, worker.name, 'employee');
    const res = ok({ user: { id: worker.id, username: worker.name, games: worker.games, role: 'employee' } });
    res.headers.set('Set-Cookie', setCookie(token));
    return res;
  }

  // 3)  + 
  const order = await db.prepare("SELECT * FROM orders WHERE order_no = ?").bind(username).first();
  if (!order) return err('invalid order number or password', 401);
  if (!order.user_password) return err('order has no password set', 401);
  const hash = await hashPwd(password);
  if (hash !== order.user_password) return err('invalid order number or password', 401);
  const token = await createSession(kv, order.id, order.order_no, 'user');
  const res = ok({ user: { id: order.id, order_no: order.order_no, game: order.game, status: order.status, role: 'user' } });
  res.headers.set('Set-Cookie', setCookie(token));
  return res;
}

async function hLogout(kv, req) {
  const t = getToken(req);
  if (t) await kv.delete(t);
  const res = ok({ message: 'logged out' });
  res.headers.set('Set-Cookie', clearCookie());
  return res;
}

async function hMe(kv, req) {
  const t = getToken(req);
  if (!t) return err('not logged in', 401);
  const s = await getSession(kv, t);
  if (!s) return err('session expired', 401);
  return ok({ userId: s.user_id, username: s.username, role: s.role });
}

// ---  API ---

async function hAdminStats(db) {
  const o = await db.prepare("SELECT COUNT(*) as c FROM orders").first();
  const op = await db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='pending'").first();
  const oc = await db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='completed'").first();
  const w = await db.prepare("SELECT COUNT(*) as c FROM workers WHERE status='active'").first();
  const a = await db.prepare("SELECT COUNT(*) as c FROM announcements WHERE is_active=1").first();
  const ctr = await db.prepare("SELECT count FROM counter WHERE id=1").first();
  return ok({
    orders: { total: o?.c || 0, pending: op?.c || 0, completed: oc?.c || 0 },
    workers: w?.c || 0,
    announcements: a?.c || 0,
    visits: ctr?.count || 0,
  });
}

async function hAdminAnnouncements(db) {
  const r = await db.prepare("SELECT * FROM announcements ORDER BY is_pinned DESC, created_at DESC").all();
  return ok(r.results);
}

async function hAdminCreateAnnouncement(db, req) {
  let b; try { b = await req.json(); } catch { return err('invalid json'); }
  if (!b.title || !b.content) return err('title and content required');
  const id = genId('ann');
  await db.prepare("INSERT INTO announcements (id, title, content, category, is_pinned, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, b.title, b.content, b.category || 'announce', b.is_pinned ? 1 : 0, 1, now(), now()).run();
  return ok({ id });
}

async function hAdminUpdateAnnouncement(db, id, req) {
  let b; try { b = await req.json(); } catch { return err('invalid json'); }
  await db.prepare("UPDATE announcements SET title=COALESCE(?,title), content=COALESCE(?,content), category=COALESCE(?,category), is_pinned=COALESCE(?,is_pinned), is_active=COALESCE(?,is_active), updated_at=? WHERE id=?")
    .bind(b.title, b.content, b.category, b.is_pinned !== undefined ? (b.is_pinned ? 1 : 0) : null, b.is_active !== undefined ? (b.is_active ? 1 : 0) : null, now(), id).run();
  return ok({ id });
}

async function hAdminDeleteAnnouncement(db, id) {
  await db.prepare("DELETE FROM announcements WHERE id=?").bind(id).run();
  return ok({});
}

// 
async function hAdminWorkers(db) {
  const r = await db.prepare("SELECT id, name, games, status, created_at FROM workers ORDER BY created_at DESC").all();
  return ok(r.results);
}

async function hAdminCreateWorker(db, req) {
  let b; try { b = await req.json(); } catch { return err('invalid json'); }
  if (!b.name || !b.password) return err('name and password required');
  const id = genId('worker');
  const hash = await hashPwd(b.password);
  const games = b.games ? JSON.stringify(b.games) : '[]';
  await db.prepare("INSERT INTO workers (id, name, password_hash, games, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
    .bind(id, b.name, hash, games, 'active', now(), now()).run();
  return ok({ id, name: b.name });
}

async function hAdminUpdateWorker(db, id, req) {
  let b; try { b = await req.json(); } catch { return err('invalid json'); }
  if (b.password) {
    const hash = await hashPwd(b.password);
    await db.prepare("UPDATE workers SET password_hash=?, name=COALESCE(?,name), games=COALESCE(?,games), status=COALESCE(?,status), updated_at=? WHERE id=?")
      .bind(hash, b.name, b.games ? JSON.stringify(b.games) : null, b.status, now(), id).run();
  } else {
    await db.prepare("UPDATE workers SET name=COALESCE(?,name), games=COALESCE(?,games), status=COALESCE(?,status), updated_at=? WHERE id=?")
      .bind(b.name, b.games ? JSON.stringify(b.games) : null, b.status, now(), id).run();
  }
  return ok({ id });
}

async function hAdminDeleteWorker(db, id) {
  await db.prepare("DELETE FROM workers WHERE id=?").bind(id).run();
  return ok({});
}

// 
async function hAdminOrders(db) {
  const r = await db.prepare(
    "SELECT o.*, w.name as worker_name FROM orders o LEFT JOIN workers w ON o.worker_id = w.id ORDER BY o.created_at DESC"
  ).all();
  return ok(r.results);
}

// 
async function hAdminCreateOrder(db, req) {
  let b; try { b = await req.json(); } catch { return err('invalid json'); }
  if (!b.game || !b.service_type || !b.password) return err('game, service_type and password required');

  // 
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const dateKey = `${d.getFullYear()}${mm}${dd}`;
  const dateStr = mm + dd;
  const pc = (b.product_code || 'GEN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3).padEnd(3, 'X');

  // 
  await db.prepare("INSERT OR IGNORE INTO order_counter (date_key, counter) VALUES (?, 0)").bind(dateKey).run();
  const ctr = await db.prepare("UPDATE order_counter SET counter = counter + 1 WHERE date_key = ? RETURNING counter").bind(dateKey).first();
  const seq = ctr ? ctr.counter : 1;
  const seqStr = String(seq).padStart(2, '0');
  const vc = genOrderVC(dateStr, seq);
  const orderNo = `CYX${dateStr}${pc}-${vc}${seqStr}`;

  const id = genId('order');
  const hash = await hashPwd(b.password);
  const serviceType = parseInt(b.service_type) || 1;
  const price = parseInt(b.price) || 0;

  await db.prepare(
    "INSERT INTO orders (id, order_no, worker_id, preferred_worker, status, game, service_type, price, user_password, user_note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(id, orderNo, b.worker_id || null, b.preferred_worker || null, 'pending', b.game, serviceType, price, hash, b.user_note || null, now(), now()).run();

  return ok({ order_no: orderNo, password: b.password, id });
}

async function hAdminUpdateOrder(db, id, req) {
  let b; try { b = await req.json(); } catch { return err('invalid json'); }
  const validStatus = ['pending', 'in_progress', 'completed', 'cancelled'];
  if (b.status && !validStatus.includes(b.status)) return err('invalid status');
  await db.prepare("UPDATE orders SET status=COALESCE(?,status), worker_id=COALESCE(?,worker_id), preferred_worker=COALESCE(?,preferred_worker), updated_at=? WHERE id=?")
    .bind(b.status, b.worker_id, b.preferred_worker, now(), id).run();
  return ok({ id });
}

async function hAdminDeleteOrder(db, id) {
  await db.prepare("DELETE FROM orders WHERE id=?").bind(id).run();
  return ok({});
}

// ---  API ---

// 
async function hGetWorkers(db) {
  const r = await db.prepare("SELECT id, name, games FROM workers WHERE status = 'active'").all();
  return ok(r.results);
}

// 
async function hUserOrders(db, session) {
  const order = await db.prepare(
    "SELECT o.*, w.name as worker_name FROM orders o LEFT JOIN workers w ON o.worker_id = w.id WHERE o.id = ?"
  ).bind(session.user_id).first();
  return ok(order ? [order] : []);
}

// 
async function hUserSelectWorker(db, session, req) {
  let b; try { b = await req.json(); } catch { return err('invalid json'); }
  if (!b.worker_id) return err('select a worker');
  const w = await db.prepare("SELECT id FROM workers WHERE id = ? AND status = 'active'").bind(b.worker_id).first();
  if (!w) return err('worker not found');
  await db.prepare("UPDATE orders SET preferred_worker = ?, updated_at = ? WHERE id = ?").bind(b.worker_id, now(), session.user_id).run();
  return ok({ message: 'selected' });
}

// ---  API ---

async function hEmployeeOrders(db, session) {
  let query;
  if (session.role === 'admin') {
    query = "SELECT o.*, w.name as worker_name FROM orders o LEFT JOIN workers w ON o.worker_id = w.id ORDER BY o.created_at DESC";
    return ok((await db.prepare(query).all()).results);
  }
  query = "SELECT o.*, w.name as worker_name FROM orders o LEFT JOIN workers w ON o.worker_id = w.id WHERE o.worker_id = ? ORDER BY o.created_at DESC";
  return ok((await db.prepare(query).bind(session.user_id).all()).results);
}

async function hEmployeeUpdateStatus(db, session, orderId, req) {
  let b; try { b = await req.json(); } catch { return err('invalid json'); }
  const valid = ['pending', 'in_progress', 'completed', 'cancelled'];
  if (!b.status || !valid.includes(b.status)) return err('invalid status');

  let order;
  if (session.role === 'admin') {
    order = await db.prepare("SELECT id FROM orders WHERE id=?").bind(orderId).first();
  } else {
    order = await db.prepare("SELECT id FROM orders WHERE id=? AND worker_id=?").bind(orderId, session.user_id).first();
  }
  if (!order) return err('order not found or no permission', 404);

  const updates = ["status=?", "updated_at=?"];
  const vals = [b.status, now()];
  if (b.status === 'in_progress') { updates.push("assigned_at=?"); vals.push(now()); }
  if (b.status === 'completed') { updates.push("completed_at=?"); vals.push(now()); }
  vals.push(orderId);

  await db.prepare(`UPDATE orders SET ${updates.join(',')} WHERE id=?`).bind(...vals).run();
  return ok({ message: 'status updated' });
}

// ============================================================
// 
// ============================================================

async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const db = env.cyxclub_db;
  const kv = env.SESSIONS;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
  }

  if (!path.startsWith('/api/')) {
    if (path === '/' || path === '') {
      return new Response(JSON.stringify({ service: 'CYX Club API', status: 'running' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return fetch(request);
  }

  try {
    const p = path.replace('/api', '');

    // ===  ===
    if (p === '/announcements' && method === 'GET') return hAnnouncements(db);
    if (p === '/counter' && method === 'GET') return hCounter(db, req);
    if (p === '/auth/login' && method === 'POST') return hLogin(db, kv, req);

    // ===  ===
    if (p === '/auth/logout' && method === 'POST') return hLogout(kv, req);
    if (p === '/auth/me' && method === 'GET') return hMe(kv, req);

    const token = getToken(req);
    if (!token) return err('not logged in', 401);
    const session = await getSession(kv, token);
    if (!session) return err('session expired', 401);

    // ===  ===
    if (p.startsWith('/admin/')) {
      if (session.role !== 'admin') return err('permission denied', 403);
      const ap = p.replace('/admin', '');

      if (ap === '/stats' && method === 'GET') return hAdminStats(db);
      if (ap === '/announcements' && method === 'GET') return hAdminAnnouncements(db);
      if (ap === '/announcements' && method === 'POST') return hAdminCreateAnnouncement(db, req);
      let m;
      if ((m = ap.match(/^\/announcements\/([a-z0-9_]+)$/))) {
        if (method === 'PUT') return hAdminUpdateAnnouncement(db, m[1], req);
        if (method === 'DELETE') return hAdminDeleteAnnouncement(db, m[1]);
      }

      if (ap === '/workers' && method === 'GET') return hAdminWorkers(db);
      if (ap === '/workers' && method === 'POST') return hAdminCreateWorker(db, req);
      if ((m = ap.match(/^\/workers\/([a-z0-9_]+)$/))) {
        if (method === 'PUT') return hAdminUpdateWorker(db, m[1], req);
        if (method === 'DELETE') return hAdminDeleteWorker(db, m[1]);
      }

      if (ap === '/orders' && method === 'GET') return hAdminOrders(db);
      if (ap === '/orders' && method === 'POST') return hAdminCreateOrder(db, req);
      if ((m = ap.match(/^\/orders\/([a-z0-9_]+)$/))) {
        if (method === 'PUT') return hAdminUpdateOrder(db, m[1], req);
        if (method === 'DELETE') return hAdminDeleteOrder(db, m[1]);
      }

      return err('not found', 404);
    }

    // ===  ===
    if (p === '/workers' && method === 'GET') return hGetWorkers(db);
    if (p === '/orders') {
      if (session.role !== 'user') return err('user only', 403);
      if (method === 'GET') return hUserOrders(db, session);
      if (method === 'POST') return hUserSelectWorker(db, session, req);
    }

    // ===  ===
    if (p.startsWith('/employee/')) {
      if (session.role !== 'employee' && session.role !== 'admin') return err('permission denied', 403);
      const ep = p.replace('/employee', '');
      if (ep === '/orders' && method === 'GET') return hEmployeeOrders(db, session);
      let sm;
      if ((sm = ep.match(/^\/orders\/([a-z0-9_]+)\/status$/)) && method === 'PUT')
        return hEmployeeUpdateStatus(db, session, sm[1], req);
      return err('not found', 404);
    }

    return err('not found', 404);
  } catch (e) {
    console.error('API Error:', e);
    return err('server error: ' + e.message, 500);
  }
}

// ============================================================
// Worker 
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handle(request, env);
    return fetch(request);
  },
};
