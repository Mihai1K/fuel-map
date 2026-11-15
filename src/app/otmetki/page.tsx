import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { FUEL_LABEL, STATUS_META, freshness } from '@/lib/status';
import { SITE_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Последние отметки водителей — Тут Бензин',
  description:
    'Живая лента: водители прямо сейчас отмечают, где есть бензин, очереди и лимиты на заправках России.',
  alternates: { canonical: `${SITE_URL}/otmetki` },
};

export default async function OtmetkiPage() {
  const marks = await prisma.mark.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      status: true,
      fuelTypes: true,
      station: { select: { city: true, network: true, name: true } },
    },
  });

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/" className="text-sm text-muted hover:underline">
        ← Тут Бензин
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Последние отметки</h1>
      <p className="mt-2 text-sm text-muted">
        Водители отмечают ситуацию на заправках в реальном времени. Хотите
        помочь —{' '}
        <Link href="/map" className="font-medium text-primary hover:underline">
          откройте карту
        </Link>{' '}
        и подтвердите ситуацию на своей.
      </p>

      <ul className="mt-6 space-y-2">
        {marks.map((m) => {
          const meta = STATUS_META[m.status];
          const fuels = m.fuelTypes
            .map((f) => FUEL_LABEL[f] ?? f)
            .join(', ');
          return (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-5 py-3.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {m.station.city !== '—' ? `${m.station.city} · ` : ''}
                  {m.station.network ?? m.station.name}
                </p>
                <p className={`mt-0.5 text-sm font-medium ${meta.fg}`}>
                  {meta.label}
                  {fuels && m.status !== 'OUT' && m.status !== 'CLOSED'
                    ? ` · ${fuels}`
                    : ''}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted">
                {freshness(m.createdAt)}
              </span>
            </li>
          );
        })}
        {marks.length === 0 && (
          <li className="rounded-2xl border border-border bg-surface px-5 py-6 text-sm text-muted">
            Отметок пока нет — станьте первым на карте.
          </li>
        )}
      </ul>

      <Link
        href="/map"
        className="mt-8 block w-full rounded-2xl bg-primary px-6 py-3.5 text-center text-sm font-semibold text-white transition-colors hover:bg-primary-press"
      >
        Показать, где есть бензин
      </Link>
    </div>
  );
}
