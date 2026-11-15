import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, MapPin, MessageCircle, ShieldCheck } from 'lucide-react';
import { prisma } from '@/lib/db';
import { CITIES } from '@/lib/cities';
import { CHATS, COMMUNITY, DONATE_URL, NEWS } from '@/lib/community';
import { SITE_URL } from '@/lib/site';

const COMMUNITY_FOOTER = COMMUNITY.map((c) => ({
  ...c,
  label:
    c.kind === 'chat' && c.app === 'Telegram'
      ? 'Чат водителей России'
      : c.label,
}));
import { STATUS_META, freshness, type StatusCode } from '@/lib/status';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'О сервисе — Тут Бензин',
  description:
    'Как работает «Тут Бензин»: живая карта АЗС, отметки водителей, без регистрации. Статистика сервиса, новости о дефиците топлива, наши каналы.',
  alternates: { canonical: `${SITE_URL}/o-servise` },
};

async function loadLandingData() {
  // Счётчики активности («последняя отметка», «меток за сутки», «водителей с
  // нами») убраны с витрины 15.09.2026: на холодном старте они показывали
  // 0–3 и читались как «сервис мёртвый» — посетитель уходил, не дойдя до
  // карты. Остались факты охвата, которые не зависят от объёма трафика.
  // «Последние обновления» ниже по-прежнему показывают ТОЛЬКО реальные
  // отметки водителей (source='user'): seed-слой нельзя выдавать за
  // активность водителей (юридический аудит 21.07).
  return Promise.all([
    prisma.station.count(),
    prisma.mark.findMany({
      where: { source: 'user' },
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: { station: true },
    }),
  ]);
}

// «О сервисе» — информационная/SEO-страница. Главный вход в продукт — карта
// на `/` (решение владельца, 14.09.2026: карта первым экраном, лендинг сюда,
// чтобы не терять трафик на втором клике).
export default async function AboutPage() {
  const [stationsTotal, recent] = await loadLandingData();

  const problem = CITIES.filter((c) => c.alert);

  return (
    <div className="min-h-dvh">
      {/* Шапка */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-white">
            <MapPin className="size-5" />
          </span>
          <span className="text-lg font-semibold">Тут Бензин</span>
        </Link>
        <Link
          href="/"
          className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-press"
        >
          Где есть бензин
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-14 text-center sm:pt-24">
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
          Где сейчас есть бензин
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted">
          Показываем ситуацию на АЗС в реальном времени. Водители отмечают, где есть топливо,
          какая очередь и когда это подтверждали.
        </p>
        <div className="mt-9 flex items-center justify-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-2xl bg-primary px-7 py-4 text-base font-semibold text-white shadow-lg transition-colors hover:bg-primary-press"
          >
            Показать, где есть бензин
            <ArrowRight className="size-5" />
          </Link>
        </div>
        <p className="mt-5 text-sm text-muted">
          Без регистрации · ничего не нужно скачивать
        </p>
        <p className="mt-3 text-sm text-muted">
          Уведомления о новых отметках —{' '}
          <a
            href={NEWS[0].href}
            target="_blank"
            rel="noopener"
            className="font-medium text-primary hover:underline"
          >
            в Telegram
          </a>
          ,{' '}
          <a
            href={NEWS[1].href}
            target="_blank"
            rel="noopener"
            className="font-medium text-primary hover:underline"
          >
            MAX
          </a>{' '}
          и{' '}
          <a
            href={NEWS[2].href}
            target="_blank"
            rel="noopener"
            className="font-medium text-primary hover:underline"
          >
            ВКонтакте
          </a>
        </p>
      </section>

      {/* Статистика */}
      <section className="mx-auto max-w-5xl px-6">
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-3xl border border-border bg-border">
          {[
            // Только то, что не зависит от сегодняшнего трафика: цифры
            // охвата верны и в день запуска, и в мёртвый вторник.
            [String(stationsTotal), 'заправок на карте'],
            [String(CITIES.length), 'городов'],
            ['6', 'видов топлива'],
          ].map(([n, label]) => (
            <div key={label} className="bg-surface p-6 text-center">
              <p className="text-3xl font-semibold">{n}</p>
              <p className="mt-1 text-sm text-muted">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Проблемные регионы — по публикациям о дефиците топлива */}
      <section className="mx-auto max-w-5xl px-6 pt-16">
        <h2 className="text-2xl font-semibold">Где сейчас сложнее всего</h2>
        <p className="mt-2 text-sm text-muted">
          По сообщениям СМИ и отметкам водителей — дата у каждого города ниже
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {problem.map((c) => (
            <Link
              key={c.slug}
              href={`/?city=${c.slug}`}
              className="group flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-5 transition-colors hover:bg-surface-2"
            >
              <div>
                <p className="font-semibold">{c.name}</p>
                <p className="mt-0.5 text-sm text-muted">{c.alertNote}</p>
                {c.alertSource && (
                  <p className="mt-1 text-xs text-muted">
                    {c.alertSource.name}
                    {c.alertUpdatedAt &&
                      ` · ${new Date(c.alertUpdatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`}
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold ${
                  c.alert === 'critical'
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                    : c.alert === 'limits'
                      ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                }`}
              >
                {c.alert === 'critical' ? 'дефицит' : c.alert === 'limits' ? 'лимиты' : 'перебои'}
              </span>
            </Link>
          ))}
        </div>
        <Link
          href="/novosti"
          className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
        >
          Все новости о дефиците →
        </Link>
      </section>

      {/* Как работает */}
      <section className="mx-auto max-w-5xl px-6 pt-16">
        <h2 className="text-2xl font-semibold">Как это работает</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          {[
            ['1', 'Открыли сервис'],
            ['2', 'Нашли заправку с топливом'],
            ['3', 'Подтвердили в один тап'],
            ['4', 'Помогли другим водителям'],
          ].map(([n, label]) => (
            <div key={n} className="rounded-2xl border border-border bg-surface p-5">
              <p className="text-2xl font-semibold text-primary">{n}</p>
              <p className="mt-2 text-sm">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Последние обновления */}
      <section className="mx-auto max-w-5xl px-6 pt-16">
        <h2 className="text-2xl font-semibold">Последние обновления</h2>
        <div className="mt-6 overflow-hidden rounded-3xl border border-border">
          {recent.map((m) => {
            const meta = STATUS_META[m.status as StatusCode];
            return (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-4 last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: meta.color }}
                  />
                  <p className="truncate text-sm">
                    <span className="font-semibold">{m.station.city}</span>
                    {' · '}
                    {m.station.network ?? m.station.name} — {meta.label.toLowerCase()}
                  </p>
                </div>
                <p className="shrink-0 text-xs text-muted">
                  {freshness(m.createdAt)}
                </p>
              </div>
            );
          })}
        </div>
        <Link
          href="/otmetki"
          className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
        >
          Все последние отметки →
        </Link>
      </section>

      {/* Доверие */}
      <section className="mx-auto max-w-5xl px-6 pt-16">
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            'Без регистрации',
            'Ничего не нужно скачивать',
            'Отметки самих водителей',
            'Бесплатно',
          ].map((t) => (
            <div
              key={t}
              className="flex items-center gap-2.5 rounded-2xl border border-border bg-surface p-4 text-sm"
            >
              <ShieldCheck className="size-4 shrink-0 text-primary" />
              {t}
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-6 pt-16">
        <h2 className="text-2xl font-semibold">Частые вопросы</h2>
        <div className="mt-6 space-y-2">
          {[
            [
              'Откуда данные?',
              'Все отметки оставляют сами водители — прямо с заправки, в один тап. Мы показываем, когда информацию обновляли и сколько человек её подтвердили.',
            ],
            [
              'Насколько данным можно верить?',
              'Это личные наблюдения водителей, а не официальные данные сетей АЗС. Мы честно показываем возраст каждой отметки и процент согласованности — проверяйте на месте.',
            ],
            [
              'Нужно ли регистрироваться?',
              'Нет. Сервис работает в браузере, без регистрации, приложений и звонков.',
            ],
            [
              'Моего города нет в списке',
              'Мы начали с городов, где перебои сильнее всего, и быстро расширяем список.',
            ],
          ].map(([q, a]) => (
            <details
              key={q}
              className="group rounded-2xl border border-border bg-surface p-5"
            >
              <summary className="cursor-pointer list-none text-sm font-semibold">
                {q}
              </summary>
              <p className="mt-3 text-sm text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Сообщество — часть продукта: сюда возвращаются, если сайт недоступен */}
      <section className="mx-auto max-w-5xl px-6 pt-16">
        <h2 className="text-2xl font-semibold">Будьте на связи</h2>
        <p className="mt-2 text-sm text-muted">
          Новые отметки и рабочая ссылка на сервис — всегда в наших каналах.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <p className="text-sm font-semibold">📢 Новости</p>
            <div className="mt-3 space-y-2">
              {NEWS.map((c) => (
                <a
                  key={c.key}
                  href={c.href}
                  target="_blank"
                  rel="noopener"
                  className="flex min-h-11 items-center justify-between rounded-xl bg-surface-2 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-border"
                >
                  {c.label}
                  <ArrowRight className="size-4 text-muted" />
                </a>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-5">
            <p className="text-sm font-semibold">💬 Общение водителей</p>
            <div className="mt-3 space-y-2">
              {CHATS.map((c) => (
                <a
                  key={c.key}
                  href={c.href}
                  target="_blank"
                  rel="noopener"
                  className="flex min-h-11 items-center justify-between rounded-xl bg-surface-2 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-border"
                >
                  {c.label}
                  <MessageCircle className="size-4 text-muted" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-5xl px-6 py-14 text-center text-xs text-muted">
        <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {COMMUNITY_FOOTER.map((c) => (
            <a
              key={c.key}
              href={c.href}
              target="_blank"
              rel="noopener"
              className="hover:text-text hover:underline"
            >
              {c.label}
            </a>
          ))}
          {DONATE_URL && (
            <a
              href={DONATE_URL}
              target="_blank"
              rel="noopener"
              className="hover:text-text hover:underline"
            >
              Поддержать сервис
            </a>
          )}
        </p>
        <p className="mt-4">
          Тут Бензин — карта ситуации на АЗС России. Данные — отметки самих
          водителей; сервис не связан с сетями АЗС и не продаёт топливо.
          Если сайт временно недоступен — актуальные ссылки всегда есть в
          Telegram, MAX и ВКонтакте.{' '}
          <Link href="/privacy" className="hover:text-text hover:underline">
            Политика конфиденциальности
          </Link>{' '}
          ·{' '}
          <Link href="/terms" className="hover:text-text hover:underline">
            Пользовательское соглашение
          </Link>
        </p>
        <p className="mt-2">
          База АЗС —{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener"
          >
            © участники OpenStreetMap
          </a>{' '}
          (ODbL). Оператор данных: Князев М. Е.,{' '}
          <a
            href="mailto:tytbenzin@internet.ru"
            className="hover:text-text hover:underline"
          >
            tytbenzin@internet.ru
          </a>
        </p>
      </footer>
    </div>
  );
}
