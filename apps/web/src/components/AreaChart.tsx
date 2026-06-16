import React, { useId, useMemo, useState } from 'react';

export interface AreaPoint { label: string; value: number; sub?: number; sub2?: number }

interface Props {
  points: AreaPoint[];
  height?: number;
  /** Cor principal (área/linha). CSS var ou hex. */
  color?: string;
  /** Cor da 2ª série opcional (linha fina, ex.: cancelamentos). */
  subColor?: string;
  /** Cor da 3ª série opcional (ex.: gastos). */
  sub2Color?: string;
  /** Rótulos das séries para o tooltip. */
  subLabel?: string;
  sub2Label?: string;
  format?: (n: number) => string;
}

/**
 * Gráfico de área SVG moderno, sem dependências: preenchimento em gradiente,
 * linha suave, grelha subtil, rótulos de eixo e tooltip ao passar o rato.
 * Responsivo via viewBox (escala com o contentor).
 */
export function AreaChart({ points, height = 220, color = 'var(--primary)', subColor, sub2Color, subLabel = 'Anulado', sub2Label = 'Gastos', format = (n) => String(n) }: Props) {
  const uid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);

  const W = 760;          // largura do viewBox (escala por CSS)
  const H = height;
  const padL = 8, padR = 8, padT = 16, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const max = useMemo(() => {
    const vals = points.flatMap((p) => [p.value, p.sub ?? 0, p.sub2 ?? 0]);
    return Math.max(1, ...vals);
  }, [points]);

  const n = points.length;
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const linePath = useMemo(() => points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' '), [points, max]);
  const areaPath = useMemo(() => {
    if (n === 0) return '';
    return `${linePath} L ${x(n - 1).toFixed(1)} ${(padT + innerH).toFixed(1)} L ${x(0).toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;
  }, [linePath, n, max]);
  const subPath = useMemo(
    () => (subColor ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.sub ?? 0).toFixed(1)}`).join(' ') : ''),
    [points, subColor, max],
  );
  const sub2Path = useMemo(
    () => (sub2Color ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.sub2 ?? 0).toFixed(1)}`).join(' ') : ''),
    [points, sub2Color, max],
  );

  // Linhas de grelha (4 níveis).
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => padT + innerH - f * innerH);
  // Rótulos X: mostra no máximo ~8 para não sobrecarregar.
  const step = Math.max(1, Math.ceil(n / 8));

  if (n === 0) return <p className="muted">Sem dados no período.</p>;

  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="chart-svg"
        onMouseLeave={() => setHover(null)}
        style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={`g-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* grelha */}
        {grid.map((gy, i) => (
          <line key={i} x1={padL} y1={gy} x2={W - padR} y2={gy}
            stroke="var(--border)" strokeWidth="1" strokeDasharray={i === grid.length - 1 ? '0' : '3 4'} opacity="0.5" />
        ))}

        {/* área + linha */}
        <path d={areaPath} fill={`url(#g-${uid})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {subColor ? <path d={subPath} fill="none" stroke={subColor} strokeWidth="2" strokeDasharray="4 4" opacity="0.9" /> : null}
        {sub2Color ? <path d={sub2Path} fill="none" stroke={sub2Color} strokeWidth="2" strokeDasharray="2 3" opacity="0.9" /> : null}

        {/* pontos + captura de hover por coluna */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={hover === i ? 4.5 : 0} fill={color} stroke="var(--surface)" strokeWidth="2" />
            <rect x={x(i) - innerW / (2 * Math.max(1, n - 1))} y={padT} width={innerW / Math.max(1, n - 1)} height={innerH}
              fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}

        {/* guia vertical no hover */}
        {hover !== null ? (
          <line x1={x(hover)} y1={padT} x2={x(hover)} y2={padT + innerH} stroke={color} strokeWidth="1" opacity="0.4" />
        ) : null}

        {/* rótulos X */}
        {points.map((p, i) => (i % step === 0 || i === n - 1) ? (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{p.label}</text>
        ) : null)}
      </svg>

      {/* tooltip */}
      {hover !== null ? (
        <div className="chart-tip">
          <strong>{points[hover].label}</strong>
          <span>{format(points[hover].value)}</span>
          {subColor && points[hover].sub != null ? <span style={{ color: subColor }}>{subLabel}: {format(points[hover].sub ?? 0)}</span> : null}
          {sub2Color && points[hover].sub2 != null ? <span style={{ color: sub2Color }}>{sub2Label}: {format(points[hover].sub2 ?? 0)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
