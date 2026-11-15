'use client';

// Единая точка продуктовой аналитики на клиенте: событие уходит
// в собственную базу (/api/a) и параллельно в Яндекс Метрику, если
// настроен счётчик. Ошибки аналитики никогда не блокируют действия
// пользователя — всё fire-and-forget.

import { ymGoal } from '@/components/metrika';
import { getConsent } from '@/components/consent';

const DEVICE_KEY = 'pb-device-id'; // ТОТ ЖЕ id, что у меток — хеши совпадают
const SESSION_KEY = 'pb-session';
const HEARTBEAT_MS = 60_000;

function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function sessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

let ctx: {
  city?: string;
  referrerDomain?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  yclid?: string;
} = {};

function send(payload: Record<string, unknown>, beacon = false) {
  // ФЗ-152 (аудит 20.07): внутренняя аналитика — deviceId, сессии,
  // heartbeat — отправляется ТОЛЬКО после «Принимаю» в баннере.
  // Отметки на карте сюда не относятся (функция, инициированная
  // пользователем) — они идут через /api/marks.
  if (getConsent() !== 'granted') return;
  try {
    const body = JSON.stringify({
      deviceId: deviceId(),
      sessionId: sessionId(),
      ...ctx,
      ...payload,
    });
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(
        '/api/a',
        new Blob([body], { type: 'application/json' })
      );
      return;
    }
    void fetch('/api/a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // аналитика не критична
  }
}

export function track(
  name: string,
  extra?: { stationId?: string; meta?: Record<string, string> }
) {
  ymGoal(name); // Метрика получает те же события (если счётчик настроен)
  send({ events: [{ name, ...extra }] });
}

export function setTrackCity(city: string) {
  ctx.city = city;
}

// Присутствие: heartbeat раз в 60 с, только когда вкладка видима.
// Только публичные страницы — /admin этот модуль не подключает.
let started = false;
export function startPresence(city?: string) {
  if (started || typeof window === 'undefined') return;
  started = true;

  const params = new URLSearchParams(window.location.search);
  let referrerDomain: string | undefined;
  try {
    referrerDomain = document.referrer
      ? new URL(document.referrer).hostname
      : undefined;
    if (referrerDomain === window.location.hostname) referrerDomain = undefined;
  } catch {
    referrerDomain = undefined;
  }
  ctx = {
    city,
    referrerDomain,
    utmSource: params.get('utm_source') ?? undefined,
    utmMedium: params.get('utm_medium') ?? undefined,
    utmCampaign: params.get('utm_campaign') ?? undefined,
    utmContent: params.get('utm_content') ?? undefined,
    yclid: params.get('yclid') ?? undefined,
  };

  send({ heartbeat: true });
  const t = setInterval(() => {
    if (!document.hidden) send({ heartbeat: true });
  }, HEARTBEAT_MS);
  window.addEventListener('pagehide', () => {
    clearInterval(t);
    send({ heartbeat: true }, true);
  });

  collectWebVitals();
}

// Web Vitals (LCP/INP/CLS) — одним событием при уходе со страницы
function collectWebVitals() {
  try {
    let lcp = 0;
    let inp = 0;
    let cls = 0;
    new PerformanceObserver((l) => {
      const e = l.getEntries();
      if (e.length) lcp = Math.round(e[e.length - 1].startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as PerformanceEntry[]) {
        const d = (e as unknown as { duration: number }).duration;
        if (d > inp) inp = Math.round(d);
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const s = e as unknown as { hadRecentInput: boolean; value: number };
        if (!s.hadRecentInput) cls += s.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });

    let sent = false;
    const flush = () => {
      if (sent || !lcp) return;
      sent = true;
      send(
        {
          events: [
            {
              name: 'web_vitals',
              meta: {
                lcp: String(lcp),
                inp: String(inp),
                cls: cls.toFixed(3),
              },
            },
          ],
        },
        true
      );
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flush();
    });
  } catch {
    // старые браузеры без PerformanceObserver — молча пропускаем
  }
}
