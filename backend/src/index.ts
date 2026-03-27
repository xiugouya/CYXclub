// Main Cloudflare Worker entry point
// Routes incoming requests to the appropriate handler

import { handleAuth } from './routes/auth';
import { handleOrders, handleEmployees } from './routes/orders';
import { handleAdmin } from './routes/admin';
import { handleEmployee } from './routes/employee';
import { withAuth, json, type AuthContext } from './middleware/auth';
import { getSession, getSessionCookie, type Env } from './utils/session';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCors(request, env);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Auth routes (no auth required for login/register/logout)
      if (path.startsWith('/api/auth')) {
        const authPath = path.replace('/api/auth', '');
        const response = await handleAuth(request, env, authPath);
        return addCorsHeaders(response, request, env);
      }

      // All other routes require authentication
      // Get session for routing
      const token = getSessionCookie(request);
      if (!token) {
        return addCorsHeaders(json({ success: false, error: '未登录，请先登录' }, 401), request, env);
      }

      const session = await getSession(env.SESSIONS, token);
      if (!session) {
        return addCorsHeaders(json({ success: false, error: '会话已过期，请重新登录' }, 401), request, env);
      }

      const ctx: AuthContext = { session };

      // Employee listing (for user to select when creating order)
      if (path === '/api/employees' && request.method === 'GET') {
        const response = await handleEmployees(request, env, '', ctx);
        return addCorsHeaders(response, request, env);
      }

      // Order routes (user)
      if (path.startsWith('/api/orders')) {
        const orderPath = path.replace('/api/orders', '');
        const response = await handleOrders(request, env, orderPath, ctx);
        return addCorsHeaders(response, request, env);
      }

      // Admin routes
      if (path.startsWith('/api/admin')) {
        const adminPath = path.replace('/api/admin', '');
        const response = await handleAdmin(request, env, adminPath, ctx);
        return addCorsHeaders(response, request, env);
      }

      // Employee routes
      if (path.startsWith('/api/employee')) {
        const employeePath = path.replace('/api/employee', '');
        const response = await handleEmployee(request, env, employeePath, ctx);
        return addCorsHeaders(response, request, env);
      }

      return addCorsHeaders(json({ success: false, error: '接口不存在' }, 404), request, env);
    } catch (err: any) {
      console.error('Unhandled error:', err);
      return addCorsHeaders(json({ success: false, error: '服务器内部错误' }, 500), request, env);
    }
  },
};

function handleCors(request: Request, env: Env): Response {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim());

  if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  return new Response(null, { status: 204 });
}

function addCorsHeaders(response: Response, request: Request, env: Env): Response {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim());

  if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', origin);
    newHeaders.set('Access-Control-Allow-Credentials', 'true');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  return response;
}
