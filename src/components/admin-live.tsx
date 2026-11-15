'use client';

import { useEffect, useState } from 'react';

// Автообновление «активных сейчас» раз в 30 секунд
export function AdminLive({
  initial,
}: {
  initial: { activeNow: number; active15: number; at: string };
}) {
  const [live, setLive] = useState(initial);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch('/api/admin/live');
        if (!res.ok) throw new Error(String(res.status));
        setLive(await res.json());
        setErr(false);
      } catch {
        setErr(true);
      }
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const at = new Date(live.at).toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border">
      <div className="bg-surface p-5">
        <p className="text-3xl font-bold text-primary">{live.activeNow}</p>
        <p className="mt-1 text-xs text-muted">активны сейчас (5 мин)</p>
      </div>
      <div className="bg-surface p-5">
        <p className="text-3xl font-bold">{live.active15}</p>
        <p className="mt-1 text-xs text-muted">за 15 минут</p>
      </div>
      <p className="col-span-2 bg-surface px-5 pb-3 text-xs text-muted">
        обновлено {at} МСК {err && '· ошибка обновления, пробуем снова'}
      </p>
    </div>
  );
}
