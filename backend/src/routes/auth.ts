// Auth routes: register, login (user/employee), logout, me

import { hash, verify } from '../utils/crypto';
import {
  createSession,
  getSession,
  getSessionCookie,
  setSessionCookie,
  clearSessionCookie,
  deleteSession,
  type Env,
} from '../utils/session';
import { json } from '../middleware/auth';

export async function handleAuth(request: Request, env: Env, path: string): Promise<Response> {
  const method = request.method;

  try {
    // POST /api/auth/register
    if (path === '/register' && method === 'POST') {
      return await register(request, env);
    }

    // POST /api/auth/login
    if (path === '/login' && method === 'POST') {
      return await login(request, env, 'user');
    }

    // POST /api/auth/employee/login
    if (path === '/employee/login' && method === 'POST') {
      return await login(request, env, 'employee');
    }

    // POST /api/auth/logout
    if (path === '/logout' && method === 'POST') {
      return await logout(request, env);
    }

    // GET /api/auth/me
    if (path === '/me' && method === 'GET') {
      return await me(request, env);
    }

    return json({ success: false, error: '接口不存在' }, 404);
  } catch (err: any) {
    console.error('Auth error:', err);
    return json({ success: false, error: '服务器内部错误' }, 500);
  }
}

async function register(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ card_key?: string; username?: string; password?: string }>();

  if (!body.card_key || !body.username || !body.password) {
    return json({ success: false, error: '卡密、用户名和密码不能为空' }, 400);
  }

  if (body.username.length < 3 || body.username.length > 20) {
    return json({ success: false, error: '用户名长度需在3-20个字符之间' }, 400);
  }

  if (body.password.length < 6) {
    return json({ success: false, error: '密码长度不能少于6个字符' }, 400);
  }

  // Check card key exists and unused
  const card = await env.DB.prepare(
    'SELECT * FROM card_keys WHERE card_key = ?'
  ).bind(body.card_key).first();

  if (!card) {
    return json({ success: false, error: '卡密不存在' }, 400);
  }

  if (card.used) {
    return json({ success: false, error: '卡密已被使用' }, 400);
  }

  // Check username not taken
  const existingUser = await env.DB.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).bind(body.username).first();

  if (existingUser) {
    return json({ success: false, error: '用户名已被注册' }, 400);
  }

  // Hash password and create user
  const passwordHash = await hash(body.password);

  await env.DB.prepare(
    'INSERT INTO users (username, password_hash, card_key) VALUES (?, ?, ?)'
  ).bind(body.username, passwordHash, body.card_key).run();

  // Mark card key as used
  await env.DB.prepare(
    'UPDATE card_keys SET used = 1, used_by = ?, used_at = CURRENT_TIMESTAMP WHERE card_key = ?'
  ).bind(body.username, body.card_key).run();

  return json({ success: true, data: { message: '注册成功' } });
}

async function login(request: Request, env: Env, role: 'user' | 'employee'): Promise<Response> {
  const body = await request.json<{ username?: string; password?: string }>();

  if (!body.username || !body.password) {
    return json({ success: false, error: '用户名和密码不能为空' }, 400);
  }

  const table = role === 'user' ? 'users' : 'employees';
  const record = await env.DB.prepare(
    `SELECT * FROM ${table} WHERE username = ?`
  ).bind(body.username).first<{ id: number; username: string; password_hash: string }>();

  if (!record) {
    return json({ success: false, error: '用户名或密码错误' }, 401);
  }

  const valid = await verify(body.password, record.password_hash);
  if (!valid) {
    return json({ success: false, error: '用户名或密码错误' }, 401);
  }

  // Check if admin
  let finalRole: 'user' | 'employee' | 'admin' = role;
  if (role === 'user' && body.username === 'admin') {
    finalRole = 'admin';
  }

  const token = await createSession(env.SESSIONS, record.id, finalRole, record.username);
  const response = json({
    success: true,
    data: { id: record.id, username: record.username, role: finalRole },
  });
  response.headers.append('Set-Cookie', setSessionCookie(token));
  return response;
}

async function logout(request: Request, env: Env): Promise<Response> {
  const token = getSessionCookie(request);
  if (token) {
    await deleteSession(env.SESSIONS, token);
  }
  const response = json({ success: true, data: { message: '已退出登录' } });
  response.headers.append('Set-Cookie', clearSessionCookie());
  return response;
}

async function me(request: Request, env: Env): Promise<Response> {
  const token = getSessionCookie(request);
  if (!token) {
    return json({ success: false, error: '未登录' }, 401);
  }

  const session = await getSession(env.SESSIONS, token);
  if (!session) {
    return json({ success: false, error: '会话已过期' }, 401);
  }

  return json({
    success: true,
    data: {
      userId: session.userId,
      username: session.username,
      role: session.role,
    },
  });
}
