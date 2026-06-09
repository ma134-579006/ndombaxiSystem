import React, { useId, useMemo, useState } from 'react';

export interface DonutSlice { label: string; value: number }

/** Paleta moderna (ciano→azul→violeta→verde→âmbar→rosa…) para as fatias. */
const PALETTE = ['#3b82f6', '#22d3ee', '#a855f7', '#34d399', '#f59e0b', '#ec4899', '#6366f1', '#14b8a6', '#fb7185', '#84cc16'];

/**
 * Gráfico de ROSCA (donut) SVG, sem dependências — mesmo nível dos gráficos de
 * área/colunas: fatias animadas, realce ao passar o rato, total ao centro e
 * legenda com valor + percentagem. Ideal para composição/quota (categorias,
 * marcas, métodos de pagamento, IVA por taxa).
 */
export function DonutChart({
  data, size = 196, thickness = 24, centerLabel = 'Total', format = (n) => String(n),
}: {
  data: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  format?: (n: number) => string;
}) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);

  const total = useMemo(() => data.reduce((s, d) => s + Math.max(0, d.value), 0), [data]);
  if (data.length === 0 || total <= 0) return <div className="empty"><p className="muted">Sem dados no período.</p></div>;

  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const C = 2 * Math.PI * r;

  let acc = 0;
  const slices = data.map((d, i) => {
    const frac = Math.max(0, d.value) / total;
    const s = { label: d.label, value: d.value, frac, color: PALETTE[i % PALETTE.length], offset: acc, pct: frac * 100 };
    acc += frac;
    return s;
  });

  return (
    <div className="donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="donut-svg"
        onMouseLeave={() => setHover(null)} style={{ flex: 'none' }}>
        <defs>
          <filter id={`ds-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.18" />
          </filter>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} opacity="0.35" />
        {slices.map((s, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.color}
            strokeWidth={hover === i ? thickness + 4 : thickness}
            strokeDasharray={`${s.frac * C} ${C - s.frac * C}`}
            strokeDashoffset={-s.offset * C}
            transform={`rotate(-90 ${cx} ${cy})`}
            opacity={hover === null || hover === i ? 1 : 0.4}
            filter={hover === i ? `url(#ds-${uid})` : undefined}
            onMouseEnter={() => setHover(i)}
            style={{ transition: 'stroke-width .15s ease, opacity .15s ease', cursor: 'default', animation: 'donut-in .6s ease both', animationDelay: `${i * 70}ms` }} />
        ))}
        <text x={cx} y={cy - 3} textAnchor="middle" fontSize="14" fontWeight="800" fill="var(--text)">
          {hover === null ? format(total) : format(data[hover].value)}
        </text>
        <text x={cx} y={cy + 15} textAnchor="middle" fontSize="10" fill="var(--muted)">
          {hover === null ? centerLabel : `${slices[hover].pct.toFixed(1)}%`}
        </text>
      </svg>

      <div className="donut-legend">
        {slices.map((s, i) => (
          <div key={i} className={`dl-row${hover === i ? ' on' : ''}`}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="dl-dot" style={{ background: s.color }} />
            <span className="dl-label" title={s.label}>{s.label}</span>
            <span className="dl-val">{format(s.value)}</span>
            <span className="dl-pct">{s.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
