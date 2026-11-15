// Проверка таблицы брендов (src/lib/brands.ts) ПРОТИВ РЕАЛЬНЫХ ДАННЫХ.
//
// Зачем: первая версия таблицы была списана с BRAND_MAP импортёра
// (scripts/import-osm.ts), а не с содержимого базы. Две записи — «ТАИФ»
// и «Иркутскнефтепродукт» — не совпадали ни с одной станцией: в базе
// лежит «ТАИФ-НК». Ошибка не видна ни типами, ни линтером, ни глазами:
// пины просто молча рисуются без знака. Этот скрипт делает её измеримой.
//
// Что печатает:
//   1) покрытие: сколько АЗС получают фирменный знак, в % от станций с сетью;
//   2) мёртвые ключи BRANDS — те, под которые нет ни одной станции;
//   3) топ непокрытых сетей — кандидаты на добавление.
//
// Запуск: DATABASE_URL=... npx tsx scripts/brand-coverage.ts
// Код возврата 1, если есть мёртвые ключи — годится для CI.
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { BRANDS, brandOf } from '../src/lib/brands';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// Не бренды: OSM кладёт в brand/operator служебные пометки и юрлица.
// ВНИМАНИЕ на \b: в JS граница слова определяется по ASCII-классу \w, куда
// кириллица не входит. Поэтому /^АЗС\b/ НЕ совпадает со строкой «АЗС», и
// первая версия фильтра молча пропускала «АЗС», «АГЗС», «ООО …», «ЗАО …»
// в список кандидатов на бренд. Вместо \b — явный lookahead на пробел,
// конец строки или кавычку.
const NOT_A_BRAND =
  /^(?:independent|азс|агзс|ооо|зао|оао|пао|ип|общество)(?=\s|$|["«])/iu;

async function main() {
  const rows = await prisma.station.groupBy({
    by: ['network'],
    _count: { _all: true },
    orderBy: { _count: { network: 'desc' } },
  });

  let total = 0;
  let withNetwork = 0;
  let covered = 0;
  const hits = new Map<string, number>();
  const uncovered: { network: string; count: number }[] = [];

  for (const r of rows) {
    const n = r._count._all;
    total += n;
    if (!r.network) continue;
    withNetwork += n;
    const b = brandOf(r.network);
    if (b) {
      covered += n;
      // считаем попадания по ЗНАКУ: так алиасы складываются с основным ключом
      hits.set(b.mark, (hits.get(b.mark) ?? 0) + n);
    } else if (!NOT_A_BRAND.test(r.network)) {
      uncovered.push({ network: r.network, count: n });
    }
  }

  const pct = (a: number, b: number) => ((a / b) * 100).toFixed(1);
  console.log('=== покрытие фирменными знаками ===');
  console.log(`станций всего:            ${total}`);
  console.log(`из них с указанной сетью: ${withNetwork} (${pct(withNetwork, total)}% от всех)`);
  console.log(`получают знак:            ${covered} (${pct(covered, withNetwork)}% от станций с сетью)`);

  const dead = Object.entries(BRANDS)
    .filter(([, b]) => !hits.has(b.mark))
    .map(([k]) => k);
  console.log('\n=== мёртвые ключи BRANDS (нет ни одной станции) ===');
  console.log(dead.length ? dead.join(', ') : 'нет — все ключи совпадают с данными');

  console.log('\n=== топ непокрытых сетей (кандидаты) ===');
  for (const u of uncovered.slice(0, 15)) {
    console.log(`${String(u.count).padStart(5)}  ${u.network}`);
  }

  await prisma.$disconnect();
  if (dead.length) process.exit(1);
}

void main();
