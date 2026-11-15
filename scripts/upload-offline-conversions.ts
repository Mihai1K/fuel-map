// Серверные (оффлайн) конверсии в Яндекс Метрику по yclid.
// Проблема: клиентский тег Метрики до «Принимаю» отключён (ФЗ-152), плюс
// часть отметок теряется на переходах → Директ не видит реальных действий
// и оптимизирует «клики», а не отметки. Решение: берём события
// `mark_completed` из своей БД, находим yclid клика Директа (сохранён
// в AnalyticsSession) и грузим конверсию в Метрику напрямую по API.
// Дедуп — таблица OfflineConversion (одну отметку не шлём дважды).
//
// ВАЖНО про согласие: обходится клиентский ТЕГ, а не согласие пользователя.
// Источник — AnalyticsEvent, а src/lib/track.ts не пишет ни одного события
// без «Принимаю» (getConsent() !== 'granted' → return). То есть наружу
// уходят только данные тех, кто согласие дал. См. privacy/page.tsx.
//
// Запуск (на сервере, где есть METRIKA_OAUTH_TOKEN в .env):
//   tsx scripts/upload-offline-conversions.ts           — отгрузить новые
//   tsx scripts/upload-offline-conversions.ts --dry      — только показать CSV
//   tsx scripts/upload-offline-conversions.ts --selftest — проверка пайплайна
import 'dotenv/config';
import { prisma } from '../src/lib/db';

const TOKEN = process.env.METRIKA_OAUTH_TOKEN ?? '';
// счётчик 110795596 перестал писать визиты (14.09.2026, подтверждено
// тестовым счётчиком) — рабочий 112586570
const COUNTER = process.env.METRIKA_COUNTER_ID ?? '112586570';
const GOAL = process.env.METRIKA_MARK_GOAL_ID ?? '614660148';
// реальная отметка водителя (+ легаси-двойник)
const MARK_EVENTS = ['mark_completed', 'mark_sent'];
const WINDOW_DAYS = 21;

type Row = { eventId: string; yclid: string; ts: number };

// Кандидаты на отгрузку: события-отметки за окно, у чьей сессии есть yclid
// (пришёл из Директа) и которые ещё не отгружались.
async function collectPending(since: Date): Promise<Row[]> {
  const events = await prisma.analyticsEvent.findMany({
    where: { eventName: { in: MARK_EVENTS }, createdAt: { gte: since } },
    select: { id: true, sessionIdHash: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!events.length) return [];

  const sessHashes = [...new Set(events.map((e) => e.sessionIdHash))];
  const sessions = await prisma.analyticsSession.findMany({
    where: { sessionIdHash: { in: sessHashes }, yclid: { not: null } },
    select: { sessionIdHash: true, yclid: true },
  });
  const yclidByHash = new Map(sessions.map((s) => [s.sessionIdHash, s.yclid!]));

  const already = new Set(
    (
      await prisma.offlineConversion.findMany({
        where: { eventId: { in: events.map((e) => e.id) } },
        select: { eventId: true },
      })
    ).map((r) => r.eventId)
  );

  return events
    .filter((e) => yclidByHash.has(e.sessionIdHash) && !already.has(e.id))
    .map((e) => ({
      eventId: e.id,
      yclid: yclidByHash.get(e.sessionIdHash)!,
      ts: Math.floor(e.createdAt.getTime() / 1000),
    }));
}

function toCsv(rows: Row[]): string {
  return (
    'Yclid,Target,DateTime\n' +
    rows.map((r) => `${r.yclid},${GOAL},${r.ts}`).join('\n') +
    '\n'
  );
}

async function upload(csv: string): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `https://api-metrika.yandex.net/management/v1/counter/${COUNTER}/offline_conversions/upload?client_id_type=YCLID`;
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'conversions.csv');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `OAuth ${TOKEN}` },
    body: form,
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function runUpload(rows: Row[]): Promise<boolean> {
  const csv = toCsv(rows);
  const r = await upload(csv);
  if (!r.ok) {
    console.error('Метрика отклонила загрузку:', r.status, r.body.slice(0, 600));
    return false;
  }
  console.log('Метрика приняла загрузку:', r.status, r.body.slice(0, 300));
  await prisma.offlineConversion.createMany({
    data: rows.map((r) => ({ eventId: r.eventId, yclid: r.yclid, target: GOAL })),
    skipDuplicates: true,
  });
  console.log(`отгружено конверсий: ${rows.length}`);
  return true;
}

// Проверка пайплайна без реального Директ-клика: заводим синтетическую
// сессию с фиктивным (но валидным по формату) yclid и событие-отметку,
// прогоняем отгрузку, затем всё чистим. Метрика примет формат (в атрибуцию
// фиктивный yclid не попадёт — и не должен).
async function selftest() {
  const SESS = 'oc-selftest-session';
  const ANON = 'oc-selftest-anon';
  const YCLID = '10000000000000000001';
  await cleanupSelftest(SESS, ANON);
  await prisma.analyticsSession.create({
    data: { sessionIdHash: SESS, anonymousIdHash: ANON, yclid: YCLID, city: 'Тест' },
  });
  const ev = await prisma.analyticsEvent.create({
    data: { eventName: 'mark_completed', anonymousIdHash: ANON, sessionIdHash: SESS, city: 'Тест' },
  });
  const rows = await collectPending(new Date(Date.now() - WINDOW_DAYS * 24 * 3600_000));
  const mine = rows.filter((r) => r.eventId === ev.id);
  console.log('selftest: собрано кандидатов (мой):', mine.length, mine[0]?.yclid);
  let ok = false;
  if (mine.length) ok = await runUpload(mine);
  await prisma.offlineConversion.deleteMany({ where: { eventId: ev.id } });
  await cleanupSelftest(SESS, ANON);
  console.log(ok ? 'SELFTEST OK — Метрика приняла формат' : 'SELFTEST FAIL');
  if (!ok) process.exit(1);
}

async function cleanupSelftest(sess: string, anon: string) {
  await prisma.analyticsEvent.deleteMany({ where: { sessionIdHash: sess } });
  await prisma.analyticsSession.deleteMany({ where: { sessionIdHash: sess } });
  await prisma.analyticsVisitor.deleteMany({ where: { anonymousIdHash: anon } });
}

async function main() {
  if (!TOKEN) {
    console.error('METRIKA_OAUTH_TOKEN не задан — пропускаю');
    return;
  }
  if (process.argv.includes('--selftest')) return selftest();

  const rows = await collectPending(new Date(Date.now() - WINDOW_DAYS * 24 * 3600_000));
  if (!rows.length) {
    console.log('новых конверсий с yclid нет');
    return;
  }
  if (process.argv.includes('--dry')) {
    console.log('DRY — CSV:\n' + toCsv(rows));
    return;
  }
  await runUpload(rows);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
