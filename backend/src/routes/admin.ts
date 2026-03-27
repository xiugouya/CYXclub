// Admin routes: card keys, employees, orders, stats

import { requireAdmin, json, type AuthContext } from '../middleware/auth';
import { hash } from '../utils/crypto';
import type { Env } from '../utils/session';

export async function handleAdmin(
  request: Request,
  env: Env,
  path: string,
  ctx: AuthContext
): Promise<Response> {
  if (ctx.session.role !== 'admin') {
    return json({ success: false, error: '权限不足' }, 403);
  }

  const method = request.method;

  try {
    // POST /api/admin/cards - Generate card keys
    if (path === '/cards' && method === 'POST') {
      return await generateCardKeys(request, env);
    }

    // GET /api/admin/cards - List card keys
    if (path === '/cards' && method === 'GET') {
      return await listCardKeys(env);
    }

    // POST /api/admin/employees - Create employee
    if (path === '/employees' && method === 'POST') {
      return await createEmployee(request, env);
    }

    // GET /api/admin/employees - List employees
    if (path === '/employees' && method === 'GET') {
      return await listAllEmployees(env);
    }

    // GET /api/admin/orders - List all orders
    if (path === '/orders' && method === 'GET') {
      return await listAllOrders(env);
    }

    // GET /api/admin/stats - Dashboard stats
    if (path === '/stats' && method === 'GET') {
      return await getStats(env);
    }

    return json({ success: false, error: '接口不存在' }, 404);
  } catch (err: any) {
    console.error('Admin error:', err);
    return json({ success: false, error: '服务器内部错误' }, 500);
  }
}

function generateCardKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segments = 4;
  const segmentLen = 4;
  const parts: string[] = [];
  for (let s = 0; s < segments; s++) {
    let part = '';
    for (let i = 0; i < segmentLen; i++) {
      part += chars[crypto.getRandomValues(new Uint8Array(1))[0] % chars.length];
    }
    parts.push(part);
  }
  return parts.join('-');
}

async function generateCardKeys(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ count?: number }>();
  const count = Math.min(Math.max(body.count || 1, 1), 100);

  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const key = generateCardKey();
    try {
      await env.DB.prepare('INSERT INTO card_keys (card_key) VALUES (?)').bind(key).run();
      keys.push(key);
    } catch {
      // Duplicate key, retry
      i--;
    }
  }

  return json({ success: true, data: { keys, count: keys.length } });
}

async function listCardKeys(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM card_keys ORDER BY created_at DESC'
  ).all();

  return json({ success: true, data: results });
}

async function createEmployee(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{
    username?: string;
    password?: string;
    display_name?: string;
    game_types?: string[];
  }>();

  if (!body.username || !body.password || !body.display_name) {
    return json({ success: false, error: '用户名、密码和显示名称不能为空' }, 400);
  }

  // Check username not taken
  const existing = await env.DB.prepare(
    'SELECT id FROM employees WHERE username = ?'
  ).bind(body.username).first();

  if (existing) {
    return json({ success: false, error: '用户名已被使用' }, 400);
  }

  const passwordHash = await hash(body.password);
  const gameTypes = body.game_types ? JSON.stringify(body.game_types) : null;

  await env.DB.prepare(
    'INSERT INTO employees (username, password_hash, display_name, game_types) VALUES (?, ?, ?, ?)'
  ).bind(body.username, passwordHash, body.display_name, gameTypes).run();

  return json({ success: true, data: { message: '员工创建成功' } });
}

async function listAllEmployees(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, username, display_name, game_types, created_at FROM employees ORDER BY created_at DESC'
  ).all();

  return json({ success: true, data: results });
}

async function listAllOrders(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT o.*, u.username as user_name, e.display_name as employee_name
     FROM orders o
     LEFT JOIN users u ON o.user_id = u.id
     LEFT JOIN employees e ON o.employee_id = e.id
     ORDER BY o.created_at DESC`
  ).all();

  return json({ success: true, data: results });
}

async function getStats(env: Env): Promise<Response> {
  const totalOrders = await env.DB.prepare('SELECT COUNT(*) as count FROM orders').first<{ count: number }>();
  const pendingOrders = await env.DB.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").first<{ count: number }>();
  const completedOrders = await env.DB.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'completed'").first<{ count: number }>();
  const totalUsers = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  const totalEmployees = await env.DB.prepare('SELECT COUNT(*) as count FROM employees').first<{ count: number }>();
  const totalCards = await env.DB.prepare('SELECT COUNT(*) as count FROM card_keys').first<{ count: number }>();
  const usedCards = await env.DB.prepare('SELECT COUNT(*) as count FROM card_keys WHERE used = 1').first<{ count: number }>();

  return json({
    success: true,
    data: {
      orders: {
        total: totalOrders?.count || 0,
        pending: pendingOrders?.count || 0,
        completed: completedOrders?.count || 0,
      },
      users: totalUsers?.count || 0,
      employees: totalEmployees?.count || 0,
      cards: {
        total: totalCards?.count || 0,
        used: usedCards?.count || 0,
      },
    },
  });
}
