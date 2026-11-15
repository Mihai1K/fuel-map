// Статус станции не хранится — он вычисляется из последних меток
// (см. docs/DECISIONS.md). Здесь единственное место этой логики.

export type StatusCode =
  | 'AVAILABLE'
  | 'LOW'
  | 'QUEUE'
  | 'OUT'
  | 'CLOSED'
  | 'UNKNOWN';

export type QueueCode =
  | 'NONE'
  | 'UNDER_5'
  | 'FIVE_TO_20'
  | 'M15_30'
  | 'OVER_30'
  | 'OVER_20'; // legacy

// Уровни свежести (решение владельца: «старые данные ≠ нет данных»):
// до 3 ч — свежий статус; 3–24 ч — «устаревший» (бледный, с пометкой);
// 1–7 дней — «данные недели» (синий пин: были данные, статус не
// гарантируем); старше недели — честное «нет данных».
export const FRESH_TTL_MIN = 3 * 60;
export const STALE_TTL_MIN = 24 * 60;
export const WEEK_TTL_MIN = 7 * 24 * 60;

export type Freshness = 'fresh' | 'stale' | 'week' | 'none';

// Свежесть ЦЕНЫ (отдельно от статуса — топливо дорожает быстро):
// до 24 ч — показываем обычно; 24–48 ч — «устаревающая»; старше 48 ч —
// не показываем в основном блоке и не используем для сравнения «где дешевле».
// В истории цена живёт по общему сроку ретеншена.
export const PRICE_FRESH_MIN = 24 * 60;
export const PRICE_AGING_MIN = 48 * 60;
// Аномалия: свежая цена, отклонившаяся от медианы недавних больше чем на
// столько процентов, помечается «нужна проверка» (не блокирует автора).
export const PRICE_ANOMALY_PCT = 15;

export type PriceFreshness = 'fresh' | 'aging';

// Цена одной марки: значение + СВОЁ время + подтверждения + свежесть.
// Единого времени на все марки нет: 95 могли обновить 30 минут назад,
// а 92 — сутки назад (требование ревью 25.07).
export type FuelPrice = {
  value: number; // ₽/л, последняя сообщённая
  updatedAt: Date; // когда сообщили именно эту цену
  confirmations: number; // сколько независимых устройств за 48 ч
  confirmed: boolean; // ≥2 независимых устройства
  freshness: PriceFreshness; // fresh <24ч · aging 24–48ч
  needsConfirm: boolean; // аномальное отклонение — просит подтверждения
};

// цвет «данных недели» на карте — синий, вне палитры статусов
export const WEEK_COLOR = '#60A5FA';

// Единственный источник цветов статусов (handbook/DESIGN.md,
// палитра — ревью итерации 1: спокойные, «дорогие» тона).
export const STATUS_META: Record<
  StatusCode,
  { label: string; color: string; fg: string; bg: string }
> = {
  AVAILABLE: { label: 'Есть топливо', color: '#16A34A', fg: 'text-green-700 dark:text-green-400', bg: 'bg-green-600/10' },
  LOW: { label: 'Мало топлива', color: '#F59E0B', fg: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-500/10' },
  QUEUE: { label: 'Очередь', color: '#F97316', fg: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-500/10' },
  OUT: { label: 'Нет топлива', color: '#EF4444', fg: 'text-red-700 dark:text-red-400', bg: 'bg-red-500/10' },
  CLOSED: { label: 'Закрыта', color: '#6B7280', fg: 'text-gray-600 dark:text-gray-300', bg: 'bg-gray-500/10' },
  UNKNOWN: { label: 'Нет свежих данных', color: '#9CA3AF', fg: 'text-gray-500 dark:text-gray-400', bg: 'bg-gray-400/10' },
};

export const QUEUE_LABEL: Record<QueueCode, string> = {
  NONE: 'Очереди нет',
  UNDER_5: 'Очередь до 5 минут',
  FIVE_TO_20: 'Очередь 5–15 минут',
  M15_30: 'Очередь 15–30 минут',
  OVER_30: 'Очередь 30+ минут',
  OVER_20: 'Очередь ≈25 минут', // legacy
};

export const FUEL_LABEL: Record<string, string> = {
  ai92: '92',
  ai95: '95',
  ai98: '98',
  ai100: '100',
  diesel: 'ДТ',
  gas: 'Газ',
};

export const FUELS = ['ai92', 'ai95', 'ai98', 'ai100', 'diesel', 'gas'] as const;

export type MarkLite = {
  status: Exclude<StatusCode, 'UNKNOWN'>;
  fuelTypes: string[]; // какие марки есть
  fuelsOut?: string[]; // какие закончились
  limitInfo?: string | null;
  queueSize: QueueCode | null;
  prices?: Record<string, number> | null; // ₽/л по маркам
  source?: string; // user | seed
  deviceId?: string; // для подсчёта независимых подтверждений цены
  createdAt: Date;
};

// Приоритет источников (решение владельца): реальные метки всегда
// перекрывают seed для конкретной АЗС. Если в окне есть хоть одна
// реальная — seed-метки станции игнорируются целиком: демо не должно
// сказать «есть бензин» после свежего реального «нет».
export function pickMarkPool(marks: MarkLite[]): {
  pool: MarkLite[];
  real: boolean;
} {
  const realMarks = marks.filter((m) => m.source !== 'seed');
  return realMarks.length > 0
    ? { pool: realMarks, real: true }
    : { pool: marks, real: false };
}

// Противоречие в отметках: показанный статус говорит одно, а недавняя
// отметка водителя — прямо обратное. Прятать такое нельзя (человек поедет
// на пустую колонку), поэтому карточка показывает это явной плашкой —
// приём из разбора ГдеБенз 15.09.2026.
//
// Считаем противоречием только ПЕРЕХОД ЧЕРЕЗ ГРУППУ: «есть топливо»
// (AVAILABLE/LOW/QUEUE) против «нет/закрыто» (OUT/CLOSED). Разница между
// «есть» и «очередь» — это уточнение, а не конфликт, и пугать ею не за что.
export type Dispute = {
  status: StatusCode; // что сказала противоречащая отметка
  at: Date; // когда её поставили
  count: number; // сколько таких отметок в окне (1 = одиночное мнение)
};

// Группа статуса: топливо есть или нет. UNKNOWN не входит ни в одну —
// «нет данных» ничему не противоречит.
function fuelGroup(s: StatusCode): 'has' | 'none' | null {
  if (s === 'AVAILABLE' || s === 'LOW' || s === 'QUEUE') return 'has';
  if (s === 'OUT' || s === 'CLOSED') return 'none';
  return null;
}

export type StationState = {
  status: StatusCode;
  freshness: Freshness; // fresh <3ч · stale 3–24ч · week 1–7д · none
  real: boolean; // статус построен на реальных метках (не seed)
  stale: boolean; // статус по метке старше 3 ч (но моложе суток)
  queueSize: QueueCode | null;
  fuelTypes: string[]; // какое топливо есть по последней актуальной метке
  limitInfo: string | null; // лимит отпуска (LIMIT_LABEL) из свежих меток
  updatedAt: Date | null; // время последней актуальной метки
  marks24h: number; // сколько меток за сутки — сигнал доверия
  confirms60m: number; // сколько водителей подтвердили текущий статус за час
  agreePct: number | null; // % меток TTL-окна, согласных со статусом (≥3 меток)
  dispute: Dispute | null; // свежая отметка, противоречащая показанному статусу
  prices: Record<string, FuelPrice> | null; // цена по каждой марке (своё время)
};

// Цены АЗС по каждой марке отдельно. Правила (ревью 25.07):
// • только РЕАЛЬНЫЕ метки (seed никогда не участвует);
// • цена засчитывается только если марка помечена как ИМЕЮЩАЯСЯ в той же
//   метке (не OUT/CLOSED) — цена привязана к наличию;
// • окно 48 ч; старше — не показываем в основном блоке (история — отдельно);
// • у каждой марки своё время, число независимых подтверждений и признак
//   аномалии. Цена «подтверждённая» только при ≥2 независимых устройствах.
function computePrices(
  marks: MarkLite[],
  now: Date
): Record<string, FuelPrice> | null {
  const cutoff = now.getTime() - PRICE_AGING_MIN * 60_000;
  const rel = marks.filter(
    (m) =>
      m.source !== 'seed' &&
      m.prices &&
      m.status !== 'OUT' &&
      m.status !== 'CLOSED' &&
      m.createdAt.getTime() >= cutoff
  );
  // марка → список сообщённых цен (значение, время, устройство)
  const byFuel = new Map<
    string,
    { value: number; at: Date; device: string }[]
  >();
  for (const m of rel) {
    for (const [fuel, val] of Object.entries(m.prices ?? {})) {
      if (typeof val !== 'number') continue;
      // цена только для марки, указанной как имеющаяся в этой же метке
      if (!m.fuelTypes.includes(fuel)) continue;
      const list = byFuel.get(fuel) ?? [];
      list.push({ value: val, at: m.createdAt, device: m.deviceId ?? '' });
      byFuel.set(fuel, list);
    }
  }

  const out: Record<string, FuelPrice> = {};
  for (const [fuel, list] of byFuel) {
    list.sort((a, b) => b.at.getTime() - a.at.getTime());
    const latest = list[0];
    const ageMin = (now.getTime() - latest.at.getTime()) / 60_000;
    const freshness: PriceFreshness =
      ageMin <= PRICE_FRESH_MIN ? 'fresh' : 'aging';
    // независимые подтверждения — по разным устройствам
    const devices = new Set(list.map((p) => p.device).filter(Boolean));
    const confirmations = devices.size || list.length;
    const confirmed = confirmations >= 2;
    // аномалия: сильное отклонение свежей цены от медианы прочих недавних
    let needsConfirm = false;
    if (list.length >= 2) {
      const others = list
        .slice(1)
        .map((p) => p.value)
        .sort((a, b) => a - b);
      const median = others[Math.floor(others.length / 2)];
      if (
        median > 0 &&
        Math.abs(latest.value - median) / median > PRICE_ANOMALY_PCT / 100
      ) {
        needsConfirm = true;
      }
    }
    out[fuel] = {
      value: latest.value,
      updatedAt: latest.at,
      confirmations,
      confirmed,
      freshness,
      needsConfirm,
    };
  }
  return Object.keys(out).length ? out : null;
}

// Свежие метки (внутри TTL) → статус по самой новой; иначе UNKNOWN.
export function computeState(marks: MarkLite[], now = new Date()): StationState {
  // реальные метки перекрывают seed (приоритет источников)
  const { pool, real } = pickMarkPool(marks);
  const prices = computePrices(marks, now);
  const sorted = [...pool].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
  const dayAgo = now.getTime() - 24 * 60 * 60_000;
  const marks24h = sorted.filter((m) => m.createdAt.getTime() >= dayAgo).length;

  const latest = sorted[0];
  if (!latest) {
    return {
      status: 'UNKNOWN', freshness: 'none', real, stale: false,
      queueSize: null, fuelTypes: [], limitInfo: null, updatedAt: null,
      marks24h, confirms60m: 0, agreePct: null, dispute: null, prices,
    };
  }

  const ageMin = (now.getTime() - latest.createdAt.getTime()) / 60_000;
  // старше недели — честное «нет данных»
  if (ageMin > WEEK_TTL_MIN) {
    return {
      status: 'UNKNOWN', freshness: 'none', real, stale: false,
      queueSize: null, fuelTypes: [], limitInfo: null,
      updatedAt: latest.createdAt, marks24h, confirms60m: 0, agreePct: null, dispute: null, prices,
    };
  }
  // 1–7 дней: «данные недели» — статус сообщаем как исторический
  // (синий пин на карте), без деталей очереди
  if (ageMin > STALE_TTL_MIN) {
    return {
      status: latest.status, freshness: 'week', real, stale: false,
      queueSize: null, fuelTypes: latest.fuelTypes, limitInfo: null,
      updatedAt: latest.createdAt, marks24h, confirms60m: 0, agreePct: null, dispute: null, prices,
    };
  }
  // 3–24 часа: статус показываем, но помечаем устаревшим (бледный пин,
  // «данные устарели» в карточке) — карта живая, честность сохранена
  const stale = ageMin > FRESH_TTL_MIN;

  // окно расчёта: для свежих станций — 3 часа, для устаревших — сутки
  const windowMin = stale ? STALE_TTL_MIN : FRESH_TTL_MIN;

  // Метка без уточнения топлива наследует топливо предыдущей свежей метки —
  // подтверждение «Да, всё так» не должно стирать данные (ревью итерации 1).
  let fuelTypes = latest.fuelTypes;
  if (fuelTypes.length === 0 && latest.status !== 'OUT' && latest.status !== 'CLOSED') {
    const prevWithFuel = sorted.find(
      (m) =>
        m.fuelTypes.length > 0 &&
        now.getTime() - m.createdAt.getTime() <= windowMin * 60_000
    );
    if (prevWithFuel) fuelTypes = prevWithFuel.fuelTypes;
  }

  const hourAgo = now.getTime() - 60 * 60_000;
  const confirms60m = sorted.filter(
    (m) => m.createdAt.getTime() >= hourAgo && m.status === latest.status
  ).length;

  const ttlWindow = sorted.filter(
    (m) => now.getTime() - m.createdAt.getTime() <= windowMin * 60_000
  );
  const agreePct =
    ttlWindow.length >= 3
      ? Math.round(
          (ttlWindow.filter((m) => m.status === latest.status).length /
            ttlWindow.length) * 100
        )
      : null;

  // Частичное «нет»: если в метке указано, КАКОГО топлива нет, а другое
  // топливо по свежим меткам есть — станция «мало», а не «нет топлива».
  // Детали по видам — в computeFuelStatuses.
  let status: StatusCode = latest.status;
  const latestOut = latest.fuelsOut ?? [];
  if (latest.status === 'OUT' && latestOut.length > 0) {
    // указано, КАКОГО топлива нет; если другое живо — станция «мало»
    const otherFuelAlive =
      latest.fuelTypes.length > 0 ||
      ttlWindow.some(
        (m) =>
          (m.status === 'AVAILABLE' || m.status === 'LOW' || m.status === 'QUEUE') &&
          m.fuelTypes.some((f) => !latestOut.includes(f))
      );
    if (otherFuelAlive) status = 'LOW';
  }

  // лимит отпуска — из последней свежей метки, где он указан
  const limitInfo =
    ttlWindow.find((m) => m.limitInfo)?.limitInfo ?? null;

  // Противоречие в отметках за сутки. Берём метки СТАРШЕ последней (она и
  // задаёт показанный статус) и ищем среди них переход через группу.
  // Самая свежая такая — та, о которой стоит предупредить; count отличает
  // одиночное мнение от устойчивого расхождения.
  const shownGroup = fuelGroup(status);
  const opposing = shownGroup
    ? sorted.filter((m) => {
        if (m.createdAt.getTime() < dayAgo) return false;
        if (m.createdAt.getTime() >= latest.createdAt.getTime()) return false;
        const g = fuelGroup(m.status);
        return g !== null && g !== shownGroup;
      })
    : [];
  const dispute: Dispute | null = opposing[0]
    ? {
        status: opposing[0].status,
        at: opposing[0].createdAt,
        count: opposing.length,
      }
    : null;

  return {
    status,
    freshness: stale ? 'stale' : 'fresh',
    real,
    stale,
    queueSize: latest.queueSize,
    fuelTypes,
    limitInfo,
    updatedAt: latest.createdAt,
    marks24h,
    confirms60m,
    agreePct,
    dispute,
    prices,
  };
}

// Очередь: сначала вывод, потом цифра (ревью владельца)
export const QUEUE_MINUTES: Record<QueueCode, string> = {
  NONE: 'Свободно',
  UNDER_5: 'Небольшая · до 5 минут',
  FIVE_TO_20: 'Средняя · 5–15 минут',
  M15_30: 'Большая · 15–30 минут',
  OVER_30: 'Очень большая · 30+ минут',
  OVER_20: 'Большая · ≈25 минут', // legacy
};

// Лимит отпуска топлива — важно в дефицит
export const LIMIT_LABEL: Record<string, string> = {
  NONE: 'Без лимита',
  FULL_TANK: 'До полного бака',
  L10: '10 литров',
  L20: '20 литров',
  L30: '30 литров',
  L40: '40 литров',
  L50: '50 литров',
};

// «441 заправка / 2 заправки / 5 заправок»
export function pluralRu(
  n: number,
  one: string,
  few: string,
  many: string
): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export type FuelStatus = { code: string; status: StatusCode };

// Статус по КАЖДОМУ виду топлива: по последней свежей метке, где топливо
// упомянуто. «95 — есть, 92 — нет» сильнее одного общего статуса.
export function computeFuelStatuses(
  marks: MarkLite[],
  now = new Date()
): FuelStatus[] {
  // тот же приоритет источников, что и в computeState
  const sorted = [...pickMarkPool(marks).pool].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
  // окно суток: у устаревших станций статусы марок тоже видны
  // (возраст показан в карточке, честность не страдает)
  const fresh = sorted.filter(
    (m) => now.getTime() - m.createdAt.getTime() <= STALE_TTL_MIN * 60_000
  );
  if (!fresh.length) return [];

  const dayAgo = now.getTime() - 24 * 60 * 60_000;
  const universe = new Set<string>();
  for (const m of sorted) {
    if (m.createdAt.getTime() < dayAgo) break;
    for (const f of m.fuelTypes) universe.add(f);
    for (const f of m.fuelsOut ?? []) universe.add(f);
  }
  if (!universe.size) return [];

  const latest = fresh[0];
  return FUELS.filter((f) => universe.has(f)).map((code) => {
    // первое свежее упоминание марки решает: есть она или закончилась
    for (const m of fresh) {
      if ((m.fuelsOut ?? []).includes(code))
        return { code, status: 'OUT' as StatusCode };
      if (m.fuelTypes.includes(code)) return { code, status: m.status };
    }
    // марка известна, но в свежих метках не упомянута
    if (latest.status === 'OUT' || latest.status === 'CLOSED') {
      return { code, status: latest.status };
    }
    return { code, status: 'UNKNOWN' as StatusCode };
  });
}

// ★-оценка достоверности (0–5) из согласованности и объёма меток
export function trustStars(agreePct: number | null, marks24h: number): number | null {
  if (agreePct === null || marks24h < 3) return null;
  return Math.max(1, Math.min(5, Math.round(agreePct / 20)));
}

// Стабильное анонимное имя из deviceId — история читается как чат,
// но никакой регистрации и персональных данных (это НЕ настоящие имена).
const DRIVER_NAMES = [
  'Алексей', 'Игорь', 'Мария', 'Дмитрий', 'Анна', 'Сергей', 'Ольга',
  'Иван', 'Наталья', 'Павел', 'Екатерина', 'Андрей', 'Юлия', 'Михаил',
  'Татьяна', 'Николай', 'Светлана', 'Владимир', 'Елена', 'Роман',
  'Ксения', 'Артём', 'Виктор', 'Дарья', 'Олег', 'Полина', 'Максим',
  'Ирина', 'Егор', 'Вера', 'Денис', 'Людмила',
];

export function driverName(deviceId: string): string {
  let h = 5381;
  for (let i = 0; i < deviceId.length; i++) {
    h = (h * 33) ^ deviceId.charCodeAt(i);
  }
  return DRIVER_NAMES[Math.abs(h) % DRIVER_NAMES.length];
}

// «обновлено 2 мин назад» — единый формат свежести (handbook/COPY.md)
export function freshness(date: Date | null, now = new Date()): string {
  if (!date) return 'нет меток';
  const min = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}
