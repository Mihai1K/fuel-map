import type { Metadata } from 'next';
import Link from 'next/link';
import { computeFuelIndex, loadFuelIndexHistory, INDEX_LEVEL } from '@/lib/fuel-index';
import { FuelIndexChart } from '@/components/fuel-index-chart';
import { pluralRu } from '@/lib/status';
import { SITE_URL } from '@/lib/site';

// как и остальные страницы с БД: рендер на запрос (в сборочном контейнере
// базы нет — статический пререндер валил build). Кэш не нужен: трафик мал.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Индекс топлива России — где есть бензин сегодня · Тут Бензин',
  description:
    'Ежедневный индекс доступности топлива: доля заправок с бензином по данным водителей — по России и городам. Обновляется по живым отметкам.',
  alternates: { canonical: `${SITE_URL}/indeks` },
};

function delta(pct: number | null, prev: number | null): string | null {
  if (pct === null || prev === null) return null;
  const d = pct - prev;
  if (d === 0) return 'без изменений за сутки';
  return d > 0 ? `+${d} п.п. за сутки` : `−${Math.abs(d)} п.п. за сутки`;
}

export default async function IndeksPage() {
  const { russia, cities, counts, updatedAt } = await computeFuelIndex();
  const history = await loadFuelIndexHistory('Россия', 30);
  const rl = INDEX_LEVEL[russia.level];
  const date = new Date(updatedAt).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  });

  // готовый текст ежедневного поста — копируется в TG/MAX/VK одним кликом
  const post = [
    `⛽️ Индекс топлива России — ${date}`,
    '',
    `${rl.emoji} ${russia.pct ?? '—'}% заправок с топливом (${rl.label.toLowerCase()})`,
    ...(delta(russia.pct, russia.pctYesterday)
      ? [delta(russia.pct, russia.pctYesterday) as string]
      : []),
    '',
    ...cities
      .slice(0, 6)
      .map(
        (c) =>
          `${INDEX_LEVEL[c.level].emoji} ${c.scope}: ${c.pct ?? '—'}%`
      ),
    '',
    `Живая карта: ${SITE_URL}`,
  ].join('\n');

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/" className="text-sm text-muted hover:underline">
        ← Тут Бензин
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Индекс топлива России</h1>
      <p className="mt-2 text-sm text-muted">
        Доля заправок с подтверждённым топливом среди заправок со свежими
        отметками водителей за сутки. Обновлено: {date}.
      </p>

      <div className="mt-8 rounded-3xl border border-border bg-surface p-8 text-center">
        <p className="text-5xl">{rl.emoji}</p>
        <p className="mt-3 text-5xl font-bold">
          {russia.pct !== null ? `${russia.pct}%` : '—'}
        </p>
        <p className="mt-1 text-lg font-medium">{rl.label}</p>
        {delta(russia.pct, russia.pctYesterday) && (
          <p className="mt-1 text-sm text-muted">
            {delta(russia.pct, russia.pctYesterday)}
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          {russia.withData}{' '}
          {pluralRu(russia.withData, 'заправка', 'заправки', 'заправок')} с
          данными · {russia.alive} с топливом
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-5">
        {(
          [
            ['🟢', 'Есть топливо', counts.available],
            ['🟡', 'Мало', counts.low],
            ['🟠', 'Очередь', counts.queue],
            ['🔴', 'Нет / закрыта', counts.out],
            ['⚪', 'Нет данных', counts.nodata],
          ] as const
        ).map(([emoji, label, n]) => (
          <div key={label} className="bg-surface p-4 text-center">
            <p className="text-lg">{emoji}</p>
            <p className="mt-0.5 text-xl font-semibold">
              {n.toLocaleString('ru-RU')}
            </p>
            <p className="mt-0.5 text-xs text-muted">{label}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-xl font-semibold">Динамика за 30 дней</h2>
      <p className="mt-1 text-sm text-muted">
        Доля заправок с топливом по России, день за днём.
      </p>
      <div className="mt-4 rounded-2xl border border-border bg-surface p-5">
        <FuelIndexChart points={history} />
      </div>

      <h2 className="mt-10 text-xl font-semibold">По городам</h2>
      <div className="mt-4 overflow-hidden rounded-2xl border border-border">
        {cities.map((c) => {
          const l = INDEX_LEVEL[c.level];
          return (
            <div
              key={c.scope}
              className="flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-3.5 last:border-b-0"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span>{l.emoji}</span>
                <span className="truncate text-sm font-medium">{c.scope}</span>
              </span>
              <span className="flex shrink-0 items-baseline gap-3">
                <span className="text-xs text-muted">
                  {delta(c.pct, c.pctYesterday) ?? ''}
                </span>
                <span className="text-sm font-semibold">
                  {c.pct !== null ? `${c.pct}%` : '—'}
                </span>
              </span>
            </div>
          );
        })}
        {cities.length === 0 && (
          <p className="bg-surface px-5 py-6 text-sm text-muted">
            Пока мало свежих отметок — индекс появится, когда водители начнут
            отмечать ситуацию.
          </p>
        )}
      </div>

      <h2 className="mt-10 text-xl font-semibold">Пост дня для соцсетей</h2>
      <p className="mt-1 text-sm text-muted">
        Готовый текст — скопируйте в Telegram, MAX и ВКонтакте.
      </p>
      <pre className="mt-3 whitespace-pre-wrap rounded-2xl border border-border bg-surface-2/60 p-5 text-sm">
        {post}
      </pre>

      <p className="mt-10 text-xs text-muted">
        Методика: учитываются заправки, по которым за последние 24 часа есть
        отметки водителей; «с топливом» = есть/мало/очередь, «без топлива» =
        нет/закрыта. Изменение — к такому же расчёту за предыдущие сутки.
        Города с менее чем 8 отмеченными заправками не показываются.
      </p>
    </div>
  );
}
