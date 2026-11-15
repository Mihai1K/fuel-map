import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { listNovosti } from '@/lib/novosti';
import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Новости о дефиците топлива в России · Тут Бензин',
  description:
    'Что происходит с бензином в регионах России: лимиты, очереди, ограничения отпуска — по данным крупных СМИ, с ссылками на карту наличия топлива.',
  alternates: { canonical: `${SITE_URL}/novosti` },
};

export default function NovostiIndex() {
  const articles = listNovosti();

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-semibold">
          Тут Бензин
        </Link>
        <Link
          href="/map"
          className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-press"
        >
          Где есть бензин
        </Link>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-16 pt-10">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Новости о дефиците топлива
        </h1>
        <p className="mt-3 text-muted">
          Разбираем сообщения крупных СМИ о лимитах и очередях на АЗС по
          городам — и сразу показываем, где искать бензин прямо сейчас.
        </p>

        {articles.length === 0 ? (
          <p className="mt-10 text-sm text-muted">
            Пока нет опубликованных материалов. Актуальную картину по
            городам смотрите на{' '}
            <Link href="/" className="text-primary hover:underline">
              главной
            </Link>
            .
          </p>
        ) : (
          <div className="mt-8 space-y-3">
            {articles.map((a) => (
              <Link
                key={a.slug}
                href={`/novosti/${a.slug}`}
                className="group flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-5 transition-colors hover:bg-surface-2"
              >
                <div>
                  <p className="font-semibold">{a.title}</p>
                  <p className="mt-1 text-sm text-muted">{a.description}</p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
