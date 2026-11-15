'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// Согласие на cookies и метрические программы (ФЗ-152, требование
// юридического контура 20.07.2026): Яндекс Метрика и Вебвизор НЕ
// загружаются, пока пользователь не нажал «Принимаю». Отказ хранится
// и уважается так же, как согласие. Выбор можно изменить на /privacy.
const KEY = 'pb-consent'; // 'granted' | 'denied'

export function getConsent(): 'granted' | 'denied' | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem(KEY);
  return v === 'granted' || v === 'denied' ? v : null;
}

export function setConsent(v: 'granted' | 'denied' | 'revoked') {
  localStorage.setItem(KEY, v === 'revoked' ? 'denied' : v);
  window.dispatchEvent(new CustomEvent('pb-consent-change', { detail: v }));
  // доказательный журнал согласий (ФЗ-152) — фиксируем выбор на сервере
  try {
    const deviceId = localStorage.getItem('pb-device-id') ?? undefined;
    void fetch('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: v, deviceId }),
    });
  } catch {
    // журнал не должен ломать интерфейс
  }
}

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // после маунта: не мигать на SSR
    const t = setTimeout(() => setVisible(getConsent() === null), 300);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Согласие на использование cookies"
      className="fixed inset-x-2 bottom-2 z-50 mx-auto max-w-lg rounded-3xl border border-border bg-surface p-5 shadow-2xl"
      style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <p className="text-sm">
        Мы используем cookies и метрические программы (Яндекс Метрика,
        Вебвизор) для работы сервиса и анализа его использования.
        Подробности — в{' '}
        <Link href="/privacy" className="font-medium text-primary hover:underline">
          политике конфиденциальности
        </Link>
        .
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => {
            setConsent('granted');
            setVisible(false);
          }}
          className="flex-1 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-press"
        >
          Принимаю
        </button>
        <button
          onClick={() => {
            setConsent('denied');
            setVisible(false);
          }}
          className="flex-1 rounded-2xl border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-surface-2"
        >
          Отклонить
        </button>
      </div>
    </div>
  );
}


// Управление согласием на /privacy: посмотреть текущий выбор,
// изменить его или отозвать (ст. 9 ФЗ-152 — отзыв так же прост,
// как и дача согласия).
export function ConsentManager() {
  const [state, setState] = useState<'granted' | 'denied' | null>(null);

  useEffect(() => {
    const read = () => setState(getConsent());
    read();
    window.addEventListener('pb-consent-change', read);
    return () => window.removeEventListener('pb-consent-change', read);
  }, []);

  return (
    <div className="rounded-2xl border border-border p-4">
      <p className="text-sm font-semibold">Cookies и метрические программы</p>
      <p className="mt-1 text-sm text-muted">
        Текущий выбор:{' '}
        {state === 'granted'
          ? 'согласие дано — Яндекс Метрика работает'
          : state === 'denied'
            ? 'отказ — метрические программы не запускаются'
            : 'выбор ещё не сделан'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {state !== 'granted' && (
          <button
            onClick={() => setConsent('granted')}
            className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-press"
          >
            Дать согласие
          </button>
        )}
        {state === 'granted' && (
          <button
            onClick={() => setConsent('revoked')}
            className="rounded-2xl border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2"
          >
            Отозвать согласие
          </button>
        )}
        {state === 'denied' && (
          <span className="py-2 text-xs text-muted">
            Сервис полностью работает и без метрических программ.
          </span>
        )}
      </div>
    </div>
  );
}

// Самостоятельное удаление данных устройства (право на удаление):
// показывает идентификатор и удаляет отметки + аналитику по нему.
export function EraseMyData() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>(
    'idle'
  );
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const t = setTimeout(
      () => setDeviceId(localStorage.getItem('pb-device-id')),
      0
    );
    return () => clearTimeout(t);
  }, []);

  async function erase() {
    if (!deviceId) return;
    setStatus('busy');
    try {
      const res = await fetch('/api/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      localStorage.removeItem('pb-device-id');
      sessionStorage.clear();
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-border p-4">
      <p className="text-sm font-semibold">Удаление данных этого устройства</p>
      {deviceId ? (
        <>
          <p className="mt-1 text-sm text-muted">
            Будут удалены все отметки, оставленные с этого устройства, и
            связанная с ним внутренняя статистика (посетитель, сессии,
            события). Действие необратимо. В журнале сохранится только
            обезличенная запись факта удаления — как доказательство
            исполнения вашего запроса (хранится ограниченный срок).
          </p>
          {status === 'done' ? (
            <p className="mt-3 text-sm font-medium text-primary">
              Данные удалены. Идентификатор сброшен.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                  className="size-4"
                />
                Понимаю, что удаление необратимо
              </label>
              <button
                onClick={erase}
                disabled={!confirm || status === 'busy'}
                className="rounded-2xl border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                {status === 'busy' ? 'Удаляем…' : 'Удалить мои данные'}
              </button>
              {status === 'error' && (
                <span className="text-xs text-red-600">
                  Не получилось — попробуйте позже или напишите на почту.
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">
          На этом устройстве нет сохранённого идентификатора — удалять
          нечего.
        </p>
      )}
    </div>
  );
}
