// Session management using KV
// Stores session data in Cloudflare KV with 7-day expiry

export interface SessionData {
  userId: number;
  role: 'user' | 'employee' | 'admin';
  username: string;
  expiresAt: string;
}

export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  ENVIRONMENT: string;
  ALLOWED_ORIGINS: string;
}

const SESSION_COOKIE_NAME = 'cyx_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function createSession(
  kv: KVNamespace,
  userId: number,
  role: 'user' | 'employee' | 'admin',
  username: string
): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  const data: SessionData = { userId, role, username, expiresAt };
  await kv.put(token, JSON.stringify(data), { expirationTtl: SESSION_MAX_AGE });
  return token;
}

export async function getSession(
  kv: KVNamespace,
  token: string
): Promise<SessionData | null> {
  const raw = await kv.get(token);
  if (!raw) return null;
  try {
    const data: SessionData = JSON.parse(raw);
    if (new Date(data.expiresAt) < new Date()) {
      await kv.delete(token);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function deleteSession(kv: KVNamespace, token: string): Promise<void> {
  await kv.delete(token);
}

export function getSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith(SESSION_COOKIE_NAME + '=')) {
      return cookie.substring(SESSION_COOKIE_NAME.length + 1);
    }
  }
  return null;
}

export function setSessionCookie(token: string): string {
  const isSecure = true;
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
