// SEO-сетка «топливо × город». Правило пилота (20.07.2026, статичный
// whitelist на 14 страниц по частоте Wordstat) отменено владельцем
// 23.08.2026: индексация теперь считается по реальным данным —
// см. isFuelPageIndexable / loadIndexableFuelsForCity в lib/stations.ts
// (гейт: ≥3 АЗС в городе + хотя бы одна user-отметка марки когда-либо).

export type FuelSlug = '92' | '95' | '98' | '100' | 'dt' | 'gaz';

export const FUEL_INFO: Record<
  FuelSlug,
  { code: string; label: string; genitive: string; short: string }
> = {
  '92': { code: 'ai92', label: '92-й бензин', genitive: '92-го бензина', short: 'АИ-92' },
  '95': { code: 'ai95', label: '95-й бензин', genitive: '95-го бензина', short: 'АИ-95' },
  '98': { code: 'ai98', label: '98-й бензин', genitive: '98-го бензина', short: 'АИ-98' },
  '100': { code: 'ai100', label: '100-й бензин', genitive: '100-го бензина', short: 'АИ-100' },
  dt: { code: 'diesel', label: 'дизель', genitive: 'дизеля', short: 'ДТ' },
  gaz: { code: 'gas', label: 'газ', genitive: 'газа', short: 'Газ' },
};

export const FUEL_SLUG_BY_CODE: Record<string, FuelSlug> = Object.fromEntries(
  (Object.entries(FUEL_INFO) as [FuelSlug, (typeof FUEL_INFO)[FuelSlug]][]).map(
    ([slug, info]) => [info.code, slug]
  )
);
