import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, MapPin } from 'lucide-react';
import { notFound } from 'next/navigation';
import { CITIES } from '@/lib/cities';
import { FUEL_INFO } from '@/lib/seo-pilot';
import { loadIndexableFuelsForCity, loadStations } from '@/lib/stations';
import { listNovostiByCity } from '@/lib/novosti';
import { SITE_URL } from '@/lib/site';
import { STATUS_META, freshness, pluralRu, type StatusCode } from '@/lib/status';

// SEO-страницы городов: «где есть бензин в <городе>» — главный запрос.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return CITIES.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const city = CITIES.find((c) => c.slug === slug);
  if (!city) return {};
  return {
    title: `Где есть бензин в городе ${city.name} сегодня — живая карта заправок · Тут Бензин`,
    description: `Заправки города ${city.name} с бензином прямо сейчас: 92, 95, ДТ. Водители отмечают наличие топлива, очереди и лимиты. Без регистрации.`,
    alternates: { canonical: `${SITE_URL}/gorod/${city.slug}` },
  };
}

export default async function CityPage({ params }: Props) {
  const { slug } = await params;
  const city = CITIES.find((c) => c.slug === slug);
  if (!city) notFound();

  const stations = await loadStations(city.name);
  const live = stations.filter(
    (s) => s.status === 'AVAILABLE' || s.status === 'LOW' || s.status === 'QUEUE'
  );
  const recent = stations
    .filter((s) => s.updatedAt)
    .sort((a, b) => (b.updatedAt!.getTime() - a.updatedAt!.getTime()))
    .slice(0, 6);
  const cityFuels = await loadIndexableFuelsForCity(city.name);
  const cityNews = listNovostiByCity(city.slug);

  const faq = [
    {
      q: `Где сейчас есть бензин в городе ${city.name}?`,
      a: 'Смотрите карту выше или список последних отметок ниже — зелёные и жёлтые статусы значат, что топливо по свежим данным есть.',
    },
    {
      q: `Как узнать, есть ли бензин на конкретной АЗС в ${city.name}?`,
      a: 'Откройте карточку станции на карте — там время последней отметки, кто и что видел, и история за сутки.',
    },
    {
      q: 'Насколько свежие данные?',
      a: 'Метка живёт 3 часа, дальше статус честно становится «нет свежих данных», а не остаётся зелёным. Возраст каждой отметки виден крупно.',
    },
    {
      q: 'Можно ли самому сообщить о наличии топлива?',
      a: 'Да, без регистрации: откройте станцию на карте и отметьте статус — есть, мало, очередь или нет. Это занимает около 10 секунд.',
    },
  ];

  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-6 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faq.map((f) => ({
              '@type': 'Question',
              name: f.q,
              acceptedAnswer: { '@type': 'Answer', text: f.a },
            })),
          }),
        }}
      />

      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-xl bg-primary text-white">
            <MapPin className="size-4" />
          </span>
          <span className="font-semibold">Тут Бензин</span>
        </Link>
        <Link
          href={`/map?city=${city.slug}`}
          className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-press"
        >
          Где есть бензин
        </Link>
      </header>

      <h1 className="mt-10 text-3xl font-semibold leading-tight sm:text-4xl">
        Где есть бензин в городе {city.name} — сейчас
      </h1>
      <p className="mt-3 text-muted">
        {live.length > 0
          ? `${live.length} ${pluralRu(live.length, 'заправка', 'заправки', 'заправок')} с топливом по отметкам водителей. Всего на карте — ${stations.length}.`
          : `На карте ${stations.length} ${pluralRu(stations.length, 'заправка', 'заправки', 'заправок')} города. Свежих отметок пока нет — станьте первым.`}
        {city.alertNote ? ` Ситуация в регионе: ${city.alertNote}.` : ''}
      </p>

      <Link
        href={`/map?city=${city.slug}`}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-base font-semibold text-white transition-colors hover:bg-primary-press sm:w-auto sm:px-8"
      >
        Показать, где есть бензин
        <ArrowRight className="size-5" />
      </Link>

      {recent.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold">Последние отметки</h2>
          <div className="mt-4 overflow-hidden rounded-2xl border border-border">
            {recent.map((s) => {
              const meta = STATUS_META[s.status as StatusCode];
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 last:border-b-0"
                >
                  <span className="flex min-w-0 items-center gap-2.5 text-sm">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: meta.color }}
                    />
                    <span className="truncate">
                      {s.network ?? s.name} — {meta.label.toLowerCase()}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {freshness(s.updatedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-10 space-y-3 text-sm text-muted">
        <h2 className="text-xl font-semibold text-text">
          Как найти бензин в городе {city.name}
        </h2>
        <p>
          «Тут Бензин» — живая карта заправок: водители отмечают, где есть
          топливо (92, 95, 98, 100, ДТ, газ), какая очередь в минутах и
          какие лимиты отпуска действуют. Отметки видны всем сразу, без
          регистрации и приложений.
        </p>
        <p>
          Откройте карту, выберите нужную марку топлива — и сервис покажет
          ближайшую работающую заправку и построит маршрут в Яндекс Картах
          или 2ГИС.
        </p>
      </section>

      {cityNews.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold">Новости о топливе в {city.name}</h2>
          <div className="mt-4 space-y-2">
            {cityNews.map((a) => (
              <Link
                key={a.slug}
                href={`/novosti/${a.slug}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0 truncate text-sm font-medium">{a.title}</span>
                <ArrowRight className="size-4 shrink-0 text-muted" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Частые вопросы</h2>
        <dl className="mt-4 space-y-4">
          {faq.map((f) => (
            <div key={f.q} className="rounded-2xl border border-border p-4">
              <dt className="font-medium">{f.q}</dt>
              <dd className="mt-1.5 text-sm text-muted">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-10">
        {cityFuels.length > 0 && (
          <>
            <h2 className="text-sm font-semibold text-muted">По маркам топлива</h2>
            <div className="mb-4 mt-3 flex flex-wrap gap-2">
              {cityFuels.map((f) => (
                <Link
                  key={f}
                  href={`/gorod/${city.slug}/${f}`}
                  className="rounded-xl border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2"
                >
                  Где есть {FUEL_INFO[f].short} в городе {city.name}
                </Link>
              ))}
            </div>
          </>
        )}
        <h2 className="text-sm font-semibold text-muted">Другие города</h2>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {CITIES.filter((c) => c.slug !== city.slug).map((c) => (
            <Link
              key={c.slug}
              href={`/gorod/${c.slug}`}
              className="text-primary hover:underline"
            >
              {c.name}
            </Link>
          ))}
        </p>
      </section>

      <footer className="mt-12 text-xs text-muted">
        Данные — отметки самих водителей. Проверяйте на месте.
      </footer>
    </div>
  );
}
