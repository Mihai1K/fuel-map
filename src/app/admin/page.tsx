import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isAdmin, SESSION_COOKIE_NAME } from '@/lib/admin-auth';
import {
  apiHealth,
  cities,
  daily,
  dataQuality,
  funnel,
  headline,
  liveCounters,
  recentActions,
  sources,
  techHealth,
  webVitals,
  type Filters,
} from '@/lib/admin-stats';
import { AdminLive } from '@/components/admin-live';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Панель владельца · Тут Бензин',
  robots: { index: false, follow: false },
};

async function logout() {
  'use server';
  const jar = await cookies();
  jar.delete(SESSION_COOKIE_NAME);
  redirect('/admin/login');
}

const msk = (iso: string | null, withDate = false) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        hour: '2-digit',
        minute: '2-digit',
        ...(withDate ? { day: 'numeric', month: 'short' } : {}),
      })
    : '—';

function Card({ n, label, hint }: { n: string | number; label: string; hint?: string }) {
  return (
    <div className="bg-surface p-4" title={hint}>
      <p className="text-2xl font-bold">{n}</p>
      <p className="mt-0.5 text-xs text-muted">
        {label}
        {hint ? ' ⓘ' : ''}
      </p>
    </div>
  );
}

// мини-график без библиотек: CSS-столбики (объём данных крошечный,
// тянуть chart-библиотеку ради 30 точек — лишний вес публичного бандла
// не трогаем, а админке хватает)
function Bars({ data, label }: { data: { day: string; v: number }[]; label: string }) {
  const max = Math.max(...data.map((d) => d.v), 1);
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <div className="mt-2 flex h-24 items-end gap-0.5">
        {data.map((d) => (
          <div
            key={d.day}
            title={`${d.day}: ${d.v}`}
            className="min-w-1 flex-1 rounded-t bg-primary/70"
            style={{ height: `${Math.max((d.v / max) * 100, d.v > 0 ? 4 : 1)}%` }}
          />
        ))}
      </div>
      <p className="mt-1 text-right text-xs text-muted">
        макс. {max}
      </p>
    </div>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; city?: string; src?: string }>;
}) {
  if (!(await isAdmin())) redirect('/admin/login');

  const sp = await searchParams;
  const f: Filters = {
    days: [1, 7, 30, 90, 180, 365].includes(Number(sp.days)) ? Number(sp.days) : 7,
    city: sp.city || undefined,
    src: sp.src || undefined,
  };

  const [live, head, fun, days, srcs, cts, recent, quality, health, api, vitals] =
    await Promise.all([
      liveCounters(),
      headline(),
      funnel(f),
      daily(f),
      sources(f),
      cities(f),
      recentActions(),
      dataQuality(),
      techHealth(),
      apiHealth(),
      webVitals(),
    ]);

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { days: String(f.days), city: f.city, src: f.src, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/admin?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Панель владельца</h1>
          <p className="mt-1 text-sm text-muted">
            Только реальные пользователи; демо-слой — отдельно в «Качестве данных».
            Время — МСК.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={qs({})}
            className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-surface-2"
          >
            Обновить
          </Link>
          <form action={logout}>
            <button className="rounded-xl border border-border px-3 py-2 text-sm text-muted hover:bg-surface-2">
              Выйти
            </button>
          </form>
        </div>
      </div>

      {head.firstDataAt === null ? (
        <p className="mt-6 rounded-2xl border border-border bg-surface p-5 text-sm text-muted">
          Данные собираются с момента выпуска аналитики — событий пока нет.
          Откройте сайт в другой вкладке, и здесь появятся первые цифры.
        </p>
      ) : (
        <p className="mt-4 text-xs text-muted">
          Данные собираются с {msk(head.firstDataAt, true)}
        </p>
      )}

      {/* фильтры */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        {[1, 7, 30, 90, 180, 365].map((d) => (
          <Link
            key={d}
            href={qs({ days: String(d) })}
            className={`rounded-xl px-3 py-1.5 ${f.days === d ? 'bg-text text-background' : 'border border-border hover:bg-surface-2'}`}
          >
            {d === 1 ? '24 часа' : d === 365 ? 'год' : `${d} дней`}
          </Link>
        ))}
        {f.city && (
          <Link href={qs({ city: undefined })} className="rounded-xl bg-primary/10 px-3 py-1.5 text-primary">
            {f.city} ×
          </Link>
        )}
        {f.src && (
          <Link href={qs({ src: undefined })} className="rounded-xl bg-primary/10 px-3 py-1.5 text-primary">
            {f.src} ×
          </Link>
        )}
      </div>

      {/* верхние карточки */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <AdminLive initial={live} />
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:col-span-2">
          <Card n={head.dau} label="DAU (сегодня)" hint="Уникальные анонимные устройства с активностью сегодня (границы суток — МСК)" />
          <Card n={head.wau} label="WAU (7 дней)" hint="Уникальные устройства за последние 7 суток" />
          <Card n={head.mau} label="MAU (30 дней)" hint="Уникальные устройства за последние 30 суток" />
          <Card n={head.newToday} label="новых сегодня" hint="Устройства, впервые увиденные сегодня" />
          <Card n={head.returningToday} label="вернулись сегодня" hint="DAU минус новые: были раньше и пришли сегодня снова" />
          <Card n={head.marksToday} label="реальных отметок сегодня" />
          <Card
            n={head.markShare !== null ? `${head.markShare}%` : '—'}
            label="доля с отметкой"
            hint="Уникальные устройства с mark_completed сегодня / DAU"
          />
          <Card
            n={head.sfsPct !== null ? `${head.sfsPct}%` : '—'}
            label="SFS proxy (7 дн)"
            hint="Доля сессий, где за 60 с после открытия карты человек открыл АЗС, построил маршрут или оставил отметку. Прокси-метрика, не гарантированный успех поиска топлива."
          />
          <Card n={head.sfsTotal} label="сессий с картой (7 дн)" />
        </div>
      </div>

      {/* воронка */}
      <h2 className="mt-8 text-lg font-semibold">Воронка · {f.days === 1 ? '24 часа' : `${f.days} дней`}</h2>
      <div className="mt-3 overflow-hidden rounded-2xl border border-border">
        {fun.map((step, i) => {
          const first = fun[0].n || 1;
          const prev = i > 0 ? fun[i - 1].n || 1 : first;
          return (
            <div key={step.label} className="border-b border-border bg-surface px-5 py-3 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">{step.label}</p>
                <p className="text-sm">
                  <span className="font-bold">{step.n}</span>
                  <span className="ml-3 text-xs text-muted">
                    {i > 0 ? `${Math.round((step.n / prev) * 100)}% от пред.` : ''}
                    {' · '}
                    {Math.round((step.n / first) * 100)}% от входа
                  </span>
                </p>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max((step.n / first) * 100, step.n > 0 ? 2 : 0)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* графики */}
      <div className="mt-8 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Динамика</h2>
        <a href={`/api/admin/export?what=daily&days=${f.days}`} className="text-xs text-primary hover:underline">CSV</a>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Bars label="Пользователи" data={days.map((d) => ({ day: d.day, v: d.users }))} />
        <Bars label="Сессии" data={days.map((d) => ({ day: d.day, v: d.sessions }))} />
        <Bars label="Карточки АЗС" data={days.map((d) => ({ day: d.day, v: d.cards }))} />
        <Bars label="Маршруты" data={days.map((d) => ({ day: d.day, v: d.routes }))} />
        <Bars label="Отметки (события)" data={days.map((d) => ({ day: d.day, v: d.marks }))} />
        <Bars label="Установки PWA" data={days.map((d) => ({ day: d.day, v: d.installs }))} />
        <Bars label="Репосты" data={days.map((d) => ({ day: d.day, v: d.shares }))} />
        <Bars
          label="Конверсия в отметку, %"
          data={days.map((d) => ({
            day: d.day,
            v: d.users > 0 ? Math.round((d.marks / d.users) * 100) : 0,
          }))}
        />
      </div>

      {/* источники */}
      <div className="mt-8 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Источники трафика</h2>
        <a href={`/api/admin/export?what=sources&days=${f.days}`} className="text-xs text-primary hover:underline">CSV</a>
      </div>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[560px] bg-surface text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-2.5">Источник / кампания</th>
              <th className="px-3 py-2.5 text-right">Польз.</th>
              <th className="px-3 py-2.5 text-right">Карта</th>
              <th className="px-3 py-2.5 text-right">Карточка</th>
              <th className="px-3 py-2.5 text-right">Маршрут</th>
              <th className="px-3 py-2.5 text-right">Отметки</th>
            </tr>
          </thead>
          <tbody>
            {srcs.map((s, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2.5">
                  <Link href={qs({ src: s.source })} className="font-medium hover:underline">
                    {s.source}
                  </Link>
                  {(s.medium || s.campaign || s.content) && (
                    <span className="ml-2 text-xs text-muted">
                      {[s.medium, s.campaign, s.content].filter(Boolean).join(' / ')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-semibold">{s.users}</td>
                <td className="px-3 py-2.5 text-right">{s.maps}</td>
                <td className="px-3 py-2.5 text-right">{s.cards}</td>
                <td className="px-3 py-2.5 text-right">{s.routes}</td>
                <td className="px-3 py-2.5 text-right">{s.marks}</td>
              </tr>
            ))}
            {srcs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-5 text-sm text-muted">
                  Пока нет данных за период.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* города */}
      <div className="mt-8 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Города</h2>
        <a href={`/api/admin/export?what=cities&days=${f.days}`} className="text-xs text-primary hover:underline">CSV</a>
      </div>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[560px] bg-surface text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-2.5">Город</th>
              <th className="px-3 py-2.5 text-right">Сейчас</th>
              <th className="px-3 py-2.5 text-right">Сегодня</th>
              <th className="px-3 py-2.5 text-right">За период</th>
              <th className="px-3 py-2.5 text-right">Карточки</th>
              <th className="px-3 py-2.5 text-right">Маршруты</th>
              <th className="px-3 py-2.5 text-right">Отметки</th>
              <th className="px-3 py-2.5 text-right" title="АЗС города со свежими реальными метками за 24 ч">Покрытие ⓘ</th>
            </tr>
          </thead>
          <tbody>
            {cts.map((c) => (
              <tr key={c.city} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2.5">
                  <Link href={qs({ city: c.city })} className="font-medium hover:underline">
                    {c.city}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right">{c.active}</td>
                <td className="px-3 py-2.5 text-right">{c.todayUsers}</td>
                <td className="px-3 py-2.5 text-right font-semibold">{c.users}</td>
                <td className="px-3 py-2.5 text-right">{c.cards}</td>
                <td className="px-3 py-2.5 text-right">{c.routes}</td>
                <td className="px-3 py-2.5 text-right">{c.marks}</td>
                <td className="px-3 py-2.5 text-right text-xs">
                  {c.stationsFreshReal}/{c.stationsTotal}
                </td>
              </tr>
            ))}
            {cts.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-5 text-sm text-muted">
                  Пока нет данных за период.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* последние действия */}
      <h2 className="mt-8 text-lg font-semibold">Последние реальные действия</h2>
      <ul className="mt-3 space-y-1.5 rounded-2xl border border-border bg-surface p-4 text-sm">
        {recent.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0 tabular-nums text-muted">{msk(r.at)}</span>
            <span className="text-muted">·</span>
            {r.city && (
              <>
                <span className="shrink-0 font-medium">{r.city}</span>
                <span className="text-muted">·</span>
              </>
            )}
            <span className="min-w-0 truncate">{r.text}</span>
          </li>
        ))}
        {recent.length === 0 && (
          <li className="text-muted">Реальных действий пока не было.</li>
        )}
      </ul>

      {/* качество данных — технический блок, визуально отделён */}
      <h2 className="mt-10 border-t border-border pt-6 text-lg font-semibold text-muted">
        Качество данных (техническое)
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-dashed border-border bg-border sm:grid-cols-4">
        <Card n={quality.total} label="всего АЗС" />
        <Card n={quality.realFresh} label="со свежими реальными" />
        <Card n={quality.seedOnly} label="только seed-данные" />
        <Card
          n={quality.realShare !== null ? `${quality.realShare}%` : '—'}
          label="доля реальных меток (24 ч)"
        />
        <Card n={quality.realMarks24} label="реальных меток за 24 ч" />
        <Card n={quality.seedMarks24} label="seed-меток за 24 ч" />
        <Card n={quality.demoOff ? 'ВЫКЛ' : 'вкл'} label="демо-слой (DEMO_OFF)" />
        <Card n={quality.demoCities} label="DEMO_CITIES" />
      </div>

      {/* тех. здоровье */}
      <h2 className="mt-8 text-lg font-semibold text-muted">Техническое здоровье</h2>
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-dashed border-border bg-border sm:grid-cols-4">
        <Card n={`${health.dbMs} мс`} label="ответ базы данных" />
        <Card n={msk(health.lastImportAt, true)} label="последняя новая АЗС" />
        <Card n={msk(health.lastSeedAt, true)} label="последний seed-прогон" />
        <Card n={msk(health.lastRealMarkAt, true)} label="последняя реальная метка" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-dashed border-border bg-border sm:grid-cols-4">
        <Card n={api.errHour} label="ошибок API за час" />
        <Card n={api.errDay} label="ошибок API за сутки" />
        <Card
          n={vitals.lcp !== null ? `${vitals.lcp} мс` : '—'}
          label="LCP p75 (24 ч)"
          hint="Отрисовка главного контента; хорошо — до 2500 мс"
        />
        <Card
          n={vitals.inp !== null ? `${vitals.inp} мс` : '—'}
          label="INP p75 (24 ч)"
          hint="Отклик на нажатия; хорошо — до 200 мс"
        />
      </div>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-dashed border-border">
        <table className="w-full min-w-[480px] bg-surface text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-2.5">API (24 ч)</th>
              <th className="px-3 py-2.5 text-right">Запросов</th>
              <th className="px-3 py-2.5 text-right">p50</th>
              <th className="px-3 py-2.5 text-right">p95</th>
              <th className="px-3 py-2.5 text-right">Неуспешных</th>
            </tr>
          </thead>
          <tbody>
            {api.paths.map((p) => (
              <tr key={p.path} className="border-b border-border last:border-b-0">
                <td className="px-4 py-2.5 font-medium">{p.path}</td>
                <td className="px-3 py-2.5 text-right">{p.total}</td>
                <td className="px-3 py-2.5 text-right">{p.p50} мс</td>
                <td className="px-3 py-2.5 text-right">{p.p95} мс</td>
                <td className="px-3 py-2.5 text-right">{p.failPct}%</td>
              </tr>
            ))}
            {api.paths.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-5 text-sm text-muted">
                  Телеметрия собирается с момента этого выпуска.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {vitals.cls !== null && (
        <p className="mt-2 text-xs text-muted">
          CLS p75: {vitals.cls} (хорошо — до 0,1) · замеров за сутки: {vitals.n}
        </p>
      )}
    </div>
  );
}
