// Чистые проверки пофуельной модели цен (ревью 25.07) — без БД.
// Запуск: tsx prisma/price-logic-test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeState, type MarkLite } from '../src/lib/status';

const NOW = new Date('2026-07-25T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

function mk(p: Partial<MarkLite>): MarkLite {
  return {
    status: 'AVAILABLE',
    fuelTypes: ['ai95'],
    queueSize: null,
    source: 'user',
    createdAt: ago(10),
    ...p,
  } as MarkLite;
}

test('у каждой марки своё время и значение', () => {
  const s = computeState(
    [
      mk({ fuelTypes: ['ai95'], prices: { ai95: 55 }, createdAt: ago(30), deviceId: 'a' }),
      mk({ fuelTypes: ['ai92'], prices: { ai92: 51 }, createdAt: ago(600), deviceId: 'b' }),
    ],
    NOW
  );
  assert.equal(s.prices?.ai95?.value, 55);
  assert.equal(s.prices?.ai92?.value, 51);
  assert.equal(s.prices!.ai95!.updatedAt.getTime(), ago(30).getTime());
  assert.equal(s.prices!.ai92!.updatedAt.getTime(), ago(600).getTime());
});

test('до 24 ч — fresh, 24–48 ч — aging, старше 48 ч — не показываем', () => {
  assert.equal(
    computeState([mk({ prices: { ai95: 55 }, createdAt: ago(60), deviceId: 'a' })], NOW)
      .prices?.ai95?.freshness,
    'fresh'
  );
  assert.equal(
    computeState([mk({ prices: { ai95: 55 }, createdAt: ago(30 * 60), deviceId: 'a' })], NOW)
      .prices?.ai95?.freshness,
    'aging'
  );
  assert.equal(
    computeState([mk({ prices: { ai95: 55 }, createdAt: ago(49 * 60), deviceId: 'a' })], NOW)
      .prices,
    null
  );
});

test('подтверждения считаются по разным устройствам', () => {
  const p = computeState(
    [
      mk({ prices: { ai95: 55 }, createdAt: ago(10), deviceId: 'a' }),
      mk({ prices: { ai95: 55.2 }, createdAt: ago(20), deviceId: 'b' }),
      mk({ prices: { ai95: 55.1 }, createdAt: ago(30), deviceId: 'a' }),
    ],
    NOW
  ).prices?.ai95;
  assert.equal(p?.confirmations, 2);
  assert.equal(p?.confirmed, true);
});

test('одна отметка — цена не подтверждена', () => {
  const p = computeState([mk({ prices: { ai95: 55 }, deviceId: 'a' })], NOW).prices?.ai95;
  assert.equal(p?.confirmations, 1);
  assert.equal(p?.confirmed, false);
});

test('аномальное отклонение помечается needsConfirm', () => {
  const p = computeState(
    [
      mk({ prices: { ai95: 90 }, createdAt: ago(5), deviceId: 'a' }),
      mk({ prices: { ai95: 55 }, createdAt: ago(20), deviceId: 'b' }),
      mk({ prices: { ai95: 56 }, createdAt: ago(30), deviceId: 'c' }),
    ],
    NOW
  ).prices?.ai95;
  assert.equal(p?.needsConfirm, true);
});

test('seed никогда не участвует в цене', () => {
  assert.equal(
    computeState([mk({ prices: { ai95: 55 }, source: 'seed', deviceId: 'a' })], NOW).prices,
    null
  );
});

test('цена только для имеющейся марки: OUT-топливо игнорируется', () => {
  assert.equal(
    computeState(
      [mk({ status: 'OUT', fuelTypes: [], fuelsOut: ['ai95'], prices: { ai95: 55 }, deviceId: 'a' })],
      NOW
    ).prices,
    null
  );
});

test('цена не засчитывается марке, которой нет в fuelTypes метки', () => {
  // метка про наличие ai95, но в prices затесался ai92 (нет в fuelTypes)
  const s = computeState(
    [mk({ fuelTypes: ['ai95'], prices: { ai95: 55, ai92: 40 }, deviceId: 'a' })],
    NOW
  );
  assert.equal(s.prices?.ai95?.value, 55);
  assert.equal(s.prices?.ai92, undefined);
});

// --- Противоречия в отметках (плашка в карточке, разбор ГдеБенз 15.09) ---

test('переход через группу «есть»/«нет» — это противоречие', () => {
  const s = computeState(
    [
      mk({ status: 'AVAILABLE', createdAt: ago(30), deviceId: 'a' }),
      mk({ status: 'OUT', createdAt: ago(600), deviceId: 'b' }),
    ],
    NOW
  );
  assert.equal(s.status, 'AVAILABLE');
  assert.equal(s.dispute?.status, 'OUT');
  assert.equal(s.dispute?.count, 1);
  assert.equal(s.dispute?.at.getTime(), ago(600).getTime());
});

test('разница внутри группы «есть» противоречием не считается', () => {
  const s = computeState(
    [
      mk({ status: 'AVAILABLE', createdAt: ago(30), deviceId: 'a' }),
      mk({ status: 'QUEUE', createdAt: ago(120), deviceId: 'b' }),
    ],
    NOW
  );
  assert.equal(s.dispute, null);
});

test('противоречия старше суток не показываем', () => {
  const s = computeState(
    [
      mk({ status: 'AVAILABLE', createdAt: ago(30), deviceId: 'a' }),
      mk({ status: 'OUT', createdAt: ago(2000), deviceId: 'b' }),
    ],
    NOW
  );
  assert.equal(s.dispute, null);
});

test('несколько расходящихся отметок считаются, берётся самая свежая', () => {
  const s = computeState(
    [
      mk({ status: 'OUT', createdAt: ago(20), deviceId: 'a' }),
      mk({ status: 'AVAILABLE', createdAt: ago(200), deviceId: 'b' }),
      mk({ status: 'AVAILABLE', createdAt: ago(400), deviceId: 'c' }),
    ],
    NOW
  );
  assert.equal(s.status, 'OUT');
  assert.equal(s.dispute?.count, 2);
  assert.equal(s.dispute?.at.getTime(), ago(200).getTime());
});

test('без отметок противоречия нет', () => {
  assert.equal(computeState([], NOW).dispute, null);
});
