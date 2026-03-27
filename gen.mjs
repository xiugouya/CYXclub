import { writeFileSync } from 'fs';

const apiCode = `/**
 * CYX俱乐部 - Cloudflare Workers API
 *
 * 路由：
 *   GET  /api/announcements          - 获取公告列表
 *   GET  /api/announcements/:id     - 获取单条公告
 *   GET  /api/config                - 获取所有配置项
 *   GET  /api/config/:key           - 获取单个配置项
 *   GET  /api/counter              - 访问计数器
 *   POST /api/admin/login           - 登录
 *   POST /api/admin/logout          - 登出
 *   GET  /api/admin/announcements   - 管理：获取全部公告
 *   POST /api/admin/announcements   - 管理：新增公告
 *   PUT  /api/admin/announcements/:id - 管理：更新公告
 *   DELETE /api/admin/announcements/:id - 管理：删除公告
 *   POST /api/admin/cards           - 管理：批量生成卡密
 *   GET  /api/admin/cards          - 管理：获取所有卡密
 *   DELETE /api/admin/cards/:id    - 管理：删除卡密
 *   GET  /api/admin/products       - 管理：获取所有商品
 *   POST /api/admin/products       - 管理：新增商品
 *   PUT  /api/admin/products/:id   - 管理：更新商品
 *   DELETE /api/admin/products/:id  - 管理：删除商品
 *   GET  /api/admin/config         - 管理：获取全部配置
 *   PUT  /api/admin/config/:key    - 管理：更新配置项
 *   GET  /admin                    - 管理后台 HTML
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
    const decoded = atob(token);
    const parts = decoded.split(':');
    if (parts.length < 3) return null;
    const [username, timestamp, hash] = parts;
    if (Date.now() - parseInt(timestamp) > 7 * 24 * 60 * 60 * 1000) return null;
    return { username };
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
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

let _db = null;
async function getDB(env) {
  if (_db) return _db;
  _db = env.cyxclub_db;
  return _db;
}

async function handleAPI(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');
  const method = request.method;

  // GET /api/announcements
  if (path === '/announcements' && method === 'GET') {
    const db = await getDB(env);
    const count = url.searchParams.get('count') || '10';
    const result = await db.prepare(
      'SELECT * FROM announcements ORDER BY sticky DESC, date DESC LIMIT ?'
    ).bind(parseInt(count)).all();
    return json({ data: result.results });
  }

  // GET /api/announcements/:id
  const singleMatch = path.match(/^\\/announcements\\/(\\d+)$/);
  if (singleMatch && method === 'GET') {
    const db = await getDB(env);
    const result = await db.prepare('SELECT * FROM announcements WHERE id = ?').bind(parseInt(singleMatch[1])).first();
    return result ? json({ data: result }) : err('Not found', 404);
  }

  // GET /api/config
  if (path === '/config' && method === 'GET') {
    const db = await getDB(env);
    const result = await db.prepare('SELECT * FROM config').all();
    const cfg = {}; for (const r of result.results) cfg[r.key] = r.value;
    return json({ data: cfg });
  }

  // GET /api/config/:key
  const cfgMatch = path.match(/^\\/config\\/([a-z_]+)$/);
  if (cfgMatch && method === 'GET') {
    const db = await getDB(env);
    const result = await db.prepare('SELECT * FROM config WHERE key = ?').bind(cfgMatch[1]).first();
    return result ? json({ data: result }) : err('Not found', 404);
  }

  // GET /api/counter
  if (path === '/counter' && method === 'GET') {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
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

  // POST /api/admin/login
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

  // 管理接口权限检查
  const authErr = requireAuth(request);
  if (authErr) return authErr;

  // ---- 公告管理 ----
  if (path === '/admin/announcements' && method === 'GET') {
    const db = await getDB(env);
    const result = await db.prepare('SELECT * FROM announcements ORDER BY sticky DESC, date DESC').all();
    return json({ data: result.results });
  }

  if (path === '/admin/announcements' && method === 'POST') {
    const db = await getDB(env);
    let body;
    try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { title, content, summary, category, date, source, url, sticky } = body;
    if (!title || !content || !date) return err('Missing required fields');
    const result = await db.prepare(
      'INSERT INTO announcements (title,content,summary,category,date,source,url,sticky) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(title, content, summary || '', category || 'announce', date, source || 'CYX俱乐部', url || 'news.html', sticky ? 1 : 0).run();
    return ok({ id: result.meta.last_insert_id });
  }

  const annMatch = path.match(/^\\/admin\\/announcements\\/(\\d+)$/);
  if (annMatch) {
    const db = await getDB(env);
    const id = parseInt(annMatch[1]);
    if (method === 'PUT') {
      let body;
      try { body = await request.json(); } catch { return err('Invalid JSON'); }
      const { title, content, summary, category, date, source, url, sticky } = body;
      await db.prepare(
        "UPDATE announcements SET title=COALESCE(?,title),content=COALESCE(?,content),summary=COALESCE(?,summary),category=COALESCE(?,category),date=COALESCE(?,date),source=COALESCE(?,source),url=COALESCE(?,url),sticky=COALESCE(?,sticky),updated_at=datetime('now','+8 hours') WHERE id=?"
      ).bind(title, content, summary, category, date, source, url, sticky !== undefined ? (sticky ? 1 : 0) : null, id).run();
      return ok({ id });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();
      return ok({});
    }
  }

  // ---- 卡密管理 ----
  if (path === '/admin/cards' && method === 'GET') {
    const db = await getDB(env);
    const result = await db.prepare('SELECT * FROM card_keys ORDER BY created_at DESC').all();
    return json({ data: result.results });
  }

  if (path === '/admin/cards' && method === 'POST') {
    const db = await getDB(env);
    let body;
    try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const count = Math.min(Math.max(parseInt(body.count) || 1, 1), 100);
    const product = (body.product || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'FREE';
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dp = mm + dd;
    const prefix = 'CYX-' + dp + '-' + product + '-%';
    const last = await db.prepare("SELECT card_key FROM card_keys WHERE card_key LIKE ? ORDER BY id DESC LIMIT 1").bind(prefix).first();
    let seq = 1;
    if (last) {
      const parts = last.card_key.split('-');
      if (parts.length >= 4) { const n = parseInt(parts[3]); if (!isNaN(n)) seq = n + 1; }
    }
    const rc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const keys = [];
    for (let i = 0; i < count; i++) {
      const ss = String(seq + i).padStart(4, '0');
      const bytes = crypto.getRandomValues(new Uint8Array(4));
      let rand = ''; for (let j = 0; j < 4; j++) rand += rc[bytes[j] % rc.length];
      const key = 'CYX-' + dp + '-' + product + '-' + ss + '-' + rand;
      try { await db.prepare('INSERT INTO card_keys (card_key, product_code) VALUES (?, ?)').bind(key, product).run(); keys.push(key); } catch {}
    }
    return ok({ keys, count: keys.length, product });
  }

  const cardMatch = path.match(/^\\/admin\\/cards\\/(\\d+)$/);
  if (cardMatch && method === 'DELETE') {
    const db = await getDB(env);
    await db.prepare('DELETE FROM card_keys WHERE id = ?').bind(parseInt(cardMatch[1])).run();
    return ok({});
  }

  // ---- 商品管理 ----
  if (path === '/admin/products' && method === 'GET') {
    const db = await getDB(env);
    const result = await db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
    return json({ data: result.results });
  }

  if (path === '/admin/products' && method === 'POST') {
    const db = await getDB(env);
    let body;
    try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const code = (body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    const name = (body.name || '').trim().slice(0, 50);
    const desc = (body.description || '').trim().slice(0, 200);
    if (!code || !name) return err('商品编号和名称不能为空');
    const existing = await db.prepare('SELECT id FROM products WHERE code = ?').bind(code).first();
    if (existing) return err('商品编号已存在');
    await db.prepare('INSERT INTO products (code, name, description) VALUES (?, ?, ?)').bind(code, name, desc).run();
    return ok({ code, name });
  }

  const prodMatch = path.match(/^\\/admin\\/products\\/(\\d+)$/);
  if (prodMatch) {
    const db = await getDB(env);
    const id = parseInt(prodMatch[1]);
    if (method === 'PUT') {
      let body;
      try { body = await request.json(); } catch { return err('Invalid JSON'); }
      const name = (body.name || '').trim().slice(0, 50);
      const desc = (body.description || '').trim().slice(0, 200);
      if (!name) return err('商品名称不能为空');
      await db.prepare("UPDATE products SET name=?,description=?,updated_at=datetime('now','+8 hours') WHERE id=?").bind(name, desc, id).run();
      return ok({ id });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
      return ok({});
    }
  }

  // ---- 配置管理 ----
  if (path === '/admin/config' && method === 'GET') {
    const db = await getDB(env);
    const result = await db.prepare('SELECT * FROM config').all();
    return json({ data: result.results });
  }

  const cfgKeyMatch = path.match(/^\\/admin\\/config\\/([a-z_]+)$/);
  if (cfgKeyMatch && method === 'PUT') {
    const db = await getDB(env);
    let body;
    try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const key = cfgKeyMatch[1];
    const { value, label, type } = body;
    await db.prepare(
      "INSERT INTO config (key,value,label,type) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,label=COALESCE(excluded.label,config.label),type=COALESCE(excluded.type,config.type),updated_at=datetime('now','+8 hours')"
    ).bind(key, value, label || null, type || 'text').run();
    return ok({ key, value });
  }

  return err('Not found', 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 管理后台 HTML（直接在这里内联，避免外部依赖）
    if (path === '/admin' || path === '/admin/') {
      return new Response(getAdminHTML(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }

    // API
    if (path.startsWith('/api/')) {
      const response = await handleAPI(request, env);
      const headers = new Headers(response.headers);
      Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
      return new Response(response.body, { status: response.status, headers });
    }

    return fetch(request);
  },
};

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function getAdminHTML() {
  var h = '';
  h += '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CYX俱乐部 管理后台</title><style>';
  h += '*{box-sizing:border-box;margin:0;padding:0}body{font-family:"Segoe UI",sans-serif;background:#0f0f0f;color:#e0e0e0;min-height:100vh}a{color:#7dd3fc;text-decoration:none}';
  h += '#login-screen{display:flex;align-items:center;justify-content:center;min-height:100vh}';
  h += '.login-box{background:#1a1a1a;padding:40px;border-radius:12px;width:360px;border:1px solid #333}';
  h += '.login-box h1{font-size:24px;margin-bottom:8px;color:#7dd3fc}.login-box p{color:#888;margin-bottom:24px;font-size:14px}';
  h += '.form-group{margin-bottom:16px}.form-group label{display:block;margin-bottom:6px;color:#aaa;font-size:14px}';
  h += '.form-group input{width:100%;padding:10px 12px;border:1px solid #333;border-radius:8px;background:#111;color:#fff;font-size:14px}';
  h += '.form-group input:focus{outline:none;border-color:#7dd3fc}';
  h += '.btn{display:inline-block;padding:10px 20px;background:#7dd3fc;color:#000;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600}';
  h += '.btn:hover{opacity:0.9}.btn-danger{background:#f87171}.btn-success{background:#4ade80}.btn-sm{padding:6px 12px;font-size:12px}';
  h += '#login-error{color:#f87171;margin-top:12px;font-size:14px;min-height:20px}';
  h += '#admin-screen{display:none}';
  h += '.topbar{background:#1a1a1a;border-bottom:1px solid #333;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}';
  h += '.topbar h2{font-size:18px;color:#7dd3fc}.topbar-right{display:flex;gap:12px;align-items:center}.topbar-right span{color:#888;font-size:14px}';
  h += '.tabs{background:#1a1a1a;border-bottom:1px solid #333;padding:0 24px;display:flex;gap:4px}';
  h += '.tab{padding:12px 20px;cursor:pointer;color:#888;font-size:14px;border-bottom:2px solid transparent}';
  h += '.tab.active{color:#7dd3fc;border-bottom-color:#7dd3fc}';
  h += '.content{padding:24px;max-width:1200px;margin:0 auto}';
  h += '.table-wrap{overflow-x:auto}';
  h += 'table{width:100%;border-collapse:collapse;background:#1a1a1a;border-radius:8px;overflow:hidden}';
  h += 'th,td{padding:12px 16px;text-align:left;border-bottom:1px solid #2a2a2a;font-size:14px}';
  h += 'th{background:#222;color:#7dd3fc;font-weight:600}tr:last-child td{border-bottom:none}tr:hover td{background:#1e1e1e}';
  h += '.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px}';
  h += '.badge-announce{background:#1e3a5f;color:#7dd3fc}.badge-activity{background:#1e3a2f;color:#4ade80}.badge-maintain{background:#3a1e1e;color:#f87171}';
  h += '.actions{display:flex;gap:8px}';
  h += '.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:100;align-items:center;justify-content:center}';
  h += '.modal.active{display:flex}.modal-box{background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:32px;width:560px;max-height:90vh;overflow-y:auto}';
  h += '.modal-box h3{margin-bottom:20px;font-size:18px}';
  h += '.form-row{margin-bottom:14px}.form-row label{display:block;margin-bottom:4px;font-size:13px;color:#aaa}';
  h += '.form-row input,.form-row textarea,.form-row select{width:100%;padding:8px 12px;border:1px solid #333;border-radius:6px;background:#111;color:#fff;font-size:14px}';
  h += '.form-row textarea{height:100px;resize:vertical}.form-row-inline{display:flex;gap:12px}.form-row-inline>*{flex:1}';
  h += '.modal-actions{display:flex;gap:12px;margin-top:20px;justify-content:flex-end}';
  h += '.config-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}';
  h += '.config-card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:20px}';
  h += '.config-card label{display:block;font-size:12px;color:#888;margin-bottom:6px}';
  h += '.config-card input{width:100%;padding:8px 12px;border:1px solid #333;border-radius:6px;background:#111;color:#fff;font-size:14px;margin-bottom:10px}';
  h += '.config-card .config-actions{display:flex;justify-content:flex-end}';
  h += '#toast{position:fixed;bottom:24px;right:24px;background:#1a1a1a;border:1px solid #333;color:#e0e0e0;padding:12px 20px;border-radius:8px;font-size:14px;display:none;z-index:200}';
  h += '#toast.ok{border-color:#4ade80}#toast.error{border-color:#f87171}';
  h += '</style></head><body>';
  h += '<div id="login-screen"><div class="login-box"><h1>CYX俱乐部</h1><p>管理后台</p>';
  h += '<div class="form-group"><label>管理员账号</label><input type="text" id="username" placeholder="admin" autocomplete="username"></div>';
  h += '<div class="form-group"><label>密码</label><input type="password" id="password" placeholder="&#9679;&#9679;&#9679;&#9679;&#9679;&#9679;&#9679;&#9679;" autocomplete="current-password"></div>';
  h += '<button class="btn" style="width:100%" id="btn-login">登录</button><div id="login-error"></div></div></div>';
  h += '<div id="admin-screen"><div class="topbar"><h2>CYX俱乐部 &amp;mdash; 管理后台</h2>';
  h += '<div class="topbar-right"><span id="current-user"></span><button class="btn btn-sm" id="btn-logout">退出登录</button></div></div>';
  h += '<div class="tabs">';
  h += '<div class="tab active" data-tab="announcements">&#128203; 公告管理</div>';
  h += '<div class="tab" data-tab="products">&#128230; 商品管理</div>';
  h += '<div class="tab" data-tab="cards">&#128273; 卡密管理</div>';
  h += '<div class="tab" data-tab="config">&#9881; 网站配置</div>';
  h += '</div>';
  h += '<div id="tab-announcements" class="content">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">';
  h += '<h3>公告列表</h3><button class="btn btn-success" id="btn-new-ann">+ 新增公告</button></div>';
  h += '<div class="table-wrap"><table><thead><tr><th>ID</th><th>标题</th><th>分类</th><th>日期</th><th>来源</th><th>操作</th></tr></thead><tbody id="ann-tbody"></tbody></table></div></div>';
  h += '<div id="tab-products" class="content" style="display:none">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">';
  h += '<h3>商品列表</h3><button class="btn btn-success" id="btn-new-product">+ 新增商品</button></div>';
  h += '<div class="table-wrap"><table><thead><tr><th>ID</th><th>商品编号</th><th>名称</th><th>描述</th><th>创建时间</th><th>操作</th></tr></thead><tbody id="products-tbody"></tbody></table></div></div>';
  h += '<div id="tab-cards" class="content" style="display:none">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">';
  h += '<h3>卡密管理</h3>';
  h += '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">';
  h += '<div style="display:flex;align-items:center;gap:6px;"><label style="color:#888;font-size:13px;white-space:nowrap;">选择商品</label>';
  h += '<select id="card-product" style="width:180px;padding:6px 10px;border:1px solid #333;border-radius:6px;background:#111;color:#fff;font-size:14px;"><option value="">-- 请先添加商品 --</option></select></div>';
  h += '<div style="display:flex;align-items:center;gap:6px;"><label style="color:#888;font-size:13px;white-space:nowrap;">数量</label>';
  h += '<input type="number" id="card-gen-count" value="5" min="1" max="100" style="width:70px;padding:6px 10px;border:1px solid #333;border-radius:6px;background:#111;color:#fff;font-size:14px;text-align:center"></div>';
  h += '<button class="btn btn-success" id="btn-gen-cards">生成卡密</button>';
  h += '<button class="btn btn-sm" id="btn-copy-all" style="display:none">&#128203; 复制全部</button>';
  h += '</div></div>';
  h += '<div id="cards-stats" style="margin-bottom:12px;color:#888;font-size:13px;"></div>';
  h += '<div style="margin-bottom:12px;padding:10px 14px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;font-size:12px;color:#888;">&#128304; 格式：<code style="color:#7dd3fc">CYX-MMDD-商品编号-序号-随机码</code> &nbsp;例：<code style="color:#7dd3fc">CYX-0328-A01-0001-K9X2</code></div>';
  h += '<div class="table-wrap"><table><thead><tr><th>ID</th><th>卡密</th><th>商品</th><th>状态</th><th>使用者</th><th>创建时间</th><th>操作</th></tr></thead><tbody id="cards-tbody"></tbody></table></div></div>';
  h += '<div id="tab-config" class="content" style="display:none">';
  h += '<h3 style="margin-bottom:20px">网站配置项</h3><div class="config-grid" id="config-grid"></div></div></div>';
  // 公告弹窗
  h += '<div id="ann-modal" class="modal"><div class="modal-box">';
  h += '<h3 id="ann-modal-title">新增公告</h3>';
  h += '<input type="hidden" id="ann-id">';
  h += '<div class="form-row"><label>标题</label><input type="text" id="ann-title" placeholder="公告标题"></div>';
  h += '<div class="form-row"><label>摘要</label><input type="text" id="ann-summary" placeholder="简短摘要"></div>';
  h += '<div class="form-row"><label>正文内容</label><textarea id="ann-content" placeholder="公告正文内容"></textarea></div>';
  h += '<div class="form-row form-row-inline"><div><label>分类</label><select id="ann-category"><option value="announce">官方公告</option><option value="activity">活动</option><option value="maintain">维护</option></select></div><div><label>发布日期</label><input type="date" id="ann-date"></div></div>';
  h += '<div class="form-row form-row-inline"><div><label>来源</label><input type="text" id="ann-source" value="CYX俱乐部"></div><div><label>链接页面</label><input type="text" id="ann-url" value="news.html"></div></div>';
  h += '<div class="form-row"><label><input type="checkbox" id="ann-sticky"> 置顶</label></div>';
  h += '<div class="modal-actions"><button class="btn btn-sm" id="btn-close-ann">取消</button><button class="btn btn-success btn-sm" id="btn-save-ann">保存</button></div>';
  h += '</div></div>';
  // 商品弹窗
  h += '<div id="product-modal" class="modal"><div class="modal-box">';
  h += '<h3 id="product-modal-title">新增商品</h3>';
  h += '<input type="hidden" id="product-id">';
  h += '<div class="form-row"><label>商品编号 <span style="color:#888;font-size:11px">（字母数字，如 A01）</span></label><input type="text" id="product-code" placeholder="A01" maxlength="10" style="text-transform:uppercase"></div>';
  h += '<div class="form-row"><label>商品名称</label><input type="text" id="product-name" placeholder="如：原神月卡托管" maxlength="50"></div>';
  h += '<div class="form-row"><label>描述（可选）</label><textarea id="product-desc" placeholder="商品备注说明" style="height:60px"></textarea></div>';
  h += '<div class="modal-actions"><button class="btn btn-sm" id="btn-close-product">取消</button><button class="btn btn-success btn-sm" id="btn-save-product">保存</button></div>';
  h += '</div></div>';
  h += '<div id="toast"></div>';
  h += '<script>';
  h += 'var API="/api";var token=localStorage.getItem("cyx_token")||"";var username=localStorage.getItem("cyx_user")||"";var lastGenKeys=[];';
  h += 'function toast(msg,type){var t=document.getElementById("toast");t.textContent=msg;t.className=type||"";t.style.display="block";setTimeout(function(){t.style.display="none"},3000);}';
  h += 'function ah(){return{"Authorization":"Bearer "+token,"Content-Type":"application/json"};}';
  h += 'document.getElementById("btn-login").onclick=doLogin;';
  h += 'document.getElementById("password").onkeydown=function(e){if(e.key==="Enter")doLogin()};';
  h += 'function doLogin(){var u=document.getElementById("username").value.trim(),p=document.getElementById("password").value;if(!u||!p)return showErr("请输入账号和密码");fetch(API+"/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u,password:p})}).then(function(r){return r.json()}).then(function(d){if(!d.token)return showErr(d.error||"登录失败");token=d.token;username=d.username;localStorage.setItem("cyx_token",token);localStorage.setItem("cyx_user",username);showAdmin();}).catch(function(){showErr