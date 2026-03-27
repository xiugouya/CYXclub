import { writeFileSync } from 'fs';

// Generate clean api.js (no HTML embedded)
const apiCode = `/**
 * CYX俱乐部 - Cloudflare Workers API
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS_HEADERS };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function ok(data) { return json({ ok: true, ...data }); }
function err(msg, status = 400) { return json({ error: msg }, status); }

function getCredentials(request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    const parts = atob(token).split(':');
    if (parts.length < 3) return null;
    if (Date.now() - parseInt(parts[1]) > 7 * 24 * 60 * 60 * 1000) return null;
    return { username: parts[0] };
  } catch { return null; }
}
function requireAuth(request) {
  const cred = getCredentials(request);
  if (!cred) return err('Unauthorized', 401);
  return null;
}
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'cyxclub_salt_2026');
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
let _db = null;
async function getDB(env) { if (_db) return _db; _db = env.cyxclub_db; return _db; }

async function handleAPI(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');
  const method = request.method;

  if (path === '/announcements' && method === 'GET') {
    const db = await getDB(env);
    const r = await db.prepare('SELECT * FROM announcements ORDER BY sticky DESC, date DESC LIMIT ?').bind(parseInt(url.searchParams.get('count') || '10')).all();
    return json({ data: r.results });
  }
  const sm = path.match(/^\\/announcements\\/(\\d+)$/);
  if (sm && method === 'GET') {
    const db = await getDB(env);
    const r = await db.prepare('SELECT * FROM announcements WHERE id = ?').bind(parseInt(sm[1])).first();
    return r ? json({ data: r }) : err('Not found', 404);
  }
  if (path === '/config' && method === 'GET') {
    const db = await getDB(env);
    const r = await db.prepare('SELECT * FROM config').all();
    const cfg = {}; for (const row of r.results) cfg[row.key] = row.value;
    return json({ data: cfg });
  }
  const cm = path.match(/^\\/config\\/([a-z_]+)$/);
  if (cm && method === 'GET') {
    const db = await getDB(env);
    const r = await db.prepare('SELECT * FROM config WHERE key = ?').bind(cm[1]).first();
    return r ? json({ data: r }) : err('Not found', 404);
  }
  if (path === '/counter' && method === 'GET') {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const now = Date.now();
    const db = await getDB(env);
    const row = await db.prepare('SELECT * FROM counter WHERE id = 1').first();
    let sessions = {}, count = 0;
    if (row) { try { sessions = JSON.parse(row.sessions || '{}'); } catch {} count = row.count || 0; }
    const active = {};
    for (const [k, ts] of Object.entries(sessions)) { if (now - ts < 120000) active[k] = ts; }
    if (!active[ip] || now - active[ip] >= 120000) count++;
    active[ip] = now;
    const ns = JSON.stringify(active);
    if (row) { await db.prepare('UPDATE counter SET count=?,sessions=? WHERE id=1').bind(count, ns).run(); }
    else { await db.prepare('INSERT INTO counter (id,count,sessions) VALUES (1,?,?)').bind(count, ns).run(); }
    return json({ total: count, online: Object.keys(active).length });
  }
  if (path === '/admin/login' && method === 'POST') {
    const db = await getDB(env);
    let body;
    try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { username, password } = body;
    if (!username || !password) return err('Missing credentials');
    const admin = await db.prepare('SELECT * FROM admins WHERE username = ?').bind(username).first();
    if (!admin) return err('Invalid credentials', 401);
    const hash = await hashPassword(password);
    if (hash !== admin.password) return err('Invalid credentials', 401);
    const token = btoa(username + ':' + Date.now() + ':' + hash);
    return json({ token, username, role: 'admin' });
  }
  const authErr = requireAuth(request);
  if (authErr) return authErr;

  // announcements
  if (path === '/admin/announcements' && method === 'GET') {
    const db = await getDB(env);
    const r = await db.prepare('SELECT * FROM announcements ORDER BY sticky DESC, date DESC').all();
    return json({ data: r.results });
  }
  if (path === '/admin/announcements' && method === 'POST') {
    const db = await getDB(env);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { title, content, summary, category, date, source, url, sticky } = body;
    if (!title || !content || !date) return err('Missing required fields');
    const r = await db.prepare('INSERT INTO announcements (title,content,summary,category,date,source,url,sticky) VALUES (?,?,?,?,?,?,?,?)').bind(title, content, summary||'', category||'announce', date, source||'CYX俱乐部', url||'news.html', sticky?1:0).run();
    return ok({ id: r.meta.last_insert_id });
  }
  const am = path.match(/^\\/admin\\/announcements\\/(\\d+)$/);
  if (am) {
    const db = await getDB(env);
    const id = parseInt(am[1]);
    if (method === 'PUT') {
      let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
      const { title, content, summary, category, date, source, url, sticky } = body;
      await db.prepare("UPDATE announcements SET title=COALESCE(?,title),content=COALESCE(?,content),summary=COALESCE(?,summary),category=COALESCE(?,category),date=COALESCE(?,date),source=COALESCE(?,source),url=COALESCE(?,url),sticky=COALESCE(?,sticky),updated_at=datetime('now','+8 hours') WHERE id=?").bind(title,content,summary,category,date,source,url,sticky!==undefined?(sticky?1:0):null,id).run();
      return ok({ id });
    }
    if (method === 'DELETE') { await db.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run(); return ok({}); }
  }

  // cards
  if (path === '/admin/cards' && method === 'GET') {
    const db = await getDB(env);
    const r = await db.prepare('SELECT * FROM card_keys ORDER BY created_at DESC').all();
    return json({ data: r.results });
  }
  if (path === '/admin/cards' && method === 'POST') {
    const db = await getDB(env);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const count = Math.min(Math.max(parseInt(body.count)||1, 1), 100);
    const product = (body.product||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6)||'FREE';
    const now = new Date();
    const mm = String(now.getMonth()+1).padStart(2,'0');
    const dd = String(now.getDate()).padStart(2,'0');
    const dp = mm+dd;
    const prefix = 'CYX-'+dp+'-'+product+'-%';
    const last = await db.prepare("SELECT card_key FROM card_keys WHERE card_key LIKE ? ORDER BY id DESC LIMIT 1").bind(prefix).first();
    let seq = 1;
    if (last) { const parts = last.card_key.split('-'); if (parts.length>=4){const n=parseInt(parts[3]);if(!isNaN(n))seq=n+1;} }
    const rc='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const keys = [];
    for (let i=0;i<count;i++) {
      const ss=String(seq+i).padStart(4,'0');
      const bytes=crypto.getRandomValues(new Uint8Array(4));
      let rand='';for(let j=0;j<4;j++)rand+=rc[bytes[j]%rc.length];
      const key='CYX-'+dp+'-'+product+'-'+ss+'-'+rand;
      try { await db.prepare('INSERT INTO card_keys (card_key, product_code) VALUES (?, ?)').bind(key, product).run(); keys.push(key); } catch {}
    }
    return ok({ keys, count: keys.length, product });
  }
  const cdm = path.match(/^\\/admin\\/cards\\/(\\d+)$/);
  if (cdm && method === 'DELETE') { const db = await getDB(env); await db.prepare('DELETE FROM card_keys WHERE id = ?').bind(parseInt(cdm[1])).run(); return ok({}); }

  // products
  if (path === '/admin/products' && method === 'GET') {
    const db = await getDB(env);
    const r = await db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
    return json({ data: r.results });
  }
  if (path === '/admin/products' && method === 'POST') {
    const db = await getDB(env);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const code = (body.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);
    const name = (body.name||'').trim().slice(0,50);
    const desc = (body.description||'').trim().slice(0,200);
    if (!code||!name) return err('商品编号和名称不能为空');
    const existing = await db.prepare('SELECT id FROM products WHERE code = ?').bind(code).first();
    if (existing) return err('商品编号已存在');
    await db.prepare('INSERT INTO products (code, name, description) VALUES (?, ?, ?)').bind(code, name, desc).run();
    return ok({ code, name });
  }
  const pm = path.match(/^\\/admin\\/products\\/(\\d+)$/);
  if (pm) {
    const db = await getDB(env);
    const id = parseInt(pm[1]);
    if (method === 'PUT') {
      let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
      const name = (body.name||'').trim().slice(0,50);
      const desc = (body.description||'').trim().slice(0,200);
      if (!name) return err('商品名称不能为空');
      await db.prepare("UPDATE products SET name=?,description=?,updated_at=datetime('now','+8 hours') WHERE id=?").bind(name, desc, id).run();
      return ok({ id });
    }
    if (method === 'DELETE') { await db.prepare('DELETE FROM products WHERE id = ?').bind(id).run(); return ok({}); }
  }

  // config
  if (path === '/admin/config' && method === 'GET') {
    const db = await getDB(env);
    const r = await db.prepare('SELECT * FROM config').all();
    return json({ data: r.results });
  }
  const ckm = path.match(/^\\/admin\\/config\\/([a-z_]+)$/);
  if (ckm && method === 'PUT') {
    const db = await getDB(env);
    let body; try { body = await request.json(); } catch { return err('Invalid JSON'); }
    await db.prepare("INSERT INTO config (key,value,label,type) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,label=COALESCE(excluded.label,config.label),type=COALESCE(excluded.type,config.type),updated_at=datetime('now','+8 hours')").bind(ckm[1], body.value, body.label||null, body.type||'text').run();
    return ok({ key: ckm[1], value: body.value });
  }

  return err('Not found', 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      const response = await handleAPI(request, env);
      const headers = new Headers(response.headers);
      Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
      return new Response(response.body, { status: response.status, headers });
    }

    return fetch(request);
  },
};
`;

writeFileSync('C:/Users/cxk/Desktop/CYXclub-main/workers/api.js', apiCode, 'utf8');
console.log('api.js written: ' + apiCode.length + ' chars');
