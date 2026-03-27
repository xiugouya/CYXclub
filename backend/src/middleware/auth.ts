// Auth middleware - checks session and extracts user info

import { getSession, getSessionCookie, type SessionData, type Env } from '../utils/session';

export interface AuthContext {
  session: SessionData;
}

export type Handler = (
  request: Request,
  env: Env,
  ctx: AuthContext
) => Promise<Response> | Response;

export type UnauthHandler = (
  request: Request,
  env: Env
) => Promise<Response> | Response;

export function withAuth(handler: Handler, roles?: string[]): UnauthHandler {
  return async (request: Request, env: Env) => {
    const token = getSessionCookie(request);
    if (!token) {
      return json({ success: false, error: '未登录，请先登录' }, 401);
    }

    const session = await getSession(env.SESSIONS, token);
    if (!session) {
      return json({ success: false, error: '会话已过期，请重新登录' }, 401);
    }

    if (roles && !roles.includes(session.role)) {
      return json({ success: false, error: '权限不足' }, 403);
    }

    return handler(request, env, { session });
  };
}

// Convenience auth wrappers
export function requireAdmin(handler: Handler): UnauthHandler {
  return withAuth(handler, ['admin']);
}

export function requireUser(handler: Handler): UnauthHandler {
  return withAuth(handler, ['user']);
}

export function requireEmployee(handler: Handler): UnauthHandler {
  return withAuth(handler, ['employee']);
}

export function requireUserOrAdmin(handler: Handler): UnauthHandler {
  return withAuth(handler, ['user', 'admin']);
}

export function requireEmployeeOrAdmin(handler: Handler): UnauthHandler {
  return withAuth(handler, ['employee', 'admin']);
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
