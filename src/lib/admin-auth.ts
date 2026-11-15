import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

// Авторизация админки: один владелец, без системы пользователей.
// Пароль хранится ТОЛЬКО как scrypt-хеш в переменной окружения,
// сессия — подписанный HMAC-токен в HttpOnly cookie на 12 часов.
//
// Генерация значений для deploy/.env (НЕ коммитить):
//   ADMIN_PASSWORD_HASH:  node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');const h=c.scryptSync(process.argv[1],s,64).toString('hex');console.log(s+':'+h)" 'ВАШ_ПАРОЛЬ'
//   ADMIN_SESSION_SECRET: openssl rand -hex 32
//   ANALYTICS_HASH_SECRET: openssl rand -hex 32

const SESSION_COOKIE = 'pb-admin';
const SESSION_TTL_MS = 12 * 60 * 60_000;

const PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ?? '';
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET ?? '';

export function verifyPassword(password: string): boolean {
  if (!PASSWORD_HASH || !SESSION_SECRET) return false;
  const [salt, hash] = PASSWORD_HASH.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function sign(payload: string): string {
  return createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

export function createSessionToken(): string {
  const payload = `${Date.now() + SESSION_TTL_MS}.${randomBytes(8).toString('hex')}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token || !SESSION_SECRET) return false;
  const i = token.lastIndexOf('.');
  if (i <= 0) return false;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const expiresAt = Number(payload.split('.')[0]);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}

export function sessionCookieSpec(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

// Лимит попыток входа: 5 за 15 минут, ПЕРСИСТЕНТНО (переживает рестарт
// контейнера — иначе брутфорс сбрасывался бы перезапуском). Ключ —
// усечённый источник запроса, полный IP не храним (anonymous-first).
export async function allowLoginAttempt(rawKey: string): Promise<boolean> {
  const { prisma } = await import('@/lib/db');
  const key = hashKey(rawKey);
  const windowStart = new Date(Date.now() - 15 * 60_000);
  try {
    const n = await prisma.adminLoginAttempt.count({
      where: { key, createdAt: { gte: windowStart } },
    });
    if (n >= 5) return false;
    await prisma.adminLoginAttempt.create({ data: { key } });
    // не копим историю: подчищаем старые записи мимоходом
    if (Math.random() < 0.1) {
      await prisma.adminLoginAttempt.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } },
      });
    }
    return true;
  } catch {
    // база недоступна — вход невозможен в любом случае, отказываем
    return false;
  }
}

function hashKey(raw: string): string {
  return createHmac('sha256', SESSION_SECRET || 'k').update(raw).digest('hex').slice(0, 24);
}
