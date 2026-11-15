import type { MetadataRoute } from 'next';

// PWA-манифест: установка на главный экран (Android/desktop — системный
// prompt, iOS — «На экран “Домой”» из Safari). start_url ведёт сразу в
// приложение-карту.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Тут Бензин — где есть бензин сейчас',
    short_name: 'Тут Бензин',
    description:
      'Живая карта АЗС России: водители отмечают, где есть топливо, какая очередь и когда это подтверждали.',
    start_url: '/map?source=pwa',
    display: 'standalone',
    background_color: '#f7f7f5',
    theme_color: '#16A34A',
    lang: 'ru',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
