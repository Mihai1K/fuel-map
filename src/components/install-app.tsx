'use client';

import { useEffect, useState } from 'react';
import { MonitorDown, Share, SquarePlus, X } from 'lucide-react';
import { track as ymGoal } from '@/lib/track';

// Установка на главный экран. Правила (итерация «путь без препятствий»):
// — НИКАКИХ авто-показов: мастер открывается только из меню «Ещё»;
// — системный prompt Android вызывается только после явного нажатия;
// — уже установлено → разовое «Спасибо» при первом запуске из иконки.

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type Platform = 'android' | 'ios-safari' | 'ios-inapp' | 'other';

// Инструкции по браузерам: автоопределяем, но можно переключить вручную
const BROWSERS = ['Chrome', 'Safari', 'Яндекс', 'Другой'] as const;
type Browser = (typeof BROWSERS)[number];

function detectBrowser(): Browser {
  const ua = navigator.userAgent;
  if (/yabrowser/i.test(ua)) return 'Яндекс';
  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (isIOS && !/crios|fxios|edgios/i.test(ua)) return 'Safari';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  return 'Другой';
}

const THANKS_KEY = 'pb-pwa-thanked';

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1); // iPadOS
  if (isIOS) {
    // во встроенных браузерах (Telegram/MAX/VK) и не-Safari установка недоступна
    const inApp = /telegram|vkontakte|vkclient|instagram|fban|fbav|max\//i.test(ua);
    const notSafari = /crios|fxios|edgios|opt\/|yabrowser/i.test(ua);
    return inApp || notSafari ? 'ios-inapp' : 'ios-safari';
  }
  if (/android/i.test(ua)) return 'android';
  return 'other';
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// Разовое «Спасибо» при первом запуске установленного приложения.
// Рендерится всегда (лёгкий), показывает окно только когда уместно.
export function InstallThanks() {
  const [thanks, setThanks] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (isStandalone() && !localStorage.getItem(THANKS_KEY)) {
        localStorage.setItem(THANKS_KEY, '1');
        setThanks(true);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  if (!thanks) return null;
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 grid place-items-center bg-background/80 p-6 backdrop-blur-sm">
      <div className="pb-sheet w-full max-w-sm rounded-3xl border border-border bg-surface p-8 text-center shadow-2xl">
        <p className="text-3xl">❤️</p>
        <p className="mt-3 text-lg font-semibold">Спасибо!</p>
        <p className="mt-1.5 text-sm text-muted">
          Теперь «Тут Бензин» всегда под рукой.
        </p>
        <button
          onClick={() => setThanks(false)}
          className="mt-5 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-press"
        >
          Открыть карту
        </button>
      </div>
    </div>
  );
}

// Мастер установки: контролируемый bottom sheet, открывается ТОЛЬКО
// действием пользователя (пункт меню «Ещё»). Авто-показов нет.
export function InstallApp({ onClose }: { onClose: () => void }) {
  const [platform, setPlatform] = useState<Platform>('other');
  const [browser, setBrowser] = useState<Browser>('Chrome');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // микротаск после маунта: определение платформы читает navigator
    const t = setTimeout(() => {
      setPlatform(detectPlatform());
      setBrowser(detectBrowser());
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // системный install prompt (Android/desktop Chrome) — придерживаем
  // событие, чтобы вызвать его по кнопке «Установить в один тап»
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      ymGoal('install_completed');
      onClose();
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [onClose]);

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === 'accepted') onClose();
    setDeferred(null);
  }

  return (
    <div className="pb-sheet pointer-events-auto fixed inset-x-2 bottom-2 z-30 mx-auto max-w-md rounded-3xl border border-border bg-surface p-6 shadow-2xl sm:bottom-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-semibold">
          📲 Установите «Тут Бензин» на главный экран
        </p>
        <button
          onClick={onClose}
          aria-label="Закрыть"
          className="grid size-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* если браузер умеет ставить сам — кнопка сверху,
          инструкции ниже всё равно доступны */}
      {deferred && (
        <button
          onClick={install}
          className="mt-4 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-press"
        >
          Установить в один тап
        </button>
      )}

      {platform === 'ios-inapp' ? (
        <div className="mt-3">
          <p className="text-sm text-muted">
            Во встроенных браузерах установка недоступна. Откройте сайт
            в Safari — обычно это кнопка «⋯» → «Открыть в Safari» —
            и повторите.
          </p>
        </div>
      ) : (
        <>
          {/* выбор браузера: определяем сами, но можно переключить */}
          <p className="mt-3 text-xs text-muted">Ваш браузер</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {BROWSERS.map((b) => (
              <button
                key={b}
                onClick={() => setBrowser(b)}
                className={`min-h-10 rounded-xl px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  browser === b
                    ? 'bg-text text-background'
                    : 'bg-surface-2 text-muted hover:text-text'
                }`}
              >
                {b}
              </button>
            ))}
          </div>

          <ol className="mt-4 space-y-3">
            {browser === 'Safari' ? (
              <>
                <Step n={1}>
                  Нажмите «Поделиться»
                  <Share className="mx-1 inline size-4 align-text-bottom" />
                  внизу Safari
                </Step>
                <Step n={2}>
                  Выберите «На экран “Домой”»
                  <SquarePlus className="mx-1 inline size-4 align-text-bottom" />
                </Step>
                <Step n={3}>Нажмите «Добавить»</Step>
              </>
            ) : browser === 'Яндекс' ? (
              platform === 'ios-safari' ? (
                <p className="text-sm text-muted">
                  На iPhone установка возможна только из Safari: откройте
                  сайт в Safari → «Поделиться» → «На экран “Домой”».
                </p>
              ) : (
                <>
                  <Step n={1}>Нажмите ⋮ (меню) в правом нижнем углу</Step>
                  <Step n={2}>Выберите «Добавить ярлык»</Step>
                  <Step n={3}>«На главный экран» → «Добавить»</Step>
                </>
              )
            ) : browser === 'Chrome' ? (
              platform === 'android' ? (
                <>
                  <Step n={1}>Нажмите ⋮ в правом верхнем углу</Step>
                  <Step n={2}>
                    Выберите «Добавить на главный экран» или «Установить
                    приложение»
                  </Step>
                  <Step n={3}>Нажмите «Установить»</Step>
                </>
              ) : (
                <>
                  <Step n={1}>
                    Найдите значок установки
                    <MonitorDown className="mx-1 inline size-4 align-text-bottom" />
                    в конце адресной строки
                  </Step>
                  <Step n={2}>Нажмите «Установить»</Step>
                </>
              )
            ) : (
              <p className="text-sm text-muted">
                Установка «в один тап» надёжнее всего работает в Chrome
                (Android, компьютер) и Safari (iPhone). Откройте сайт
                там — и вернитесь к этой кнопке.
              </p>
            )}
          </ol>
        </>
      )}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}
