// Официальные сообщества. Разделение по назначению, не по мессенджеру:
// «Новости» — каналы, «Общение водителей» — чаты (решение владельца).
export type CommunityLink = {
  key: string;
  href: string;
  app: 'Telegram' | 'MAX' | 'VK';
  kind: 'news' | 'chat';
  label: string;
};

// Порядок важен: панель 2×2/2×3 рисует строку на мессенджер
// (слева новости, справа чат), поэтому пары идут подряд.
export const COMMUNITY: CommunityLink[] = [
  {
    key: 'tg-channel',
    href: 'https://t.me/tyt_benzin',
    app: 'Telegram',
    kind: 'news',
    label: 'Официальный Telegram',
  },
  {
    key: 'tg-chat',
    href: 'https://t.me/tyt_ben3in',
    app: 'Telegram',
    kind: 'chat',
    label: 'Чат водителей в Telegram',
  },
  {
    key: 'max-channel',
    href: 'https://max.ru/join/ZXdrAaH7nwEBhKMhWKdPcP-gf7Fiav-PeUk7cI8FR7Q',
    app: 'MAX',
    kind: 'news',
    label: 'Официальный MAX',
  },
  {
    key: 'max-chat',
    href: 'https://max.ru/join/EKInZCdflMqewkbJGYwk8igrbTYnxMBiY9c__j_yrTA',
    app: 'MAX',
    kind: 'chat',
    label: 'Чат водителей в MAX',
  },
  {
    key: 'vk-channel',
    href: 'https://vk.ru/club240293023',
    app: 'VK',
    kind: 'news',
    label: 'Сообщество ВКонтакте',
  },
  {
    key: 'vk-chat',
    href: 'https://vk.me/join/AVEkivhgCUSvF/SvTTJSuQ8FR3z3AVq55_Y=',
    app: 'VK',
    kind: 'chat',
    label: 'Чат водителей в ВК',
  },
];

export const NEWS = COMMUNITY.filter((c) => c.kind === 'news');
export const CHATS = COMMUNITY.filter((c) => c.kind === 'chat');

// Донат (CloudTips владельца). Решение: ТОЛЬКО тихая ссылка в footer
// лендинга — никаких попапов и баннеров (ANTI_FEATURES запрещает именно
// навязчивость). Пока null — ссылка появится после регистрации владельца
// на cloudtips.ru; вставить сюда, и footer покажет её автоматически.
export const DONATE_URL: string | null = null;
