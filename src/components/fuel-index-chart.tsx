import type { IndexHistoryPoint } from '@/lib/fuel-index';

// Простой линейный график без внешних зависимостей — один показатель
// (доля АЗС с топливом, %), поэтому легенда не нужна (заголовок рядом
// уже называет ряд). Пропуски в данных (pct === null) рвут линию, а не
// интерполируются — честнее, чем рисовать выдуманную точку.
export function FuelIndexChart({ points }: { points: IndexHistoryPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="text-sm text-muted">
        Пока меньше двух дней истории — график появится, когда накопятся
        данные за несколько суток.
      </p>
    );
  }

  const W = 600;
  const H = 160;
  const PAD_X = 8;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 24;

  const times = points.map((p) => new Date(p.date).getTime());
  const minT = times[0];
  const maxT = times[times.length - 1];
  const spanT = Math.max(maxT - minT, 1);

  const x = (t: number) => PAD_X + ((t - minT) / spanT) * (W - PAD_X * 2);
  const y = (pct: number) => PAD_TOP + (1 - pct / 100) * (H - PAD_TOP - PAD_BOTTOM);

  // сегменты по непрерывным участкам данных (разрыв на null)
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  points.forEach((p, i) => {
    if (p.pct === null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: x(times[i]), y: y(p.pct) });
  });
  if (current.length) segments.push(current);

  const last = [...points].reverse().find((p) => p.pct !== null);
  const first = points.find((p) => p.pct !== null);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Динамика доли заправок с топливом за период: ${
          first ? fmtDate(first.date) : ''
        }–${last ? fmtDate(last.date) : ''}`}
      >
        {[0, 50, 100].map((gy) => (
          <g key={gy}>
            <line
              x1={PAD_X}
              x2={W - PAD_X}
              y1={y(gy)}
              y2={y(gy)}
              stroke="var(--border)"
              strokeWidth={1}
              strokeDasharray={gy === 0 || gy === 100 ? undefined : '3 3'}
            />
            <text
              x={0}
              y={y(gy)}
              dy={gy === 0 ? -3 : gy === 100 ? 10 : 3}
              fontSize={10}
              fill="var(--muted)"
            >
              {gy}%
            </text>
          </g>
        ))}

        {segments.map((seg, i) => (
          <path
            key={i}
            d={seg.map((p, j) => `${j === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {last && (
          <circle cx={x(new Date(last.date).getTime())} cy={y(last.pct!)} r={3.5} fill="var(--primary)" />
        )}
      </svg>

      <div className="mt-1 flex items-center justify-between text-xs text-muted">
        <span>{first ? fmtDate(first.date) : ''}</span>
        <span>{last ? fmtDate(last.date) : ''}</span>
      </div>

      <table className="sr-only">
        <caption>Доля заправок с топливом по дням</caption>
        <thead>
          <tr>
            <th>Дата</th>
            <th>Доля с топливом, %</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <td>{p.date}</td>
              <td>{p.pct ?? 'нет данных'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
