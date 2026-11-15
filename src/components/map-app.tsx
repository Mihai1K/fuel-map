'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Check,
  ChevronDown,
  Download,
  Fuel,
  List,
  MapPin,
  Bookmark,
  MoreHorizontal,
  Navigation,
  Search,
  Share2,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react';
import { CITIES, type City } from '@/lib/cities';
import { brandGlyphHtml, brandOf } from '@/lib/brands';
import { getConsent } from '@/components/consent';
import { COMMUNITY } from '@/lib/community';
import { SITE_URL } from '@/lib/site';
import { InstallApp, InstallThanks } from '@/components/install-app';
import { setTrackCity, track as ymGoal } from '@/lib/track';
import {
  FUELS,
  FUEL_LABEL,
  LIMIT_LABEL,
  QUEUE_LABEL,
  QUEUE_MINUTES,
  STATUS_META,
  WEEK_COLOR,
  freshness,
  pluralRu,
  trustStars,
  type Dispute,
  type FuelStatus,
  type StatusCode,
} from '@/lib/status';

// Цена одной марки в клиенте (Date уже сериализована в ISO-строку).
// Держим форму синхронной с ClientFuelPrice из lib/stations.
export type ClientFuelPrice = {
  value: number;
  updatedAt: string;
  confirmations: number;
  confirmed: boolean;
  freshness: 'fresh' | 'aging';
  needsConfirm: boolean;
};

export type ClientStation = {
  id: string;
  name: string;
  network: string | null;
  address: string;
  lat: number;
  lng: number;
  status: StatusCode;
  freshness: 'fresh' | 'stale' | 'week' | 'none';
  real: boolean;
  stale: boolean;
  queueSize: keyof typeof QUEUE_LABEL | null;
  fuelTypes: string[];
  fuelStatuses: FuelStatus[];
  limitInfo: string | null;
  updatedAt: string | null;
  marks24h: number;
  confirms60m: number;
  agreePct: number | null;
  // противоречащая отметка (время уже ISO). Форму держим синхронной
  // с ClientDispute из lib/stations.
  dispute: (Omit<Dispute, 'at'> & { at: string }) | null;
  prices: Record<string, ClientFuelPrice> | null;
};

type HistoryMark = {
  id: string;
  status: Exclude<StatusCode, 'UNKNOWN'>;
  fuelTypes: string[];
  fuelsOut?: string[];
  limitInfo?: string | null;
  queueSize: keyof typeof QUEUE_LABEL | null;
  prices?: Record<string, number> | null;
  createdAt: string;
  name: string;
};

// Полная отметка: марки «есть», марки «нет», очередь, лимит
type MarkPayload = {
  status: Exclude<StatusCode, 'UNKNOWN'>;
  fuelTypes?: string[];
  fuelsOut?: string[];
  queueSize?: keyof typeof QUEUE_LABEL;
  limitInfo?: string;
  prices?: Record<string, number>;
};

// Яндекс Карты (JS API 2.1) вместо MapLibre+CARTO: первый водитель не смог
// найти заправку на непривычной подложке («нет дорог, нет парков, нет
// метро») — проблема доверия, не дизайна. Версия 2.1 — потому что ключ
// владельца выпущен для классического JavaScript API (v3 отвечает 403).
// Ключ ограничен доменом в кабинете Яндекса, поэтому видимость в клиенте
// безопасна.
const YMAPS_KEY = process.env.NEXT_PUBLIC_YMAPS_KEY ?? '';

/* eslint-disable @typescript-eslint/no-explicit-any -- у JS API Яндекса нет
   официальных типов; изолируем any внутри карт-слоя */
type YMap = any;

let ymapsLoader: Promise<any> | null = null;
function loadYmaps(): Promise<any> {
  const w = window as any;
  if (w.ymaps?.Map) return Promise.resolve(w.ymaps);
  if (!ymapsLoader) {
    ymapsLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://api-maps.yandex.ru/2.1/?apikey=${YMAPS_KEY}&lang=ru_RU`;
      s.async = true;
      s.onload = () => w.ymaps.ready(() => resolve(w.ymaps));
      s.onerror = () => reject(new Error('ymaps load failed'));
      document.head.appendChild(s);
    });
  }
  return ymapsLoader;
}

const MARK_STATUSES: Exclude<StatusCode, 'UNKNOWN'>[] = [
  'AVAILABLE',
  'LOW',
  'QUEUE',
  'OUT',
  'CLOSED',
];

const REFRESH_MS = 60_000;

function deviceId(): string {
  const KEY = 'pb-device-id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}


// Канонизация названий сетей: «ATAN» и «Атан» — одна сеть.
const NETWORK_ALIASES: Record<string, string> = {
  atan: 'ATAN',
  'атан': 'ATAN',
  tes: 'ТЕС',
  'тес': 'ТЕС',
  wog: 'WOG',
  'вог': 'WOG',
  'тнк': 'ТНК',
  tnk: 'ТНК',
};
function canonNetwork(name: string): string {
  const key = name.trim().toLowerCase();
  return NETWORK_ALIASES[key] ?? name.trim();
}

// Режим показа (как у конкурента): все АЗС / где есть топливо / строго «есть»
export type ViewMode = 'all' | 'has' | 'strict';

type Filters = {
  fuel: string | null;
  status: StatusCode | null;
  viewMode: ViewMode;
  network: string | null;
};

// Станция «подходит» под фильтры? Не подходит — точка приглушается.
function matches(s: ClientStation, f: Filters): boolean {
  if (f.viewMode === 'has' && kindOf(s) !== 2) return false;
  if (f.viewMode === 'strict' && (s.status !== 'AVAILABLE' || s.freshness === 'week'))
    return false;
  if (f.network && canonNetwork(s.network ?? '') !== f.network) return false;
  if (f.status && s.status !== f.status) return false;
  if (f.fuel) {
    const hasFuelInfo =
      s.status === 'AVAILABLE' || s.status === 'LOW' || s.status === 'QUEUE';
    if (!hasFuelInfo) return false;
    if (s.fuelTypes.length > 0 && !s.fuelTypes.includes(f.fuel)) return false;
  }
  return true;
}

// 2 — есть топливо (крупный цветной), 1 — нет бензина, 0 — нет данных.
// «Данные недели» (1–7 дней) живыми НЕ считаются — на карте они синие,
// в счётчик «Есть бензин: N» не входят.
function kindOf(s: ClientStation): number {
  if (s.freshness === 'week') return 0;
  if (s.status === 'AVAILABLE' || s.status === 'LOW' || s.status === 'QUEUE')
    return 2;
  return s.status === 'OUT' ? 1 : 0;
}

type PinFeature = {
  type: 'Feature';
  id: string;
  // ВНИМАНИЕ: у JS API 2.1 порядок координат [широта, долгота]
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    css: string;
    tailCss: string;
    dotCss: string;
    iconHtml: string;
    extraHtml: string;
    label: string;
    cls: string;
    kind: number;
    week: number;
    st: 'ok' | 'warn' | 'bad' | 'week' | 'none';
  };
  options?: Record<string, unknown>;
};

// На карте ВСЕГДА все заправки: живые — «фирменный гибрид» (тёмный
// корпус с пиктограммой колонки и цветным статусным ореолом — макет
// владельца), «нет данных» — бледные кружки. Скрытие «безмолвных»
// станций провалило боевой тест (водитель не нашёл свою АЗС).
// Каждый пин — div с прозрачной hit-зоной 52×52 (доступность), видимая
// часть меньше. role/aria-label — для экранных дикторов.

// пиктограмма топливной колонки (упрощённый lucide fuel), белая
const PUMP_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" ' +
  'stroke="#fff" stroke-width="2.2" stroke-linecap="round" ' +
  'stroke-linejoin="round" style="display:block">' +
  '<path d="M4 22V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v17"/>' +
  '<path d="M3 22h11"/><path d="M13 10h2.5l2 2v6a1.5 1.5 0 0 1-3 0v-4"/>' +
  '<path d="M6.5 7h4"/></svg>';

// aria-подпись статуса для пина
const ST_LABEL: Record<string, string> = {
  ok: 'есть топливо',
  warn: 'мало топлива или очередь',
  bad: 'топлива нет или закрыта',
  week: 'данные недельной давности',
  none: 'нет свежих данных',
};

// Чип сети для списка и карточки: фирменный цвет + буквенный знак
// (см. src/lib/brands.ts — чужие логотипы не используем). Даёт карте и
// списку «вес настоящей базы», который в разборе ГдеБенз давали логотипы.
function BrandChip({
  network,
  size = 36,
}: {
  network: string | null;
  size?: number;
}) {
  const b = brandOf(network);
  if (!b) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-xl bg-surface-2 text-muted"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <Fuel style={{ width: size * 0.45, height: size * 0.45 }} />
      </span>
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-xl font-extrabold text-white"
      style={{
        width: size,
        height: size,
        background: b.color,
        fontSize: b.mark.length > 1 ? size * 0.34 : size * 0.44,
        // жёлтые бренды (Роснефть, Shell) нечитаемы белым — им тёмный текст
        color: b.color === '#FFC20E' || b.color === '#FBCE07' ? '#0F172A' : '#fff',
      }}
      aria-hidden
    >
      {b.mark}
    </span>
  );
}

function toFeatures(
  stations: ClientStation[],
  filters: Filters,
  pulseIds?: Set<string>,
  selectedId?: string | null,
  closeZoom = false,
  gen = 0
): PinFeature[] {
  // closeZoom больше не меняет форму (единый пин), оставлен в сигнатуре
  // для совместимости; лёгкое укрупнение на близком зуме
  const scale = closeZoom ? 1.12 : 1;
  return stations.map((s) => {
    const kind = kindOf(s);
    const week = s.freshness === 'week';
    const color =
      kind === 2
        ? STATUS_META[s.status].color
        : week
          ? WEEK_COLOR
          : s.status === 'OUT' || s.status === 'CLOSED'
            ? '#EF4444'
            : '#c9ced6';
    const st: PinFeature['properties']['st'] = week
      ? 'week'
      : s.status === 'AVAILABLE'
        ? 'ok'
        : s.status === 'LOW' || s.status === 'QUEUE'
          ? 'warn'
          : s.status === 'OUT' || s.status === 'CLOSED'
            ? 'bad'
            : 'none';
    const stale = s.stale ? 1 : 0;
    // демо: статус показан, но построен на seed-слое (не отметки водителей)
    const demo = !s.real && kind === 2;
    const dim = matches(s, filters) ? 0 : 1;
    const selected = s.id === selectedId;
    const opacity = dim
      ? 0.15
      : stale
        ? 0.6
        : kind === 2
          ? 1
          : week
            ? 0.85
            : kind === 1
              ? 0.9
              : 0.65;
    const label = `${s.network ?? s.name}: ${ST_LABEL[st]}`;

    // id с поколением: ObjectManager кэширует оверлеи по id и «оживляет»
    // их без DOM после нашей ручной чистки pane — свежий id на каждую
    // перерисовку заставляет создать DOM заново (фикс «пины пропали
    // после отметки»); клик обрезает всё после «|»
    const fid = `${s.id}|g${gen}`;

    // «нет свежих данных» — подавляющее большинство пинов на реальной
    // карте. Раньше это был безликий бледный кружок, и карта читалась как
    // абстрактное поле точек. Известной сети даём светлый чип с её буквой
    // и цветом: станция опознаётся как настоящая, но остаётся приглушённой
    // — цветного статусного ореола здесь нет и быть не должно, «нет данных»
    // не имеет права выглядеть как «есть топливо» (проверка на проде
    // 15.09.2026: в Москве почти все АЗС попадают именно в эту ветку).
    if (st === 'none') {
      const b = brandOf(s.network);
      if (b) {
        const size = 22;
        const fs = b.mark.length > 1 ? 8 : 11;
        return {
          type: 'Feature',
          id: fid,
          geometry: { type: 'Point', coordinates: [s.lat, s.lng] },
          properties: {
            css:
              'position:absolute;left:-26px;top:-26px;width:52px;height:52px;' +
              `cursor:pointer;opacity:${opacity}`,
            tailCss: 'display:none',
            dotCss:
              `position:absolute;left:50%;top:50%;width:${size}px;height:${size}px;` +
              `margin:-${size / 2}px 0 0 -${size / 2}px;border-radius:7px;` +
              `background:#fff;border:1.5px solid ${b.color};` +
              (selected
                ? `box-shadow:0 0 0 6px ${b.color}40;`
                : 'box-shadow:0 1px 3px rgba(0,0,0,.25);') +
              'display:flex;align-items:center;justify-content:center',
            iconHtml:
              `<span style="display:block;color:${b.color};font:800 ${fs}px/1 ` +
              'Inter,system-ui,sans-serif;letter-spacing:-.02em">' +
              `${b.mark}</span>`,
            extraHtml: '',
            cls: pulseIds?.has(s.id) ? 'pb-pin-pulse' : '',
            kind,
            week: week ? 1 : 0,
            st,
            label,
          },
          options: {
            iconShape: { type: 'Circle', coordinates: [0, 0], radius: 26 },
          },
        };
      }
      // сеть неизвестна — прежний бледный кружок
      const size = 14;
      return {
        type: 'Feature',
        id: fid,
        geometry: { type: 'Point', coordinates: [s.lat, s.lng] },
        properties: {
          css:
            'position:absolute;left:-26px;top:-26px;width:52px;height:52px;' +
            `cursor:pointer;opacity:${opacity}`,
          tailCss:
            `position:absolute;left:50%;top:50%;width:${size}px;height:${size}px;` +
            `margin:-${size / 2}px 0 0 -${size / 2}px;border-radius:50%;` +
            `background:${color};border:1.5px solid #fff;` +
            (selected ? `box-shadow:0 0 0 6px ${color}40;` : ''),
          dotCss: 'display:none',
          iconHtml: '',
          extraHtml: '',
          cls: pulseIds?.has(s.id) ? 'pb-pin-pulse' : '',
          kind,
          week: week ? 1 : 0,
          st,
          label,
        },
        options: {
          iconShape: { type: 'Circle', coordinates: [0, 0], radius: 26 },
        },
      };
    }

    // «фирменный гибрид»: ореол → белая прослойка → тёмный корпус
    // с колонкой; хвостик-остриё снизу; статус-точка сверху слева.
    // Контейнер 56×64: прозрачная hit-зона ≥52×52, остриё в координате.
    const halo = Math.round(42 * scale); // видимый ореол
    const core = halo - 11; // тёмный корпус (белая прослойка — border)
    const haloOff = (56 - halo) / 2;
    const ringShadow = selected
      ? `box-shadow:0 0 0 7px ${color}40,0 3px 8px rgba(0,0,0,.35);`
      : 'box-shadow:0 3px 8px rgba(0,0,0,.3);';
    return {
      type: 'Feature',
      id: fid,
      geometry: { type: 'Point', coordinates: [s.lat, s.lng] },
      properties: {
        // css — прозрачный контейнер-мишень (56 ширина × 64 высота,
        // остриё хвостика в геокоординате)
        css:
          'position:absolute;left:-28px;top:-58px;width:56px;height:64px;' +
          `cursor:pointer;opacity:${opacity}`,
        // tailCss — ореол с прослойкой и корпусом внутри (вложенные div
        // недоступны шаблону, поэтому корпус собран через градиент и
        // внутренние элементы: ореол = внешний div, корпус — dotCss)
        tailCss:
          `position:absolute;left:${haloOff}px;top:${haloOff - 2}px;` +
          `width:${halo}px;height:${halo}px;border-radius:${Math.round(halo * 0.32)}px;` +
          `background:${color};${ringShadow}` +
          `border:2px solid #fff;`,
        // dotCss — тёмный корпус с пиктограммой (через flex-центровку),
        // хвостик и статус-точка дорисованы псевдоэлементами класса pb-hybrid
        dotCss:
          `position:absolute;left:${haloOff + (halo - core) / 2}px;` +
          `top:${haloOff + (halo - core) / 2 - 2}px;` +
          `width:${core}px;height:${core}px;` +
          `border-radius:${Math.round(core * 0.28)}px;background:#0F172A;` +
          'display:flex;align-items:center;justify-content:center',
        // бренд внутри корпуса: узнаваемость сети, не мешая статусу (ореол
        // остаётся статусным). Неизвестные сети — прежняя колонка.
        iconHtml: brandGlyphHtml(s.network) ?? PUMP_SVG,
        extraHtml:
          // хвостик-остриё (продолжение корпуса) + статусная точка
          '<div style="position:absolute;left:50%;bottom:4px;margin-left:-7px;' +
          'width:0;height:0;border-left:7px solid transparent;' +
          'border-right:7px solid transparent;border-top:10px solid #0F172A"></div>' +
          `<div style="position:absolute;left:${haloOff + 1}px;top:${haloOff - 1}px;` +
          `width:12px;height:12px;border-radius:50%;background:${color};` +
          'border:2px solid #fff"></div>' +
          // демо-бейдж: seed-статус визуально отличим от отметок водителей
          (demo
            ? `<div style="position:absolute;right:${haloOff - 3}px;top:${haloOff - 3}px;` +
              'padding:0 3px;height:13px;line-height:13px;border-radius:4px;' +
              'background:#6B7280;color:#fff;font:700 8px Inter,system-ui,sans-serif;' +
              'border:1.5px solid #fff">демо</div>'
            : ''),
        cls: pulseIds?.has(s.id) ? 'pb-pin-pulse' : '',
        kind,
        week: week ? 1 : 0,
        st,
        label: demo ? `${s.network ?? s.name}: демонстрационные данные` : label,
      },
      options: {
        // мишень накрывает весь корпус: 52+ px вокруг видимой части
        iconShape: { type: 'Circle', coordinates: [0, -30], radius: 30 },
      },
    };
  });
}

// Кластеры «фирменный гибрид» без хвостика: тёмный корпус с числом,
// цветной ореол, белая прослойка (макет владельца, 18.07). Прозрачная
// hit-зона ≥52×52, aria-label для дикторов. Кэш по цвету+размеру.
const ringLayoutCache = new Map<string, unknown>();
function ringLayout(ymaps: YMap, color: string, size: number) {
  const key = `${color}-${size}`;
  let l = ringLayoutCache.get(key);
  if (!l) {
    const box = Math.max(56, size + 14);
    const off = (box - size) / 2;
    const core = size - 10;
    const coreOff = off + (size - core) / 2;
    l = ymaps.templateLayoutFactory.createClass(
      '<div role="button" tabindex="0" ' +
        'aria-label="Группа из {{ properties.geoObjects.length }} АЗС" ' +
        `style="position:absolute;left:${-box / 2}px;top:${-box / 2}px;` +
        `width:${box}px;height:${box}px;cursor:pointer">` +
        `<div style="position:absolute;left:${off}px;top:${off}px;` +
        `width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.32)}px;` +
        `background:${color};border:2px solid #fff;` +
        'box-shadow:0 3px 8px rgba(0,0,0,.3)"></div>' +
        `<div style="position:absolute;left:${coreOff}px;top:${coreOff}px;` +
        `width:${core}px;height:${core}px;border-radius:${Math.round(core * 0.28)}px;` +
        'background:#0F172A;display:flex;align-items:center;justify-content:center;' +
        `color:#fff;font:700 ${size >= 50 ? 16 : 14}px Inter,system-ui,sans-serif">` +
        '{{ properties.geoObjects.length }}</div>' +
        '</div>'
    );
    ringLayoutCache.set(key, l);
  }
  return l;
}

// «Отметка после маршрута»: запоминаем, куда человек поехал, и после
// возвращения во вкладку спрашиваем, удалось ли заправиться. Формулировка
// без «вы были там» — достоверно мы этого не знаем (приёмка 18.07).
const ROUTE_INTENT_KEY = 'pb-route-intent';
function saveRouteIntent(stationId: string, name: string) {
  try {
    sessionStorage.setItem(
      ROUTE_INTENT_KEY,
      JSON.stringify({ id: stationId, name, ts: Date.now() })
    );
  } catch {
    // приватный режим — просто без напоминания
  }
}

// Сохранённые заправки — локально на устройстве (без аккаунтов)
const ONBOARD_KEY = 'pb-onboard'; // подсказка первого визита показана
const FAVS_KEY = 'pb-favs';
function getFavs(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAVS_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function toggleFav(id: string): boolean {
  const favs = getFavs();
  const has = favs.includes(id);
  const next = has ? favs.filter((x) => x !== id) : [...favs, id];
  localStorage.setItem(FAVS_KEY, JSON.stringify(next));
  return !has;
}

// Заголовок статуса с топливом: «Есть 92 и 95» сильнее общего «Есть топливо»
function statusHeadline(s: ClientStation): string {
  const fuels = s.fuelTypes.map((f) => FUEL_LABEL[f] ?? f);
  const list =
    fuels.length === 0
      ? ''
      : fuels.length === 1
        ? fuels[0]
        : fuels.length === 2
          ? `${fuels[0]} и ${fuels[1]}`
          : fuels.join(', ');
  if (s.status === 'AVAILABLE' && list) return `Есть ${list}`;
  if (s.status === 'LOW' && list) return `Мало: ${list}`;
  return STATUS_META[s.status].label;
}

// Маршруты: только Яндекс и 2ГИС (Google/Apple Maps не используем —
// решение владельца). «Поехать» открывает Яндекс сразу, без вопросов.
const yandexRoute = (lat: number, lng: number) =>
  `https://yandex.ru/maps/?rtext=~${lat},${lng}&rtt=auto`;
const dgisRoute = (lat: number, lng: number) =>
  `https://2gis.ru/directions/points/%7C${lng},${lat}`;

// расстояние по прямой, км (для «Ближайших» этого достаточно)
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} м` : `${km.toFixed(1)} км`;
}

function nearestCity(lat: number, lng: number): City {
  let best = CITIES[0];
  let bestD = Infinity;
  for (const c of CITIES) {
    const d = (c.lat - lat) ** 2 + (c.lng - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function MapApp({
  initialStations,
  city,
  initialFuel = null,
}: {
  initialStations: ClientStation[];
  city: City;
  initialFuel?: string | null;
}) {
  const router = useRouter();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<YMap | null>(null);
  const userPinRef = useRef<YMap | null>(null);
  const accCircleRef = useRef<YMap | null>(null);
  const geoWatchRef = useRef<number | null>(null);
  const geoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bestAccRef = useRef<number>(Infinity);
  const clustererRef = useRef<YMap | null>(null);
  const mapReady = useRef(false);
  // сигнал «карта создана» для эффектов отрисовки (инициализация async)
  const [mapLive, setMapLive] = useState(false);
  // близкий зум: отдельные АЗС рисуются капле-пинами (вариант C владельца)
  const [zoomClose, setZoomClose] = useState(false);

  const [stations, setStations] = useState(initialStations);
  const [fuel, setFuel] = useState<string | null>(initialFuel);
  const [status, setStatus] = useState<StatusCode | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [network, setNetwork] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cityOpen, setCityOpen] = useState(false);
  // Подсказка первого визита. Из разбора ГдеБенз 15.09.2026: у него на входе
  // модалка «Включить геолокацию / Указать свой город». Задача та же —
  // человек из Казани не должен смотреть на Москву и уходить. Но модалку мы
  // НЕ копируем: карту не перекрываем и геолокацию сами не дёргаем (правило
  // «гео только по действию пользователя»). Это некритичный лист снизу с
  // крестиком, один раз на устройство, и только ПОСЛЕ решения по cookies —
  // иначе он столкнётся с баннером согласия, который живёт в том же углу.
  const [onboard, setOnboard] = useState(false);
  useEffect(() => {
    if (localStorage.getItem(ONBOARD_KEY)) return;
    const show = () => {
      if (getConsent() !== null) setOnboard(true);
    };
    const t = setTimeout(show, 600);
    window.addEventListener('pb-consent-change', show);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pb-consent-change', show);
    };
  }, []);
  const closeOnboard = useCallback(() => {
    localStorage.setItem(ONBOARD_KEY, '1');
    setOnboard(false);
  }, []);
  const [searchQ, setSearchQ] = useState('');
  // Единый менеджер оверлеев: в каждый момент открыт максимум один
  // bottom sheet. Автоматических показов нет — только действие пользователя.
  const [overlay, setOverlay] = useState<
    | 'nearby'
    | 'community'
    | 'install'
    | 'filters'
    | 'menu'
    | 'afterMark'
    | null
  >(null);
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());
  const [shareCopied, setShareCopied] = useState(false);
  // уже установленное PWA — не предлагаем установку повторно
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setStandalone(
        window.matchMedia('(display-mode: standalone)').matches ||
          (navigator as unknown as { standalone?: boolean }).standalone === true
      );
    }, 0);
    return () => clearTimeout(t);
  }, []);
  // Гео: единый управляемый сценарий (приёмка 18.07)
  // idle → requesting → approximate → accurate | failed
  const [geoState, setGeoState] = useState<
    'idle' | 'requesting' | 'approximate' | 'accurate' | 'failed'
  >('idle');
  // неблокирующие подсказки над нижней плашкой (смена города / гео-фейл)
  const [citySuggest, setCitySuggest] = useState<City | null>(null);
  // «Удалось заправиться?» после возврата из навигатора
  const [routePrompt, setRoutePrompt] = useState<{ id: string; name: string } | null>(null);
  const [routePromptBusy, setRoutePromptBusy] = useState(false);
  const [geoToast, setGeoToast] = useState<string | null>(null);

  const filters = useMemo<Filters>(
    () => ({ fuel, status, viewMode, network }),
    [fuel, status, viewMode, network]
  );
  const activeFilterCount =
    (status ? 1 : 0) + (network ? 1 : 0) + (viewMode !== 'all' ? 1 : 0);

  function openOverlay(name: NonNullable<typeof overlay> | null) {
    setOverlay(name);
    if (name) {
      setSelectedId(null);
      setCityOpen(false);
    }
  }
  // пульс сервиса: «я не первый» — последняя метка, водители, активность
  const [activity, setActivity] = useState<{
    lastMarkAt: string | null;
    last10min: number;
    driversNow: number;
    driversToday: number;
  } | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch('/api/activity');
        if (!res.ok || stop) return;
        const d = (await res.json()) as {
          lastMarkAt: string | null;
          last10min: number;
          driversNow: number;
          driversToday: number;
        };
        setActivity(d);
      } catch {
        // пульс не критичен
      }
    };
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, REFRESH_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  // «обновлено N мин назад» должно тикать само, а не только при событиях
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setClockTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // воронка: открытие карты; app_open — запуск установленного PWA
  useEffect(() => {
    setTrackCity(city.name);
    ymGoal('map_open');
    if (window.matchMedia('(display-mode: standalone)').matches) {
      ymGoal('app_open');
    }
  }, [city.name]);

  const stationsRef = useRef(stations);
  useEffect(() => {
    stationsRef.current = stations;
  }, [stations]);

  // «Мы всегда на связи» при входе — решение владельца (18.07): сайт
  // может быть временно недоступен, актуальная ссылка всегда в каналах.
  // Показ не чаще раза в 7 дней, лёгкое закрытие, клик по карте закрывает.
  // флаг «видел» пишется ТОЛЬКО при осознанном закрытии (крестик,
  // «К карте», клик по каналу) — приёмка 18.07; показ ждёт готовую карту
  // возврат во вкладку после «Построить маршрут»: если прошло от 1 минуты
  // до 4 часов — спрашиваем результат поездки (главный момент конверсии)
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const raw = sessionStorage.getItem(ROUTE_INTENT_KEY);
        if (!raw) return;
        const intent = JSON.parse(raw) as { id: string; name: string; ts: number };
        const age = Date.now() - intent.ts;
        if (age < 60_000 || age > 4 * 60 * 60_000) return;
        sessionStorage.removeItem(ROUTE_INTENT_KEY);
        ymGoal('route_return_prompt', { stationId: intent.id });
        setRoutePrompt({ id: intent.id, name: intent.name });
      } catch {
        // повреждённый intent — молча забываем
        sessionStorage.removeItem(ROUTE_INTENT_KEY);
      }
    };
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);

  async function answerRoutePrompt(status: 'AVAILABLE' | 'OUT' | null) {
    if (!routePrompt || routePromptBusy) return;
    if (status === null) {
      setRoutePrompt(null);
      return;
    }
    setRoutePromptBusy(true);
    const id = await sendMark(routePrompt.id, { status, fuelTypes: [] });
    setRoutePromptBusy(false);
    setRoutePrompt(null);
    if (id !== null) setOverlay('afterMark');
  }

  function closeAfterMark() {
    setOverlay(null);
    setShareCopied(false);
  }

  async function shareService() {
    ymGoal('share_click');
    const data = {
      title: 'Тут Бензин',
      text: 'Живая карта заправок: где есть бензин прямо сейчас',
      url: SITE_URL,
    };
    try {
      if (navigator.share) {
        await navigator.share(data);
      } else {
        await navigator.clipboard.writeText(SITE_URL);
        setShareCopied(true);
      }
    } catch {
      // пользователь закрыл системный шэр — это не ошибка
    }
  }

  // Геолокация — ТОЛЬКО по действию пользователя (кнопка гео / «Найти
  // рядом»). Авто-запроса при загрузке нет. Город никогда не меняется
  // молча: если GPS показал другой город из списка — неблокирующее
  // предложение «Переключить», решает пользователь.
  // подсказка по включению доступа — своя для каждой платформы
  function geoHelpText(): string {
    const ua = navigator.userAgent;
    if (/telegram/i.test(ua))
      return 'Во встроенном браузере Telegram геолокация часто закрыта — откройте сайт в Safari или Chrome (кнопка «⋯»).';
    if (/iphone|ipad/i.test(ua) && !/crios/i.test(ua))
      return 'Разрешите доступ: Настройки iPhone → Приложения → Safari → Местоположение, и «аА» в адресной строке → Настройки сайта.';
    if (/android/i.test(ua))
      return 'Разрешите доступ: значок замка в адресной строке → Разрешения → Местоположение.';
    return 'Разрешите доступ к местоположению в настройках браузера для tytbenzin.ru.';
  }

  const stopGeoWatch = useCallback(() => {
    if (geoWatchRef.current !== null) {
      navigator.geolocation.clearWatch(geoWatchRef.current);
      geoWatchRef.current = null;
    }
    if (geoTimerRef.current !== null) {
      clearTimeout(geoTimerRef.current);
      geoTimerRef.current = null;
    }
  }, []);

  // watcher не должен пережить экран карты
  useEffect(() => stopGeoWatch, [stopGeoWatch]);

  const requestGeo = useCallback(
    (opts?: { center?: boolean; silent?: boolean }) => {
      if (!('geolocation' in navigator) || !window.isSecureContext) {
        setGeoState('failed');
        if (!opts?.silent)
          setGeoToast('Геолокация недоступна — выберите город или переместите карту');
        return;
      }
      stopGeoWatch();
      bestAccRef.current = Infinity;
      setGeoState('requesting');

      const applyFix = (pos: GeolocationPosition) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        if (accuracy >= bestAccRef.current) return; // хуже уже принятого
        bestAccRef.current = accuracy;
        // >5 км — IP-примерка, координатам не верим вовсе
        if (accuracy > 5_000) return;
        setUserPos([lat, lng]);
        setGeoState(accuracy <= 200 ? 'accurate' : 'approximate');
        if (opts?.center) {
          mapRef.current?.panTo([lat, lng], { duration: 450 });
        }
        // предложение смены города: только если позиция в другом городе
        // списка (<60 км до центра) — и только предложение, не подмена
        const c = nearestCity(lat, lng);
        if (c.slug !== city.slug && distanceKm(lat, lng, c.lat, c.lng) < 60) {
          setCitySuggest(c);
          ymGoal('city_switch_suggested');
        }
        // точная позиция получена — уточнение можно останавливать
        if (accuracy <= 200) stopGeoWatch();
      };

      const fail = (err: GeolocationPositionError | null) => {
        stopGeoWatch();
        // если хоть какой-то фикс уже принят — это не провал
        if (bestAccRef.current <= 5_000) return;
        setGeoState('failed');
        ymGoal('geolocation_denied');
        if (opts?.silent) return;
        if (err && err.code === err.PERMISSION_DENIED) {
          setGeoToast(`Доступ к геолокации запрещён. ${geoHelpText()}`);
        } else if (err && err.code === err.POSITION_UNAVAILABLE) {
          setGeoToast('GPS недоступен — попробуйте у окна или на улице, либо выберите город вручную.');
        } else {
          setGeoToast('Не удалось определить местоположение за отведённое время. Попробуйте ещё раз.');
        }
      };

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          ymGoal('geolocation_allowed');
          applyFix(pos);
          if (bestAccRef.current > 200) {
            // первый фикс грубый — уточняем одним watchPosition
            const watchId = navigator.geolocation.watchPosition(
              applyFix,
              () => {},
              { enableHighAccuracy: true, maximumAge: 0 }
            );
            geoWatchRef.current = watchId;
            // максимум 18 секунд уточнения, дальше живём с тем, что есть
            geoTimerRef.current = setTimeout(() => {
              stopGeoWatch();
              if (bestAccRef.current > 5_000) fail(null);
              else if (bestAccRef.current > 200 && !opts?.silent)
                setGeoToast('Позиция приблизительная — расстояния до АЗС примерные.');
            }, 18_000);
          }
          if (bestAccRef.current > 5_000) {
            // единственный фикс оказался мусорным
            if (!opts?.silent)
              setGeoToast('Не удалось точно определить местоположение — выберите город или переместите карту');
          }
        },
        fail,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 }
      );
    },
    [city.slug, stopGeoWatch]
  );

  // тосты живут недолго и не блокируют
  useEffect(() => {
    if (!geoToast) return;
    const t = setTimeout(() => setGeoToast(null), 6_000);
    return () => clearTimeout(t);
  }, [geoToast]);

  // База общероссийская: станции подгружаются по видимой области карты
  // (при перемещении и раз в минуту) и сливаются с уже известными —
  // изменившиеся получают короткий пульс-ореол.
  const refreshByBbox = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    // JS API 2.1: getBounds() → [[южнЛат, запЛнг], [северЛат, востЛнг]]
    const b = map.getBounds() as [number, number][] | undefined;
    if (!b) return;
    const bbox = [b[0][1], b[0][0], b[1][1], b[1][0]]
      .map((n) => n.toFixed(4))
      .join(',');
    try {
      const res = await fetch(`/api/stations?bbox=${bbox}`);
      if (!res.ok) return;
      const data = (await res.json()) as { stations: ClientStation[] };
      const prev = new Map(stationsRef.current.map((s) => [s.id, s]));
      const changed = new Set(
        data.stations
          .filter((s) => prev.has(s.id) && prev.get(s.id)!.status !== s.status)
          .map((s) => s.id)
      );
      // слияние: свежие данные поверх, станции вне области не выбрасываем
      const merged = new Map(prev);
      let dirty = false;
      for (const s of data.stations) {
        const old = merged.get(s.id);
        if (!old || old.updatedAt !== s.updatedAt || old.status !== s.status) {
          dirty = true;
        }
        merged.set(s.id, s);
      }
      // без изменений не трогаем state: каждый setStations = полная
      // перерисовка пинов, а у ObjectManager 2.1 она подтекает DOM-узлами
      if (dirty || merged.size !== prev.size) setStations([...merged.values()]);
      if (changed.size) {
        setPulseIds(changed);
        setTimeout(() => setPulseIds(new Set()), 5_000);
      }
    } catch {
      // нет сети — показываем последние известные данные
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      void refreshByBbox();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshByBbox]);

  const selected = useMemo(
    () => stations.find((s) => s.id === selectedId) ?? null,
    [stations, selectedId]
  );

  // Ответ до карты: сколько станций с топливом под текущими фильтрами
  const liveCount = useMemo(
    () =>
      stations.filter((s) => kindOf(s) === 2 && matches(s, filters)).length,
    [stations, filters]
  );

  // Топ сетей по загруженным станциям — для фильтра «Сеть»
  const topNetworks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of stations) {
      if (!s.network) continue;
      const n = canonNetwork(s.network);
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([n]) => n);
  }, [stations]);

  const lastUpdate = useMemo(() => {
    const times = stations
      .map((s) => (s.updatedAt ? Date.parse(s.updatedAt) : 0))
      .filter(Boolean);
    return times.length ? new Date(Math.max(...times)) : null;
  }, [stations]);

  const selectStation = useCallback((id: string) => {
    const s = stationsRef.current.find((x) => x.id === id);
    const map = mapRef.current;
    if (!s || !map) return;
    ymGoal('station_open', { stationId: id });
    setSelectedId(id);
    setOverlay(null); // карточка станции вытесняет любой открытый sheet
    // на телефоне карточка закрывает низ экрана — смещаем центр так,
    // чтобы пин оказался выше (аналог прежнего offset в пикселях)
    let lat = s.lat;
    if (window.innerWidth < 640) {
      const b = map.getBounds() as [number, number][] | undefined;
      const span = b ? Math.abs(b[1][0] - b[0][0]) : 0.02;
      lat = s.lat - span * 0.17;
    }
    map.panTo([lat, s.lng], { duration: 450 });
  }, []);

  // — инициализация Яндекс Карты (JS API 2.1): подложка + ObjectManager
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    let cancelled = false;
    let map: YMap = null;
    (async () => {
      try {
        const ymaps = await loadYmaps();
        if (cancelled || !mapEl.current) return;

        map = new ymaps.Map(
          mapEl.current,
          {
            center: [city.lat, city.lng],
            zoom: city.zoom,
            controls: [],
          },
          {
            suppressMapOpenBlock: true,
            // клики по чужим POI не должны воровать тап по нашему пину
            yandexMapDisablePoiInteractivity: true,
          }
        );
        // геолокация — своя кнопка в шапке (единый сценарий + смена города),
        // родной контрол убран, чтобы не дублировать запросы позиции
        map.controls.add('zoomControl', {
          position: { right: 12, bottom: 220 },
          size: 'small',
        });

        const createManager = () => {
          const m = new ymaps.ObjectManager({
            clusterize: true,
            gridSize: 56,
            // клик по кластеру сам приближает карту
            clusterDisableClickZoom: false,
          });
          // «Статусные кольца» (вариант A владельца): тёмный центр с числом,
          // кольцо = реальная картина внутри кластера
          m.clusters.events.add('add', (e: YMap) => {
            const id = e.get('objectId');
            const cluster = m.clusters.getById(id);
            const objs = (cluster?.properties?.geoObjects ?? []) as {
              properties: { st: string };
            }[];
            let ok = 0;
            let warn = 0;
            let bad = 0;
            let week = 0;
            for (const o of objs) {
              const st = o.properties?.st;
              if (st === 'ok') ok++;
              else if (st === 'warn') warn++;
              else if (st === 'bad') bad++;
              else if (st === 'week') week++;
            }
            const withData = ok + warn + bad;
            const color =
              withData === 0
                ? week > 0
                  ? WEEK_COLOR
                  : '#9CA3AF'
                : bad >= withData / 2
                  ? '#EF4444'
                  : warn > ok
                    ? '#F59E0B'
                    : '#16A34A';
            const n = objs.length;
            const size = n < 10 ? 38 : n < 50 ? 46 : 54;
            m.clusters.setClusterOptions(id, {
              clusterIconLayout: ringLayout(ymaps, color, size),
              clusterIconShape: {
                type: 'Circle',
                coordinates: [0, 0],
                // hit-зона ≥52×52 у любого кластера
                radius: Math.max(28, size / 2 + 8),
              },
            });
          });
          m.objects.options.set({
            iconLayout: ymaps.templateLayoutFactory.createClass(
              '<div class="$[properties.cls]" role="button" tabindex="0" ' +
                'aria-label="$[properties.label]" style="$[properties.css]">' +
                '<div style="$[properties.tailCss]"></div>' +
                '<div style="$[properties.dotCss]">$[properties.iconHtml]</div>' +
                '$[properties.extraHtml]' +
                '</div>'
            ),
            // запасная мишень (основная — iconShape на каждой фиче)
            iconShape: { type: 'Circle', coordinates: [0, 0], radius: 18 },
          });
          m.objects.events.add('click', (e: YMap) =>
            selectStation(String(e.get('objectId')).split('|')[0])
          );
          map.geoObjects.add(m);
          return m;
        };
        const om = createManager();

        // клик мимо пинов закрывает панели
        map.events.add('click', () => {
          setSelectedId(null);
          setCityOpen(false);
          setOverlay(null);
        });
        // конец движения/зума — подгрузка станций видимой области;
        // на близком зуме (>=14) отдельные АЗС становятся капле-пинами
        let moveTimer: ReturnType<typeof setTimeout> | undefined;
        map.events.add('boundschange', (e: YMap) => {
          // во время события getZoom() ещё старый — берём newZoom из события
          const nz = e.get('newZoom') ?? map.getZoom() ?? 10;
          setZoomClose(nz >= 14);
          clearTimeout(moveTimer);
          moveTimer = setTimeout(() => void refreshByBbox(), 400);
        });

        clustererRef.current = om;
        mapRef.current = map;
        mapReady.current = true;
        setMapLive(true);
        if (process.env.NODE_ENV !== 'production') {
          (window as unknown as { __pbMap?: YMap }).__pbMap = map;
        }
      } catch {
        // карта не критична для ответа: список «Рядом» работает и без неё
      }
    })();

    return () => {
      cancelled = true;
      try {
        map?.destroy();
      } catch {
        // повторный destroy при гонке размонтирования безопасно глотаем
      }
      mapRef.current = null;
      clustererRef.current = null;
      mapReady.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Синяя точка «вы здесь»: собственный маркер позиции пользователя
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLive || !userPos) return;
    const w = window as unknown as { ymaps?: YMap };
    const ymaps = w.ymaps;
    if (!ymaps) return;
    try {
      // круг точности: показывается только пока позиция приблизительная
      if (geoState === 'approximate' && bestAccRef.current < Infinity) {
        if (accCircleRef.current) {
          accCircleRef.current.geometry.setCoordinates(userPos);
          accCircleRef.current.geometry.setRadius(bestAccRef.current);
        } else {
          const circle = new ymaps.Circle(
            [userPos, bestAccRef.current],
            {},
            {
              fillColor: '#2563EB15',
              strokeColor: '#2563EB55',
              strokeWidth: 1,
              interactivityModel: 'default#transparent',
            }
          );
          map.geoObjects.add(circle);
          accCircleRef.current = circle;
        }
      } else if (accCircleRef.current) {
        try {
          map.geoObjects.remove(accCircleRef.current);
        } catch {
          // уже снят
        }
        accCircleRef.current = null;
      }
      if (userPinRef.current) {
        userPinRef.current.geometry.setCoordinates(userPos);
      } else {
        const pin = new ymaps.Placemark(
          userPos,
          {},
          {
            iconLayout: ymaps.templateLayoutFactory.createClass(
              '<div style="position:absolute;left:-11px;top:-11px;width:22px;' +
                'height:22px;border-radius:50%;background:#2563EB;' +
                'border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25),' +
                '0 1px 4px rgba(0,0,0,.4)"></div>'
            ),
            iconShape: { type: 'Circle', coordinates: [0, 0], radius: 14 },
            zIndex: 1000,
          }
        );
        map.geoObjects.add(pin);
        userPinRef.current = pin;
      }
    } catch {
      // маркер позиции не критичен
    }
  }, [userPos, mapLive, geoState]);

  // — данные, фильтры, выбор, пульс → перерисовка пинов
  const genRef = useRef(0);
  useEffect(() => {
    const om = clustererRef.current;
    if (!om || !mapReady.current) return;
    genRef.current += 1; // новое поколение id — см. комментарий в toFeatures
    om.removeAll();
    // removeAll() в 2.1 НЕ удаляет DOM плейсмарков (боевой замер:
    // 231→829 узлов за 24 смены зума) — вычищаем pane руками: после
    // removeAll любой узел плейсмарка по определению мусор
    mapEl.current
      ?.querySelectorAll('[class*="placemark-overlay"]')
      .forEach((el) => el.remove());
    om.add({
      type: 'FeatureCollection',
      features: toFeatures(stations, filters, pulseIds, selectedId, zoomClose, genRef.current),
    });
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { __pbZoomClose?: boolean }).__pbZoomClose = zoomClose;
    }
  }, [stations, filters, pulseIds, selectedId, zoomClose, mapLive]);

  async function sendMark(
    stationId: string,
    payload: MarkPayload
  ): Promise<string | null> {
    try {
      const res = await fetch('/api/marks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stationId, ...payload, deviceId: deviceId() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        station: ClientStation;
        markId?: string;
      };
      setStations((prev) =>
        prev.map((s) => (s.id === data.station.id ? data.station : s))
      );
      ymGoal('mark_sent');
      ymGoal('mark_completed'); // дубль для сквозной воронки (список владельца)
      return data.markId ?? null;
    } catch {
      return null;
    }
  }

  // Уточнение своей метки: какое топливо и какая очередь
  async function refineMark(
    markId: string,
    fuelTypes: string[],
    queueSize: keyof typeof QUEUE_LABEL | null
  ): Promise<boolean> {
    try {
      const res = await fetch('/api/marks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markId,
          deviceId: deviceId(),
          fuelTypes,
          ...(queueSize ? { queueSize } : {}),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { station: ClientStation };
      setStations((prev) =>
        prev.map((s) => (s.id === data.station.id ? data.station : s))
      );
      return true;
    } catch {
      return false;
    }
  }

  // — «Ближайшие»: ответ на вопрос, а не карта ради карты.
  // Точка отсчёта — геопозиция пользователя, иначе центр карты.
  function openNearby() {
    ymGoal('nearest_open');
    // центр карты снимаем здесь (в обработчике ref доступен), а не в рендере
    const c = mapRef.current?.getCenter() as [number, number] | undefined;
    setMapCenter(c ? [c[0], c[1]] : [city.lat, city.lng]);
    openOverlay('nearby');
    // «Найти рядом» — явное действие: можно спросить позицию (тихо)
    if (!userPos) requestGeo({ silent: true });
  }

  const nearby = useMemo(() => {
    if (overlay !== 'nearby') return [];
    const [oLat, oLng] = userPos ?? mapCenter ?? [city.lat, city.lng];
    const usable = stations.filter(
      (s) =>
        matches(s, filters) &&
        (fuel || status || network || viewMode !== 'all'
          ? true
          : s.status === 'AVAILABLE' || s.status === 'LOW' || s.status === 'QUEUE')
    );
    // «Рядом» отвечает «куда ехать сейчас»: свежие и дневные — в приоритете,
    // «данные недели» показываем только когда свежих нет (возраст честно виден)
    const current = usable.filter((s) => s.freshness !== 'week');
    const pool = current.length > 0 ? current : usable;
    return pool
      .map((s) => ({ s, km: distanceKm(oLat, oLng, s.lat, s.lng) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 12);
  }, [overlay, stations, fuel, status, network, viewMode, filters, userPos, mapCenter, city.lat, city.lng]);

  // — поиск: города + станции (название/сеть/адрес)
  const searchResults = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (q.length < 2) return { cities: [], stations: [] };
    const cities = CITIES.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 3);
    const found = stations
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.network ?? '').toLowerCase().includes(q) ||
          s.address.toLowerCase().includes(q)
      )
      .slice(0, 8);
    return { cities, stations: found };
  }, [searchQ, stations]);

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <div className="absolute inset-0">
        <div ref={mapEl} className="h-full w-full" />
        {!mapLive && (
          <div className="absolute inset-0 grid place-items-center bg-surface">
            <div className="flex flex-col items-center gap-3 text-muted">
              <span className="size-8 animate-spin rounded-full border-[3px] border-border border-t-primary" />
              <span className="text-sm font-medium">Загружаем карту…</span>
            </div>
          </div>
        )}
      </div>

      {/* Шапка ≤2 компактных строк: [гео][город][поиск][ещё] + фильтры.
          pointer-events-none: пустые зоны шапки пропускают клики к карте,
          интерактивны только сами элементы. Отступ сверху уважает чёлку. */}
      <header
        className="pointer-events-none absolute inset-x-0 top-0 z-10 px-2 sm:px-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
      >
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Link
            href="/"
            className="pointer-events-auto hidden shrink-0 items-center gap-2 rounded-2xl border border-border bg-surface/80 px-3 py-2 shadow-lg backdrop-blur-xl sm:flex"
          >
            <span className="grid size-7 place-items-center rounded-xl bg-primary text-white">
              <MapPin className="size-4" />
            </span>
            <span className="hidden text-sm font-semibold lg:block">
              Тут Бензин
            </span>
          </Link>

          {/* геолокация — по нажатию, никогда автоматически */}
          <button
            onClick={() => requestGeo({ center: true })}
            aria-label="Моё местоположение"
            className="pointer-events-auto grid size-11 shrink-0 place-items-center rounded-2xl border border-border bg-surface/80 shadow-lg backdrop-blur-xl"
          >
            <Navigation
              className={`size-4 ${
                geoState === 'requesting'
                  ? 'animate-pulse text-muted'
                  : geoState === 'failed'
                    ? 'text-red-500'
                    : 'text-primary'
              }`}
            />
          </button>

          {/* город */}
          <div className="pointer-events-auto relative shrink-0">
            <button
              onClick={() => setCityOpen((v) => !v)}
              className="flex min-h-11 max-w-44 items-center gap-1.5 rounded-2xl border border-border bg-surface/80 px-4 py-2 text-sm font-semibold shadow-lg backdrop-blur-xl"
            >
              <span className="truncate">{city.name}</span>
              <ChevronDown className="size-4 shrink-0 text-muted" />
            </button>
            {cityOpen && (
              <div className="absolute left-0 top-full z-30 mt-2 max-h-96 w-72 overflow-y-auto rounded-2xl border border-border bg-surface p-1.5 shadow-2xl">
                {CITIES.map((c) => (
                  <button
                    key={c.slug}
                    onClick={() => {
                      setCityOpen(false);
                      if (c.slug !== city.slug) router.push(`/map?city=${c.slug}`);
                    }}
                    className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 ${
                      c.slug === city.slug ? 'font-semibold' : ''
                    }`}
                  >
                    <span>{c.name}</span>
                    {c.alert && (
                      <span
                        className={`rounded-lg px-2 py-0.5 text-xs font-medium ${
                          c.alert === 'critical'
                            ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                            : c.alert === 'limits'
                              ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
                              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {c.alert === 'critical' ? 'дефицит' : c.alert === 'limits' ? 'лимиты' : 'перебои'}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* поиск: сеть, адрес, станция, город */}
          <div className="pointer-events-auto relative min-w-0 flex-1 sm:max-w-md">
            <div className="flex min-h-11 items-center gap-2 rounded-2xl border border-border bg-surface/80 px-3.5 shadow-lg backdrop-blur-xl">
              <Search className="size-4 shrink-0 text-muted" />
              <input
                value={searchQ}
                onChange={(e) => {
                  // воронка: первый символ нового запроса = начал искать
                  if (!searchQ && e.target.value) ymGoal('station_search');
                  setSearchQ(e.target.value);
                }}
                placeholder="Где есть бензин?"
                className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted"
              />
              {searchQ && (
                <button
                  onClick={() => setSearchQ('')}
                  aria-label="Очистить"
                  className="text-muted"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            {(searchResults.cities.length > 0 || searchResults.stations.length > 0) && (
              <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-96 overflow-y-auto rounded-2xl border border-border bg-surface p-1.5 shadow-2xl">
                {searchResults.cities.map((c) => (
                  <button
                    key={c.slug}
                    onClick={() => {
                      setSearchQ('');
                      router.push(`/map?city=${c.slug}`);
                    }}
                    className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-surface-2"
                  >
                    <MapPin className="size-4 text-muted" />
                    {c.name}
                    <span className="text-xs text-muted">город</span>
                  </button>
                ))}
                {searchResults.stations.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      ymGoal('station_found');
                      setSearchQ('');
                      selectStation(s.id);
                    }}
                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {s.name}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {s.address}
                      </span>
                    </span>
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: STATUS_META[s.status].color }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* меню «Ещё»: установка, каналы — всё вторичное живёт тут */}
          <div className="pointer-events-auto relative shrink-0">
            <button
              onClick={() =>
                overlay === 'menu' ? setOverlay(null) : openOverlay('menu')
              }
              aria-label="Ещё"
              className="grid size-11 place-items-center rounded-2xl border border-border bg-surface/80 shadow-lg backdrop-blur-xl"
            >
              <MoreHorizontal className="size-4" />
            </button>
            {overlay === 'menu' && (
              <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl border border-border bg-surface p-1.5 shadow-2xl">
                <button
                  onClick={() => {
                    ymGoal('install_clicked');
                    openOverlay('install');
                  }}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-surface-2"
                >
                  <Download className="size-4 text-muted" />
                  Установить приложение
                </button>
                <button
                  onClick={() => openOverlay('community')}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-surface-2"
                >
                  <Share2 className="size-4 text-muted" />
                  Наши каналы
                </button>
                <Link
                  href="/o-servise"
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-surface-2"
                >
                  <MapPin className="size-4 text-muted" />
                  О сервисе
                </Link>
                {lastUpdate && (
                  <p className="px-3 py-2 text-xs text-muted">
                    Данные обновлены {freshness(lastUpdate)}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Фильтры: топливо + статусы рядом (решение владельца), сеть и
            режимы показа — в sheet «Фильтры» */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="pb-chips pointer-events-auto min-w-0 flex-1">
            <div className="flex w-max gap-1 rounded-2xl border border-border bg-surface/80 p-1 shadow-lg backdrop-blur-xl">
              <FilterChip active={fuel === null} onClick={() => setFuel(null)} label="Все" />
              {FUELS.map((f) => (
                <FilterChip
                  key={f}
                  active={fuel === f}
                  onClick={() => setFuel(fuel === f ? null : f)}
                  label={FUEL_LABEL[f]}
                />
              ))}
            </div>
          </div>
          <button
            onClick={() => {
              if (overlay === 'filters') {
                setOverlay(null);
              } else {
                ymGoal('filters_open');
                openOverlay('filters');
              }
            }}
            aria-label={
              activeFilterCount > 0
                ? `Фильтры, выбрано ${activeFilterCount}`
                : 'Фильтры'
            }
            className="pointer-events-auto flex min-h-11 shrink-0 items-center gap-1.5 rounded-2xl border border-border bg-surface/80 px-3 py-2 text-sm font-medium shadow-lg backdrop-blur-xl"
          >
            <SlidersHorizontal className="size-4" />
            <span className="hidden sm:inline">Фильтры</span>
            {activeFilterCount > 0 && (
              <span
                aria-hidden="true"
                className="grid size-5 place-items-center rounded-full bg-primary text-xs font-semibold text-white"
              >
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
        <div className="pb-chips pointer-events-auto mt-1.5">
          <div className="flex w-max gap-1 rounded-2xl border border-border bg-surface/80 p-1 shadow-lg backdrop-blur-xl">
            {MARK_STATUSES.map((s) => (
              <FilterChip
                key={s}
                active={status === s}
                onClick={() => setStatus(status === s ? null : s)}
                label={STATUS_META[s].label.split(' ')[0]}
                dot={STATUS_META[s].color}
              />
            ))}
          </div>
        </div>
      </header>

      {/* Единственная нижняя плашка: счётчик + свежесть последней метки.
          «Найти рядом» — по нажатию. Скрыта, пока открыт любой sheet. */}
      {!selected && !overlay && (
        <button
          onClick={openNearby}
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 40px)' }}
          className="absolute left-1/2 z-20 flex min-h-12 max-w-[92vw] -translate-x-1/2 items-center gap-2.5 rounded-2xl bg-text px-5 py-3 text-sm font-semibold text-background shadow-2xl transition-transform hover:scale-[1.03]"
        >
          <span className="size-2.5 shrink-0 rounded-full bg-[#16A34A]" />
          <span className="truncate">
            {liveCount > 0 ? `${liveCount} АЗС с бензином` : 'Найти рядом'}
            {activity?.lastMarkAt
              ? ` · метка ${freshness(new Date(activity.lastMarkAt))}`
              : ''}
          </span>
          <List className="size-4 shrink-0 opacity-70" />
        </button>
      )}

      {/* Неблокирующие подсказки: смена города по GPS и гео-фейл */}
      {citySuggest && !selected && (
        <div
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
          className="absolute left-1/2 z-20 flex max-w-[92vw] -translate-x-1/2 items-center gap-2 rounded-2xl border border-border bg-surface/95 py-2 pl-4 pr-2 text-sm shadow-2xl backdrop-blur-xl"
        >
          <span className="truncate">Похоже, вы в {citySuggest.name}</span>
          <button
            onClick={() => {
              ymGoal('city_switch_confirmed');
              const slug = citySuggest.slug;
              setCitySuggest(null);
              router.push(`/map?city=${slug}`);
            }}
            className="shrink-0 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white"
          >
            Переключить
          </button>
          <button
            onClick={() => setCitySuggest(null)}
            aria-label="Скрыть"
            className="grid size-8 shrink-0 place-items-center rounded-xl text-muted"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      {geoToast && (
        <div
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
          className="absolute left-1/2 z-20 w-max max-w-[92vw] -translate-x-1/2 rounded-2xl border border-border bg-surface/95 px-4 py-2.5 text-center text-sm shadow-2xl backdrop-blur-xl"
        >
          {geoToast}
          {geoState === 'failed' && (
            <button
              onClick={() => {
                setGeoToast(null);
                requestGeo({ center: true });
              }}
              className="ml-2 font-semibold text-primary"
            >
              Повторить
            </button>
          )}
        </div>
      )}

      {/* Подробные фильтры: режим показа + сеть (как у ГдеБенз) */}
      {overlay === 'filters' && !selected && (
        <div className="pb-sheet absolute inset-x-2 bottom-2 z-20 mx-auto flex max-h-[75dvh] max-w-md flex-col overflow-y-auto rounded-3xl border border-border bg-surface p-5 shadow-2xl sm:bottom-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-base font-semibold">Показать на карте</p>
            <button
              onClick={() => setOverlay(null)}
              aria-label="Закрыть"
              className="grid size-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {(
              [
                ['all', 'Все АЗС', 'Показываем всё, включая «нет топлива»'],
                ['has', 'Где есть топливо', 'Есть, мало или очередь — по свежим отметкам'],
                ['strict', 'Только «есть топливо»', 'Строго зелёные отметки'],
              ] as [ViewMode, string, string][]
            ).map(([mode, title, sub]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-3.5 text-left transition-colors ${
                  viewMode === mode
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-surface-2'
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block text-xs text-muted">{sub}</span>
                </span>
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full ${
                    viewMode === mode ? 'bg-primary text-white' : 'border border-border'
                  }`}
                >
                  {viewMode === mode && <Check className="size-4" />}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-4 text-sm font-semibold">Сеть</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <FilterChip
              active={network === null}
              onClick={() => setNetwork(null)}
              label="Все"
            />
            {topNetworks.map((n) => (
              <FilterChip
                key={n}
                active={network === n}
                onClick={() => setNetwork(network === n ? null : n)}
                label={n}
              />
            ))}
          </div>
          <button
            onClick={() => setOverlay(null)}
            className="mt-5 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-press"
          >
            Готово
          </button>
        </div>
      )}

      {overlay === 'nearby' && !selected && (
        <section
          aria-label="Ближайшие заправки"
          className="pb-sheet absolute inset-x-2 bottom-2 z-20 mx-auto flex max-h-[60dvh] max-w-md flex-col rounded-3xl border border-border bg-surface shadow-2xl sm:inset-x-auto sm:left-4 sm:bottom-4 sm:w-96"
        >
          <div className="flex items-center justify-between gap-3 p-5 pb-2">
            <div>
              <p className="text-base font-semibold">Рядом с вами</p>
              <p className="mt-0.5 text-xs text-muted">
                {userPos
                  ? 'от вашего местоположения'
                  : 'от центра карты — разрешите геолокацию для точности'}
              </p>
            </div>
            <button
              onClick={() => setOverlay(null)}
              aria-label="Закрыть"
              className="grid size-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 pt-0">
            {nearby.length === 0 ? (
              <p className="px-2 py-4 text-sm text-muted">
                Под текущие фильтры ничего нет. Попробуйте убрать фильтр.
              </p>
            ) : (
              <ul>
                {nearby.map(({ s, km }) => (
                  <li key={s.id} className="flex items-center gap-1">
                    <button
                      onClick={() => selectStation(s.id)}
                      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                    >
                      <BrandChip network={s.network} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {s.network ?? s.name}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {geoState === 'approximate' ? '≈ ' : ''}{formatKm(km)} · {freshness(s.updatedAt ? new Date(s.updatedAt) : null)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span
                          className={`block text-xs font-medium ${STATUS_META[s.status].fg}`}
                        >
                          {STATUS_META[s.status].label.split(' ')[0]}
                        </span>
                      </span>
                    </button>
                    <a
                      href={yandexRoute(s.lat, s.lng)}
                      onClick={() => {
                        ymGoal('route_click', { stationId: s.id });
                        saveRouteIntent(s.id, s.network ?? s.name);
                      }}
                      target="_blank"
                      rel="noopener"
                      aria-label={`Поехать: ${s.network ?? s.name}`}
                      className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition-colors hover:bg-primary/20"
                    >
                      <Navigation className="size-4" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* Карточка станции */}
      {selected && (
        <StationCard
          key={selected.id}
          station={selected}
          km={
            userPos
              ? distanceKm(userPos[0], userPos[1], selected.lat, selected.lng)
              : null
          }
          onClose={() => setSelectedId(null)}
          onMark={(p) => sendMark(selected.id, p)}
          onRefine={refineMark}
          onDone={() => {
            setSelectedId(null);
            setOverlay('afterMark');
          }}
        />
      )}

      {/* «Удалось заправиться?» — после возврата из навигатора */}
      {routePrompt && !selected && (
        <div className="pb-sheet absolute inset-x-2 bottom-2 z-30 mx-auto max-w-md rounded-3xl border border-border bg-surface p-6 text-center shadow-2xl sm:bottom-4">
          <p className="text-lg font-bold leading-tight">
            Удалось заправиться на «{routePrompt.name}»?
          </p>
          <p className="mt-1 text-sm text-muted">
            Ваш ответ прямо сейчас поможет другим водителям.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              disabled={routePromptBusy}
              onClick={() => answerRoutePrompt('AVAILABLE')}
              className="rounded-2xl bg-[#16A34A] px-4 py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Да, топливо есть
            </button>
            <button
              disabled={routePromptBusy}
              onClick={() => answerRoutePrompt('OUT')}
              className="rounded-2xl bg-[#EF4444] px-4 py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Нет топлива
            </button>
          </div>
          <button
            onClick={() => answerRoutePrompt(null)}
            className="mt-2 w-full rounded-2xl px-4 py-2.5 text-sm text-muted transition-colors hover:bg-surface-2"
          >
            Не доехал / не знаю
          </button>
        </div>
      )}

      {/* Подсказка первого визита: два равнозначных выхода — гео или город.
          Равнозначных намеренно: у ГдеБенз отказ от гео тоже не ведёт в
          тупик, и это правильная часть его сценария. Лист не перекрывает
          карту и закрывается крестиком. */}
      {onboard && !selected && !overlay && (
        <div className="pb-sheet absolute inset-x-2 bottom-2 z-30 mx-auto max-w-md rounded-3xl border border-border bg-surface p-5 shadow-2xl sm:bottom-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-bold leading-tight">
                Показать заправки рядом с вами?
              </p>
              <p className="mt-1 text-sm text-muted">
                Сейчас на карте {city.name}.
              </p>
            </div>
            <button
              onClick={closeOnboard}
              aria-label="Закрыть подсказку"
              className="grid size-9 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                closeOnboard();
                requestGeo({ center: true });
              }}
              className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-3 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-press"
            >
              <Navigation className="size-4" />
              Показать рядом
            </button>
            <button
              onClick={() => {
                closeOnboard();
                setCityOpen(true);
              }}
              className="min-h-12 rounded-2xl border border-border px-3 py-3 text-sm font-semibold transition-colors hover:bg-surface-2"
            >
              Выбрать город
            </button>
          </div>
          <p className="mt-3 text-center text-xs text-muted">
            Координаты остаются в браузере — на наш сервер они не уходят.
          </p>
        </div>
      )}

      {/* После метки: спасибо + каналы + «поделиться» (рост подписчиков) */}
      {overlay === 'afterMark' && !selected && (
        <div className="pb-sheet absolute inset-x-2 bottom-2 z-20 mx-auto flex max-h-[85dvh] max-w-md flex-col overflow-y-auto rounded-3xl border border-border bg-surface p-6 text-center shadow-2xl sm:bottom-4">
          <p className="text-lg font-bold leading-tight">
            Спасибо — вы помогли другим водителям 🙌
          </p>
          <p className="mt-1 text-sm text-muted">
            {activity && activity.driversToday > 1
              ? `Вашу отметку сегодня увидят ~${activity.driversToday} водителей.`
              : 'На карте видно, когда вашу заправку подтвердят другие.'}
          </p>
          <p className="mt-4 text-sm font-semibold">Будьте на связи:</p>
          <div className="mt-2">
            <CommunityPanel />
          </div>
          <button
            onClick={shareService}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-press"
          >
            <Share2 className="size-4" />
            {shareCopied ? 'Ссылка скопирована ✓' : 'Поделиться с друзьями'}
          </button>
          {/* удержание в пик готовности: человек только что внёс вклад —
              предлагаем установить, чтобы возвращаться и отмечать быстрее.
              Не авто-показ (кнопка по выбору), уже установленным не нужно. */}
          {!standalone && (
            <button
              onClick={() => {
                ymGoal('install_clicked');
                setOverlay('install');
              }}
              className="mt-2 w-full rounded-2xl border border-border px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-surface-2"
            >
              📲 Установить — отмечать в один тап
            </button>
          )}
          <button
            onClick={closeAfterMark}
            className="mt-2 w-full rounded-2xl px-4 py-2.5 text-sm text-muted transition-colors hover:bg-surface-2"
          >
            Закрыть
          </button>
        </div>
      )}

      {/* «Наши каналы» — только по действию пользователя (меню / после метки) */}
      {overlay === 'community' && !selected && (
        <div className="pb-sheet absolute inset-x-2 bottom-2 z-20 mx-auto max-w-lg rounded-3xl border border-border bg-surface p-6 shadow-2xl sm:bottom-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-base font-semibold">Наши каналы</p>
            <button
              onClick={() => setOverlay(null)}
              aria-label="Закрыть"
              className="grid size-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2"
            >
              <X className="size-5" />
            </button>
          </div>
          <p className="mt-1 text-sm text-muted">
            Новые отметки и рабочая ссылка на сервис — всегда в наших каналах.
          </p>
          <div className="mt-4">
            <CommunityPanel />
          </div>
        </div>
      )}

      {/* Мастер установки — только из меню «Ещё» */}
      {overlay === 'install' && !selected && (
        <InstallApp onClose={() => setOverlay(null)} />
      )}

      {/* Разовое «Спасибо» при первом запуске установленного PWA */}
      <InstallThanks />

      {/* Дисклеймер + атрибуция данных АЗС (ODbL — обязательна на карте) */}
      <p className="absolute bottom-2 left-2 z-10 hidden rounded-xl border border-border bg-surface/80 px-3 py-1.5 text-xs text-muted shadow-lg backdrop-blur-xl sm:block">
        Данные — отметки самих водителей. Проверяйте на месте. АЗС —{' '}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener"
          className="underline"
        >
          © участники OpenStreetMap
        </a>
      </p>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener"
        className="absolute bottom-9 left-2 z-10 rounded-lg bg-surface/80 px-2 py-0.5 text-[10px] text-muted backdrop-blur-xl sm:hidden"
        style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        АЗС © участники OpenStreetMap
      </a>
    </div>
  );
}

function StationCard({
  station,
  km,
  onClose,
  onMark,
  onRefine,
  onDone,
}: {
  station: ClientStation;
  km: number | null;
  onClose: () => void;
  onMark: (p: MarkPayload) => Promise<string | null>;
  onRefine: (
    markId: string,
    fuelTypes: string[],
    queueSize: keyof typeof QUEUE_LABEL | null
  ) => Promise<boolean>;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // ленивый инициализатор: НЕ setState в эффекте (карточка монтируется
  // заново на каждую станцию — key={id}, поэтому одного чтения хватает)
  const [fav, setFav] = useState(() => getFavs().includes(station.id));
  const [histOpen, setHistOpen] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [history, setHistory] = useState<HistoryMark[] | null>(null);
  // уточнение своей метки: «какое топливо?» после быстрого тапа статуса
  const [markId, setMarkId] = useState<string | null>(null);
  const [sentStatus, setSentStatus] =
    useState<Exclude<StatusCode, 'UNKNOWN'> | null>(null);
  const [refineFuels, setRefineFuels] = useState<string[]>([]);
  const [refineQueue, setRefineQueue] =
    useState<keyof typeof QUEUE_LABEL | null>(null);
  const [refineDone, setRefineDone] = useState(false);
  const [refining, setRefining] = useState(false);
  const meta = STATUS_META[station.status];
  // устаревшие данные не бывают «очень надёжными»
  const rawStars = trustStars(station.agreePct, station.marks24h);
  const stars =
    rawStars === null
      ? null
      : station.freshness === 'week'
        ? Math.min(rawStars, 1)
        : station.stale
          ? Math.min(rawStars, 2)
          : rawStars;

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/history?stationId=${station.id}`);
      if (!res.ok) return;
      const data = (await res.json()) as { marks: HistoryMark[] };
      setHistory(data.marks);
    } catch {
      // история не критична — карточка работает и без неё
    }
  }, [station.id]);

  useEffect(() => {
    // микротаск: setState только после await, не синхронно в эффекте
    void Promise.resolve().then(loadHistory);
  }, [loadHistory]);

  async function handleMark(p: MarkPayload, fullForm = false) {
    if (sending) return;
    setSending(true);
    setSendError(false);
    const id = await onMark(p);
    setSending(false);
    if (id !== null) {
      setConfirming(false);
      setThanks(true);
      setMarkId(id);
      setSentStatus(p.status);
      // полная форма уже всё собрала — доуточнять нечего
      if (fullForm) setRefineDone(true);
      loadHistory();
    } else {
      setSendError(true);
    }
  }

  // — форма 3.0: марки чекбоксами, незачёкнутые известные марки = «нет»
  const [fStatus, setFStatus] =
    useState<'AVAILABLE' | 'LOW' | 'QUEUE' | 'CLOSED' | null>(null);
  const [fFuels, setFFuels] = useState<string[]>([]);
  const [fTouched, setFTouched] = useState(false);
  const [fQueue, setFQueue] = useState<keyof typeof QUEUE_LABEL | null>(null);
  const [fLimit, setFLimit] = useState<string | null>(null);
  // цены по маркам, ₽/л (необязательно) — сырой ввод строкой на марку
  const [fPrices, setFPrices] = useState<Record<string, string>>({});

  // строки цен → числа для валидного диапазона; иначе марку пропускаем
  function pricesPayload(fuels: string[]): Record<string, number> | undefined {
    const out: Record<string, number> = {};
    for (const f of fuels) {
      const n = Number((fPrices[f] ?? '').replace(',', '.'));
      if (Number.isFinite(n) && n >= 10 && n <= 200) out[f] = Math.round(n * 100) / 100;
    }
    return Object.keys(out).length ? out : undefined;
  }

  // известные марки станции (для превью «Нет: …»)
  const knownFuels = station.fuelStatuses.map((f) => f.code);
  const derivedOut = fTouched
    ? (knownFuels.length ? knownFuels : []).filter((f) => !fFuels.includes(f))
    : [];
  const formProgress =
    (fStatus ? 1 : 0) + (fTouched ? 1 : 0) + (fQueue ? 1 : 0) + (fLimit ? 1 : 0);

  function submitForm() {
    if (!fStatus) return;
    const status: MarkPayload['status'] =
      fStatus === 'CLOSED'
        ? 'CLOSED'
        : fTouched && fFuels.length === 0
          ? 'OUT'
          : fStatus;
    const priceObj = pricesPayload(fFuels);
    if (priceObj) ymGoal('price_added');
    handleMark(
      {
        status,
        fuelTypes: fFuels,
        fuelsOut: derivedOut,
        ...(fQueue && fStatus !== 'CLOSED' ? { queueSize: fQueue } : {}),
        ...(fLimit && fStatus !== 'CLOSED' ? { limitInfo: fLimit } : {}),
        ...(priceObj ? { prices: priceObj } : {}),
      },
      true
    );
  }

  async function handleRefine() {
    if (!markId || refining) return;
    setRefining(true);
    const ok = await onRefine(markId, refineFuels, refineQueue);
    setRefining(false);
    if (ok) {
      setRefineDone(true);
      loadHistory();
    }
  }

  return (
    <section
      aria-label={station.name}
      className="pb-sheet absolute inset-x-2 bottom-2 z-20 mx-auto flex max-h-[70dvh] max-w-md flex-col rounded-3xl border border-border bg-surface shadow-2xl sm:inset-x-auto sm:left-4 sm:top-40 sm:bottom-4 sm:max-h-none sm:w-96"
    >
      <div className="flex items-start justify-between gap-2 p-6 pb-0">
        <div className="flex min-w-0 items-start gap-3">
          <BrandChip network={station.network} size={40} />
          <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold leading-tight">
            {station.network ?? station.name}
          </h2>
          <p className="mt-1 truncate text-sm text-muted">
            {km !== null && <span>{formatKm(km)} от вас · </span>}
            {station.address}
          </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setFav(toggleFav(station.id))}
            aria-label={fav ? 'Убрать из сохранённых' : 'Сохранить заправку'}
            className={`grid size-11 place-items-center rounded-xl transition-colors hover:bg-surface-2 ${fav ? 'text-primary' : 'text-muted'}`}
          >
            <Bookmark className={`size-5 ${fav ? 'fill-current' : ''}`} />
          </button>
          <button
            // после успешной метки закрытие ведёт в окно «спасибо + каналы»
            onClick={markId ? onDone : onClose}
            aria-label="Закрыть"
            className="grid size-11 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-0">
        {thanks ? (
          <div className="mt-5 rounded-2xl bg-primary/10 p-6 text-center">
            <p className="text-2xl">❤️</p>
            <p className="mt-2 text-base font-semibold">Спасибо!</p>
            <p className="mt-1 text-sm text-muted">
              Вы помогли другим водителям.
            </p>

            {/* Уточнение: какое топливо — иначе «нет топлива» ни о чём */}
            {markId && sentStatus && sentStatus !== 'CLOSED' && !refineDone && (
              <div className="mt-4 rounded-2xl bg-surface p-4 text-left">
                <p className="text-sm font-medium">
                  {sentStatus === 'OUT'
                    ? 'Какого топлива нет?'
                    : 'Какое топливо есть?'}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {FUELS.map((f) => (
                    <button
                      key={f}
                      onClick={() =>
                        setRefineFuels((prev) =>
                          prev.includes(f)
                            ? prev.filter((x) => x !== f)
                            : [...prev, f]
                        )
                      }
                      className={`min-h-10 rounded-xl px-3.5 py-1.5 text-sm font-medium transition-colors ${
                        refineFuels.includes(f)
                          ? 'bg-text text-background'
                          : 'bg-surface-2 text-muted hover:text-text'
                      }`}
                    >
                      {FUEL_LABEL[f]}
                    </button>
                  ))}
                </div>
                {sentStatus !== 'OUT' && (
                  <>
                    <p className="mt-3 text-sm font-medium">Есть очередь?</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(
                        [
                          ['NONE', 'Нет'],
                          ['UNDER_5', 'До 5 машин'],
                          ['FIVE_TO_20', '5–20'],
                          ['OVER_20', '20+'],
                        ] as const
                      ).map(([code, label]) => (
                        <button
                          key={code}
                          onClick={() =>
                            setRefineQueue((prev) =>
                              prev === code ? null : code
                            )
                          }
                          className={`min-h-10 rounded-xl px-3.5 py-1.5 text-sm font-medium transition-colors ${
                            refineQueue === code
                              ? 'bg-text text-background'
                              : 'bg-surface-2 text-muted hover:text-text'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {refineDone && (
              <p className="mt-3 text-sm font-medium text-primary">
                Уточнение принято 🙌
              </p>
            )}

            {/* одна кнопка (решение владельца): «Готово» само отправляет
                заполненное уточнение и закрывает карточку */}
            <button
              disabled={refining}
              onClick={async () => {
                if (!refineDone && (refineFuels.length > 0 || refineQueue)) {
                  await handleRefine();
                }
                onDone();
              }}
              className="mt-4 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-press disabled:opacity-40"
            >
              Готово
            </button>
          </div>
        ) : confirming ? (
          <div className="mt-5">
            {/* прогресс: психология завершения формы */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Что происходит?</p>
              <span className="text-xs text-muted">{formProgress} из 4</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${(formProgress / 4) * 100}%` }}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {(
                [
                  ['AVAILABLE', 'Есть топливо'],
                  ['LOW', 'Топлива мало'],
                  ['QUEUE', 'Большая очередь'],
                  ['CLOSED', 'Заправка закрыта'],
                ] as const
              ).map(([code, label]) => (
                <button
                  key={code}
                  onClick={() => setFStatus(fStatus === code ? null : code)}
                  className={`flex min-h-12 items-center gap-2.5 rounded-2xl border px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                    fStatus === code
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-surface-2'
                  }`}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: STATUS_META[code].color }}
                  />
                  {label}
                </button>
              ))}
            </div>

            {fStatus && fStatus !== 'CLOSED' && (
              <>
                <p className="mt-4 text-sm font-medium">
                  Какие марки сейчас есть?
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {FUELS.map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        ymGoal('fuel_selected');
                        setFTouched(true);
                        setFFuels((prev) =>
                          prev.includes(f)
                            ? prev.filter((x) => x !== f)
                            : [...prev, f]
                        );
                      }}
                      className={`min-h-11 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                        fFuels.includes(f)
                          ? 'bg-primary text-white'
                          : 'bg-surface-2 text-muted hover:text-text'
                      }`}
                    >
                      {FUEL_LABEL[f]}
                    </button>
                  ))}
                </div>

                {fFuels.length > 0 && (
                  <>
                    <p className="mt-4 text-sm font-medium">
                      Цена, ₽/л{' '}
                      <span className="font-normal text-muted">
                        — по желанию, поможет другим
                      </span>
                    </p>
                    <div className="mt-2 space-y-2">
                      {fFuels.map((f) => (
                        <div key={f} className="flex items-center gap-2">
                          <span className="w-14 text-sm text-muted">
                            {FUEL_LABEL[f]}
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={10}
                            max={200}
                            step={0.1}
                            value={fPrices[f] ?? ''}
                            onChange={(e) =>
                              setFPrices((prev) => ({
                                ...prev,
                                [f]: e.target.value,
                              }))
                            }
                            placeholder="напр. 62,90"
                            className="w-32 rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                          />
                          <span className="text-sm text-muted">₽/л</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <p className="mt-4 text-sm font-medium">Сколько ждать?</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(
                    [
                      ['NONE', 'Свободно'],
                      ['UNDER_5', 'До 5 мин'],
                      ['FIVE_TO_20', '5–15 мин'],
                      ['M15_30', '15–30 мин'],
                      ['OVER_30', '30+ мин'],
                    ] as const
                  ).map(([code, label]) => (
                    <button
                      key={code}
                      onClick={() => {
                        ymGoal('queue_selected');
                        setFQueue((prev) => (prev === code ? null : code));
                      }}
                      className={`min-h-11 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
                        fQueue === code
                          ? 'bg-text text-background'
                          : 'bg-surface-2 text-muted hover:text-text'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <p className="mt-4 text-sm font-medium">
                  Лимит отпуска{' '}
                  <span className="font-normal text-muted">
                    (если объявлен)
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(
                    [
                      ['NONE', 'Без лимита'],
                      ['FULL_TANK', 'До полного'],
                      ['L10', '10 л'],
                      ['L20', '20 л'],
                      ['L30', '30 л'],
                      ['L40', '40 л'],
                      ['L50', '50 л'],
                    ] as const
                  ).map(([code, label]) => (
                    <button
                      key={code}
                      onClick={() => {
                        ymGoal('limit_selected');
                        setFLimit((prev) => (prev === code ? null : code));
                      }}
                      className={`min-h-11 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
                        fLimit === code
                          ? 'bg-text text-background'
                          : 'bg-surface-2 text-muted hover:text-text'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* превью: человек видит, что именно отправляет */}
            {fStatus && fTouched && (fFuels.length > 0 || derivedOut.length > 0) && (
              <div className="mt-4 rounded-2xl border border-dashed border-border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Так это увидят другие
                </p>
                {fFuels.length > 0 && (
                  <p className="mt-1.5 text-sm">
                    <span className="font-medium text-green-700 dark:text-green-400">
                      Есть:
                    </span>{' '}
                    {fFuels.map((f) => FUEL_LABEL[f]).join(', ')}
                  </p>
                )}
                {derivedOut.length > 0 && (
                  <p className="mt-0.5 text-sm">
                    <span className="font-medium text-red-700 dark:text-red-400">
                      Нет:
                    </span>{' '}
                    {derivedOut.map((f) => FUEL_LABEL[f]).join(', ')}
                  </p>
                )}
              </div>
            )}

            <button
              disabled={sending || !fStatus}
              onClick={submitForm}
              className="mt-4 w-full rounded-2xl bg-primary px-4 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-press disabled:opacity-40"
            >
              Отправить
            </button>
            <button
              disabled={sending}
              onClick={() => setConfirming(false)}
              className="mt-2 w-full rounded-2xl px-4 py-2.5 text-sm text-muted transition-colors hover:bg-surface-2"
            >
              Отмена
            </button>
            {sendError && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">
                Не получилось отправить. Попробуйте ещё раз.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* 1. Статус + свежесть + достоверность — один блок в цвет
                статуса (сценарий владельца по разбору конкурента) */}
            <div className={`mt-5 rounded-2xl p-4 ${meta.bg}`}>
              <p className={`text-xl font-bold leading-tight ${meta.fg}`}>
                {statusHeadline(station)}
              </p>
              {station.real ? (
                <p className="mt-1 text-sm font-medium">
                  Проверено{' '}
                  {freshness(
                    station.updatedAt ? new Date(station.updatedAt) : null
                  )}
                  {station.confirms60m >= 2
                    ? ` · ${station.confirms60m} ${pluralRu(station.confirms60m, 'водитель', 'водителя', 'водителей')} за час`
                    : station.marks24h > 0
                      ? ` · ${station.marks24h} ${pluralRu(station.marks24h, 'водитель', 'водителя', 'водителей')} за сутки`
                      : ''}
                </p>
              ) : (
                // seed-статус: НЕ выдаём за отметки водителей (ФЗ-152/реклама)
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                  <span className="rounded-md bg-gray-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                    демо
                  </span>
                  Демонстрационные данные · отметок водителей пока нет
                </p>
              )}
              {station.stale && (
                <p className="mt-1 text-xs text-muted">
                  ⚠ Данные устарели — проверьте и подтвердите
                </p>
              )}
              {station.freshness === 'week' && (
                <p className="mt-1 text-xs text-muted">
                  🕓 Данные недельной давности — проверьте и подтвердите
                </p>
              )}
              {/* достоверность словами, не псевдопроцентами: до 3 меток
                  честное «мало данных» (решение владельца) */}
              {station.status !== 'UNKNOWN' && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium">
                  {station.real &&
                  station.agreePct !== null &&
                  station.agreePct >= 80 &&
                  station.marks24h >= 3 ? (
                    <>
                      <Check className="size-3.5 text-green-700 dark:text-green-400" />
                      Последние отметки совпадают · высокая достоверность
                    </>
                  ) : stars !== null && stars >= 4 ? (
                    <>
                      <Star className="size-3.5 fill-amber-400 text-amber-400" />
                      Высокая достоверность
                    </>
                  ) : stars !== null && stars === 3 ? (
                    <>
                      <Star className="size-3.5 fill-amber-400 text-amber-400" />
                      Средняя достоверность
                    </>
                  ) : (
                    <span className="text-muted">
                      Мало данных — подтвердите, если вы рядом
                    </span>
                  )}
                </p>
              )}
            </div>

            {/* 1б. Противоречие в отметках. Прятать расхождение нельзя:
                человек поедет на пустую колонку. Показываем прямо, как
                это делает ГдеБенз, но своим текстом и только при переходе
                через группу «есть»/«нет» (см. Dispute в lib/status.ts). */}
            {station.dispute && (
              <p className="mt-3 rounded-2xl bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                {station.dispute.count > 1
                  ? `${station.dispute.count} ${pluralRu(station.dispute.count, 'водитель', 'водителя', 'водителей')} за сутки отметили «${STATUS_META[station.dispute.status].label.toLowerCase()}» — отметки расходятся. Уточните перед поездкой.`
                  : `Водитель ${freshness(new Date(station.dispute.at))} отметил «${STATUS_META[station.dispute.status].label.toLowerCase()}» — возможно, ситуация изменилась. Уточните перед поездкой.`}
              </p>
            )}

            {/* 2. Действия: подтвердить/изменить — раньше маршрута.
                Одно-тап «Да, подтверждаю» только для станций с РЕАЛЬНЫМИ
                свежими данными: на демо/seed-карточке подтверждать нечего,
                иначе создаётся реальная метка-эхо демо (порча данных).
                На демо и на пустых — главный CTA ведёт в форму «сообщить». */}
            {station.status !== 'UNKNOWN' && station.real ? (
              <div className="mt-3">
                {/* вопрос перед кнопками: без него пара кнопок читается
                    как «оцените нас», а не как «подтвердите факт» */}
                <p className="mb-2 text-sm font-medium text-muted">
                  Это всё ещё актуально?
                </p>
                <div className="grid grid-cols-2 gap-2">
                <button
                  disabled={sending}
                  onClick={() => {
                    ymGoal('mark_started');
                    handleMark({
                      status: station.status as MarkPayload['status'],
                      fuelTypes: station.fuelTypes,
                    });
                  }}
                  className="flex min-h-12 items-center justify-center gap-1.5 rounded-2xl bg-primary px-3 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-press disabled:opacity-50"
                >
                  <Check className="size-4" />
                  Да, подтверждаю
                </button>
                <button
                  disabled={sending}
                  onClick={() => {
                    ymGoal('mark_started');
                    setConfirming(true);
                  }}
                  className="min-h-12 rounded-2xl border border-border px-3 py-3 text-sm font-semibold transition-colors hover:bg-surface-2 disabled:opacity-50"
                >
                  Ситуация изменилась
                </button>
                </div>
              </div>
            ) : (
              // один-тап: самые частые сигналы «есть»/«нет» отправляются
              // сразу, без многошаговой формы (снижаем трение — главная
              // причина 0 отметок). Марки из демо НЕ подставляем, иначе
              // получится метка-эхо демо-данных. Детали — за «Уточнить».
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    disabled={sending}
                    onClick={() => {
                      ymGoal('mark_started');
                      handleMark({ status: 'AVAILABLE', fuelTypes: [] });
                    }}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-press disabled:opacity-50"
                  >
                    <Check className="size-4" />
                    Есть бензин
                  </button>
                  <button
                    disabled={sending}
                    onClick={() => {
                      ymGoal('mark_started');
                      handleMark({ status: 'OUT', fuelTypes: [] });
                    }}
                    className="min-h-12 rounded-2xl border border-border px-4 py-3 text-sm font-semibold transition-colors hover:bg-surface-2 disabled:opacity-50"
                  >
                    Нет бензина
                  </button>
                </div>
                <button
                  disabled={sending}
                  onClick={() => {
                    ymGoal('mark_started');
                    setConfirming(true);
                  }}
                  className="min-h-11 w-full rounded-2xl px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 disabled:opacity-50"
                >
                  Уточнить: марки, очередь, цена
                </button>
              </div>
            )}
            {sendError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                Не получилось отправить. Попробуйте ещё раз.
              </p>
            )}

            {/* 3. Маршрут — второе главное действие, не прячем вниз */}
            <a
              href={yandexRoute(station.lat, station.lng)}
              onClick={() => {
                ymGoal('route_click', { stationId: station.id });
                saveRouteIntent(station.id, station.network ?? station.name);
              }}
              target="_blank"
              rel="noopener"
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-text px-4 py-3.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            >
              <Navigation className="size-4" />
              Построить маршрут
            </a>
            <p className="mt-1.5 text-center text-xs text-muted">
              откроется Яндекс Карты ·{' '}
              <a
                href={dgisRoute(station.lat, station.lng)}
                target="_blank"
                rel="noopener"
                className="font-medium text-primary hover:underline"
              >
                или в 2ГИС
              </a>
            </p>

            {/* 4. Статус по каждому виду топлива — сильнее одного общего */}
            {station.fuelStatuses.length > 0 && (
              <ul className="mt-3 divide-y divide-border rounded-2xl border border-border">
                {station.fuelStatuses.map((f) => {
                  const fm = STATUS_META[f.status];
                  const price = station.prices?.[f.code] ?? null;
                  return (
                    <li key={f.code} className="px-4 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">
                          {FUEL_LABEL[f.code] ?? f.code}
                        </span>
                        <span className="flex items-center gap-2">
                          {price && (
                            <span
                              className={`rounded-lg px-2 py-0.5 text-sm font-semibold tabular-nums ${
                                price.freshness === 'aging'
                                  ? 'bg-surface-2 text-muted'
                                  : 'bg-surface-2'
                              }`}
                            >
                              {price.value.toFixed(2)} ₽
                            </span>
                          )}
                          <span className={`flex items-center gap-2 text-sm font-medium ${fm.fg}`}>
                            <span
                              className="size-2 rounded-full"
                              style={{ background: fm.color }}
                            />
                            {f.status === 'AVAILABLE'
                              ? 'Есть'
                              : f.status === 'LOW'
                                ? 'Мало'
                                : f.status === 'QUEUE'
                                  ? 'Очередь'
                                  : f.status === 'UNKNOWN'
                                    ? 'Нет данных'
                                    : f.status === 'CLOSED'
                                      ? 'Закрыта'
                                      : 'Нет'}
                          </span>
                        </span>
                      </div>
                      {price && (
                        // у каждой цены — своё время, свежесть и подтверждения
                        <p className="mt-1 text-xs text-muted">
                          {price.freshness === 'aging' && 'устаревающая · '}
                          {freshness(new Date(price.updatedAt))}
                          {price.needsConfirm
                            ? ' · требует подтверждения'
                            : price.confirmed
                              ? ` · подтверждена (${price.confirmations})`
                              : ' · пока 1 отметка'}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {station.prices && (
              <p className="mt-1.5 text-xs text-muted">
                Последняя цена по отметкам водителей — не официальная цена
                АЗС. Проверяйте на месте.
              </p>
            )}

            {/* 5. Очередь и лимит */}
            {(station.queueSize || station.limitInfo) && (
              <dl className="mt-3 divide-y divide-border rounded-2xl border border-border text-sm">
                {station.queueSize && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <dt className="text-muted">Очередь</dt>
                    <dd className="font-medium">
                      {QUEUE_MINUTES[station.queueSize]}
                    </dd>
                  </div>
                )}
                {station.limitInfo && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <dt className="text-muted">Лимит</dt>
                    <dd className="font-medium">
                      {LIMIT_LABEL[station.limitInfo] ?? station.limitInfo}
                    </dd>
                  </div>
                )}
              </dl>
            )}
            {/* Здесь зарезервировано место под будущий рекламный слот —
                сейчас сознательно пустое, чтобы не ломать вёрстку потом. */}

            {/* История отметок — живая лента станции */}
            <div className="mt-5">
              <p className="text-sm font-semibold">История отметок</p>
              {history === null ? (
                <p className="mt-2 text-xs text-muted">Загружаем…</p>
              ) : history.length === 0 ? (
                <p className="mt-2 text-xs text-muted">
                  Отметок ещё не было. Ваша станет первой.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {(histOpen ? history : history.slice(0, 3)).map((m, i, shown) => {
                    const hm = STATUS_META[m.status];
                    const phrase = historyPhrase(m, history[i + 1]);
                    const details = [
                      phrase.includes(':') || !m.fuelTypes.length
                        ? null
                        : m.fuelTypes.map((f) => FUEL_LABEL[f] ?? f).join(', '),
                      m.queueSize && m.queueSize !== 'NONE'
                        ? QUEUE_LABEL[m.queueSize].toLowerCase()
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <li key={m.id} className="flex items-start gap-3">
                        <span className="flex flex-col items-center self-stretch">
                          <span
                            className="mt-1 size-2.5 shrink-0 rounded-full"
                            style={{ background: hm.color }}
                          />
                          {i < shown.length - 1 && (
                            <span className="mt-1 w-px flex-1 bg-border" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1 pb-1">
                          <span className="block text-xs text-muted">
                            {freshness(new Date(m.createdAt))}
                          </span>
                          <span className={`block truncate text-sm font-medium ${hm.fg}`}>
                            {phrase}
                          </span>
                          {details && (
                            <span className="block truncate text-xs text-muted">
                              {details}
                            </span>
                          )}
                          {m.prices && Object.keys(m.prices).length > 0 && (
                            <span className="mt-0.5 block text-xs text-muted">
                              {Object.entries(m.prices)
                                .map(
                                  ([f, p]) =>
                                    `${FUEL_LABEL[f] ?? f} ${p.toFixed(2)} ₽`
                                )
                                .join(' · ')}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {history !== null && history.length > 3 && (
                <button
                  onClick={() => setHistOpen((v) => !v)}
                  className="mt-2 text-sm font-medium text-primary hover:underline"
                >
                  {histOpen
                    ? 'Свернуть'
                    : `Показать все (${history.length})`}
                </button>
              )}
            </div>

            {/* 7. Поделиться конкретной ситуацией — сильнее общей ссылки */}
            <button
              onClick={async () => {
                ymGoal('share_click');
                const text = `${station.network ?? station.name}: ${statusHeadline(station).toLowerCase()} (${freshness(station.updatedAt ? new Date(station.updatedAt) : null)}) — Тут Бензин`;
                try {
                  if (navigator.share) {
                    await navigator.share({ text, url: SITE_URL });
                  } else {
                    await navigator.clipboard.writeText(`${text} ${SITE_URL}`);
                  }
                } catch {
                  // отмена системного шэра — не ошибка
                }
              }}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2"
            >
              <Share2 className="size-4" />
              Поделиться ситуацией
            </button>
          </>
        )}
      </div>
    </section>
  );
}

// «Будьте на связи»: Новости (каналы) и Общение водителей (чаты) —
// один блок для входа на карту и для «Спасибо» после метки
// Фирменные значки мессенджеров — по макету владельца ссылки должны
// узнаваться иконкой, а не словами «Официальный …»
function AppIcon({ app }: { app: 'Telegram' | 'MAX' | 'VK' }) {
  if (app === 'Telegram') {
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#2AABEE] to-[#229ED9]">
        <svg viewBox="0 0 24 24" className="size-3.5 fill-white" aria-hidden>
          <path d="M20.6 4.1 3.3 10.9c-1.1.44-1.08 1.13-.16 1.42l4.35 1.38 1.66 5.16c.2.56.37.77.76.77.38 0 .55-.18.86-.48l2.06-2.03 4.28 3.2c.79.44 1.36.21 1.55-.74l2.82-13.4c.29-1.16-.43-1.68-1.32-1.28ZM8.3 13.4l9.43-6.03c.47-.29.9-.13.55.19l-7.66 7-.3 3.23-2.02-4.39Z" />
        </svg>
      </span>
    );
  }
  if (app === 'VK') {
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#0077FF]">
        <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden>
          <text
            x="12"
            y="16.5"
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fontFamily="system-ui, -apple-system, sans-serif"
            fill="#fff"
          >
            VK
          </text>
        </svg>
      </span>
    );
  }
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6]">
      <svg viewBox="0 0 24 24" className="size-3.5 fill-white" aria-hidden>
        <path d="M12 3.5a8.5 8.5 0 0 0-8.5 8.5c0 4.7 3.8 8.5 8.5 8.5h7.6c.5 0 .9-.4.9-.9V12A8.5 8.5 0 0 0 12 3.5Zm-4 6.7h8v1.6H8v-1.6Zm0 3.2h5.5V15H8v-1.6Z" />
      </svg>
    </span>
  );
}

// Единый блок 2×2: назначение мелко, мессенджер крупно, значок справа.
// Всегда две колонки фиксированной сетки — не зависит от брейкпоинтов
// экрана (прошлая вёрстка разъезжалась внутри узкой карточки)
function CommunityPanel() {
  return (
    <div className="grid grid-cols-2 gap-2 text-left">
      {COMMUNITY.map((c) => (
        <a
          key={c.key}
          href={c.href}
          target="_blank"
          rel="noopener"
          onClick={() => {
            ymGoal('community_click');
            // воронка по площадкам (список владельца)
            ymGoal(
              c.app === 'Telegram'
                ? 'telegram_click'
                : c.app === 'MAX'
                  ? 'max_click'
                  : 'vk_click'
            );
          }}
          className="flex min-h-14 items-center justify-between gap-1.5 rounded-2xl bg-surface-2/60 px-2.5 py-2.5 transition-colors hover:bg-surface-2"
        >
          <span className="min-w-0">
            <span className="block truncate text-[10px] font-medium text-muted">
              {c.kind === 'news' ? '📢 Новости' : '💬 Чат водителей'}
            </span>
            <span className="block truncate text-sm font-semibold">
              {c.app === 'VK' ? 'ВКонтакте' : c.app}
            </span>
          </span>
          <AppIcon app={c.app} />
        </a>
      ))}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  dot?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-text text-background'
          : 'text-muted hover:bg-surface-2 hover:text-text'
      }`}
    >
      {dot && (
        <span className="size-2 rounded-full" style={{ background: dot }} />
      )}
      {label}
    </button>
  );
}

// Лента истории говорит человеческим языком: не «статус AVAILABLE»,
// а «Появилось: 95, ДТ» — фраза выводится из ПЕРЕХОДА между метками.
function historyPhrase(cur: HistoryMark, prev: HistoryMark | undefined): string {
  const fuels = cur.fuelTypes.map((f) => FUEL_LABEL[f] ?? f).join(', ');
  const outs = (cur.fuelsOut ?? []).map((f) => FUEL_LABEL[f] ?? f).join(', ');
  // смешанная метка — самое информативное сообщение
  if (fuels && outs) return `Есть: ${fuels} · Нет: ${outs}`;
  // «Нет топлива» с уточнением — всегда говорим, какого именно
  if (cur.status === 'OUT') {
    return outs ? `Закончился: ${outs}` : 'Топливо закончилось';
  }
  if (prev && cur.status !== prev.status) {
    switch (cur.status) {
      case 'AVAILABLE':
        return fuels ? `Появилось: ${fuels}` : 'Топливо появилось';
      case 'QUEUE':
        return 'Выросла очередь';
      case 'LOW':
        return fuels ? `Мало: ${fuels}` : 'Топлива мало';
      case 'CLOSED':
        return 'Заправка закрылась';
    }
  }
  return STATUS_META[cur.status].label;
}

