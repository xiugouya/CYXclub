var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// workers/api.js
var COOKIE_NAME = "cyx_session";
var SESSION_TTL = 7 * 86400;
var COUNTER_SESSION_MS = 12e4;
var SALT = "cyxclub_salt_2026";
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
var JSON_H = { "Content-Type": "application/json", ...CORS };
var json = /* @__PURE__ */ __name((d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: JSON_H }), "json");
var ok = /* @__PURE__ */ __name((d) => json({ success: true, data: d }), "ok");
var err = /* @__PURE__ */ __name((m, s = 400) => json({ success: false, error: m }, s), "err");
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256, "sha256");
var hashPwd = /* @__PURE__ */ __name((p) => sha256(p + SALT), "hashPwd");
function genToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(genToken, "genToken");
function now() {
  return Math.floor(Date.now() / 1e3);
}
__name(now, "now");
function genId(prefix) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * 36)];
  return `${prefix}_${suffix}`;
}
__name(genId, "genId");
function genOrderVC(dateStr, seq) {
  let h = 0;
  const s = dateStr + seq + "cyx_order_2026";
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i) | 0;
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let r = "";
  h = Math.abs(h);
  for (let i = 0; i < 4; i++) {
    r += chars[h % chars.length];
    h = Math.floor(h / chars.length);
  }
  return r;
}
__name(genOrderVC, "genOrderVC");
async function createSession(kv, userId, username, role) {
  const token = genToken();
  const exp = now() + SESSION_TTL;
  await kv.put(token, JSON.stringify({ user_id: userId, username, role, expires_at: exp }), { expirationTtl: SESSION_TTL });
  return token;
}
__name(createSession, "createSession");
async function getSession(kv, token) {
  if (!token) return null;
  const raw = await kv.get(token);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (d.expires_at < now()) {
      await kv.delete(token);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}
__name(getSession, "getSession");
var getCookies = /* @__PURE__ */ __name((r) => {
  const c = r.headers.get("Cookie");
  if (!c) return {};
  return Object.fromEntries(c.split(";").map((x) => {
    const i = x.trim().indexOf("=");
    return [x.trim().slice(0, i), x.trim().slice(i + 1)];
  }));
}, "getCookies");
var getToken = /* @__PURE__ */ __name((r) => getCookies(r)[COOKIE_NAME] || null, "getToken");
var setCookie = /* @__PURE__ */ __name((t) => `${COOKIE_NAME}=${t}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; SameSite=Lax; Secure`, "setCookie");
var clearCookie = /* @__PURE__ */ __name(() => `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`, "clearCookie");
async function hAnnouncements(db) {
  const r = await db.prepare("SELECT * FROM announcements WHERE is_active = 1 ORDER BY is_pinned DESC, created_at DESC LIMIT 20").all();
  return ok(r.results);
}
__name(hAnnouncements, "hAnnouncements");
async function hCounter(db, req) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const t = Date.now();
  const row = await db.prepare("SELECT * FROM counter WHERE id = 1").first();
  let sessions = {}, count = 0;
  if (row) {
    try {
      sessions = JSON.parse(row.sessions || "{}");
    } catch {
    }
    count = row.count || 0;
  }
  const active = {};
  for (const [k, ts] of Object.entries(sessions)) if (t - ts < COUNTER_SESSION_MS) active[k] = ts;
  if (!active[ip]) count++;
  active[ip] = t;
  const ns = JSON.stringify(active);
  if (row) await db.prepare("UPDATE counter SET count=?, sessions=?, updated_at=? WHERE id=1").bind(count, ns, now()).run();
  else await db.prepare("INSERT INTO counter (id, count, sessions, updated_at) VALUES (1,?,?,?)").bind(count, ns, now()).run();
  return ok({ total: count, online: Object.keys(active).length });
}
__name(hCounter, "hCounter");
async function hLogin(db, kv, req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON");
  }
  const { username, password, role } = body;
  if (!username || !password) return err("\u7528\u6237\u540D\u548C\u5BC6\u7801\u4E0D\u80FD\u4E3A\u7A7A");
  const admin = await db.prepare("SELECT * FROM admins WHERE username = ?").bind(username).first();
  if (admin) {
    const hash2 = await hashPwd(password);
    if (hash2 !== admin.password_hash) return err("\u5BC6\u7801\u9519\u8BEF", 401);
    const token2 = await createSession(kv, admin.id, admin.username, "admin");
    const res2 = ok({ user: { id: admin.id, username: admin.username, role: "admin" } });
    res2.headers.set("Set-Cookie", setCookie(token2));
    return res2;
  }
  if (role === "employee") {
    const worker = await db.prepare("SELECT * FROM workers WHERE name = ? AND status = 'active'").bind(username).first();
    if (!worker) return err("\u7528\u6237\u540D\u6216\u5BC6\u7801\u9519\u8BEF", 401);
    const hash2 = await hashPwd(password);
    if (hash2 !== worker.password_hash) return err("\u5BC6\u7801\u9519\u8BEF", 401);
    const token2 = await createSession(kv, worker.id, worker.name, "employee");
    const res2 = ok({ user: { id: worker.id, username: worker.name, games: worker.games, role: "employee" } });
    res2.headers.set("Set-Cookie", setCookie(token2));
    return res2;
  }
  const order = await db.prepare("SELECT * FROM orders WHERE order_no = ?").bind(username).first();
  if (!order) return err("\u8BA2\u5355\u53F7\u6216\u5BC6\u7801\u9519\u8BEF", 401);
  if (!order.user_password) return err("\u8BE5\u8BA2\u5355\u672A\u8BBE\u7F6E\u5BC6\u7801", 401);
  const hash = await hashPwd(password);
  if (hash !== order.user_password) return err("\u8BA2\u5355\u53F7\u6216\u5BC6\u7801\u9519\u8BEF", 401);
  const token = await createSession(kv, order.id, order.order_no, "user");
  const res = ok({ user: { id: order.id, order_no: order.order_no, game: order.game, status: order.status, role: "user" } });
  res.headers.set("Set-Cookie", setCookie(token));
  return res;
}
__name(hLogin, "hLogin");
async function hLogout(kv, req) {
  const t = getToken(req);
  if (t) await kv.delete(t);
  const res = ok({ message: "\u5DF2\u9000\u51FA\u767B\u5F55" });
  res.headers.set("Set-Cookie", clearCookie());
  return res;
}
__name(hLogout, "hLogout");
async function hMe(kv, req) {
  const t = getToken(req);
  if (!t) return err("\u672A\u767B\u5F55", 401);
  const s = await getSession(kv, t);
  if (!s) return err("\u4F1A\u8BDD\u5DF2\u8FC7\u671F", 401);
  return ok({ userId: s.user_id, username: s.username, role: s.role });
}
__name(hMe, "hMe");
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
    visits: ctr?.count || 0
  });
}
__name(hAdminStats, "hAdminStats");
async function hAdminAnnouncements(db) {
  const r = await db.prepare("SELECT * FROM announcements ORDER BY is_pinned DESC, created_at DESC").all();
  return ok(r.results);
}
__name(hAdminAnnouncements, "hAdminAnnouncements");
async function hAdminCreateAnnouncement(db, req) {
  let b;
  try {
    b = await req.json();
  } catch {
    return err("Invalid JSON");
  }
  if (!b.title || !b.content) return err("\u6807\u9898\u548C\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
  const id = genId("ann");
  await db.prepare("INSERT INTO announcements (id, title, content, category, is_pinned, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(id, b.title, b.content, b.category || "announce", b.is_pinned ? 1 : 0, 1, now(), now()).run();
  return ok({ id });
}
__name(hAdminCreateAnnouncement, "hAdminCreateAnnouncement");
async function hAdminUpdateAnnouncement(db, id, req) {
  let b;
  try {
    b = await req.json();
  } catch {
    return err("Invalid JSON");
  }
  await db.prepare("UPDATE announcements SET title=COALESCE(?,title), content=COALESCE(?,content), category=COALESCE(?,category), is_pinned=COALESCE(?,is_pinned), is_active=COALESCE(?,is_active), updated_at=? WHERE id=?").bind(b.title, b.content, b.category, b.is_pinned !== void 0 ? b.is_pinned ? 1 : 0 : null, b.is_active !== void 0 ? b.is_active ? 1 : 0 : null, now(), id).run();
  return ok({ id });
}
__name(hAdminUpdateAnnouncement, "hAdminUpdateAnnouncement");
async function hAdminDeleteAnnouncement(db, id) {
  await db.prepare("DELETE FROM announcements WHERE id=?").bind(id).run();
  return ok({});
}
__name(hAdminDeleteAnnouncement, "hAdminDeleteAnnouncement");
async function hAdminWorkers(db) {
  const r = await db.prepare("SELECT id, name, games, status, created_at FROM workers ORDER BY created_at DESC").all();
  return ok(r.results);
}
__name(hAdminWorkers, "hAdminWorkers");
async function hAdminCreateWorker(db, req) {
  let b;
  try {
    b = await req.json();
  } catch {
    return err("Invalid JSON");
  }
  if (!b.name || !b.password) return err("\u5458\u5DE5\u540D\u79F0\u548C\u5BC6\u7801\u4E0D\u80FD\u4E3A\u7A7A");
  const id = genId("worker");
  const hash = await hashPwd(b.password);
  const games = b.games ? JSON.stringify(b.games) : "[]";
  await db.prepare("INSERT INTO workers (id, name, password_hash, games, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)").bind(id, b.name, hash, games, "active", now(), now()).run();
  return ok({ id, name: b.name });
}
__name(hAdminCreateWorker, "hAdminCreateWorker");
async function hAdminUpdateWorker(db, id, req) {
  let b;
  try {
    b = await req.json();
  } catch {
    return err("Invalid JSON");
  }
  if (b.password) {
    const hash = await hashPwd(b.password);
    await db.prepare("UPDATE workers SET password_hash=?, name=COALESCE(?,name), games=COALESCE(?,games), status=COALESCE(?,status), updated_at=? WHERE id=?").bind(hash, b.name, b.games ? JSON.stringify(b.games) : null, b.status, now(), id).run();
  } else {
    await db.prepare("UPDATE workers SET name=COALESCE(?,name), games=COALESCE(?,games), status=COALESCE(?,status), updated_at=? WHERE id=?").bind(b.name, b.games ? JSON.stringify(b.games) : null, b.status, now(), id).run();
  }
  return ok({ id });
}
__name(hAdminUpdateWorker, "hAdminUpdateWorker");
async function hAdminDeleteWorker(db, id) {
  await db.prepare("DELETE FROM workers WHERE id=?").bind(id).run();
  return ok({});
}
__name(hAdminDeleteWorker, "hAdminDeleteWorker");
async function hAdminOrders(db) {
  const r = await db.prepare(
    "SELECT o.*, w.name as worker_name FROM orders o LEFT JOIN workers w ON o.worker_id = w.id ORDER BY o.created_at DESC"
  ).all();
  return ok(r.results);
}
__name(hAdminOrders, "hAdminOrders");
async function hAdminCreateOrder(db, req) {
  let b;
  try {
    b = await req.json();
  } catch {
    return err("Invalid JSON");
  }
  if (!b.game || !b.service_type || !b.password) return err("\u6E38\u620F\u3001\u670D\u52A1\u7C7B\u578B\u548C\u5BC6\u7801\u4E0D\u80FD\u4E3A\u7A7A");
  const d = /* @__PURE__ */ new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const dateKey = `${d.getFullYear()}${mm}${dd}`;
  const dateStr = mm + dd;
  const pc = (b.product_code || "GEN").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3).padEnd(3, "X");
  await db.prepare("INSERT OR IGNORE INTO order_counter (date_key, counter) VALUES (?, 0)").bind(dateKey).run();
  const ctr = await db.prepare("UPDATE order_counter SET counter = counter + 1 WHERE date_key = ? RETURNING counter").bind(dateKey).first();
  const seq = ctr ? ctr.counter : 1;
  const seqStr = String(seq).padStart(2, "0");
  const vc = genOrderVC(dateStr, seq);
  const orderNo = `CYX${dateStr}${pc}-${vc}${seqStr}`;
  const id = genId("order");
  const hash = await hashPwd(b.password);
  const serviceType = parseInt(b.service_type) || 1;
  const price = parseInt(b.price) || 0;
  await db.prepare(
    "INSERT INTO orders (id, order_no, worker_id, preferred_worker, status, game, service_type, price, user_password, user_note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(id, orderNo, b.worker_id || null, b.preferred_worker || null, "pending", b.game, serviceType, price, hash, b.user_note || null, now(), now()).run();
  return ok({ order_no: orderNo, password: b.password, id });
}
__name(hAdminCreateOrder, "hAdminCreateOrder");
async function hAdminUpdateOrder(db, id, req) {
  let b;
  try {
    b = await req.json();
  } catch {
    return err("Invalid JSON");
  }
  const validStatus = ["pending", "in_progress", "completed", "cancelled"];
  if (b.status && !validStatus.includes(b.status)) return err("\u65E0\u6548\u72B6\u6001");
  await db.prepare("UPDATE orders SET status=COALESCE(?,status), worker_id=COALESCE(?,worker_id), preferred_worker=COALESCE(?,preferred_worker), updated_at=? WHERE id=?").bind(b.status, b.worker_id, b.preferred_worker, now(), id).run();
  return ok({ id });
}
__name(hAdminUpdateOrder, "hAdminUpdateOrder");
async function hAdminDeleteOrder(db, id) {
  await db.prepare("DELETE FROM orders WHERE id=?").bind(id).run();
  return ok({});
}
__name(hAdminDeleteOrder, "hAdminDeleteOrder");
async function hGetWorkers(db) {
  const r = await db.prepare("SELECT id, name, games FROM workers WHERE status = 'active'").all();
  return ok(r.results);
}
__name(hGetWorkers, "hGetWorkers");
async function hUserOrders(db, session) {
  const order = await db.prepare(
    "SELECT o.*, w.name as worker_name FROM orders o LEFT JOIN workers w ON o.worker_id = w.id WHERE o.id = ?"
  ).bind(session.user_id).first();
  return ok(order ? [order] : []);
}
__name(hUserOrders, "hUserOrders");
async function hUserSelectWorker(db, session, req) {
  let b;
  try {
    b = await req.json();
  } catch {
    return err("Invalid JSON");
  }
  if (!b.worker_id) return err("\u8BF7\u9009\u62E9\u6253\u624B");
  const w = await db.prepare("SELECT id FROM workers WHERE id = ? AND status = 'active'").bind(b.worker_id).first();
  if (!w) return err("\u6253\u624B\u4E0D\u5B58\u5728");
  await db.prepare("UPDATE orders SET preferred_worker = ?, updated_at = ? WHERE id = ?").bind(b.worker_id, now(), session.user_id).run();
  return ok({ message: "\u9009\u62E9\u6210\u529F" });
}
__name(hUserSelectWorker, "hUserSelectWorker");
async function hEmployeeOrders(db, session) {
  let query;
  if (session.role === "admin") {
    query = "SELECT o.*, w.name as worker_name FROM orders o LEFT JOIN workers w ON o.worker_id = w.id ORDER BY o.created_at DESC";
    return ok((await db.prepare(query).all()).results);
  }
  query = "SELECT o.*, w.name as worker_name FROM orders o LEFT JOIN workers w ON o.worker_id = w.id WHERE o.worker_id = ? ORDER BY o.created_at DESC";
  return ok((await db.prepare(query).bind(session.user_id).all()).results);
}
__name(hEmployeeOrders, "hEmployeeOrders");
async function hEmployeeUpdateStatus(db, session, orderId, req) {
  let b;
  try {
    b = await req.json();
  } catch {
    return err("Invalid JSON");
  }
  const valid = ["pending", "in_progress", "completed", "cancelled"];
  if (!b.status || !valid.includes(b.status)) return err("\u65E0\u6548\u72B6\u6001");
  let order;
  if (session.role === "admin") {
    order = await db.prepare("SELECT id FROM orders WHERE id=?").bind(orderId).first();
  } else {
    order = await db.prepare("SELECT id FROM orders WHERE id=? AND worker_id=?").bind(orderId, session.user_id).first();
  }
  if (!order) return err("\u8BA2\u5355\u4E0D\u5B58\u5728\u6216\u65E0\u6743\u64CD\u4F5C", 404);
  const updates = ["status=?", "updated_at=?"];
  const vals = [b.status, now()];
  if (b.status === "in_progress") {
    updates.push("assigned_at=?");
    vals.push(now());
  }
  if (b.status === "completed") {
    updates.push("completed_at=?");
    vals.push(now());
  }
  vals.push(orderId);
  await db.prepare(`UPDATE orders SET ${updates.join(",")} WHERE id=?`).bind(...vals).run();
  return ok({ message: "\u72B6\u6001\u66F4\u65B0\u6210\u529F" });
}
__name(hEmployeeUpdateStatus, "hEmployeeUpdateStatus");
async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const db = env.cyxclub_db;
  const kv = env.SESSIONS;
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
  }
  if (!path.startsWith("/api/")) {
    if (path === "/" || path === "") {
      return new Response(JSON.stringify({ service: "CYX Club API", status: "running" }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return fetch(req);
  }
  try {
    const p = path.replace("/api", "");
    if (p === "/announcements" && method === "GET") return hAnnouncements(db);
    if (p === "/counter" && method === "GET") return hCounter(db, req);
    if (p === "/auth/login" && method === "POST") return hLogin(db, kv, req);
    if (p === "/auth/logout" && method === "POST") return hLogout(kv, req);
    if (p === "/auth/me" && method === "GET") return hMe(kv, req);
    const token = getToken(req);
    if (!token) return err("\u672A\u767B\u5F55", 401);
    const session = await getSession(kv, token);
    if (!session) return err("\u4F1A\u8BDD\u5DF2\u8FC7\u671F", 401);
    if (p.startsWith("/admin/")) {
      if (session.role !== "admin") return err("\u6743\u9650\u4E0D\u8DB3", 403);
      const ap = p.replace("/admin", "");
      if (ap === "/stats" && method === "GET") return hAdminStats(db);
      if (ap === "/announcements" && method === "GET") return hAdminAnnouncements(db);
      if (ap === "/announcements" && method === "POST") return hAdminCreateAnnouncement(db, req);
      let m;
      if (m = ap.match(/^\/announcements\/([a-z0-9_]+)$/)) {
        if (method === "PUT") return hAdminUpdateAnnouncement(db, m[1], req);
        if (method === "DELETE") return hAdminDeleteAnnouncement(db, m[1]);
      }
      if (ap === "/workers" && method === "GET") return hAdminWorkers(db);
      if (ap === "/workers" && method === "POST") return hAdminCreateWorker(db, req);
      if (m = ap.match(/^\/workers\/([a-z0-9_]+)$/)) {
        if (method === "PUT") return hAdminUpdateWorker(db, m[1], req);
        if (method === "DELETE") return hAdminDeleteWorker(db, m[1]);
      }
      if (ap === "/orders" && method === "GET") return hAdminOrders(db);
      if (ap === "/orders" && method === "POST") return hAdminCreateOrder(db, req);
      if (m = ap.match(/^\/orders\/([a-z0-9_]+)$/)) {
        if (method === "PUT") return hAdminUpdateOrder(db, m[1], req);
        if (method === "DELETE") return hAdminDeleteOrder(db, m[1]);
      }
      return err("\u63A5\u53E3\u4E0D\u5B58\u5728", 404);
    }
    if (p === "/workers" && method === "GET") return hGetWorkers(db);
    if (p === "/orders") {
      if (session.role !== "user") return err("\u4EC5\u7528\u6237\u53EF\u64CD\u4F5C", 403);
      if (method === "GET") return hUserOrders(db, session);
      if (method === "POST") return hUserSelectWorker(db, session, req);
    }
    if (p.startsWith("/employee/")) {
      if (session.role !== "employee" && session.role !== "admin") return err("\u6743\u9650\u4E0D\u8DB3", 403);
      const ep = p.replace("/employee", "");
      if (ep === "/orders" && method === "GET") return hEmployeeOrders(db, session);
      let sm;
      if ((sm = ep.match(/^\/orders\/([a-z0-9_]+)\/status$/)) && method === "PUT")
        return hEmployeeUpdateStatus(db, session, sm[1], req);
      return err("\u63A5\u53E3\u4E0D\u5B58\u5728", 404);
    }
    return err("\u63A5\u53E3\u4E0D\u5B58\u5728", 404);
  } catch (e) {
    console.error("API Error:", e);
    return err("\u670D\u52A1\u5668\u9519\u8BEF: " + e.message, 500);
  }
}
__name(handle, "handle");
var api_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handle(request, env);
    return fetch(request);
  }
};
export {
  api_default as default
};
//# sourceMappingURL=api.js.map
