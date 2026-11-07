import React, { useId, useMemo, useState } from 'react';

/* Gráficos SVG no padrão visual do backoffice de referência (desenho próprio,
   sem bibliotecas): eixo Y com valores em Kz e grelha horizontal, curva
   suave com área em gradiente, barras com gradiente vertical, mini-linha e
   mini-barras para as linhas por loja, e donut com legenda. Cores do tema. */

const fmtAxis = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;

/** Máximo "redondo" do eixo e os seus 6 degraus (0 … max). */
function niceScale(max: number, steps = 5): number[] {
  if (max <= 0) return [0, 1, 2, 3, 4, 5].map((i) => i * 0.2);
  const raw = max / steps;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const nice = [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw)! * mag;
  return Array.from({ length: steps + 1 }, (_, i) => i * nice);
}

/** Curva suave (Catmull-Rom → Bézier) pelos pontos. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x},${Math.min(c1y, Math.max(p1[1], p2[1]))} ${c2x},${Math.min(c2y, Math.max(p1[1], p2[1]))} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export interface VdPoint { label: string; value: number }

/** Área suave com eixo Y em Kz (gráfico principal do dashboard). */
export function VdArea({ points, height = 190, format }: { points: VdPoint[]; height?: number; format: (n: number) => string }) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const W = 900, padL = 96, padR = 10, padT = 10, padB = 24, H = height;
  const iw = W - padL - padR, ih = H - padT - padB;
  const ticks = useMemo(() => niceScale(Math.max(0, ...points.map((p) => p.value))), [points]);
  const top = ticks[ticks.length - 1] || 1;
  const n = points.length;
  const x = (i: number) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => padT + ih - (v / top) * ih;
  const pts = points.map((p, i) => [x(i), y(p.value)] as [number, number]);
  const line = smoothPath(pts);
  const area = n ? `${line} L${x(n - 1)},${padT + ih} L${x(0)},${padT + ih} Z` : '';
  const every = Math.max(1, Math.ceil(n / 15));
  return (
    <div className="vd-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Faturação por dia">
        <defs>
          <linearGradient id={`a${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity=".85" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity=".06" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="vd-grid" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="vd-axis">{fmtAxis(t)}</text>
          </g>
        ))}
        {area ? <path d={area} fill={`url(#a${uid})`} className="vd-area-fill" /> : null}
        {line ? <path d={line} fill="none" stroke="var(--primary)" strokeWidth="1.6" className="vd-area-line" /> : null}
        {points.map((p, i) => (i % every === 0 ? (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={padT + ih} y2={padT + ih + 4} className="vd-grid" />
            <text x={x(i)} y={H - 6} textAnchor="middle" className="vd-axis">{p.label}</text>
          </g>
        ) : null))}
        {points.map((p, i) => (
          <rect key={`h${i}`} x={x(i) - iw / Math.max(1, n) / 2} y={padT} width={iw / Math.max(1, n)} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {hover != null && points[hover] ? (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + ih} className="vd-hoverline" />
            <circle cx={x(hover)} cy={y(points[hover].value)} r="4" fill="var(--surface)" stroke="var(--primary)" strokeWidth="2" />
          </g>
        ) : null}
      </svg>
      {hover != null && points[hover] ? (
        <div className="vd-tip" style={{ left: `${(x(hover) / W) * 100}%` }}><b>{points[hover].label}</b>{format(points[hover].value)}</div>
      ) : null}
    </div>
  );
}

/** Barras verticais com gradiente e eixo Y em Kz ("Últimos 6 meses"). */
export function VdBars({ points, height = 170, format }: { points: VdPoint[]; height?: number; format: (n: number) => string }) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const W = 300, padL = 84, padR = 6, padT = 8, padB = 20, H = height;
  const iw = W - padL - padR, ih = H - padT - padB;
  const ticks = useMemo(() => niceScale(Math.max(0, ...points.map((p) => p.value)), 6), [points]);
  const top = ticks[ticks.length - 1] || 1;
  const n = Math.max(1, points.length), slot = iw / n, bw = Math.min(18, slot * 0.62);
  const y = (v: number) => padT + ih - (v / top) * ih;
  return (
    <div className="vd-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Faturação mensal">
        <defs>
          <linearGradient id={`b${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity=".75" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity=".18" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="vd-grid" />
            <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" className="vd-axis sm">{fmtAxis(t)}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = padL + slot * i + slot / 2, h = Math.max(0, padT + ih - y(p.value));
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={cx - bw / 2} y={padT + ih - h} width={bw} height={h} rx="1.5" fill={`url(#b${uid})`} className="vd-bar" style={{ animationDelay: `${i * 50}ms` }} />
              {i % 2 === 0 ? <text x={cx} y={H - 5} textAnchor="middle" className="vd-axis sm">{p.label}</text> : null}
              <rect x={padL + slot * i} y={padT} width={slot} height={ih} fill="transparent" />
            </g>
          );
        })}
      </svg>
      {hover != null && points[hover] ? (
        <div className="vd-tip" style={{ left: `${((padL + slot * hover + slot / 2) / W) * 100}%` }}><b>{points[hover].label}</b>{format(points[hover].value)}</div>
      ) : null}
    </div>
  );
}

/** Mini-linha (sem eixos) — tendência do mês numa linha por loja. */
export function VdSpark({ values, width = 110, height = 46 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => [n <= 1 ? width / 2 : (i / (n - 1)) * width, height - 3 - (v / max) * (height - 6)] as [number, number]);
  return (
    <svg className="vd-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <line x1="0" x2={width} y1={height - 1} y2={height - 1} className="vd-grid" />
      {n ? <path d={smoothPath(pts)} fill="none" stroke="var(--primary)" strokeWidth="1.4" /> : null}
    </svg>
  );
}

/** Mini-barras (sem eixos) — últimos meses numa linha por loja. */
export function VdMiniBars({ values, width = 96, height = 46 }: { values: number[]; width?: number; height?: number }) {
  const uid = useId().replace(/:/g, '');
  const max = Math.max(1, ...values);
  const n = Math.max(1, values.length), slot = width / n, bw = slot * 0.6;
  return (
    <svg className="vd-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <defs>
        <linearGradient id={`m${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity=".8" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity=".2" />
        </linearGradient>
      </defs>
      {values.map((v, i) => {
        const h = Math.max(1.5, (v / max) * (height - 2));
        return <rect key={i} x={slot * i + (slot - bw) / 2} y={height - h} width={bw} height={h} fill={`url(#m${uid})`} className="vd-bar" style={{ animationDelay: `${i * 40}ms` }} />;
      })}
    </svg>
  );
}

const DONUT = ['var(--primary)', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b'];

/** Donut com percentagem por fatia e legenda por baixo. */
export function VdDonut({ data, format }: { data: VdPoint[]; format: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 62, r = 32, C = 100;
  let acc = 0;
  const arcs = data.map((d, i) => {
    const a0 = (acc / total) * Math.PI * 2 - Math.PI / 2; acc += d.value;
    const a1 = (acc / total) * Math.PI * 2 - Math.PI / 2;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    const full = data.length === 1;
    const path = full
      ? `M${C - R},${C} a${R},${R} 0 1,0 ${R * 2},0 a${R},${R} 0 1,0 ${-R * 2},0 M${C - r},${C} a${r},${r} 0 1,1 ${r * 2},0 a${r},${r} 0 1,1 ${-r * 2},0`
      : `M${p(R, a0)} A${R},${R} 0 ${big} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${big} 0 ${p(r, a0)} Z`;
    const mid = (a0 + a1) / 2;
    return { path, color: DONUT[i % DONUT.length], mid, pct: total ? (d.value / total) * 100 : 0 };
  });
  return (
    <div className="vd-donut">
      <svg viewBox="0 0 200 200" width="100%" style={{ maxWidth: 260 }} role="img" aria-label="Distribuição">
        {arcs.map((a, i) => (
          <path key={i} d={a.path} fill={a.color} fillRule="evenodd" className="vd-slice" opacity={hover == null || hover === i ? 1 : 0.45}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ animationDelay: `${i * 60}ms` }} />
        ))}
        {arcs.map((a, i) => (a.pct >= 4 ? (() => {
          const x1 = C + (R + 2) * Math.cos(a.mid), y1 = C + (R + 2) * Math.sin(a.mid);
          const x2 = C + (R + 14) * Math.cos(a.mid), y2 = C + (R + 14) * Math.sin(a.mid);
          const right = Math.cos(a.mid) >= 0;
          return (
            <g key={`l${i}`} className="vd-donut-lbl">
              <polyline points={`${x1},${y1} ${x2},${y2} ${x2 + (right ? 10 : -10)},${y2}`} fill="none" />
              <text x={x2 + (right ? 13 : -13)} y={y2 + 3} textAnchor={right ? 'start' : 'end'}>{a.pct.toFixed(a.pct >= 99.95 ? 0 : 1).replace('.', ',')}%</text>
            </g>
          );
        })() : null))}
      </svg>
      <ul className="vd-legend">
        {data.map((d, i) => (
          <li key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} title={format(d.value)}>
            <span style={{ background: DONUT[i % DONUT.length] }} />{d.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const VdEmpty = ({ children = 'Sem informação disponível' }: { children?: React.ReactNode }) => (
  <div className="vd-panel-empty">
    <svg width="52" height="40" viewBox="0 0 52 40" aria-hidden="true">
      <rect x="2" y="4" width="40" height="27" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 12h12M8 18h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="30" cy="16" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M38 22l9 15H29z" fill="var(--warning)" />
      <path d="M38 28v4M38 34v.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
    <span>{children}</span>
  </div>
);
