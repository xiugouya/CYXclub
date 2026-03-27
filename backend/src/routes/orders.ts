// Order routes: create order, list user orders, list employees

import { withAuth, json, type AuthContext } from '../middleware/auth';
import type { Env } from '../utils/session';

export async function handleOrders(
  request: Request,
  env: Env,
  path: string,
  ctx: AuthContext
): Promise<Response> {
  const method = request.method;

  try {
    // POST /api/orders - Create order (user only)
    if (path === '' && method === 'POST') {
      if (ctx.session.role !== 'user') {
        return json({ success: false, error: '只有用户可以创建订单' }, 403);
      }
      return await createOrder(request, env, ctx);
    }

    // GET /api/orders - List user's orders
    if (path === '' && method === 'GET') {
      if (ctx.session.role !== 'user') {
        return json({ success: false, error: '只有用户可以查看订单' }, 403);
      }
      return await listUserOrders(env, ctx);
    }

    return json({ success: false, error: '接口不存在' }, 404);
  } catch (err: any) {
    console.error('Orders error:', err);
    return json({ success: false, error: '服务器内部错误' }, 500);
  }
}

export async function handleEmployees(
  request: Request,
  env: Env,
  _path: string,
  ctx: AuthContext
): Promise<Response> {
  try {
    if (request.method !== 'GET') {
      return json({ success: false, error: '接口不存在' }, 404);
    }
    return await listEmployees(env);
  } catch (err: any) {
    console.error('Employees error:', err);
    return json({ success: false, error: '服务器内部错误' }, 500);
  }
}

async function createOrder(request: Request, env: Env, ctx: AuthContext): Promise<Response> {
  const body = await request.json<{
    game?: string;
    service_type?: string;
    employee_id?: number;
    details?: string;
  }>();

  if (!body.game || !body.service_type || !body.employee_id) {
    return json({ success: false, error: '游戏、服务类型和打手不能为空' }, 400);
  }

  // Verify employee exists
  const employee = await env.DB.prepare(
    'SELECT id FROM employees WHERE id = ?'
  ).bind(body.employee_id).first();

  if (!employee) {
    return json({ success: false, error: '指定的打手不存在' }, 400);
  }

  const result = await env.DB.prepare(
    'INSERT INTO orders (user_id, game, service_type, employee_id, details) VALUES (?, ?, ?, ?, ?)'
  ).bind(
    ctx.session.userId,
    body.game,
    body.service_type,
    body.employee_id,
    body.details || null
  ).run();

  return json({
    success: true,
    data: { message: '订单创建成功', orderId: result.meta.last_row_id },
  });
}

async function listUserOrders(env: Env, ctx: AuthContext): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT o.*, e.display_name as employee_name
     FROM orders o
     LEFT JOIN employees e ON o.employee_id = e.id
     WHERE o.user_id = ?
     ORDER BY o.created_at DESC`
  ).bind(ctx.session.userId).all();

  return json({ success: true, data: results });
}

async function listEmployees(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, display_name, game_types FROM employees'
  ).all();

  return json({ success: true, data: results });
}
