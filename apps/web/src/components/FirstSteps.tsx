import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

/**
 * PRIMEIROS PASSOS por SETOR (onboarding pós-registo, Fase 3 da auditoria).
 * Aparece no topo da Visão geral de empresas NOVAS: 3 passos certos para o
 * vertical (restaurante→mesas/pratos, oficina→equipamentos/OS, hotel→quartos,
 * clínica→equipa/pacientes, retalho→produtos/venda), cada um com o estado
 * derivado de DADOS REAIS e um botão que leva ao sítio certo (deep-link).
 * Desaparece sozinho quando tudo está feito; pode ocultar-se manualmente.
 */

type Step = { key: string; icon: string; label: string; done: boolean; section: string; tab?: [string, string] };

const hideKey = (code: string) => `ndombaxi.firststeps.hide.${code}`;

function stepsFor(biz: string, c: Record<string, number>): Step[] {
  const products = { key: 'products', icon: 'box', label: 'Cria o teu 1.º produto', done: c.products > 0, section: 'products' };
  const sale = { key: 'sale', icon: 'receipt', label: 'Emite a 1.ª fatura (venda)', done: c.invoices > 0, section: 'reports' };
  switch (biz) {
    case 'RESTAURANT':
      return [
        { key: 'tables', icon: 'table', label: 'Cria as mesas da sala', done: c.tables > 0, section: 'restaurant', tab: ['ndx_rest_tab', 'mesas'] },
        { ...products, label: 'Cria os pratos e bebidas do cardápio' },
        sale,
      ];
    case 'SERVICES':
      return [
        { key: 'equip', icon: 'car', label: 'Regista o 1.º equipamento/viatura', done: c.equipments > 0, section: 'service-orders', tab: ['ndx_srv_tab', 'equipments'] },
        { ...products, label: 'Cria as peças e serviços que vendes' },
        sale,
      ];
    case 'HOSPITALITY':
      return [
        { key: 'rooms', icon: 'bed', label: 'Cria os quartos do hotel', done: c.rooms > 0, section: 'hotel' },
        { ...products, label: 'Cria os serviços e produtos (bar, frigobar…)' },
        sale,
      ];
    case 'CLINIC':
      return [
        { key: 'prof', icon: 'steth', label: 'Regista os profissionais de saúde', done: c.professionals > 0, section: 'clinic' },
        { key: 'pat', icon: 'user', label: 'Cria a 1.ª ficha de paciente', done: c.patients > 0, section: 'clinic' },
        sale,
      ];
    default: // RETAIL, PHARMACY e restantes
      return [products, sale];
  }
}

export function FirstSteps({ onGo, companyCode }: { onGo?: (section: string) => void; companyCode?: string | null }) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(hideKey(companyCode ?? '')) === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (hidden) return;
    let alive = true;
    Promise.all([api.branding(), api.firstSteps()])
      .then(([b, c]) => { if (alive) setSteps(stepsFor(b.businessType || 'RETAIL', c)); })
      .catch(() => { /* sem dados → não mostra nada (não incomoda) */ });
    return () => { alive = false; };
  }, [hidden]);

  if (hidden || !steps) return null;
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null; // tudo feito → o guia retira-se sozinho

  const go = (s: Step) => {
    try { if (s.tab) sessionStorage.setItem(s.tab[0], s.tab[1]); } catch { /* indisponível */ }
    onGo?.(s.section);
  };
  const hide = () => {
    try { localStorage.setItem(hideKey(companyCode ?? ''), '1'); } catch { /* indisponível */ }
    setHidden(true);
  };

  const pct = Math.round((done / steps.length) * 100);
  const nextKey = steps.find((x) => !x.done)?.key;
  return (
    <section className="fs-card" aria-labelledby="fs-title">
      <header className="fs-head">
        <div className="fs-head-tx">
          <h3 id="fs-title">Primeiros passos</h3>
          <p>{done} de {steps.length} concluídos</p>
        </div>
        <div className="fs-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progresso">
          <span className="fs-pct">{pct}%</span>
          <span className="fs-bar"><i style={{ width: `${pct}%` }} /></span>
        </div>
        <button className="fs-close" onClick={hide} title="Não voltar a mostrar" aria-label="Ocultar primeiros passos">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <ol className="fs-list">
        {steps.map((s, i) => (
          <li key={s.key} className={`fs-step${s.done ? ' done' : ''}${s.key === nextKey ? ' next' : ''}`}>
            <span className="fs-num" aria-hidden="true">
              {s.done
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                : i + 1}
            </span>
            <span className="fs-ic" aria-hidden="true"><StepIcon name={s.icon} /></span>
            <span className="fs-label">{s.label}{s.done ? <span className="sr-only"> (concluído)</span> : null}</span>
            {s.done
              ? <span className="fs-tag">Concluído</span>
              : <button className={`btn sm${s.key === nextKey ? '' : ' ghost'}`} onClick={() => go(s)}>
                  {s.key === nextKey ? 'Começar' : 'Fazer agora'}
                </button>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Ícones dos passos: traço único 1.75 (mesma família do resto do painel). */
const STEP_ICONS: Record<string, string> = {
  box: 'M21 8 12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6M9 16h3',
  table: 'M4 9h16M6 9v10M18 9v10M8 5h8l2 4H6l2-4z',
  car: 'M5 16h14M3 13l2-6h14l2 6v4H3v-4zM7 17v2M17 17v2M7 13h.01M17 13h.01',
  bed: 'M3 18V7M3 13h18v5M21 13v-2a3 3 0 0 0-3-3h-7v5M7 11.5a1.5 1.5 0 1 0 0-.01',
  steth: 'M6 3v6a4 4 0 0 0 8 0V3M10 13v2a4 4 0 0 0 8 0v-1.5M18 13.5a1.8 1.8 0 1 0 0-.01',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
};
function StepIcon({ name }: { name: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={STEP_ICONS[name] ?? STEP_ICONS.box} />
    </svg>
  );
}
