/**
 * CYX俱乐部 - Cloudflare Worker Counter
 * 
 * 部署方式：
 * 1. npm install -g wrangler
 * 2. wrangler login
 * 3. wrangler secret put GIST_TOKEN   (输入你的 GitHub Gist token)
 * 4. wrangler secret put GIST_ID       (输入你的 Gist ID)
 * 5. wrangler deploy
 */

const GIST_ID = GIST_ID;           // 通过 wrangler secret 注入
const GIST_TOKEN = GIST_TOKEN;     // 通过 wrangler secret 注入
const GIST_FILENAME = "cyxclub-counter.json";
const GIST_API = `https://api.github.com/gists/${GIST_ID}`;
const WRITE_INTERVAL_MS = 60000;   // 每 60 秒写一次 Gist
const SESSION_THRESHOLD_MS = 120000; // 2分钟内无活动视为新访问

// 进程级状态（Worker 冷启动后丢失，但 Gist 有备份）
let state = { count: 0, sessions: {} };
let lastWritten = 0;
let initPromise = null;
let writeLock = false;

async function init() {
  if (!GIST_ID || !GIST_TOKEN) {
    throw new Error("Missing GIST_ID or GIST_TOKEN — run: wrangler secret put GIST_TOKEN && wrangler secret put GIST_ID");
  }
  try {
    const res = await fetch(GIST_API, {
      headers: {
        Authorization: `Bearer ${GIST_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "cloudflare-counter/1.0"
      }
    });
    if (!res.ok) throw new Error(`Gist fetch failed: ${res.status}`);
    const gist = await res.json();
    const content = gist.files[GIST_FILENAME]?.content;
    if (content) state = JSON.parse(content);
  } catch (e) {
    console.warn("Gist init read failed, starting fresh:", e.message);
    state = { count: 0, sessions: {} };
  }
}

async function writeGist() {
  if (writeLock) return;
  writeLock = true;
  try {
    const res = await fetch(GIST_API, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${GIST_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "cloudflare-counter/1.0"
      },
      body: JSON.stringify({
        description: "cyxclub online counter",
        files: {
          [GIST_FILENAME]: { content: JSON.stringify(state) }
        }
      })
    });
    if (!res.ok) throw new Error(`Gist write failed: ${res.status}`);
    lastWritten = Date.now();
  } finally {
    writeLock = false;
  }
}

async function scheduleWrite() {
  const now = Date.now();
  if (now - lastWritten >= WRITE_INTERVAL_MS) {
    try {
      await writeGist();
    } catch (e) {
      console.error("Gist write failed:", e.message);
    }
  }
}

function getClientIP(request) {
  const headers = request.headers || {};
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = headers.get("x-real-ip");
  return realIp || "unknown";
}

function countActive(sessions, now) {
  const active = {};
  let activeCount = 0;
  for (const [key, ts] of Object.entries(sessions)) {
    if (now - ts < SESSION_THRESHOLD_MS) {
      active[key] = ts;
      activeCount++;
    }
  }
  return { active, activeCount };
}

async function handleRequest(request) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers });
  }

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Only GET allowed" }), {
      status: 405,
      headers
    });
  }

  // 冷启动初始化（只执行一次）
  if (!initPromise) initPromise = init();
  await initPromise;

  const ip = getClientIP(request);
  const now = Date.now();

  // 清理过期 session 并计算在线人数
  const { active, activeCount } = countActive(state.sessions, now);

  // 如果该 IP 超过 2 分钟无活动，才计入总数
  if (!active[ip] || now - active[ip] >= SESSION_THRESHOLD_MS) {
    state.count += 1;
  }
  active[ip] = now;
  state.sessions = active;

  // 异步写回 Gist（每 60 秒最多一次）
  scheduleWrite();

  return new Response(
    JSON.stringify({ total: state.count, online: activeCount }),
    { status: 200, headers }
  );
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request);
  }
};
