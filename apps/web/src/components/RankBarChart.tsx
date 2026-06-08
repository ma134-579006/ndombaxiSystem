import React, { useId } from 'react';

export interface RankBar { label: string; value: number; hint?: string }

/**
 * Gráfico de ranking (barras horizontais) moderno: barra com gradiente, valor à
 * direita, animação de crescimento. Ideal para "top produtos / funcionários /
 * clientes / lojas". Sem dependências; responsivo.
 */
export function RankBarChart({
  data, color = 'var(--primary)', format = (n) => String(n), max,
}: {
  data: RankBar[];
  color?: string;
  format?: (n: number) => string;
  max?: number;
}) {
  const uid = useId().replace(/:/g, '');
  if (!data.length) return <div className="empty"><p className="muted">Sem dados no período.</p></div>;
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="rankchart">
      {data.map((d, i) => {
        const pct = Math.max(2, Math.round((d.value / top) * 100));
        return (
          <div className="rankrow" key={i}>
            <div className="rankrow-head">
              <span className="rl" title={d.label}>{i + 1}. {d.label}</span>
              <span className="rv">{format(d.value)}</span>
            </div>
            <div className="rankbar-track">
              <div className="rankbar-fill" style={{ width: `${pct}%`, animationDelay: `${i * 60}ms`, background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 55%, transparent))` }} />
            </div>
            {d.hint ? <div className="rankrow-hint">{d.hint}</div> : null}
          </div>
        );
      })}
      <span hidden id={uid} />
    </div>
  );
}
