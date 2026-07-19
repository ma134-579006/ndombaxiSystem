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
  const products = { key: 'products', icon: '📦', label: 'Cria o teu 1.º produto', done: c.products > 0, section: 'products' };
  const sale = { key: 'sale', icon: '🧾', label: 'Emite a 1.ª fatura (venda)', done: c.invoices > 0, section: 'reports' };
  switch (biz) {
    case 'RESTAURANT':
      return [
        { key: 'tables', icon: '🪑', label: 'Cria as mesas da sala', done: c.tables > 0, section: 'restaurant', tab: ['ndx_rest_tab', 'mesas'] },
        { ...products, label: 'Cria os pratos e bebidas do cardápio' },
        sale,
      ];
    case 'SERVICES':
      return [
        { key: 'equip', icon: '🚗', label: 'Regista o 1.º equipamento/viatura', done: c.equipments > 0, section: 'service-orders', tab: ['ndx_srv_tab', 'equipments'] },
        { ...products, label: 'Cria as peças e serviços que vendes' },
        sale,
      ];
    case 'HOSPITALITY':
      return [
        { key: 'rooms', icon: '🛏️', label: 'Cria os quartos do hotel', done: c.rooms > 0, section: 'hotel' },
        { ...products, label: 'Cria os serviços e produtos (bar, frigobar…)' },
        sale,
      ];
    case 'CLINIC':
      return [
        { key: 'prof', icon: '🩺', label: 'Regista os profissionais de saúde', done: c.professionals > 0, section: 'clinic' },
        { key: 'pat', icon: '🧑', label: 'Cria a 1.ª ficha de paciente', done: c.patients > 0, section: 'clinic' },
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

  return (
    <div className="card" style={{ marginBottom: 14, borderLeft: '3px solid var(--primary)' }}>
      <div className="row" style={{ alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ fontSize: 15 }}>🚀 Primeiros passos</strong>
        <span className="muted" style={{ marginLeft: 10, fontSize: 12.5 }}>{done} de {steps.length} concluídos</span>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn sm ghost" onClick={hide} title="Não voltar a mostrar">Ocultar</button>
      </div>
      {/* Barra de progresso simples (sem libs) */}
      <div aria-hidden style={{ height: 6, borderRadius: 999, background: 'var(--border)', overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ height: '100%', width: `${(done / steps.length) * 100}%`, background: 'var(--primary)', borderRadius: 999, transition: 'width .4s cubic-bezier(.16,1,.3,1)' }} />
      </div>
      {steps.map((s) => (
        <div key={s.key} className="row" style={{ alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border-soft, #0001)' }}>
          <span aria-hidden style={{ width: 22, height: 22, borderRadius: 999, flex: 'none', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800,
            background: s.done ? 'var(--success)' : 'var(--surface-2)', color: s.done ? '#fff' : 'var(--muted)', border: s.done ? 'none' : '1.5px solid var(--border)' }}>
            {s.done ? '✓' : ''}
          </span>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: s.done ? 500 : 700, textDecoration: s.done ? 'line-through' : 'none', opacity: s.done ? 0.65 : 1 }}>
            {s.icon} {s.label}
          </span>
          {!s.done ? <button className="btn sm" onClick={() => go(s)}>Fazer agora</button> : null}
        </div>
      ))}
    </div>
  );
}
