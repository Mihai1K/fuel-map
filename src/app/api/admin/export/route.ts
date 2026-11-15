import { isAdmin } from '@/lib/admin-auth';
import { cities, daily, sources, type Filters } from '@/lib/admin-stats';

// Экспорт таблиц админки в CSV — только под сессией владельца
export async function GET(req: Request) {
  if (!(await isAdmin())) {
    return new Response('unauthorized', { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const what = params.get('what') ?? 'sources';
  const f: Filters = {
    days: [1, 7, 30].includes(Number(params.get('days')))
      ? Number(params.get('days'))
      : 7,
  };

  let rows: Record<string, unknown>[] = [];
  if (what === 'sources') rows = await sources(f);
  else if (what === 'cities') rows = await cities(f);
  else if (what === 'daily') rows = await daily(f);
  else return new Response('unknown table', { status: 400 });

  if (rows.length === 0) {
    return new Response('нет данных за период', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const csv = [
    headers.join(';'),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(';')),
  ].join('\n');

  // BOM — чтобы Excel открыл кириллицу без плясок
  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tytbenzin-${what}-${f.days}d.csv"`,
    },
  });
}
