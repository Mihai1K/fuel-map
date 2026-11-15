// Города сервиса. Уровни тревоги — по публикациям о дефиците топлива
// (июль 2026): Крым/Севастополь — критично; Краснодарский край, Ростовская
// и Астраханская области — жёсткие лимиты; Татарстан, Москва и трасса М-4 —
// локальные ограничения. Список расширяется до 120+ городов (BACKLOG).

export type CityAlert = 'critical' | 'limits' | 'watch' | null;

export type City = {
  slug: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  zoom: number;
  alert: CityAlert;
  alertNote: string | null;
  // Источник и дата последнего обновления alertNote — заполняются
  // при обновлении из ежедневного дайджеста новостей (см. novosti.ts).
  // Необязательны: старые записи без источника продолжают отображаться.
  alertSource?: { name: string; url: string };
  alertUpdatedAt?: string; // ISO-дата
};

export const CITIES: City[] = [
  // приоритет продвижения (решение владельца, 18.07.2026):
  // СПб → Краснодар → Астрахань → Уфа → Симферополь/Севастополь → Москва
  {
    slug: 'moskva', name: 'Москва', region: 'Москва', lat: 55.751, lng: 37.618, zoom: 10.4,
    alert: 'limits',
    alertNote: 'Крупные сети АЗС ввели лимит 50–60 л на заправку с 19 августа; ранее сообщалось о дефиците АИ-95 и очередях',
    alertSource: { name: 'Коммерсантъ', url: 'https://www.kommersant.ru/doc/8905689' },
    alertUpdatedAt: '2026-08-21',
  },
  {
    slug: 'spb', name: 'Санкт-Петербург', region: 'Санкт-Петербург', lat: 59.939, lng: 30.316, zoom: 10.2,
    alert: 'limits',
    alertNote: 'Крупные сети АЗС ввели лимит 50–60 л на заправку с 19 августа',
    alertSource: { name: 'Коммерсантъ', url: 'https://www.kommersant.ru/doc/8905689' },
    alertUpdatedAt: '2026-08-21',
  },
  // Крым
  {
    slug: 'simferopol', name: 'Симферополь', region: 'Республика Крым', lat: 44.952, lng: 34.102, zoom: 11.5,
    alert: 'limits',
    alertNote: 'Продажа субсидированного топлива продолжается по нарастающей: в воскресенье 14 сентября — 284 т через 90 АЗС (АИ-92 — 125 т на сети «Атан», 44 станции, с 8:00; АИ-95 — 69 т и дизель — 90 т на сети «ТЭС», с 18:00). В сентябре региону обещано 60 тыс. т топлива. Лимит ~20 л на автомобиль сохраняется',
    alertSource: { name: 'Интерфакс', url: 'https://www.interfax.ru/russia/1115796' },
    alertUpdatedAt: '2026-09-13',
  },
  {
    slug: 'sevastopol', name: 'Севастополь', region: 'Севастополь', lat: 44.605, lng: 33.522, zoom: 11.3,
    alert: 'limits',
    alertNote: 'С понедельника 14 сентября в продаже — топливо по QR-кодам и сниженной цене (не дороже 100 руб./л): сеть «ТЭС» — АИ-92, АИ-95 и АИ-95 NP по QR-коду (лимит 20 л), сеть «Атан» — АИ-92 с 10:00 по QR-коду на 7 станциях. В свободную продажу (без QR, в т.ч. дизель и отдалённые АЗС) — лимит 40 л',
    alertSource: { name: 'Интерфакс', url: 'https://www.interfax.ru/russia/1115881' },
    alertUpdatedAt: '2026-09-11',
  },
  { slug: 'kerch', name: 'Керчь', region: 'Республика Крым', lat: 45.356, lng: 36.467, zoom: 11.8, alert: 'critical', alertNote: 'Дефицит, ограничения отпуска' },
  { slug: 'yalta', name: 'Ялта', region: 'Республика Крым', lat: 44.495, lng: 34.166, zoom: 12, alert: 'critical', alertNote: 'Дефицит, ограничения отпуска' },
  { slug: 'evpatoria', name: 'Евпатория', region: 'Республика Крым', lat: 45.19, lng: 33.367, zoom: 12, alert: 'critical', alertNote: 'Дефицит, ограничения отпуска' },
  { slug: 'feodosia', name: 'Феодосия', region: 'Республика Крым', lat: 45.031, lng: 35.382, zoom: 12, alert: 'critical', alertNote: 'Дефицит, ограничения отпуска' },
  // Краснодарский край
  {
    slug: 'krasnodar', name: 'Краснодар', region: 'Краснодарский край', lat: 45.035, lng: 38.976, zoom: 11.2,
    alert: 'limits',
    alertNote: 'Запрет на заправку топлива в канистры на фоне второй волны дефицита',
    alertSource: { name: 'Коммерсантъ', url: 'https://www.kommersant.ru/doc/8905689' },
    alertUpdatedAt: '2026-08-21',
  },
  {
    slug: 'sochi', name: 'Сочи', region: 'Краснодарский край', lat: 43.586, lng: 39.72, zoom: 11.5,
    alert: 'limits',
    alertNote: 'Губернатор Кубани Кондратьев после пожара на нефтебазе в Адлере (атака БПЛА в ночь на 4 сентября) предупредил о риске перебоев с топливом в городе, но подчеркнул, что поставки бензина и ДТ в регион идут в достаточном объёме. Мэр Сочи заявил, что запасы топлива в городе есть и АЗС работают в штатном режиме',
    alertSource: { name: 'Коммерсантъ', url: 'https://www.kommersant.ru/doc/8936719' },
    alertUpdatedAt: '2026-09-05',
  },
  {
    slug: 'anapa', name: 'Анапа', region: 'Краснодарский край', lat: 44.895, lng: 37.316, zoom: 12,
    alert: 'limits',
    alertNote: 'Перебои с бензином на части заправок, как в Геленджике и Новороссийске',
    alertSource: { name: 'Коммерсантъ', url: 'https://www.kommersant.ru/doc/8894390' },
    alertUpdatedAt: '2026-08-21',
  },
  {
    slug: 'gelendzhik', name: 'Геленджик', region: 'Краснодарский край', lat: 44.561, lng: 38.077, zoom: 12,
    alert: 'critical',
    alertNote: 'Утром 21 августа бензин продавала только 1 из 8 АЗС города, на остальных — только дизель',
    alertSource: { name: 'Коммерсантъ', url: 'https://www.kommersant.ru/doc/8894390' },
    alertUpdatedAt: '2026-08-21',
  },
  {
    slug: 'novorossiysk', name: 'Новороссийск', region: 'Краснодарский край', lat: 44.723, lng: 37.769, zoom: 11.8,
    alert: 'limits',
    alertNote: 'Перебои с бензином, как в Геленджике и Анапе — часть АЗС прекратила продажу населению',
    alertSource: { name: 'Коммерсантъ', url: 'https://www.kommersant.ru/doc/8894390' },
    alertUpdatedAt: '2026-08-21',
  },
  { slug: 'tuapse', name: 'Туапсе', region: 'Краснодарский край', lat: 44.106, lng: 39.081, zoom: 12.2, alert: 'limits', alertNote: 'Перебои на трассе' },
  { slug: 'armavir', name: 'Армавир', region: 'Краснодарский край', lat: 44.988, lng: 41.129, zoom: 12, alert: 'limits', alertNote: 'Лимиты на части АЗС' },
  { slug: 'eysk', name: 'Ейск', region: 'Краснодарский край', lat: 46.711, lng: 38.273, zoom: 12.2, alert: 'limits', alertNote: 'Перебои с отдельными марками' },
  { slug: 'slavyansk', name: 'Славянск-на-Кубани', region: 'Краснодарский край', lat: 45.26, lng: 38.126, zoom: 12.2, alert: 'limits', alertNote: 'Перебои с отдельными марками' },
  // Ростовская область
  { slug: 'rostov', name: 'Ростов-на-Дону', region: 'Ростовская область', lat: 47.222, lng: 39.72, zoom: 11.2, alert: 'limits', alertNote: 'До 40 л на автомобиль' },
  { slug: 'taganrog', name: 'Таганрог', region: 'Ростовская область', lat: 47.236, lng: 38.895, zoom: 12, alert: 'limits', alertNote: 'Лимиты на части АЗС' },
  { slug: 'novocherkassk', name: 'Новочеркасск', region: 'Ростовская область', lat: 47.411, lng: 40.104, zoom: 12, alert: 'limits', alertNote: 'Лимиты на части АЗС' },
  { slug: 'shakhty', name: 'Шахты', region: 'Ростовская область', lat: 47.709, lng: 40.215, zoom: 12, alert: 'limits', alertNote: 'Лимиты на части АЗС' },
  { slug: 'volgodonsk', name: 'Волгодонск', region: 'Ростовская область', lat: 47.516, lng: 42.151, zoom: 12, alert: 'limits', alertNote: 'Лимиты на части АЗС' },
  // Волгоградская и Астраханская области
  { slug: 'volgograd', name: 'Волгоград', region: 'Волгоградская область', lat: 48.708, lng: 44.513, zoom: 10.8, alert: 'watch', alertNote: 'Перебои с отдельными марками' },
  { slug: 'volzhskiy', name: 'Волжский', region: 'Волгоградская область', lat: 48.786, lng: 44.752, zoom: 12, alert: 'watch', alertNote: 'Перебои с отдельными марками' },
  { slug: 'kamyshin', name: 'Камышин', region: 'Волгоградская область', lat: 50.083, lng: 45.407, zoom: 12.2, alert: 'watch', alertNote: 'Перебои с отдельными марками' },
  {
    slug: 'astrakhan', name: 'Астрахань', region: 'Астраханская область', lat: 46.347, lng: 48.03, zoom: 11.5,
    alert: 'limits',
    alertNote: 'Власти снизили суточный лимит продажи АИ-92/АИ-95 до 30 л на человека (ранее — 40 л на автомобиль, до этого — режим «чёт-нечет»)',
    alertSource: { name: 'Коммерсантъ', url: 'https://www.kommersant.ru/doc/8908285' },
    alertUpdatedAt: '2026-08-27',
  },
  // Поволжье и Урал
  { slug: 'kazan', name: 'Казань', region: 'Республика Татарстан', lat: 55.796, lng: 49.108, zoom: 11.2, alert: 'watch', alertNote: '95-й быстро заканчивается' },
  { slug: 'ufa', name: 'Уфа', region: 'Республика Башкортостан', lat: 54.735, lng: 55.958, zoom: 11, alert: 'limits', alertNote: 'Крупные очереди, часть АЗС закрыта' },
  {
    slug: 'ekaterinburg', name: 'Екатеринбург', region: 'Свердловская область', lat: 56.838, lng: 60.597, zoom: 11,
    alert: 'watch',
    alertNote: 'Губернатор Свердловской области Денис Паслер 8 сентября заявил о стабилизации: суточные поставки бензина по «Лукойлу» выросли со 138 до 400 т, «Газпром нефть» увеличила продажи на 40–50% к 2025 году и восполняет топливом закрытые АЗС других сетей. По его оценке, для полной нормализации может понадобиться ещё около недели',
    alertSource: { name: 'ТАСС', url: 'https://tass.ru/obschestvo/28091285' },
    alertUpdatedAt: '2026-09-09',
  },
  // региональные центры, где сообщалось об ограничениях
  { slug: 'voronezh', name: 'Воронеж', region: 'Воронежская область', lat: 51.661, lng: 39.2, zoom: 11.3, alert: 'watch', alertNote: 'Перебои вдоль М-4 «Дон»' },
  { slug: 'maykop', name: 'Майкоп', region: 'Республика Адыгея', lat: 44.609, lng: 40.101, zoom: 12, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'arkhangelsk', name: 'Архангельск', region: 'Архангельская область', lat: 64.539, lng: 40.517, zoom: 11.5, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'bryansk', name: 'Брянск', region: 'Брянская область', lat: 53.243, lng: 34.364, zoom: 11.5, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'vladimir', name: 'Владимир', region: 'Владимирская область', lat: 56.129, lng: 40.407, zoom: 11.8, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'vologda', name: 'Вологда', region: 'Вологодская область', lat: 59.221, lng: 39.891, zoom: 11.8, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'ivanovo', name: 'Иваново', region: 'Ивановская область', lat: 56.997, lng: 40.981, zoom: 11.8, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'irkutsk', name: 'Иркутск', region: 'Иркутская область', lat: 52.287, lng: 104.281, zoom: 11.5, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'kaliningrad', name: 'Калининград', region: 'Калининградская область', lat: 54.71, lng: 20.452, zoom: 11.5, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'elista', name: 'Элиста', region: 'Республика Калмыкия', lat: 46.308, lng: 44.256, zoom: 12, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'petrozavodsk', name: 'Петрозаводск', region: 'Республика Карелия', lat: 61.785, lng: 34.347, zoom: 11.8, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'kemerovo', name: 'Кемерово', region: 'Кемеровская область', lat: 55.355, lng: 86.087, zoom: 11.5, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'krasnoyarsk', name: 'Красноярск', region: 'Красноярский край', lat: 56.01, lng: 92.852, zoom: 11, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'kurgan', name: 'Курган', region: 'Курганская область', lat: 55.441, lng: 65.341, zoom: 11.8, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'kursk', name: 'Курск', region: 'Курская область', lat: 51.73, lng: 36.193, zoom: 11.5, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'lipetsk', name: 'Липецк', region: 'Липецкая область', lat: 52.61, lng: 39.595, zoom: 11.5, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'penza', name: 'Пенза', region: 'Пензенская область', lat: 53.195, lng: 45.019, zoom: 11.5, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'vladivostok', name: 'Владивосток', region: 'Приморский край', lat: 43.115, lng: 131.885, zoom: 11.5, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'pskov', name: 'Псков', region: 'Псковская область', lat: 57.817, lng: 28.334, zoom: 11.8, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  // добавлены 25.08 по итогам дайджеста: названы Минэнерго в числе
  // проблемных регионов на совещании 21 августа
  { slug: 'izhevsk', name: 'Ижевск', region: 'Удмуртская Республика', lat: 56.853, lng: 53.204, zoom: 11.3, alert: 'watch', alertNote: 'Названа Минэнерго в числе проблемных регионов по топливу (совещание 21 августа)' },
  { slug: 'cheboksary', name: 'Чебоксары', region: 'Чувашская Республика', lat: 56.146, lng: 47.251, zoom: 11.8, alert: 'watch', alertNote: 'Названа Минэнерго в числе проблемных регионов по топливу (совещание 21 августа)' },
  { slug: 'belgorod', name: 'Белгород', region: 'Белгородская область', lat: 50.596, lng: 36.588, zoom: 11.8, alert: 'watch', alertNote: 'Названа Минэнерго в числе проблемных регионов по топливу (совещание 21 августа)' },
  { slug: 'kyzyl', name: 'Кызыл', region: 'Республика Тыва', lat: 51.719, lng: 94.437, zoom: 12, alert: 'watch', alertNote: 'Названа Минэнерго в числе проблемных регионов по топливу (совещание 21 августа)' },
  // добавлены 05.09 по разбору высокочастотных запросов Wordstat: города
  // с прямыми запросами «бензин в {городе}» и реальными данными АЗС в OSM
  { slug: 'perm', name: 'Пермь', region: 'Пермский край', lat: 58.01, lng: 56.229, zoom: 11, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'chelyabinsk', name: 'Челябинск', region: 'Челябинская область', lat: 55.16, lng: 61.4, zoom: 11, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'tula', name: 'Тула', region: 'Тульская область', lat: 54.193, lng: 37.617, zoom: 11.3, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'samara', name: 'Самара', region: 'Самарская область', lat: 53.195, lng: 50.1, zoom: 11, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  {
    slug: 'kaluga', name: 'Калуга', region: 'Калужская область', lat: 54.513, lng: 36.261, zoom: 11.5,
    alert: 'watch',
    alertNote: 'С 1 сентября регион отменил режим «чёт-нечет» при заправке (действовал с 15 августа); заправка в бак и канистру разрешена в пределах лимитов АЗС. Губернатор заявил о стабилизации поставок топлива в область',
    alertSource: { name: 'Коммерсантъ', url: 'https://www.kommersant.ru/doc/8922431' },
    alertUpdatedAt: '2026-09-05',
  },
  { slug: 'novosibirsk', name: 'Новосибирск', region: 'Новосибирская область', lat: 55.03, lng: 82.92, zoom: 10.8, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'nizhny-novgorod', name: 'Нижний Новгород', region: 'Нижегородская область', lat: 56.326, lng: 44.006, zoom: 11, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
  { slug: 'ryazan', name: 'Рязань', region: 'Рязанская область', lat: 54.63, lng: 39.742, zoom: 11.3, alert: 'watch', alertNote: 'Сообщалось об ограничениях' },
];

export const DEFAULT_CITY = CITIES[0];

export function cityBySlug(slug: string | undefined | null): City {
  return CITIES.find((c) => c.slug === slug) ?? DEFAULT_CITY;
}
