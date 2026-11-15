import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, MapPin } from 'lucide-react';
import { CITIES } from '@/lib/cities';
import { loadStations } from '@/lib/stations';
import { SITE_URL } from '@/lib/site';
import { pluralRu } from '@/lib/status';

// «Бензин на М4/трассе» — высокочастотный запрос без города. Не строим
// геопривязку к линии трассы (нет данных о расстоянии до дороги в OSM-
// импорте) — честно берём города вдоль М-4 «Дон», которые уже есть на
// карте, от Москвы до Краснодара (решение владельца, 05.09.2026).
export const dynamic = 'force-dynamic';

const ROUTE_SLUGS = ['moskva', 'tula', 'voronezh', 'rostov', 'krasnodar'];

export const metadata: Metadata = {
  title: 'Где есть бензин на трассе М-4 «Дон» — карта АЗС по городам | Тут Бензин',
  description:
    'Наличие бензина на заправках вдоль М-4 «Дон»: Москва, Тула, Воронеж, Ростов-на-Дону, Краснодар. Отметки водителей в реальном времени, без регистрации.',
  alternates: { canonical: `${SITE_URL}/trassa/m4` },
};

export default async function TrassaM4Page() {
  const cities = ROUTE_SLUGS.map((slug) => CITIES.find((c) => c.slug === slug)).filter(
    (c): c is NonNullable<typeof c> => Boolean(c)
  );

  const stats = await Promise.all(
    cities.map(async (city) => {
      const stations = await loadStations(city.name);
      const live = stations.filter(
        (s) => s.status === 'AVAILABLE' || s.status === 'LOW' || s.status === 'QUEUE'
      );
      return { city, total: stations.length, live: live.length };
    })
  );

  const totalStations = stats.reduce((sum, s) => sum + s.total, 0);
  const totalLive = stats.reduce((sum, s) => sum + s.live, 0);

  const faq = [
    {
      q: 'Какие города входят в маршрут М-4 «Дон» на карте?',
      a: 'Москва, Тула, Воронеж, Ростов-на-Дону и Краснодар — крупные города вдоль трассы, где есть отметки водителей о наличии топлива.',
    },
    {
      q: 'Учитываются ли заправки только у самой трассы?',
      a: 'Нет, показаны все заправки города по отметкам водителей — привязки к конкретному километру трассы пока нет. Открывайте карту нужного города, чтобы увидеть станции ближе к вашему участку.',
    },
    {
      q: 'Как часто обновляются данные?',
      a: 'Статус вычисляется из отметок водителей за последние часы — у каждой заправки видно время последней отметки.',
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
          href="/map"
          className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-press"
        >
          Где есть бензин
        </Link>
      </header>

      <h1 className="mt-10 text-3xl font-semibold leading-tight sm:text-4xl">
        Где есть бензин на трассе М-4 «Дон»
      </h1>
      <p className="mt-3 text-lg text-muted">
        {totalLive} {pluralRu(totalLive, 'заправка', 'заправки', 'заправок')} с
        топливом по отметкам водителей вдоль маршрута, всего на карте —{' '}
        {totalStations}.
      </p>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Города по маршруту</h2>
        <div className="mt-4 space-y-2">
          {stats.map(({ city, total, live }) => (
            <Link
              key={city.slug}
              href={`/gorod/${city.slug}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 transition-colors hover:bg-surface-2"
            >
              <div>
                <p className="font-medium">{city.name}</p>
                <p className="mt-0.5 text-sm text-muted">
                  {live} из {total}{' '}
                  {pluralRu(total, 'заправка', 'заправки', 'заправок')} с топливом
                </p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-muted" />
            </Link>
          ))}
        </div>
      </section>

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

      <p className="mt-10 text-xs text-muted">
        Данные — отметки самих водителей, у каждой видно время. Проверяйте
        на месте.
      </p>
    </div>
  );
}
