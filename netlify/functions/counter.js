const GIST_ID = process.env.GIST_ID;
const GIST_TOKEN = process.env.GIST_TOKEN;
const GIST_FILENAME = "cyxclub-counter.json";
const ACTIVE_THRESHOLD_MS = 120000;

const GIST_API = `https://api.github.com/gists/${GIST_ID}`;

async function getGist() {
  const res = await fetch(GIST_API, {
    headers: {
      Authorization: `Bearer ${GIST_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "netlify-counter/1.0"
    }
  });
  if (!res.ok) throw new Error(`Gist fetch failed: ${res.status}`);
  return res.json();
}

async function updateGist(newData) {
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
        [GIST_FILENAME]: { content: JSON.stringify(newData) }
      }
    })
  });
  if (!res.ok) throw new Error(`Gist update failed: ${res.status}`);
}

function getClientIP(headers) {
  const headerObj = headers || {};
  const forwarded = headerObj["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return headerObj["x-real-ip"] || "unknown";
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

  try {
    const ip = getClientIP(event.headers);
    const now = Date.now();

    let data = { count: 0, sessions: {} };
    try {
      const gist = await getGist();
      data = JSON.parse(gist.files[GIST_FILENAME]?.content || '{"count":0,"sessions":{}}');
    } catch (e) {
      // Gist 读取失败用默认值
    }

    const activeSessions = {};
    for (const [key, ts] of Object.entries(data.sessions)) {
      if (now - ts < ACTIVE_THRESHOLD_MS) {
        activeSessions[key] = ts;
      }
    }

    if (!activeSessions[ip] || now - activeSessions[ip] >= ACTIVE_THRESHOLD_MS) {
      data.count += 1;
    }
    activeSessions[ip] = now;

    await updateGist({ count: data.count, sessions: activeSessions });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        total: data.count,
        online: Object.keys(activeSessions).length
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message })
    };
  }
};
