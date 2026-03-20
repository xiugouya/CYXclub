const GIST_ID = process.env.GIST_ID;
const GIST_TOKEN = process.env.GIST_TOKEN;
const GIST_FILENAME = "cyxclub-counter.json";
const WRITE_INTERVAL_MS = 60000; // 每 60 秒写一次 Gist，每小时最多 60 次，刚好不超限

const GIST_API = `https://api.github.com/gists/${GIST_ID}`;
const GIST_RAW = `https://gist.githubusercontent.com/${process.env.GIST_USERNAME}/${GIST_ID}/raw/${GIST_FILENAME}`;

// 内存中的计数器状态
let state = { count: 0, sessions: {} };
let lastWritten = 0;
let initPromise = null;

async function init() {
  if (!GIST_ID || !GIST_TOKEN) {
    throw new Error("Missing GIST_ID or GIST_TOKEN env vars");
  }
  try {
    const res = await fetch(GIST_API, {
      headers: {
        Authorization: `Bearer ${GIST_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "netlify-counter/1.0"
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
  const res = await fetch(GIST_API, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${GIST_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "netlify-counter/1.0"
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
}

async function scheduleWrite() {
  const now = Date.now();
  if (now - lastWritten >= WRITE_INTERVAL_MS) {
    try {
      await writeGist();
    } catch (e) {
      console.error("Write failed:", e.message);
    }
  }
}

function getClientIP(headers) {
  const h = headers || {};
  const forwarded = h["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return h["x-real-ip"] || "unknown";
}

function countActive(sessions, now) {
  const active = {};
  let activeCount = 0;
  const THRESHOLD = 120000;
  for (const [key, ts] of Object.entries(sessions)) {
    if (now - ts < THRESHOLD) {
      active[key] = ts;
      activeCount++;
    }
  }
  return { active, activeCount };
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Only GET allowed" }) };
  }

  // 冷启动初始化（只执行一次）
  if (!initPromise) initPromise = init();
  await initPromise;

  const ip = getClientIP(event.headers);
  const now = Date.now();

  // 清理过期 session 并更新
  const { active, activeCount } = countActive(state.sessions, now);

  if (!active[ip] || now - active[ip] >= 120000) {
    state.count += 1;
  }
  active[ip] = now;
  state.sessions = active;

  // 异步写回 Gist（每 30 秒最多一次）
  scheduleWrite();

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      total: state.count,
      online: activeCount
    })
  };
};
