'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getConsent } from '@/components/consent';

// Яндекс.Метрика. Включается переменной NEXT_PUBLIC_YM_ID (номер счётчика).
// ФЗ-152 (аудит 21.07): счётчик и Вебвизор запускаются ТОЛЬКО после
// «Принимаю». Отзыв должен останавливать УЖЕ загруженный счётчик —
// поэтому используем официальный флаг Яндекса window['disableYaCounterID'],
// а не только размонтирование компонента (tag.js после init не выгружается).
const YM_ID = process.env.NEXT_PUBLIC_YM_ID;
const DISABLE_FLAG = YM_ID ? `disableYaCounter${Number(YM_ID)}` : '';

declare global {
  interface Window {
    ym?: (id: number, action: string, ...args: unknown[]) => void;
    [key: string]: unknown;
  }
}

// Цели: уходят в Метрику только при активном согласии И существующем ym.
export function ymGoal(goal: string) {
  if (
    YM_ID &&
    typeof window !== 'undefined' &&
    getConsent() === 'granted' &&
    window[DISABLE_FLAG] !== true &&
    window.ym
  ) {
    window.ym(Number(YM_ID), 'reachGoal', goal);
  }
}

export function Metrika() {
  const pathname = usePathname();
  const [initedOnce, setInitedOnce] = useState(false);

  // Пересчёт флага запрета на смену согласия И на смену маршрута:
  // на /admin (владельческая зона) счётчик глушится даже при согласии,
  // иначе SPA-переход внутри сайта оставит Метрику работать на /admin.
  useEffect(() => {
    const onAdmin = pathname?.startsWith('/admin') ?? false;
    const check = () => {
      const granted = getConsent() === 'granted';
      if (typeof window !== 'undefined' && DISABLE_FLAG) {
        // отзыв или вход в /admin мгновенно глушат счётчик и Вебвизор;
        // на публичной странице счётчик оживает только при согласии
        window[DISABLE_FLAG] = !granted || onAdmin;
      }
      // скрипт вставляется один раз, дальше управляет только флаг
      if (granted) setInitedOnce(true);
    };
    // первичная синхронизация — микротаском, чтобы не setState синхронно
    const t = setTimeout(check, 0);
    window.addEventListener('pb-consent-change', check);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pb-consent-change', check);
    };
  }, [pathname]);

  // /admin вне Метрики; скрипт вставляется один раз (initedOnce), дальше
  // включением/выключением управляет только флаг disableYaCounter —
  // повторный init запрещён рекомендацией Яндекса.
  if (!YM_ID || pathname?.startsWith('/admin') || !initedOnce) return null;
  return (
    <Script id="yandex-metrika" strategy="afterInteractive">
      {`
        window['${DISABLE_FLAG}'] = window['${DISABLE_FLAG}'] === true;
        (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
        m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],
        k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
        (window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
        ym(${Number(YM_ID)}, "init", {
          clickmap: true,
          trackLinks: true,
          accurateTrackBounce: true,
          webvisor: true,
          defer: true
        });
      `}
    </Script>
  );
}
