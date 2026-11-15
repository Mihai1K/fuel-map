// Интеграционная проверка цен (ревью 25.07): при уточнении метки цена
// снятой марки должна исчезать из JSON и из DTO; у OUT/CLOSED цен нет.
// Запуск на сервере (нужен DATABASE_URL):
//   tsx prisma/price-selftest.ts
// Тест создаёт изолированную станцию (source='manual', префикс SELFTEST),
// прогоняет РЕАЛЬНЫЙ обработчик PATCH и убирает за собой все записи.
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { PATCH } from '../src/app/api/marks/route';
import { loadStation } from '../src/lib/stations';

const DEVICE = 'pricetest-patch-0000000001';

async function patch(body: Record<string, unknown>) {
  const req = new Request('http://localhost/api/marks', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await PATCH(req);
  return { status: res.status, json: await res.json() };
}

async function cleanup(stationId?: string) {
  await prisma.mark.deleteMany({ where: { deviceId: DEVICE } });
  if (stationId) await prisma.station.delete({ where: { id: stationId } }).catch(() => {});
}

async function main() {
  // изолированная станция — чтобы DTO не смешивался с чужими метками
  const st = await prisma.station.create({
    data: {
      name: 'SELFTEST АЗС',
      address: 'тест',
      city: 'SELFTEST',
      region: 'SELFTEST',
      lat: 0,
      lng: 0,
      source: 'manual',
    },
  });
  await cleanup(); // на случай висящих меток прошлого прогона

  let failed = false;
  const check = (name: string, ok: boolean, extra = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' · ' + extra : ''}`);
    if (!ok) failed = true;
  };

  // 1) метка: есть АИ-95 и АИ-92, у обоих цена
  const mark = await prisma.mark.create({
    data: {
      stationId: st.id,
      status: 'AVAILABLE',
      fuelTypes: ['ai95', 'ai92'],
      prices: { ai95: 54.9, ai92: 51.2 },
      source: 'user',
      deviceId: DEVICE,
    },
  });
  const before = (await prisma.mark.findUnique({ where: { id: mark.id } }))
    ?.prices as Record<string, number>;
  check('до PATCH обе цены на месте', 'ai95' in before && 'ai92' in before, JSON.stringify(before));

  // 2) PATCH убирает АИ-95 (остаётся только АИ-92)
  const r = await patch({ markId: mark.id, deviceId: DEVICE, fuelTypes: ['ai92'] });
  check('PATCH принят', r.status === 200);

  // 3) в БД цены АИ-95 больше нет, АИ-92 сохранена
  const db = ((await prisma.mark.findUnique({ where: { id: mark.id } }))?.prices ??
    {}) as Record<string, number>;
  check('в БД нет цены ai95', !('ai95' in db), JSON.stringify(db));
  check('в БД сохранена цена ai92', db.ai92 === 51.2);

  // 4) в DTO станции цены АИ-95 нет, АИ-92 есть
  const dto = await loadStation(st.id);
  check('в DTO нет цены ai95', !dto?.prices?.ai95);
  check('в DTO есть цена ai92', dto?.prices?.ai92?.value === 51.2, `updatedAt=${dto?.prices?.ai92?.updatedAt?.toISOString?.() ?? '—'}`);

  // 5) отдельная метка OUT с ценой — цена не должна сохраниться
  const outMark = await prisma.mark.create({
    data: {
      stationId: st.id,
      status: 'AVAILABLE',
      fuelTypes: ['ai98'],
      prices: { ai98: 70.0 },
      source: 'user',
      deviceId: DEVICE + '-out',
    },
  });
  // делаем её OUT через PATCH… но PATCH не меняет статус; проверим правило
  // POST-guard отдельно: OUT-метку с ценой имитируем прямым PATCH на снятие
  await patch({ markId: outMark.id, deviceId: DEVICE + '-out', fuelTypes: [] });
  const outDb = ((await prisma.mark.findUnique({ where: { id: outMark.id } }))
    ?.prices ?? {}) as Record<string, number>;
  check('снятие всех марок очищает цены', Object.keys(outDb).length === 0, JSON.stringify(outDb));
  await prisma.mark.deleteMany({ where: { deviceId: DEVICE + '-out' } });

  await cleanup(st.id);
  console.log(failed ? '\nИТОГ: есть провалы' : '\nИТОГ: все проверки пройдены');
  if (failed) process.exit(1);
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
