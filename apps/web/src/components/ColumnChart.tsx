import React, { useId, useMemo, useState } from 'react';

export interface ColumnPoint { label: string; value: number; hint?: string }

/**
 * Gráfico de COLUNAS verticais (SVG, sem dependências) — mesmo estilo do gráfico
 * de área da Visão Geral: grelha subtil, gradiente, colunas arredondadas com
 * animação de crescimento, rótulos no eixo e tooltip ao passar o rato.
 * Ideal para rankings (top produtos/funcionários/clientes/lojas).
 */
export function ColumnChart({
  data, height = 240, color = 'var(--primary)', format = (n) => String(n),
}: {
  data: ColumnPoint[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
}) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);

  const W = 760;
  const H = height;
  const padL = 8, padR = 8, padT = 16, padB = 46;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const max = useMemo(() => Math.max(1, ...data.map((d) => d.value)), [data]);
  const n = data.length;
  if (n === 0) return <div className="empty"><p className="muted">Sem dados no período.</p></div>;

  const slot = innerW / n;
  const bw = Math.min(64, slot * 0.62);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => padT + innerH - f * innerH);
  const colX = (i: number) => padL + slot * i + (slot - bw) / 2;
  const barH = (v: number) => (v / max) * innerH;
  const trim = (s: string, k = 14) => (s.length > k ? s.slice(0, k - 1) + '…' : s);

  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={`c-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.95" />
            <stop offset="100%" stopColor={color} stopOpacity="0.45" />
          </linearGradient>
        </defs>

        {grid.map((gy, i) => (
          <line key={i} x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--border)" strokeWidth="1"
            strokeDasharray={i === grid.length - 1 ? '0' : '3 4'} opacity="0.5" />
        ))}

        {data.map((d, i) => {
          const h = Math.max(2, barH(d.value));
          const x = colX(i);
          const yTop = padT + innerH - h;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill="transparent" />
              <rect x={x} y={yTop} width={bw} height={h} rx={6} fill={`url(#c-${uid})`}
                opacity={hover === null || hover === i ? 1 : 0.55}
                style={{ transformBox: 'fill-box', transformOrigin: 'bottom', animation: 'col-grow .55s cubic-bezier(.2,.7,.3,1) both', animationDelay: `${i * 60}ms` }} />
              <text x={x + bw / 2} y={H - 26} textAnchor="middle" fontSize="11" fill="var(--muted)">{trim(d.label)}</text>
              <text x={x + bw / 2} y={H - 12} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--text)">{format(d.value)}</text>
            </g>
          );
        })}
      </svg>

      {hover !== null ? (
        <div className="chart-tip">
          <strong>{data[hover].label}</strong>
          <span>{format(data[hover].value)}</span>
          {data[hover].hint ? <span className="muted">{data[hover].hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
