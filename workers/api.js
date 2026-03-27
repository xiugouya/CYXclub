/**
 * CYX俱乐部 - Cloudflare Workers API
 * 
 * 路由：
 *   GET  /api/announcements          - 获取公告列表
 *   GET  /api/announcements/:id      - 获取单条公告
 *   GET  /api/config                  - 获取所有配置项
 *   GET  /api/config/:key            - 获取单个配置项
 *   GET  /api/counter                - 访问计数器
 * 
 * 管理端（需登录）：
 *   POST /api/admin/login             - 登录，返回 session token
 *   POST /api/admin/logout            - 登出
 *   GET  /api/admin/announcements     - 管理：获取全部公告（含未发布的）
 *   POST /api/admin/announcements     - 管理：新增公告
 *   PUT  /api/admin/announcements/:id - 管理：更新公告
 *   DELETE /api/admin/announcements/:id - 管理：删除公告
 *   POST /api/admin/cards             - 管理：批量生成卡密
 *   GET  /api/admin/cards             - 管理：获取所有卡密
 *   DELETE /api/admin/cards/:id       - 管理：删除卡密
 *   GET  /api/admin/config            - 管理：获取全部配置
 *   PUT  /api/admin/config/:key       - 管理：更新配置项
 *   GET  /admin                       - 管理后台 HTML 页面
 */

// ============================================================
// 工具函数
// ============================================================

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
  // 简单的 session token： Authorization: Bearer <token>
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try {
    // token 格式: base64(username:timestamp:hash)
    const decoded = atob(token);
    const [username, timestamp, hash] = decoded.split(':');
    // 7天有效期
    const age = Date.now() - parseInt(timestamp);
    if (age > 7 * 24 * 60 * 60 * 1000) return null;
    return { username };
  } catch { return null; }
}

function requireAuth(request) {
  const cred = getCredentials(request);
  if (!cred) return err('Unauthorized', 401);
  return null; // null = 通过
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'cyxclub_salt_2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// 数据库初始化（每个 Worker 实例只执行一次）
// ============================================================

let db = null;
async function getDB(env) {
  if (db) return db;
  db = env.cyxclub_db;  // D1 数据库绑定
  return db;
}

// ============================================================
// 计数器（使用 D1 数据库持久化）
// ============================================================

const SESSION_THRESHOLD_MS = 120000;  // 2分钟无活动视为离线
const WRITE_INTERVAL_MS = 60000;       // 最多每60秒写一次DB

// ============================================================
// API 路由
// ============================================================

async function handleAPI(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method;

  // ---- 公开接口 ----

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
  const singleMatch = path.match(/^\/announcements\/(\d+)$/);
  if (singleMatch && method === 'GET') {
    const db = await getDB(env);
    const result = await db.prepare(
      'SELECT * FROM announcements WHERE id = ?'
    ).bind(parseInt(singleMatch[1])).first();
    return result ? json({ data: result }) : err('Not found', 404);
  }

  // GET /api/config
  if (path === '/config' && method === 'GET') {
    const db = await getDB(env);
    const result = await db.prepare('SELECT * FROM config').all();
    // 转成 key-value 对象
    const config = {};
    for (const row of result.results) config[row.key] = row.value;
    return json({ data: config });
  }

  // GET /api/config/:key
  const configMatch = path.match(/^\/config\/([a-z_]+)$/);
  if (configMatch && method === 'GET') {
    const db = await getDB(env);
    const result = await db.prepare(
      'SELECT * FROM config WHERE key = ?'
    ).bind(configMatch[1]).first();
    return result ? json({ data: result }) : err('Not found', 404);
  }

  // ---- 公开接口：计数器 ----

  // GET /api/counter（在线人数 + 总访问，状态存储在 D1 数据库）
  if (path === '/counter' && method === 'GET') {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
             || request.headers.get('x-real-ip') || 'unknown';
    const now = Date.now();

    const db = await getDB(env);
    const row = await db.prepare('SELECT * FROM counter WHERE id = 1').first();

    let sessions = {};
    let count = 0;
    if (row) {
      try { sessions = JSON.parse(row.sessions || '{}'); } catch {}
      count = row.count || 0;
    }

    // 清理过期 session
    const active = {};
    let activeCount = 0;
    for (const [k, ts] of Object.entries(sessions)) {
      if (now - ts < SESSION_THRESHOLD_MS) { active[k] = ts; activeCount++; }
    }

    // 新访客 or 超过阈值重新活动
    if (!active[ip] || now - active[ip] >= SESSION_THRESHOLD_MS) {
      count += 1;
    }
    active[ip] = now;

    // 写回 D1
    const newSessions = JSON.stringify(active);
    if (row) {
      await db.prepare(
        'UPDATE counter SET count = ?, sessions = ?, updated_at = datetime("now", "+8 hours") WHERE id = 1'
      ).bind(count, newSessions).run();
    } else {
      await db.prepare(
        'INSERT INTO counter (id, count, sessions) VALUES (1, ?, ?)'
      ).bind(count, newSessions).run();
    }

    return json({ total: count, online: activeCount });
  }

  // ---- 公开接口：管理员注册（仅当没有管理员时使用一次）----
  if (path === '/admin/setup' && method === 'POST') {
    const db = await getDB(env);
    const existing = await db.prepare('SELECT id FROM admins LIMIT 1').first();
    if (existing) return err('Admin already exists — use /admin/login', 403);
    let body;
    try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { username, password } = body;
    if (!username || !password) return err('Missing username or password');
    const hash = await hashPassword(password);
    await db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').bind(username, hash).run();
    return ok({ username, message: 'Admin created — please login now' });
  }

  // ---- 管理接口（需登录）----

  // POST /api/admin/login
  if (path === '/admin/login' && method === 'POST') {
    const db = await getDB(env);
    let body;
    try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { username, password } = body;
    if (!username || !password) return err('Missing credentials');

    const admin = await db.prepare(
      'SELECT * FROM admins WHERE username = ?'
    ).bind(username).first();

    if (!admin) return err('Invalid credentials', 401);

    const hash = await hashPassword(password);
    if (hash !== admin.password) return err('Invalid credentials', 401);

    // 生成 session token: base64(username:timestamp:hash)
    const token = btoa(`${username}:${Date.now()}:${hash}`);
    return json({ token, username });
  }

  // 管理接口统一权限检查
  const authError = requireAuth(request);
  if (authError) return authError;

  // GET /api/admin/announcements
  if (path === '/admin/announcements' && method === 'GET') {
    const db = await getDB(env);
    const result = await db.prepare(
      'SELECT * FROM announcements ORDER BY sticky DESC, date DESC'
    ).all();
    return json({ data: result.results });
  }

  // POST /api/admin/announcements
  if (path === '/admin/announcements' && method === 'POST') {
    const db = await getDB(env);
    let body;
    try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { title, content, summary, category, date, source, url, sticky } = body;
    if (!title || !content || !date) return err('Missing required fields');
    const result = await db.prepare(`
      INSERT INTO announcements (title, content, summary, category, date, source, url, sticky)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(title, content, summary || '', category || 'announce', date, source || 'CYX俱乐部', url || 'news.html', sticky ? 1 : 0).run();
    return ok({ id: result.meta.last_insert_id });
  }

  // PUT /api/admin/announcements/:id
  const putMatch = path.match(/^\/admin\/announcements\/(\d+)$/);
  if (putMatch && method === 'PUT') {
    const db = await getDB(env);
    const id = parseInt(putMatch[1]);
    let body;
    try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { title, content, summary, category, date, source, url, sticky } = body;
    await db.prepare(`
      UPDATE announcements SET
        title = COALESCE(?, title),
        content = COALESCE(?, content),
        summary = COALESCE(?, summary),
        category = COALESCE(?, category),
        date = COALESCE(?, date),
        source = COALESCE(?, source),
        url = COALESCE(?, url),
        sticky = COALESCE(?, sticky),
        updated_at = datetime('now', '+8 hours')
      WHERE id = ?
    `).bind(title, content, summary, category, date, source, url, sticky !== undefined ? (sticky ? 1 : 0) : null, id).run();
    return ok({ id });
  }

  // DELETE /api/admin/announcements/:id
  const delMatch = path.match(/^\/admin\/announcements\/(\d+)$/);
  if (delMatch && method === 'DELETE') {
    const db = await getDB(env);
    await db.prepare('DELETE FROM announcements WHERE id = ?').bind(parseInt(delMatch[1])).run();
    return ok({});
  }

  // ---- 卡密管理 ----

  // POST /api/admin/cards - 批量生成卡密
  // body: { count: number, product: string }  product = 商品号，如 "A01"
  if (path === '/admin/cards' && method === 'POST') {
    const db = await getDB(env);
    let body;
    try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const count = Math.min(Math.max(parseInt(body.count) || 1, 1), 100);
    const product = (body.product || 'DEF').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'DEF';

    // 日期部分 MMDD
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePart = mm + dd;

    // 查找今天该商品的最大序号
    const prefix = `CYX-${datePart}-${product}-%`;
    const lastCard = await db.prepare(
      "SELECT card_key FROM card_keys WHERE card_key LIKE ? ORDER BY id DESC LIMIT 1"
    ).bind(prefix).first();

    let seq = 1;
    if (lastCard) {
      // 格式: CYX-MMDD-PRODUCT-SEQ-RAND，取 SEQ 部分
      const parts = lastCard.card_key.split('-');
      if (parts.length >= 4) {
        const lastSeq = parseInt(parts[3]);
        if (!isNaN(lastSeq)) seq = lastSeq + 1;
      }
    }

    const randChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const keys = [];
    for (let i = 0; i < count; i++) {
      const seqStr = String(seq + i).padStart(4, '0');
      const bytes = crypto.getRandomValues(new Uint8Array(4));
      let rand = '';
      for (let j = 0; j < 4; j++) rand += randChars[bytes[j] % randChars.length];
      const key = `CYX-${datePart}-${product}-${seqStr}-${rand}`;
      try {
        await db.prepare('INSERT INTO card_keys (card_key) VALUES (?)').bind(key).run();
        keys.push(key);
      } catch { /* 重复则跳过 */ }
    }
    return ok({ keys, count: keys.length, product, date: mm + '/' + dd });
  }

  // GET /api/admin/cards - 获取所有卡密
  if (path === '/admin/cards' && method === 'GET') {
    const db = await getDB(env);
    const result = await db.prepare(
      'SELECT * FROM card_keys ORDER BY created_at DESC'
    ).all();
    return json({ data: result.results });
  }

  // DELETE /api/admin/cards/:id - 删除卡密
  const cardDelMatch = path.match(/^\/admin\/cards\/(\d+)$/);
  if (cardDelMatch && method === 'DELETE') {
    const db = await getDB(env);
    await db.prepare('DELETE FROM card_keys WHERE id = ?').bind(parseInt(cardDelMatch[1])).run();
    return ok({});
  }

  // ---- 商品管理 ----

  // POST /api/admin/products - 新增商品
  if (path === '/admin/products' && method === 'POST') {
    const db = await getDB(env);
    let body;
    try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const code = (body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    const name = (body.name || '').trim().slice(0, 50);
    const description = (body.description || '').trim().slice(0, 200);
    if (!code || !name) return err('商品编号和名称不能为空');
    const existing = await db.prepare('SELECT id FROM products WHERE code = ?').bind(code).first();
    if (existing) return err('商品编号已存在');
    await db.prepare('INSERT INTO products (code, name, description) VALUES (?, ?, ?)').bind(code, name, description).run();
    return ok({ code, name });
  }

  // GET /api/admin/products - 获取所有商品
  if (path === '/admin/products' && method === 'GET') {
    const db = await getDB(env);
    const result = await db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
    return json({ data: result.results });
  }

  // PUT /api/admin/products/:id - 更新商品
  const prodPutMatch = path.match(/^\/admin\/products\/(\d+)$/);
  if (prodPutMatch && method === 'PUT') {
    const db = await getDB(env);
    const id = parseInt(prodPutMatch[1]);
    let body;
    try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const name = (body.name || '').trim().slice(0, 50);
    const description = (body.description || '').trim().slice(0, 200);
    if (!name) return err('商品名称不能为空');
    await db.prepare('UPDATE products SET name = ?, description = ?, updated_at = datetime("now", "+8 hours") WHERE id = ?').bind(name, description, id).run();
    return ok({ id });
  }

  // DELETE /api/admin/products/:id - 删除商品
  const prodDelMatch = path.match(/^\/admin\/products\/(\d+)$/);
  if (prodDelMatch && method === 'DELETE') {
    const db = await getDB(env);
    await db.prepare('DELETE FROM products WHERE id = ?').bind(parseInt(prodDelMatch[1])).run();
    return ok({});
  }

  // GET /api/admin/config
  if (path === '/admin/config' && method === 'GET') {
    const db = await getDB(env);
    const result = await db.prepare('SELECT * FROM config').all();
    return json({ data: result.results });
  }

  // PUT /api/admin/config/:key
  const cfgMatch = path.match(/^\/admin\/config\/([a-z_]+)$/);
  if (cfgMatch && method === 'PUT') {
    const db = await getDB(env);
    const key = cfgMatch[1];
    let body;
    try { body = await request.json(); } catch { return err('Invalid JSON'); }
    const { value, label, type } = body;
    await db.prepare(`
      INSERT INTO config (key, value, label, type)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        label = COALESCE(excluded.label, config.label),
        type = COALESCE(excluded.type, config.type),
        updated_at = datetime('now', '+8 hours')
    `).bind(key, value, label || null, type || 'text').run();
    return ok({ key, value });
  }

  return err('Not found', 404);
}

// ============================================================
// 管理后台 HTML 页面
// ============================================================

function adminHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CYX俱乐部 管理后台</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; min-height: 100vh; }
a { color: #7dd3fc; text-decoration: none; }
a:hover { text-decoration: underline; }

/* 登录页 */
#login-screen { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
.login-box { background: #1a1a1a; padding: 40px; border-radius: 12px; width: 360px; border: 1px solid #333; }
.login-box h1 { font-size: 24px; margin-bottom: 8px; color: #7dd3fc; }
.login-box p { color: #888; margin-bottom: 24px; font-size: 14px; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; margin-bottom: 6px; color: #aaa; font-size: 14px; }
.form-group input { width: 100%; padding: 10px 12px; border: 1px solid #333; border-radius: 8px; background: #111; color: #fff; font-size: 14px; }
.form-group input:focus { outline: none; border-color: #7dd3fc; }
.btn { display: inline-block; padding: 10px 20px; background: #7dd3fc; color: #000; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; }
.btn:hover { opacity: 0.9; }
.btn-danger { background: #f87171; }
.btn-success { background: #4ade80; }
.btn-sm { padding: 6px 12px; font-size: 12px; }
#login-error { color: #f87171; margin-top: 12px; font-size: 14px; min-height: 20px; }

/* 管理后台 */
#admin-screen { display: none; }
.topbar { background: #1a1a1a; border-bottom: 1px solid #333; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; }
.topbar h2 { font-size: 18px; color: #7dd3fc; }
.topbar-right { display: flex; gap: 12px; align-items: center; }
.topbar-right span { color: #888; font-size: 14px; }

.tabs { background: #1a1a1a; border-bottom: 1px solid #333; padding: 0 24px; display: flex; gap: 4px; }
.tab { padding: 12px 20px; cursor: pointer; color: #888; font-size: 14px; border-bottom: 2px solid transparent; }
.tab.active { color: #7dd3fc; border-bottom-color: #7dd3fc; }

.content { padding: 24px; max-width: 1200px; margin: 0 auto; }

/* 表格 */
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; background: #1a1a1a; border-radius: 8px; overflow: hidden; }
th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #2a2a2a; font-size: 14px; }
th { background: #222; color: #7dd3fc; font-weight: 600; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #1e1e1e; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
.badge-announce { background: #1e3a5f; color: #7dd3fc; }
.badge-activity { background: #1e3a2f; color: #4ade80; }
.badge-maintain { background: #3a1e1e; color: #f87171; }
.actions { display: flex; gap: 8px; }

/* 表单弹窗 */
.modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; align-items: center; justify-content: center; }
.modal.active { display: flex; }
.modal-box { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 32px; width: 560px; max-height: 90vh; overflow-y: auto; }
.modal-box h3 { margin-bottom: 20px; font-size: 18px; }
.form-row { margin-bottom: 14px; }
.form-row label { display: block; margin-bottom: 4px; font-size: 13px; color: #aaa; }
.form-row input, .form-row textarea, .form-row select { width: 100%; padding: 8px 12px; border: 1px solid #333; border-radius: 6px; background: #111; color: #fff; font-size: 14px; }
.form-row textarea { height: 100px; resize: vertical; }
.form-row-inline { display: flex; gap: 12px; }
.form-row-inline > * { flex: 1; }
.modal-actions { display: flex; gap: 12px; margin-top: 20px; justify-content: flex-end; }

/* 配置项 */
.config-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.config-card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 20px; }
.config-card label { display: block; font-size: 12px; color: #888; margin-bottom: 6px; }
.config-card input { width: 100%; padding: 8px 12px; border: 1px solid #333; border-radius: 6px; background: #111; color: #fff; font-size: 14px; margin-bottom: 10px; }
.config-card .config-actions { display: flex; justify-content: flex-end; }

#toast { position: fixed; bottom: 24px; right: 24px; background: #1a1a1a; border: 1px solid #333; color: #e0e0e0; padding: 12px 20px; border-radius: 8px; font-size: 14px; display: none; z-index: 200; }
#toast.ok { border-color: #4ade80; }
#toast.error { border-color: #f87171; }
</style>
</head>
<body>

<!-- 登录页 -->
<div id="login-screen">
  <div class="login-box">
    <h1>CYX俱乐部</h1>
    <p>管理后台</p>
    <div class="form-group">
      <label>管理员账号</label>
      <input type="text" id="username" placeholder="admin" autocomplete="username">
    </div>
    <div class="form-group">
      <label>密码</label>
      <input type="password" id="password" placeholder="••••••••" autocomplete="current-password">
    </div>
    <button class="btn" style="width:100%" onclick="doLogin()">登录</button>
    <div id="login-error"></div>
  </div>
</div>

<!-- 管理后台 -->
<div id="admin-screen">
  <div class="topbar">
    <h2>CYX俱乐部 · 管理后台</h2>
    <div class="topbar-right">
      <span id="current-user"></span>
      <button class="btn btn-sm" onclick="doLogout()">退出登录</button>
    </div>
  </div>

  <div class="tabs">
    <div class="tab active" onclick="switchTab('announcements')">📋 公告管理</div>
    <div class="tab" onclick="switchTab('products')">📦 商品管理</div>
    <div class="tab" onclick="switchTab('cards')">🔑 卡密管理</div>
    <div class="tab" onclick="switchTab('config')">⚙️ 网站配置</div>
  </div>

  <!-- 公告管理 -->
  <div id="tab-announcements" class="content">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <h3>公告列表</h3>
      <button class="btn btn-success" onclick="openAnnModal()">+ 新增公告</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>ID</th><th>标题</th><th>分类</th><th>日期</th><th>来源</th><th>操作</th>
        </tr></thead>
        <tbody id="ann-tbody"></tbody>
      </table>
    </div>
  </div>

  <!-- 商品管理 -->
  <div id="tab-products" class="content" style="display:none">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <h3>商品列表</h3>
      <button class="btn btn-success" onclick="openProductModal()">+ 新增商品</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>ID</th><th>商品编号</th><th>商品名称</th><th>描述</th><th>已生成卡密</th><th>创建时间</th><th>操作</th>
        </tr></thead>
        <tbody id="products-tbody"></tbody>
      </table>
    </div>
  </div>

  <!-- 卡密管理 -->
  <div id="tab-cards" class="content" style="display:none">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
      <h3>卡密管理</h3>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;">
          <label style="color:#888;font-size:13px;white-space:nowrap;">选择商品</label>
          <select id="card-product" style="width:180px;padding:6px 10px;border:1px solid #333;border-radius:6px;background:#111;color:#fff;font-size:14px;">
            <option value="">-- 请先添加商品 --</option>
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <label style="color:#888;font-size:13px;white-space:nowrap;">数量</label>
          <input type="number" id="card-gen-count" value="5" min="1" max="100" style="width:70px;padding:6px 10px;border:1px solid #333;border-radius:6px;background:#111;color:#fff;font-size:14px;text-align:center">
        </div>
        <button class="btn btn-success" onclick="generateCards()">+ 生成卡密</button>
        <button class="btn btn-sm" onclick="copyAllCards()" id="btn-copy-all" style="display:none">📋 复制全部</button>
      </div>
    </div>
    <div id="cards-stats" style="margin-bottom:16px;color:#888;font-size:13px;"></div>
    <div style="margin-bottom:12px;padding:10px 14px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;font-size:12px;color:#888;">
      📌 格式：<code style="color:#7dd3fc">CYX-MMDD-商品编号-序号-随机码</code> &nbsp;例：<code style="color:#7dd3fc">CYX-0327-A01-0001-K9X2</code>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>ID</th><th>卡密</th><th>商品</th><th>状态</th><th>使用者</th><th>创建时间</th><th>使用时间</th><th>操作</th>
        </tr></thead>
        <tbody id="cards-tbody"></tbody>
      </table>
    </div>
  </div>

  <!-- 网站配置 -->
  <div id="tab-config" class="content" style="display:none">
    <h3 style="margin-bottom:20px">网站配置项</h3>
    <div class="config-grid" id="config-grid"></div>
  </div>
</div>

<!-- 公告编辑弹窗 -->
<div id="ann-modal" class="modal">
  <div class="modal-box">
    <h3 id="ann-modal-title">新增公告</h3>
    <input type="hidden" id="ann-id">
    <div class="form-row">
      <label>标题</label>
      <input type="text" id="ann-title" placeholder="公告标题">
    </div>
    <div class="form-row">
      <label>摘要</label>
      <input type="text" id="ann-summary" placeholder="简短摘要，用于首页展示">
    </div>
    <div class="form-row">
      <label>正文内容</label>
      <textarea id="ann-content" placeholder="公告正文内容（支持多段）"></textarea>
    </div>
    <div class="form-row form-row-inline">
      <div>
        <label>分类</label>
        <select id="ann-category">
          <option value="announce">官方公告</option>
          <option value="activity">活动</option>
          <option value="maintain">维护</option>
        </select>
      </div>
      <div>
        <label>发布日期</label>
        <input type="date" id="ann-date">
      </div>
    </div>
    <div class="form-row form-row-inline">
      <div>
        <label>来源</label>
        <input type="text" id="ann-source" value="CYX俱乐部">
      </div>
      <div>
        <label>链接页面</label>
        <input type="text" id="ann-url" value="news.html">
      </div>
    </div>
    <div class="form-row">
      <label><input type="checkbox" id="ann-sticky"> 置顶</label>
    </div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeAnnModal()">取消</button>
      <button class="btn btn-success btn-sm" onclick="saveAnn()">保存</button>
    </div>
  </div>
</div>

<!-- 商品编辑弹窗 -->
<div id="product-modal" class="modal">
  <div class="modal-box">
    <h3 id="product-modal-title">新增商品</h3>
    <input type="hidden" id="product-id">
    <div class="form-row">
      <label>商品编号 <span style="color:#888;font-size:11px">（字母数字，如 A01、YYDL）</span></label>
      <input type="text" id="product-code" placeholder="A01" maxlength="10" style="text-transform:uppercase">
    </div>
    <div class="form-row">
      <label>商品名称</label>
      <input type="text" id="product-name" placeholder="如：原神月卡托管" maxlength="50">
    </div>
    <div class="form-row">
      <label>描述（可选）</label>
      <textarea id="product-desc" placeholder="商品备注说明" style="height:60px"></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeProductModal()">取消</button>
      <button class="btn btn-success btn-sm" onclick="saveProduct()">保存</button>
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
const API = '/api';
let token = localStorage.getItem('cyx_token') || '';
let username = localStorage.getItem('cyx_user') || '';

// ---- 登录 ----
async function doLogin() {
  const u = document.getElementById('username').value;
  const p = document.getElementById('password').value;
  if (!u || !p) return showLoginError('请输入账号和密码');
  const res = await fetch(API + '/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p })
  });
  const data = await res.json();
  if (!res.ok) return showLoginError(data.error || '登录失败');
  token = data.token;
  username = data.username;
  localStorage.setItem('cyx_token', token);
  localStorage.setItem('cyx_user', username);
  showAdmin();
}

function showLoginError(msg) {
  document.getElementById('login-error').textContent = msg;
}

function doLogout() {
  token = '';
  username = '';
  localStorage.removeItem('cyx_token');
  localStorage.removeItem('cyx_user');
  document.getElementById('admin-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

function authHeaders() { return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }; }

// ---- 页面切换 ----
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('tab-announcements').style.display = tab === 'announcements' ? 'block' : 'none';
  document.getElementById('tab-products').style.display = tab === 'products' ? 'block' : 'none';
  document.getElementById('tab-cards').style.display = tab === 'cards' ? 'block' : 'none';
  document.getElementById('tab-config').style.display = tab === 'config' ? 'block' : 'none';
  if (tab === 'announcements') loadAnnouncements();
  if (tab === 'products') loadProducts();
  if (tab === 'cards') { loadCardProductDropdown(); loadCards(); }
  if (tab === 'config') loadConfig();
}

// ---- 公告管理 ----
async function loadAnnouncements() {
  const res = await fetch(API + '/admin/announcements', { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) return toast(data.error || '加载失败', 'error');
  const tbody = document.getElementById('ann-tbody');
  tbody.innerHTML = data.data.map(a => \`
    <tr>
      <td>\${a.id}</td>
      <td>\${a.title} \${a.sticky ? '<span style="color:#f87171;font-size:12px">★置顶</span>' : ''}</td>
      <td><span class="badge badge-\${a.category}">\${a.category === 'announce' ? '公告' : a.category === 'activity' ? '活动' : '维护'}</span></td>
      <td>\${a.date}</td>
      <td>\${a.source}</td>
      <td class="actions">
        <button class="btn btn-sm" onclick="editAnn(\${a.id}, \${JSON.stringify(a).replace(/"/g, '&quot;')})">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="delAnn(\${a.id})">删除</button>
      </td>
    </tr>\`).join('');
}

function openAnnModal(id) {
  document.getElementById('ann-modal').classList.add('active');
  document.getElementById('ann-modal-title').textContent = id ? '编辑公告' : '新增公告';
  if (!id) {
    document.getElementById('ann-id').value = '';
    document.getElementById('ann-title').value = '';
    document.getElementById('ann-summary').value = '';
    document.getElementById('ann-content').value = '';
    document.getElementById('ann-category').value = 'announce';
    document.getElementById('ann-date').value = new Date().toISOString().slice(0,10);
    document.getElementById('ann-source').value = 'CYX俱乐部';
    document.getElementById('ann-url').value = 'news.html';
    document.getElementById('ann-sticky').checked = false;
  }
}

function editAnn(id, a) {
  openAnnModal(id);
  document.getElementById('ann-id').value = id;
  document.getElementById('ann-title').value = a.title;
  document.getElementById('ann-summary').value = a.summary || '';
  document.getElementById('ann-content').value = a.content;
  document.getElementById('ann-category').value = a.category;
  document.getElementById('ann-date').value = a.date;
  document.getElementById('ann-source').value = a.source;
  document.getElementById('ann-url').value = a.url;
  document.getElementById('ann-sticky').checked = !!a.sticky;
}

function closeAnnModal() { document.getElementById('ann-modal').classList.remove('active'); }

async function saveAnn() {
  const id = document.getElementById('ann-id').value;
  const body = {
    title: document.getElementById('ann-title').value,
    summary: document.getElementById('ann-summary').value,
    content: document.getElementById('ann-content').value,
    category: document.getElementById('ann-category').value,
    date: document.getElementById('ann-date').value,
    source: document.getElementById('ann-source').value,
    url: document.getElementById('ann-url').value,
    sticky: document.getElementById('ann-sticky').checked
  };
  if (!body.title || !body.content || !body.date) return toast('请填写标题、正文和日期', 'error');
  const url = id ? API + '/admin/announcements/' + id : API + '/admin/announcements';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) return toast(data.error || '保存失败', 'error');
  toast(id ? '更新成功' : '新增成功', 'ok');
  closeAnnModal();
  loadAnnouncements();
}

async function delAnn(id) {
  if (!confirm('确定要删除这条公告吗？')) return;
  const res = await fetch(API + '/admin/announcements/' + id, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) { const data = await res.json(); return toast(data.error || '删除失败', 'error'); }
  toast('删除成功', 'ok');
  loadAnnouncements();
}

// ---- 商品管理 ----
async function loadProducts() {
  const res = await fetch(API + '/admin/products', { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) return toast(data.error || '加载失败', 'error');
  const products = data.data || [];
  // 同时加载卡密统计
  const cardsRes = await fetch(API + '/admin/cards', { headers: authHeaders() });
  const cardsData = cardsRes.ok ? await cardsRes.json() : { data: [] };
  const cards = cardsData.data || [];
  // 统计每个商品的卡密数
  const cardCount = {};
  cards.forEach(c => {
    const info = parseCardInfo(c.card_key);
    if (info.product) cardCount[info.product] = (cardCount[info.product] || 0) + 1;
  });
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = products.map(p => {
    const pd = encodeURIComponent(JSON.stringify({id:p.id, code:p.code, name:p.name||'', desc:p.description||''}));
    return \`
    <tr>
      <td>\${p.id}</td>
      <td><code style="color:#c084fc;font-size:14px">\${p.code}</code></td>
      <td>\${p.name}</td>
      <td style="color:#888;font-size:13px">\${p.description || '—'}</td>
      <td><span style="color:#7dd3fc">\${cardCount[p.code] || 0}</span></td>
      <td>\${p.created_at || ''}</td>
      <td class="actions">
        <button class="btn btn-sm" onclick="editProductJSON('\${pd}')">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="delProduct(\${p.id})">删除</button>
      </td>
    </tr>\`;
  }).join('');
}

function openProductModal() {
  document.getElementById('product-modal').classList.add('active');
  document.getElementById('product-modal-title').textContent = '新增商品';
  document.getElementById('product-id').value = '';
  document.getElementById('product-code').value = '';
  document.getElementById('product-code').disabled = false;
  document.getElementById('product-name').value = '';
  document.getElementById('product-desc').value = '';
}

function editProduct(id, code, name, desc) {
  document.getElementById('product-modal').classList.add('active');
  document.getElementById('product-modal-title').textContent = '编辑商品';
  document.getElementById('product-id').value = id;
  document.getElementById('product-code').value = code;
  document.getElementById('product-code').disabled = true;
  document.getElementById('product-name').value = name;
  document.getElementById('product-desc').value = desc;
}

function editProductJSON(encoded) {
  const p = JSON.parse(decodeURIComponent(encoded));
  editProduct(p.id, p.code, p.name, p.desc);
}

function closeProductModal() { document.getElementById('product-modal').classList.remove('active'); }

async function saveProduct() {
  const id = document.getElementById('product-id').value;
  const code = document.getElementById('product-code').value.trim().toUpperCase();
  const name = document.getElementById('product-name').value.trim();
  const description = document.getElementById('product-desc').value.trim();
  if (!code || !name) return toast('请填写商品编号和名称', 'error');
  const url = id ? API + '/admin/products/' + id : API + '/admin/products';
  const method = id ? 'PUT' : 'POST';
  const body = id ? { name, description } : { code, name, description };
  const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) return toast(data.error || '保存失败', 'error');
  toast(id ? '更新成功' : '新增成功', 'ok');
  closeProductModal();
  loadProducts();
}

async function delProduct(id) {
  if (!confirm('确定删除此商品？')) return;
  const res = await fetch(API + '/admin/products/' + id, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) { const data = await res.json(); return toast(data.error || '删除失败', 'error'); }
  toast('删除成功', 'ok');
  loadProducts();
}

// ---- 卡密管理 ----
let lastGeneratedKeys = [];

function parseCardInfo(key) {
  // CYX-MMDD-PRODUCT-SEQ-RAND
  const parts = key.split('-');
  if (parts.length >= 5 && parts[0] === 'CYX') {
    return { date: parts[1].slice(0,2) + '/' + parts[1].slice(2), product: parts[2], seq: parts[3] };
  }
  return { date: '', product: '', seq: '' };
}

async function loadCardProductDropdown() {
  const select = document.getElementById('card-product');
  try {
    const res = await fetch(API + '/admin/products', { headers: authHeaders() });
    const data = await res.json();
    const products = data.data || [];
    if (!products.length) {
      select.innerHTML = '<option value="">-- 请先去商品管理添加商品 --</option>';
      return;
    }
    select.innerHTML = products.map(p =>
      '<option value="' + p.code + '">' + p.code + ' — ' + p.name + '</option>'
    ).join('');
  } catch {
    select.innerHTML = '<option value="">-- 加载失败 --</option>';
  }
}

async function loadCards() {
  const res = await fetch(API + '/admin/cards', { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) return toast(data.error || '加载失败', 'error');
  const cards = data.data || [];
  const total = cards.length;
  const used = cards.filter(c => c.used).length;
  const unused = total - used;
  document.getElementById('cards-stats').innerHTML =
    '共 <b>' + total + '</b> 张卡密 &nbsp;|&nbsp; <span style="color:#4ade80">未使用 ' + unused + '</span> &nbsp;|&nbsp; <span style="color:#f87171">已使用 ' + used + '</span>';
  const tbody = document.getElementById('cards-tbody');
  tbody.innerHTML = cards.map(c => {
    const info = parseCardInfo(c.card_key);
    return \`
    <tr>
      <td>\${c.id}</td>
      <td style="font-family:monospace;letter-spacing:1px;color:#7dd3fc">\${c.card_key}</td>
      <td><span style="background:#2a2a3a;color:#c084fc;padding:2px 8px;border-radius:4px;font-size:12px">\${info.product || '—'}</span></td>
      <td>\${c.used
        ? '<span class="badge" style="background:#3a1e1e;color:#f87171">已使用</span>'
        : '<span class="badge" style="background:#1e3a2f;color:#4ade80">未使用</span>'
      }</td>
      <td>\${c.used_by || '—'}</td>
      <td>\${c.created_at || ''}</td>
      <td>\${c.used_at || '—'}</td>
      <td class="actions">
        <button class="btn btn-sm" onclick="copyCard('\${c.card_key}')">复制</button>
        <button class="btn btn-sm btn-danger" onclick="delCard(\${c.id})">删除</button>
      </td>
    </tr>\`;
  }).join('');
}

async function generateCards() {
  const count = parseInt(document.getElementById('card-gen-count').value) || 5;
  const product = document.getElementById('card-product').value;
  if (!product) return toast('请先选择商品（去商品管理添加）', 'error');
  const res = await fetch(API + '/admin/cards', {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ count, product })
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || '生成失败', 'error');
  lastGeneratedKeys = data.keys || [];
  document.getElementById('btn-copy-all').style.display = lastGeneratedKeys.length ? 'inline-block' : 'none';
  toast('已生成 ' + data.count + ' 张 [' + data.product + '] 卡密', 'ok');
  loadCards();
}

function copyCard(key) {
  navigator.clipboard.writeText(key).then(() => toast('已复制到剪贴板', 'ok')).catch(() => toast('复制失败', 'error'));
}

function copyAllCards() {
  if (!lastGeneratedKeys.length) return;
  navigator.clipboard.writeText(lastGeneratedKeys.join('\n'))
    .then(() => toast('已复制 ' + lastGeneratedKeys.length + ' 张卡密', 'ok'))
    .catch(() => toast('复制失败', 'error'));
}

async function delCard(id) {
  if (!confirm('确定删除此卡密？')) return;
  const res = await fetch(API + '/admin/cards/' + id, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) { const data = await res.json(); return toast(data.error || '删除失败', 'error'); }
  toast('删除成功', 'ok');
  loadCards();
}

// ---- 配置管理 ----
async function loadConfig() {
  const res = await fetch(API + '/admin/config', { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) return toast(data.error || '加载失败', 'error');
  const grid = document.getElementById('config-grid');
  grid.innerHTML = data.data.map(c => \`
    <div class="config-card">
      <label>\${c.label} (\${c.key})</label>
      <input type="\${c.type === 'number' ? 'number' : 'text'}" id="cfg-\${c.key}" value="\${c.value}" \${c.type === 'textarea' ? 'style="height:80px"' : ''}>
      <div class="config-actions">
        <button class="btn btn-sm" onclick="saveConfig('\${c.key}')">保存</button>
      </div>
    </div>\`).join('');
}

async function saveConfig(key) {
  const value = document.getElementById('cfg-' + key).value;
  const res = await fetch(API + '/admin/config/' + key, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ value })
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || '保存失败', 'error');
  toast('配置已保存', 'ok');
}

// ---- 初始化 ----
async function showAdmin() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-screen').style.display = 'block';
  document.getElementById('current-user').textContent = username;
  loadAnnouncements();
}

function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = type ? type : '';
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 3000);
}

// 回车登录
document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

// 启动时检查是否已登录
if (token) showAdmin();
</script>
</body>
</html>`;
}

// ============================================================
// 主入口
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 静态资源或管理后台页面
    if (path === '/admin' || path === '/admin/') {
      return new Response(adminHTML(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }

    // API 路由
    if (path.startsWith('/api/')) {
      const response = await handleAPI(request, env);
      // 添加 CORS 头到所有响应
      const headers = new Headers(response.headers);
      ['Access-Control-Allow-Origin', 'Access-Control-Allow-Methods', 'Access-Control-Allow-Headers'].forEach(h => {
        if (CORS_HEADERS[h]) headers.set(h, CORS_HEADERS[h]);
      });
      return new Response(response.body, { status: response.status, headers });
    }

    // 其余请求走 Cloudflare Pages 静态文件（这里是 Workers，不是 Pages）
    return fetch(request);
  }
};
