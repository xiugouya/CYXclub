// Employee routes: view orders, update order status

import { requireEmployeeOrAdmin, json, type AuthContext } from '../middleware/auth';
import type { Env } from '../utils/session';

export async function handleEmployee(
  request: Request,
  env: Env,
  path: string,
  ctx: AuthContext
): Promise<Response> {
  if (ctx.session.role !== 'employee' && ctx.session.role !== 'admin') {
    return json({ success: false, error: '权限不足' }, 403);
  }

  const method = request.method;

  try {
    // GET /api/employee/orders - List assigned orders
    if (path === '/orders' && method === 'GET') {
      return await listEmployeeOrders(env, ctx);
    }

    // PUT /api/employee/orders/:id/status
    const statusMatch = path.match(/^\/orders\/(\d+)\/status$/);
    if (statusMatch && method === 'PUT') {
      const orderId = parseInt(statusMatch[1]);
      return await updateOrderStatus(request, env, ctx, orderId);
    }

    return json({ success: false, error: '接口不存在' }, 404);
  } catch (err: any) {
    console.error('Employee error:', err);
    return json({ success: false, error: '服务器内部错误' }, 500);
  }
}

async function listEmployeeOrders(env: Env, ctx: AuthContext): Promise<Response> {
  let query: string;
  let params: any[];

  if (ctx.session.role === 'admin') {
    // Admin sees all orders
    query = `SELECT o.*, u.username as user_name
             FROM orders o
             LEFT JOIN users u ON o.user_id = u.id
             ORDER BY o.created_at DESC`;
    params = [];
  } else {
    // Employee sees only their assigned orders
    query = `SELECT o.*, u.username as user_name
             FROM orders o
             LEFT JOIN users u ON o.user_id = u.id
             WHERE o.employee_id = ?
             ORDER BY o.created_at DESC`;
    params = [ctx.session.userId];
  }

  const { results } = await env.DB.prepare(query).bind(...params).all();

  return json({ success: true, data: results });
}

async function updateOrderStatus(
  request: Request,
  env: Env,
  ctx: AuthContext,
  orderId: number
): Promise<Response> {
  const body = await request.json<{ status?: string }>();

  const validStatuses = ['pending', 'accepted', 'in_progress', 'completed', 'cancelled'];
  if (!body.status || !validStatuses.includes(body.status)) {
    return json({
      success: false,
      error: `状态无效，可选值: ${validStatuses.join(', ')}`,
    }, 400);
  }

  // Check order exists and belongs to this employee (unless admin)
  let order: any;
  if (ctx.session.role === 'admin') {
    order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  } else {
    order = await env.DB.prepare(
      'SELECT * FROM orders WHERE id = ? AND employee_id = ?'
    ).bind(orderId, ctx.session.userId).first();
  }

  if (!order) {
    return json({ success: false, error: '订单不存在或无权操作' }, 404);
  }

  await env.DB.prepare(
    'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(body.status, orderId).run();

  return json({ success: true, data: { message: '状态更新成功' } });
}
