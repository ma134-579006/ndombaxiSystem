import React from 'react';

/**
 * Painel ADAPTATIVO do vertical de serviços escolhido pela empresa
 * (Restauração / Serviços / Hotelaria). Mantém o MESMO painel base — só muda o
 * que faz sentido para o serviço: mostra os módulos próprios do vertical, ligando
 * os que já existem (Caixa, Faturação/SAF-T, Clientes, RH, Relatórios, Loja) e
 * sinalizando os que estão a chegar. (Fase 2 — adaptação; módulos próprios nas fases seguintes.)
 */
interface Mod { icon: string; title: string; desc: string; to?: string; soon?: boolean }

const VERTICALS: Record<string, { label: string; intro: string; mods: Mod[] }> = {
  RESTAURANT: {
    label: '🍔 Restauração',
    intro: 'Gestão completa do teu restaurante/pastelaria: cardápio, mesas, cozinha e entregas — integrado com caixa, faturação AGT e RH.',
    mods: [
      { icon: '📋', title: 'Cardápio', desc: 'Pratos, categorias, preços e fotos.', to: 'products' },
      { icon: '🍽️', title: 'Mesas & Comandas', desc: 'Salas, mesas e pedidos por mesa.', to: 'restaurant' },
      { icon: '👨‍🍳', title: 'Cozinha (KDS)', desc: 'Ecrã de cozinha em tempo real.', to: 'restaurant' },
      { icon: '📱', title: 'Pedido por QR', desc: 'Cliente pede pelo telemóvel na mesa.', soon: true },
      { icon: '🛵', title: 'Entregas (delivery)', desc: 'Pedidos online para entrega.', to: 'orders' },
      { icon: '🧾', title: 'Caixa & Faturação', desc: 'Vender e faturar (AGT).', to: 'operations' },
      { icon: '🤝', title: 'Clientes', desc: 'Base de clientes e fidelização.', to: 'customers' },
      { icon: '👥', title: 'Equipa & Folha', desc: 'Funcionários e salários.', to: 'employees' },
      { icon: '📊', title: 'Relatórios', desc: 'Vendas, lucros e SAF-T.', to: 'reports' },
    ],
  },
  SERVICES: {
    label: '🔧 Serviços',
    intro: 'Oficina/assistência técnica de ponta a ponta: ordens de serviço, orçamentos, execução e fatura — com peças do stock e RH integrados.',
    mods: [
      { icon: '🛠️', title: 'Ordens de serviço', desc: 'Abrir, executar e fechar OS.', to: 'service-orders' },
      { icon: '🚗', title: 'Clientes & Equipamentos', desc: 'Viaturas/aparelhos por cliente.', to: 'customers' },
      { icon: '🧮', title: 'Orçamentos', desc: 'Orçamento → aprovação → execução (na OS).', to: 'service-orders' },
      { icon: '📅', title: 'Agendamento', desc: 'Marcações e fila de trabalho.', soon: true },
      { icon: '🛡️', title: 'Garantias', desc: 'Controlo de garantia dos serviços.', soon: true },
      { icon: '📦', title: 'Peças & Stock', desc: 'Peças consumidas nas OS.', to: 'products' },
      { icon: '🧾', title: 'Faturação (AGT)', desc: 'Faturar serviços e peças.', to: 'operations' },
      { icon: '🤝', title: 'Clientes', desc: 'Base de clientes.', to: 'customers' },
      { icon: '📊', title: 'Relatórios & SAF-T', desc: 'Receita, técnicos, fiscal.', to: 'reports' },
    ],
  },
  HOSPITALITY: {
    label: '🏨 Hotelaria',
    intro: 'Gestão de hotel/hospedaria: quartos, reservas, check-in/out e conta do hóspede — com faturação AGT e RH integrados.',
    mods: [
      { icon: '🛏️', title: 'Quartos', desc: 'Tipos, estado e tarifas.', soon: true },
      { icon: '📆', title: 'Reservas', desc: 'Calendário de reservas.', soon: true },
      { icon: '🔑', title: 'Check-in / Check-out', desc: 'Entrada e saída de hóspedes.', soon: true },
      { icon: '🧾', title: 'Conta do hóspede (folio)', desc: 'Consumos + fatura final (AGT).', soon: true },
      { icon: '💲', title: 'Tarifas por época', desc: 'Preços por época/ocupação.', soon: true },
      { icon: '🛎️', title: 'Pedidos / Serviços', desc: 'Room service e extras.', to: 'orders' },
      { icon: '🤝', title: 'Hóspedes', desc: 'Base de clientes/hóspedes.', to: 'customers' },
      { icon: '👥', title: 'Equipa & Folha', desc: 'Funcionários e salários.', to: 'employees' },
      { icon: '📊', title: 'Relatórios & SAF-T', desc: 'Ocupação, receita, fiscal.', to: 'reports' },
    ],
  },
};

export function ServiceHub({ businessType, onGo }: { businessType: string; onGo(section: string): void }) {
  const v = VERTICALS[businessType] ?? VERTICALS.RESTAURANT;
  return (
    <>
      <div className="content-head">
        <h2>{v.label}</h2>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{v.intro}</p>
      </div>
      <div className="pgrid">
        {v.mods.map((m) => (
          <button
            key={m.title}
            className="pcard"
            onClick={() => { if (m.to) onGo(m.to); }}
            disabled={m.soon}
            style={{ textAlign: 'left', cursor: m.soon ? 'default' : 'pointer', opacity: m.soon ? 0.72 : 1 }}
          >
            <div className="thumb" style={{ fontSize: 30, display: 'grid', placeItems: 'center' }}>{m.icon}</div>
            <div className="pinfo">
              <div className="pname">{m.title}</div>
              <div className="pcode">{m.desc}</div>
              <div className="pfoot">
                <span className={`pill ${m.soon ? 'off' : 'on'}`}>{m.soon ? 'Em breve' : 'Disponível'}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
