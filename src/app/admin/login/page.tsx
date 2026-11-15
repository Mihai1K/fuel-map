import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { cookies } from 'next/headers';
import {
  allowLoginAttempt,
  createSessionToken,
  isAdmin,
  sessionCookieSpec,
  verifyPassword,
} from '@/lib/admin-auth';

export const metadata: Metadata = {
  title: 'Вход',
  robots: { index: false, follow: false },
};

// Единый текст любой ошибки входа — не подсказываем, что именно не так
const ERROR_TEXT = 'Не получилось войти. Проверьте пароль и попробуйте ещё раз.';

async function login(formData: FormData) {
  'use server';
  const h = await headers();
  // за Caddy реальный адрес в X-Forwarded-For; берём только для rate limit
  const key = (h.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
  const password = String(formData.get('password') ?? '');
  if (!(await allowLoginAttempt(key)) || !verifyPassword(password)) {
    redirect('/admin/login?e=1');
  }
  const jar = await cookies();
  jar.set(sessionCookieSpec(createSessionToken()));
  redirect('/admin');
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  if (await isAdmin()) redirect('/admin');
  const { e } = await searchParams;

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6">
      <form
        action={login}
        className="w-full max-w-sm rounded-3xl border border-border bg-surface p-8 shadow-2xl"
      >
        <p className="text-lg font-semibold">Тут Бензин · панель владельца</p>
        <p className="mt-1 text-sm text-muted">Закрытый раздел.</p>
        <input
          type="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          placeholder="Пароль"
          className="mt-5 w-full rounded-2xl border border-border bg-surface-2/60 px-4 py-3 text-sm outline-none focus:border-primary"
        />
        {e && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">
            {ERROR_TEXT}
          </p>
        )}
        <button
          type="submit"
          className="mt-4 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-press"
        >
          Войти
        </button>
      </form>
    </div>
  );
}
