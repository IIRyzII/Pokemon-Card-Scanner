import { money, shortDate } from '../lib/format.ts';

export interface ChartPoint {
  day: string;
  price: number;
}

/** Small line chart of a price series, with logged sales as dots. */
export function PriceChart({ series, sales = [], label }: { series: ChartPoint[]; sales?: ChartPoint[]; label: string }) {
  const all = [...series, ...sales];
  if (all.length < 2) {
    return <p className="faint small">History builds up automatically as prices refresh each day.</p>;
  }
  const W = 320;
  const H = 120;
  const PAD = 10;
  const t = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
  const xs = all.map((p) => t(p.day));
  const ys = all.map((p) => p.price);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const x = (d: string) => PAD + ((t(d) - minX) / Math.max(1, maxX - minX)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - minY) / Math.max(0.01, maxY - minY)) * (H - 2 * PAD);
  const sorted = [...series].sort((a, b) => a.day.localeCompare(b.day));
  const path = sorted.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const change = first && last && first.price > 0 ? ((last.price - first.price) / first.price) * 100 : null;

  return (
    <figure className="chart">
      <figcaption>
        <span>{label}</span>
        {change !== null && sorted.length > 1 && (
          <span className={change >= 0 ? 'up' : 'down'}>
            {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% since {shortDate(first.day)}
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} price history`}>
        <line x1={PAD} x2={W - PAD} y1={y(maxY)} y2={y(maxY)} className="gridline" />
        <line x1={PAD} x2={W - PAD} y1={y(minY)} y2={y(minY)} className="gridline" />
        {sorted.length > 1 && <path d={path} className="line" />}
        {sorted.length === 1 && <circle cx={x(sorted[0].day)} cy={y(sorted[0].price)} r={3} className="dot" />}
        {sales.map((s, i) => (
          <circle key={i} cx={x(s.day)} cy={y(s.price)} r={4} className="sale">
            <title>
              Sold {money(s.price)} on {shortDate(s.day)}
            </title>
          </circle>
        ))}
      </svg>
      <div className="chart-scale">
        <span>
          {money(minY)} – {money(maxY)}
        </span>
        <span>
          {shortDate(new Date(minX).toISOString())} → {shortDate(new Date(maxX).toISOString())}
        </span>
      </div>
    </figure>
  );
}
