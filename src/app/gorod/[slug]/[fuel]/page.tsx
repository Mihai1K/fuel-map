import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, MapPin, Navigation } from 'lucide-react';
import { notFound } from 'next/navigation';
import { CITIES } from '@/lib/cities';
import {
  isFuelPageIndexable,
  loadFuelPageData,
  loadIndexableFuelsForCity,
} from '@/lib/stations';
import { SITE_URL } from '@/lib/site';
import { freshness, pluralRu } from '@/lib/status';
import { FUEL_INFO, type FuelSlug } from '@/lib/seo-pilot';

// SEO-сетка «топливо × город»: индексируется только то, что прошло
// гейт по реальным данным (см. isFuelPageIndexable в lib/stations.ts).
// Данные в контенте — ТОЛЬКО реальные отметки водителей (source=user).
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string; fuel: string }> };

const STATUS_RU: Record<string, string> = {
  AVAILABLE: 'есть',
  LOW: 'мало',
  QUEUE: 'очередь',
  OUT: 'нет',
  CLOSED: 'закрыта',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, fuel } = await params;
  const city = CITIES.find((c) => c.slug === slug);
  const info = FUEL_INFO[fuel as FuelSlug];
  if (!city || !info) return {};
  const indexable = await isFuelPageIndexable(city.name, info.code);
  return {
    // короткий Title без «живая»/«по отметкам» — реальных отметок может
    // не быть (правка консультанта, 20.07)
    title: `Где заправить ${info.short} в городе ${city.name} — карта АЗС | Тут Бензин`,
    description: `Карта АЗС города ${city.name}: где искать ${info.genitive}, статусы заправок и время обновления отметок. Бесплатно, без регистрации.`,
    alternates: { canonical: `${SITE_URL}/gorod/${slug}/${fuel}` },
    // не прошла гейт по данным — страница доступна, но не индексируется
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function CityFuelPage({ params }: Props) {
  const { slug, fuel } = await params;
  const city = CITIES.find((c) => c.slug === slug);
  const info = FUEL_INFO[fuel as FuelSlug];
  if (!city || !info) notFound();

  const data = await loadFuelPageData(city.name, info.code);
  if (data.totalStations === 0) notFound();

  const now = new Date().getTime();
  const fresh = data.userMarked.filter(
    (s) => now - s.markedAt.getTime() < 24 * 60 * 60_000
  );
  const available = data.userMarked.filter(
    (s) => s.status === 'AVAILABLE' || s.status === 'LOW' || s.status === 'QUEUE'
  );

  const faq = [
    {
      q: 'Откуда данные о наличии топлива?',
      a: 'Статусы заправок отмечают сами водители — бесплатно и без регистрации. У каждой отметки видно время, когда её оставили.',
    },
    {
      q: 'Насколько можно доверять отметкам?',
      a: 'Отметка — личное наблюдение водителя на конкретной АЗС. Чем она свежее и чем больше подтверждений, тем надёжнее. Устаревшие отметки честно помечаются, свежие выделяются на карте.',
    },
    {
      q: 'Как оставить свою отметку?',
      a: 'Откройте карту, нажмите на заправку и выберите статус: есть топливо, мало, очередь или нет. Это занимает около 10 секунд.',
    },
    {
      q: 'Что означает статус «мало»?',
      a: 'Водитель видел, что топливо на АЗС есть, но заканчивается или продаётся с ограничениями по литрам.',
    },
    {
      q: 'Почему отметки устаревают?',
      a: `Ситуация на заправках меняется за часы: ${info.label} может закончиться или появиться. Поэтому мы показываем время каждой отметки, а старые данные помечаем отдельно.`,
    },
  ];

  const cityFuels = await loadIndexableFuelsForCity(city.name);
  const otherFuels = cityFuels.filter((f) => f !== fuel);
  // Соседние города того же региона — дешевле и релевантнее, чем
  // проверять индексируемость этой марки во всех 46 городах на каждый рендер.
  const otherCities = CITIES.filter(
    (c) => c.slug !== city.slug && c.region === city.region
  ).slice(0, 5);

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
          href={`/map?city=${city.slug}&fuel=${info.code}`}
          className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-press"
        >
          Открыть карту
        </Link>
      </header>

      <h1 className="mt-10 text-3xl font-semibold leading-tight sm:text-4xl">
        Где есть {info.label} в городе {city.name}
      </h1>
      <p className="mt-3 text-lg text-muted">
        {data.totalStations}{' '}
        {pluralRu(data.totalStations, 'заправка', 'заправки', 'заправок')}{' '}
        города на карте.{' '}
        {fresh.length > 0 ? (
          <>
            {available.length > 0 && (
              <>
                {available.length}{' '}
                {pluralRu(available.length, 'АЗС', 'АЗС', 'АЗС')} с {info.short}{' '}
                по свежим отметкам водителей,{' '}
              </>
            )}
            последняя отметка — {freshness(data.lastUserMarkAt)}.
          </>
        ) : data.userMarked.length > 0 ? (
          <>
            За последние сутки свежих отметок о наличии {info.genitive} нет;
            последняя отметка водителя — {freshness(data.lastUserMarkAt)}
            {' '}(список ниже). Проезжаете заправку? Обновите ситуацию —
            это займёт 10 секунд.
          </>
        ) : (
          <>
            Свежих отметок водителей о наличии {info.genitive} пока нет —
            проезжаете заправку? Отметьте первым, это займёт 10 секунд.
          </>
        )}
      </p>

      <Link
        href={`/map?city=${city.slug}&fuel=${info.code}`}
        className="mt-6 flex w-fit items-center gap-2 rounded-2xl bg-primary px-6 py-3.5 font-semibold text-white transition-colors hover:bg-primary-press"
      >
        Открыть карту с фильтром {info.short}
        <ArrowRight className="size-4" />
      </Link>

      {data.userMarked.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold">
            АЗС с отметками водителей по {info.short}
          </h2>
          <ul className="mt-4 space-y-2">
            {data.userMarked.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.network ?? s.name}</p>
                  <p className="truncate text-sm text-muted">{s.address}</p>
                  <p className="mt-0.5 text-sm">
                    {info.short}: <b>{STATUS_RU[s.status] ?? s.status}</b>
                    {s.price != null && <> · {s.price.toFixed(1)} ₽/л</>}{' '}
                    <span className="text-muted">
                      · отметка {freshness(s.markedAt)}
                    </span>
                  </p>
                </div>
                <a
                  href={`https://yandex.ru/maps/?rtext=~${s.lat},${s.lng}&rtt=auto`}
                  target="_blank"
                  rel="noopener"
                  aria-label={`Маршрут: ${s.network ?? s.name}`}
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
                >
                  <Navigation className="size-4" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.userMarked.length === 0 && data.topNoData.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold">Крупные АЗС города</h2>
          <p className="mt-1 text-sm text-muted">
            Свежих отметок о наличии {info.genitive} на этих заправках пока нет —
            статус можно уточнить на карте или отметить самому.
          </p>
          <ul className="mt-4 space-y-2">
            {data.topNoData.slice(0, 8).map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{s.network ?? s.name}</p>
                  <p className="truncate text-sm text-muted">{s.address}</p>
                </div>
                <a
                  href={`https://yandex.ru/maps/?rtext=~${s.lat},${s.lng}&rtt=auto`}
                  target="_blank"
                  rel="noopener"
                  aria-label={`Маршрут: ${s.network ?? s.name}`}
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
                >
                  <Navigation className="size-4" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.networks.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold">Сети АЗС в городе</h2>
          <p className="mt-2 text-muted">
            {data.networks
              .map((n) => `${n.name} (${n.count})`)
              .join(' · ')}
          </p>
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

      <section className="mt-10 border-t border-border pt-6">
        <h2 className="text-sm font-semibold text-muted">Смотрите также</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/gorod/${city.slug}`}
            className="rounded-xl border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2"
          >
            Все заправки: {city.name}
          </Link>
          {otherFuels.map((f) => (
            <Link
              key={f}
              href={`/gorod/${city.slug}/${f}`}
              className="rounded-xl border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2"
            >
              {FUEL_INFO[f].short} в городе {city.name}
            </Link>
          ))}
          {otherCities.map((c) => (
            <Link
              key={c.slug}
              href={`/gorod/${c.slug}`}
              className="rounded-xl border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2"
            >
              Заправки: {c.name}
            </Link>
          ))}
          <Link
            href="/indeks"
            className="rounded-xl border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2"
          >
            Индекс топлива России
          </Link>
        </div>
      </section>

      <p className="mt-10 text-xs text-muted">
        Данные — отметки самих водителей, у каждой видно время. Проверяйте
        на месте.
      </p>
    </div>
  );
}
