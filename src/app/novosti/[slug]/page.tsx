import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, MapPin } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getNovosti, listNovosti } from '@/lib/novosti';
import { CITIES } from '@/lib/cities';
import { loadStations } from '@/lib/stations';
import { pluralRu } from '@/lib/status';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return listNovosti().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = getNovosti(slug);
  if (!article) return {};
  return {
    title: `${article.title} · Тут Бензин`,
    description: article.description,
    alternates: { canonical: `${SITE_URL}/novosti/${article.slug}` },
  };
}

export default async function NovostiArticle({ params }: Props) {
  const { slug } = await params;
  const article = getNovosti(slug);
  if (!article) notFound();

  const city = article.citySlug
    ? CITIES.find((c) => c.slug === article.citySlug)
    : null;
  const live = city ? await loadStations(city.name) : null;
  const liveCount = live?.filter(
    (s) => s.status === 'AVAILABLE' || s.status === 'LOW' || s.status === 'QUEUE'
  ).length;

  const faqJsonLd = article.faq
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: article.faq.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      }
    : null;

  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-6 py-10">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-xl bg-primary text-white">
            <MapPin className="size-4" />
          </span>
          <span className="font-semibold">Тут Бензин</span>
        </Link>
        <Link
          href={city ? `/map?city=${city.slug}` : '/map'}
          className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-press"
        >
          Где есть бензин
        </Link>
      </header>

      <p className="mt-8 text-xs text-muted">
        {new Date(article.publishedAt).toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      </p>
      <h1 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">
        {article.title}
      </h1>

      {city && live && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm">
            Прямо сейчас в {city.name}:{' '}
            <strong>
              {liveCount} {pluralRu(liveCount ?? 0, 'заправка', 'заправки', 'заправок')}
            </strong>{' '}
            с топливом по отметкам водителей, всего на карте — {live.length}.
          </p>
          <Link
            href={`/gorod/${city.slug}`}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Смотреть карту {city.name}
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}

      <div className="prose prose-neutral mt-8 max-w-none dark:prose-invert">
        {article.body.map((p, i) => (
          <p key={i} className="mt-4 leading-relaxed text-text first:mt-0">
            {p}
          </p>
        ))}
      </div>

      {article.faq && article.faq.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold">Частые вопросы</h2>
          <div className="mt-4 space-y-2">
            {article.faq.map((f) => (
              <details
                key={f.q}
                className="rounded-2xl border border-border bg-surface p-4"
              >
                <summary className="cursor-pointer font-medium">{f.q}</summary>
                <p className="mt-3 text-sm text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 border-t border-border pt-6">
        <p className="text-xs font-medium text-muted">Источники</p>
        <ul className="mt-2 space-y-1">
          {article.sources.map((s) => (
            <li key={s.url}>
              <a
                href={s.url}
                target="_blank"
                rel="noopener nofollow"
                className="text-xs text-primary hover:underline"
              >
                {s.name}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <Link
        href="/novosti"
        className="mt-10 inline-block text-sm font-medium text-primary hover:underline"
      >
        ← Все новости
      </Link>

      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}
    </div>
  );
}
