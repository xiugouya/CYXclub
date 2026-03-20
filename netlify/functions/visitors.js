const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  // CORS
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }

  const store = getStore({ name: 'visitors' });
  const NOW = Date.now();
  const WINDOW = 5 * 60 * 1000; // 5分钟内无活动视为离线

  // 解析访客 Cookie
  const cookieStr = event.headers.cookie || '';
  const cookies = Object.fromEntries(
    (cookieStr || '').split(';').map(c => {
      const idx = c.indexOf('=');
      if (idx < 0) return [c.trim(), ''];
      return [c.slice(0, idx).trim(), c.slice(idx + 1).trim()];
    }).filter(([k]) => k)
  );
  let visitorId = cookies['cyx_vid'];
  if (!visitorId) {
    visitorId = `${NOW}_${Math.random().toString(36).slice(2)}`;
  }

  // 列出所有访客记录
  const listResp = await store.list();
  const items = listResp.objects || [];

  // 清理过期 + 计数
  const newData = {};
  let activeCount = 0;
  let currentSeen = false;

  for (const item of items) {
    const lastSeen = parseInt(item.value);
    if (isNaN(lastSeen)) continue;

    if (NOW - lastSeen < WINDOW) {
      if (item.key === visitorId) {
        currentSeen = true;
        activeCount++;
      } else {
        activeCount++;
      }
      newData[item.key] = String(lastSeen);
    }
  }

  // 当前访客未记录则新增
  if (!currentSeen) {
    newData[visitorId] = String(NOW);
    activeCount++;
  }

  // 写回 KV（异步不阻塞）
  Promise.all(
    Object.entries(newData).map(([k, v]) =>
      store.set(k, v, { expirationTtl: 86400 })
    )
  ).catch(() => {});

  return {
    statusCode: 200,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Set-Cookie': `cyx_vid=${visitorId}; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax`,
    },
    body: JSON.stringify({ visitors: activeCount }),
  };
};
