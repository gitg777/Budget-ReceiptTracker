// Login, sessions and password hashing.
// Sessions are random tokens in an HttpOnly cookie; the database keeps only their SHA-256 hash,
// so removing a helper (or logging out) cuts access immediately.

import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, SessionUser } from './types';

const SESSION_DAYS = 90; // long, because re-logging in on a weak signal is painful
const COOKIE = 'bt_session';
const MAX_FAILURES = 8;
const LOCK_MINUTES = 15;

function b64(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(text: string): Promise<string> {
  return b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// PBKDF2 is built into Workers; 100k iterations is the Workers platform maximum.
export async function hashSecret(secret: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  );
  return b64(bits);
}

export async function newPasswordHash(secret: string): Promise<{ hash: string; salt: string }> {
  const salt = randomToken(16);
  return { hash: await hashSecret(secret, salt), salt };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkSecret(secret: string, hash: string, salt: string): Promise<boolean> {
  return timingSafeEqual(await hashSecret(secret, salt), hash);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Returns minutes left on a lockout, or 0 if the login may be tried. */
export async function lockedMinutes(db: D1Database, login: string): Promise<number> {
  const row = await db.prepare('SELECT count, first_at FROM login_failures WHERE login = ?').bind(login).first<{ count: number; first_at: string }>();
  if (!row) return 0;
  const ageMin = (Date.now() - Date.parse(row.first_at)) / 60000;
  if (ageMin > LOCK_MINUTES) {
    await db.prepare('DELETE FROM login_failures WHERE login = ?').bind(login).run();
    return 0;
  }
  return row.count >= MAX_FAILURES ? Math.ceil(LOCK_MINUTES - ageMin) : 0;
}

export async function recordFailure(db: D1Database, login: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO login_failures (login, count, first_at) VALUES (?, 1, ?)
       ON CONFLICT(login) DO UPDATE SET count = count + 1`,
    )
    .bind(login, nowIso())
    .run();
}

export async function clearFailures(db: D1Database, login: string): Promise<void> {
  await db.prepare('DELETE FROM login_failures WHERE login = ?').bind(login).run();
}

export async function startSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, expires, nowIso())
    .run();
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, COOKIE, { path: '/' });
}

async function loadUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.account_id, u.role, u.display_name, u.email, u.username, u.is_admin, s.expires_at, a.name AS account_name
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN accounts a ON a.id = u.account_id
      WHERE s.token_hash = ? AND u.active = 1`,
  )
    .bind(await sha256(token))
    .first<SessionUser & { expires_at: string }>();
  if (!row || Date.parse(row.expires_at) < Date.now()) return null;
  const { expires_at: _ignored, ...user } = row;
  return user;
}

export async function requireUser(c: Context<AppEnv>, next: Next) {
  const user = await loadUser(c);
  if (!user) return c.json({ error: 'Please log in.' }, 401);
  c.set('user', user);
  await next();
}

export async function requireOwner(c: Context<AppEnv>, next: Next) {
  if (c.get('user').role !== 'owner') return c.json({ error: 'Only the account owner can do this.' }, 403);
  await next();
}

export { loadUser };
