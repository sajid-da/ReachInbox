import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { connection } from './queue.js';

export type AuthUser = { sub: string; name: string; email: string; picture: string };
type SessionPayload = AuthUser & { exp: number };

const encode = (value: string) => Buffer.from(value).toString('base64url');
const decode = (value: string) => Buffer.from(value, 'base64url').toString('utf8');
const signature = (value: string) => crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
const revokedKey = (raw: string) => `auth:revoked:${crypto.createHash('sha256').update(raw).digest('hex')}`;

function cookies(request: Request) {
  return Object.fromEntries((request.headers.cookie ?? '').split(';').filter(Boolean).map((item) => {
    const index = item.indexOf('=');
    return [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1).trim())];
  }));
}

export function getCookie(request: Request, name: string) {
  return cookies(request)[name];
}

export function setCookie(response: Response, name: string, value: string, maxAge: number) {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  const sameSite = config.nodeEnv === 'production' ? 'None' : 'Lax';
  appendCookie(response, `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${maxAge}${secure}`);
}

export function clearCookie(response: Response, name: string) {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  const sameSite = config.nodeEnv === 'production' ? 'None' : 'Lax';
  appendCookie(response, `${name}=; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=0${secure}`);
}

function appendCookie(response: Response, value: string) {
  const current = response.getHeader('Set-Cookie');
  response.setHeader('Set-Cookie', current ? (Array.isArray(current) ? [...current, value] : [current.toString(), value]) : value);
}

export function createSession(user: AuthUser) {
  if (!config.sessionSecret) throw new Error('SESSION_SECRET must be configured');
  const payload: SessionPayload = { ...user, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 };
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${signature(encoded)}`;
}

export async function readSession(request: Request): Promise<AuthUser | null> {
  if (!config.sessionSecret) return null;
  const raw = cookies(request).reachinbox_session;
  if (!raw) return null;
  const [encoded, provided] = raw.split('.');
  if (!encoded || !provided) return null;
  const expected = signature(encoded);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(decode(encoded)) as SessionPayload;
    if (payload.exp <= Date.now() || await connection.exists(revokedKey(raw))) return null;
    return { sub: payload.sub, name: payload.name, email: payload.email, picture: payload.picture };
  } catch { return null; }
}

export async function revokeSession(request: Request) {
  const raw = cookies(request).reachinbox_session;
  if (!raw) return;
  const [encoded] = raw.split('.');
  try {
    const payload = JSON.parse(decode(encoded)) as SessionPayload;
    const ttl = Math.max(1, Math.ceil((payload.exp - Date.now()) / 1000));
    await connection.set(revokedKey(raw), '1', 'EX', ttl);
  } catch { /* Invalid cookies are already unauthenticated. */ }
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  const user = await readSession(request);
  if (!user) return response.status(401).json({ error: 'Authentication required' });
  response.locals.user = user;
  next();
}

export function googleAuthUrl(state: string) {
  const query = new URLSearchParams({ client_id: config.google.clientId, redirect_uri: config.google.redirectUri, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}

export async function exchangeGoogleCode(code: string): Promise<AuthUser> {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: config.google.redirectUri, grant_type: 'authorization_code' }) });
  if (!tokenResponse.ok) throw new Error('Google token exchange failed');
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) throw new Error('Google token response did not include an access token');
  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!profileResponse.ok) throw new Error('Google profile request failed');
  const profile = await profileResponse.json() as { sub?: string; name?: string; email?: string; picture?: string; email_verified?: boolean };
  if (!profile.sub || !profile.email || profile.email_verified === false) throw new Error('Google account email is not verified');
  return { sub: profile.sub, name: profile.name ?? profile.email, email: profile.email, picture: profile.picture ?? '' };
}
