'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { startPresence } from '@/lib/track';

// Heartbeat «активные сейчас»: только публичные страницы, только видимая
// вкладка (логика в track.ts). /admin в аналитику не пишется.
export function Presence() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname?.startsWith('/admin')) return;
    startPresence();
  }, [pathname]);
  return null;
}
