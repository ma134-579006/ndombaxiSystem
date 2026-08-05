import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
// O style guide tem de carregar EXACTAMENTE a mesma pilha que as apps.
// Faltavam os tokens: a página vinha a desenhar-se com os valores de
// recurso do `var(--nx-…, fallback)`, ou seja, mostrava um sistema que
// não era o que está em produção.
import '@nexus/tokens/tokens.css';
import '@nexus/ui/styles.css';
import './theme.css';
import {
  Badge, Button, Card, DataTable, Dialog, EmptyState, Input, KpiCard,
  Select, Skeleton, Tabs, ToastProvider, useToast,
} from '@nexus/ui';
import {
  IconArrowLeftRight, IconAudit, IconBadge, IconBank, IconBell, IconBoxes, IconBuilding,
  IconCalendar, IconCamera, IconCard, IconCart, IconCartIn, IconCashRegister, IconChart,
  IconCheck, IconCoins, IconCube, IconDatabase, IconGauge, IconGear, IconHeadset,
  IconHistory, IconKey, IconLedger, IconMail, IconMessage, IconPercent, IconPlug,
  IconReceipt, IconReport, IconSearch, IconShield, IconSparkles, IconStar, IconStore,
  IconTag, IconTrendUp, IconTruck, IconUpload, IconUser, IconUsers, IconWallet,
} from './components/Icons';

/**
 * DESIGN SYSTEM — style guide VIVO do Ndombaxi System (/design.html).
 * Página estática (sem API, sem dados reais): mostra tokens, ícones
 * semânticos e todos os componentes partilhados nos 2 temas. Serve de
 * contrato visual para qualquer ecrã novo do ERP.
 */

const ICONS: Array<[string, React.ComponentType<{ size?: number }>]> = [
  ['Dashboard', IconGauge], ['Empresa', IconBuilding], ['Clientes', IconUsers],
  ['Funcionários', IconBadge], ['Perfil', IconUser], ['Loja', IconStore],
  ['Loja online', IconCart], ['Compras', IconCartIn], ['Vendas/Fatura', IconReceipt],
  ['Caixa (POS)', IconCashRegister], ['Stock/Inventário', IconBoxes], ['Produto', IconCube],
  ['Entregas', IconTruck], ['Financeiro', IconTrendUp], ['Fluxo de caixa', IconCoins],
  ['Contas a pagar', IconWallet], ['Contabilidade', IconLedger], ['Relatórios', IconReport],
  ['Auditoria', IconAudit], ['Histórico/Logs', IconHistory], ['Análise', IconChart],
  ['Segurança', IconShield], ['Permissões', IconKey], ['Configurações', IconGear],
  ['Notificações', IconBell], ['IA', IconSparkles], ['Promoções', IconTag],
  ['Comissões', IconPercent], ['Conciliação', IconArrowLeftRight], ['Banco', IconBank],
  ['Suporte', IconHeadset], ['Comentários', IconMessage], ['Integrações', IconPlug],
  ['E-mail', IconMail], ['Backup', IconDatabase], ['Migração', IconUpload],
  ['Câmaras', IconCamera], ['Férias', IconCalendar], ['Destaque', IconStar],
];

/** Navegações REAIS dos dois painéis (mesmos itens/ícones do App). */
const NAV_GESTOR = [
  { label: 'Visão geral', icon: IconGauge, active: true },
  { label: 'Assistente IA', icon: IconSparkles },
  { label: 'Lojas', icon: IconStore },
  { label: 'Produtos', icon: IconCube },
  { label: 'Inventário', icon: IconBoxes },
  { label: 'Inventário PRO', icon: IconTrendUp },
  { label: 'Compras', icon: IconCartIn },
  { label: 'Movimentações', icon: IconCoins },
  { label: 'Caixa & Auditoria', icon: IconCashRegister },
  { label: 'Relatórios', icon: IconReport },
  { label: 'Funcionários', icon: IconBadge },
  { label: 'Clientes', icon: IconUsers },
  { label: 'Câmaras', icon: IconCamera },
  { label: 'Fiscal · SAF-T', icon: IconReceipt },
  { label: 'Backup & Restauro', icon: IconDatabase },
  { label: 'Configurações', icon: IconGear },
];
const NAV_SUPER = [
  { label: 'Dashboard', icon: IconGauge, active: true },
  { label: 'Empresas', icon: IconBuilding },
  { label: 'Subscrições & Pagamentos', icon: IconCard },
  { label: 'Suporte do site', icon: IconHeadset },
  { label: 'Comentários do site', icon: IconMessage },
  { label: 'Planos & Página inicial', icon: IconTag },
  { label: 'Inteligência Artificial', icon: IconSparkles },
  { label: 'Fiscal (AGT)', icon: IconReceipt },
  { label: 'Gateways de Pagamento', icon: IconBank },
  { label: 'Integrações', icon: IconPlug },
  { label: 'E-mail (SMTP)', icon: IconMail },
];

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <div className="content-head" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className="spacer" />
        {sub ? <span className="muted" style={{ fontSize: 13 }}>{sub}</span> : null}
      </div>
      {children}
    </section>
  );
}

function DesignShowcase() {
  const [theme, setTheme] = useState('claro');
  const [panel, setPanel] = useState<'gestor' | 'super'>('gestor');
  const setT = (t: string) => {
    setTheme(t);
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme'); // padrão = escuro
  };
  const nav = panel === 'gestor' ? NAV_GESTOR : NAV_SUPER;

  return (
    <div className="admin">
      {/* Sidebar de demonstração (navegação REAL do painel escolhido) */}
      <aside className="sidebar" style={{ display: undefined }}>
        <div className="brand">
          <img src="/logo.png" alt="Ndombaxi" />
          <div>
            <div className="nm">Ndombaxi System</div>
            <div className="tg">{panel === 'gestor' ? 'Painel do Gestor' : 'Super Admin'}</div>
          </div>
        </div>
        <nav className="nav">
          {nav.map((n) => (
            <button key={n.label} className={'active' in n && n.active ? 'active' : ''}>
              <n.icon size={18} /> {n.label}
            </button>
          ))}
        </nav>
        <div className="sig">Style guide vivo — sem dados reais.</div>
      </aside>

      <div className="main">
        <div className="topbar">
          {/* Barra só-ações (o título vive no conteúdo — padrão do Shell). */}
          <span className="spacer" />
          <div className="row" role="group" aria-label="Painel">
            {(['gestor', 'super'] as const).map((p) => (
              <button key={p} className={`chip${panel === p ? ' active' : ''}`} onClick={() => setPanel(p)}>
                {p === 'gestor' ? 'Gestor' : 'Super Admin'}
              </button>
            ))}
          </div>
          <div className="row" role="group" aria-label="Tema">
            {['claro', ''].map((t) => (
              <button key={t || 'dark'} className={`chip${theme === t ? ' active' : ''}`} onClick={() => setT(t)}>
                {t === 'claro' ? '☀ Claro' : '🌙 Escuro'}
              </button>
            ))}
          </div>
          <div className="who">
            <div className="nm">Manuel Ndombaxi</div>
            <div className="rl">{panel === 'gestor' ? 'Gestor' : 'Super Admin'}</div>
          </div>
        </div>

        <div className="content" style={{ overflow: 'auto' }}>
          <div className="content-head"><h2>Design System · Enterprise</h2></div>
          <Section title="KPIs" sub="rótulo uppercase + número forte (padrão Stripe/Linear)">
            <div className="kpi-grid">
              <div className="kpi-card"><div className="kpi-label">Vendas de hoje</div><div className="kpi-value">1.254.900 Kz</div><div className="kpi-sub">+12% vs. ontem</div></div>
              <div className="kpi-card"><div className="kpi-label">Faturas emitidas</div><div className="kpi-value">87</div><div className="kpi-sub">3 anuladas</div></div>
              <div className="kpi-card"><div className="kpi-label">Valor em stock</div><div className="kpi-value">9.310.000 Kz</div><div className="kpi-sub">a preço de custo</div></div>
              <div className="kpi-card"><div className="kpi-label">Clientes ativos</div><div className="kpi-value">1.043</div><div className="kpi-sub">+18 este mês</div></div>
            </div>
          </Section>

          <Section title="Botões & estados" sub="elevação subtil, foco visível por teclado, sem glow de template">
            <div className="card">
              <div className="wrapcols" style={{ alignItems: 'center' }}>
                <button className="btn">Ação primária</button>
                <button className="btn ghost">Secundária</button>
                <button className="btn success"><IconCheck size={16} /> Sucesso</button>
                <button className="btn danger">Perigo</button>
                <button className="btn warn">Aviso</button>
                <button className="btn" disabled>Desativado</button>
                <button className="btn sm">Pequeno</button>
                <button className="btn ghost sm"><IconSearch size={15} /> Pesquisar</button>
                <span className="chip">Filtro</span>
                <span className="chip active">Filtro ativo</span>
                <span className="pill on">Pago</span>
                <span className="pill warn">Parcial</span>
                <span className="pill off">Anulada</span>
              </div>
            </div>
          </Section>

          <Section title="Cartões de ação" sub='padrão "importar" (ícone + título + descrição + botão largo)'>
            <div className="action-grid">
              {[
                { t: 'Produtos', d: 'Importação de produtos ou serviços em formato CSV ou SAF-T (XML).', i: IconCube },
                { t: 'Stock', d: 'Atualização do inventário em formato CSV, por loja.', i: IconBoxes },
                { t: 'Clientes', d: 'Importação de clientes em formato CSV ou SAF-T (XML).', i: IconUsers },
                { t: 'Fornecedores', d: 'Importação de fornecedores em formato CSV.', i: IconTruck },
              ].map((c) => (
                <div className="action-card" key={c.t}>
                  <span className="ac-icon"><c.i /></span>
                  <h4>{c.t}</h4>
                  <p>{c.d}</p>
                  <button className="btn"><IconUpload size={16} /> Importar</button>
                  <button className="ac-link">Download ficheiro exemplo</button>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Formulário" sub="rótulos firmes, foco com anel, grid 2 colunas responsivo">
            <div className="card" style={{ maxWidth: 640 }}>
              <div className="grid-2">
                <div className="field"><label>Nome do produto</label><input placeholder="ex.: Óleo alimentar 1L" /></div>
                <div className="field"><label>Categoria</label><select><option>Mercearia</option><option>Bebidas</option></select></div>
              </div>
              <div className="grid-2">
                <div className="field"><label>Preço de venda (Kz)</label><input inputMode="decimal" placeholder="0,00" /></div>
                <div className="field"><label>Stock inicial</label><input inputMode="numeric" placeholder="0" /></div>
              </div>
              <div className="switch-row">
                <span>Visível na loja online</span>
                <label className="switch"><input type="checkbox" defaultChecked /><span className="tk" /><span className="th" /></label>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
                <button className="btn ghost">Cancelar</button>
                <button className="btn">Guardar produto</button>
              </div>
            </div>
          </Section>

          <Section title="Tabela" sub="cabeçalho uppercase, hover subtil, empilha em cartões no telemóvel">
            <div className="card">
              <table className="ptable stack">
                <thead><tr><th>Documento</th><th>Cliente</th><th>Data</th><th>Total</th><th>Estado</th></tr></thead>
                <tbody>
                  {[
                    ['FT A/2026/0102', 'Maria dos Santos', '02/07/2026', '45.900 Kz', <span className="pill on" key="1">Paga</span>],
                    ['FT A/2026/0101', 'João Baptista', '02/07/2026', '128.500 Kz', <span className="pill warn" key="2">Parcial</span>],
                    ['FT A/2026/0100', 'Consumidor final', '01/07/2026', '9.200 Kz', <span className="pill off" key="3">Anulada</span>],
                  ].map((r, i) => (
                    <tr key={i}>
                      <td data-label="Documento" style={{ fontWeight: 700 }}>{r[0]}</td>
                      <td data-label="Cliente">{r[1]}</td>
                      <td data-label="Data">{r[2]}</td>
                      <td data-label="Total">{r[3]}</td>
                      <td data-label="Estado">{r[4]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Feedback" sub="banners de estado + skeleton de carregamento">
            <div className="card" style={{ display: 'grid', gap: 10 }}>
              <div className="banner success"><IconCheck size={18} /> Fatura FT A/2026/0102 emitida com sucesso.</div>
              <div className="banner info">A sincronizar o stock com a loja online…</div>
              <div className="banner warning">3 produtos abaixo do stock mínimo.</div>
              <div className="banner danger">Não foi possível ligar à impressora térmica.</div>
              <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
                <div className="skeleton" style={{ height: 14, width: '65%' }} />
                <div className="skeleton" style={{ height: 14, width: '90%' }} />
                <div className="skeleton" style={{ height: 14, width: '45%' }} />
              </div>
            </div>
          </Section>

          <NxKit />

          <Section title="Iconografia semântica" sub="uma só biblioteca · stroke 2 · cada módulo com o ícone da função">
            <div className="card">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 10 }}>
                {ICONS.map(([label, I]) => (
                  <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '14px 6px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-2)' }}>
                    <I size={22} />
                    <span style={{ fontSize: 11.5, color: 'var(--muted)', textAlign: 'center' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   @nexus/ui — os componentes PARTILHADOS pelas três apps.
   Tudo o que está aqui é literalmente o mesmo código que corre no
   Gestor, na Caixa e na Loja (e portanto no Desktop e no Android).
   ============================================================ */

interface Fatura {
  doc: string;
  cliente: string;
  data: string;
  total: number;
  estado: 'Paga' | 'Parcial' | 'Anulada';
}

const FATURAS: Fatura[] = [
  { doc: 'FT A/2026/0102', cliente: 'Maria dos Santos', data: '02/07/2026', total: 45900, estado: 'Paga' },
  { doc: 'FT A/2026/0101', cliente: 'João Baptista', data: '02/07/2026', total: 128500, estado: 'Parcial' },
  { doc: 'FT A/2026/0100', cliente: 'Consumidor final', data: '01/07/2026', total: 9200, estado: 'Anulada' },
];

const kz = (n: number) => `${n.toLocaleString('pt-PT')} Kz`;

function NxKit() {
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [aba, setAba] = useState('componentes');
  const [carregar, setCarregar] = useState(false);

  return (
    <>
      <Section title="@nexus/ui · Botões" sub="4 níveis de hierarquia · o `loading` bloqueia o duplo-clique">
        <Card>
          <div className="nx-row-wrap">
            <Button variant="primary">Emitir fatura</Button>
            <Button variant="secondary">Guardar rascunho</Button>
            <Button variant="ghost">Cancelar</Button>
            <Button variant="danger">Anular documento</Button>
            <Button variant="primary" loading>
              A gravar
            </Button>
            <Button variant="secondary" disabled>
              Indisponível
            </Button>
          </div>
          <div className="nx-row-wrap">
            <Button size="sm" variant="secondary">Pequeno</Button>
            <Button size="md" variant="secondary">Normal</Button>
            <Button size="lg" variant="secondary">Grande</Button>
          </div>
        </Card>
      </Section>

      <Section title="@nexus/ui · Campos" sub="rótulo, ajuda e erro ligados por id ao controlo (leitor de ecrã anuncia os três)">
        <Card>
          <div className="grid-2">
            <Input label="Nome do cliente" required placeholder="ex.: Maria dos Santos" />
            <Input label="NIF" hint="9 dígitos, emitido pela AGT" placeholder="000000000" />
          </div>
          <div className="grid-2">
            <Input label="Telefone" error="Preencha um número angolano válido (9 dígitos)." defaultValue="93" />
            <Select label="Regime fiscal" defaultValue="geral">
              <option value="geral">Regime geral</option>
              <option value="simplificado">Regime simplificado</option>
              <option value="isento">Isento</option>
            </Select>
          </div>
        </Card>
      </Section>

      <Section title="@nexus/ui · Indicadores" sub="valor domina · variação dita por seta, cor E palavra">
        <div className="wrapcols" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <KpiCard label="Vendas do dia" value={kz(486300)} delta={12.4} deltaLabel="vs. ontem" />
          <KpiCard label="Ticket médio" value={kz(8420)} delta={-3.1} deltaLabel="vs. ontem" />
          <KpiCard label="Rupturas de stock" value="7" delta={9.5} deltaLabel="vs. semana" invert />
          <KpiCard label="Documentos por sincronizar" value="0" delta={0} />
        </div>
      </Section>

      <Section title="@nexus/ui · Tabela de dados" sub="carregamento sem salto de layout · números tabulares · rola dentro de si">
        <Card
          flush
          title="Faturação recente"
          actions={
            <Button size="sm" variant="secondary" onClick={() => setCarregar((v) => !v)}>
              {carregar ? 'Mostrar dados' : 'Simular carregamento'}
            </Button>
          }
        >
          <DataTable<Fatura>
            caption="Faturas emitidas nos últimos 2 dias"
            loading={carregar}
            rows={FATURAS}
            rowKey={(r) => r.doc}
            columns={[
              { key: 'doc', header: 'Documento', cell: (r) => <strong>{r.doc}</strong> },
              { key: 'cliente', header: 'Cliente', cell: (r) => r.cliente },
              { key: 'data', header: 'Data', cell: (r) => r.data, hideOnMobile: true },
              { key: 'total', header: 'Total', numeric: true, cell: (r) => kz(r.total) },
              {
                key: 'estado',
                header: 'Estado',
                cell: (r) => (
                  <Badge dot tone={r.estado === 'Paga' ? 'success' : r.estado === 'Parcial' ? 'warning' : 'danger'}>
                    {r.estado}
                  </Badge>
                ),
              },
            ]}
          />
        </Card>
      </Section>

      <Section title="@nexus/ui · Estados" sub="vazio com saída · esqueleto que reserva o espaço final · emblemas com forma além da cor">
        <div className="grid-2">
          <Card title="Estado vazio">
            <EmptyState
              icon={<IconBoxes size={26} />}
              title="Ainda não há produtos"
              text="Importe o seu catálogo por ficheiro ou crie o primeiro produto à mão."
              action={<Button variant="primary" icon={<IconUpload size={16} />}>Importar catálogo</Button>}
            />
          </Card>
          <Card title="Sem ligação">
            <EmptyState
              variant="offline"
              icon={<IconDatabase size={26} />}
              title="A trabalhar sem rede"
              text="As vendas ficam guardadas no aparelho e sobem assim que a ligação voltar."
            />
          </Card>
          <Card title="Emblemas">
            <div className="nx-row-wrap">
              <Badge dot tone="success">Paga</Badge>
              <Badge dot tone="warning">Parcial</Badge>
              <Badge dot tone="danger">Anulada</Badge>
              <Badge tone="info">Sincronizada</Badge>
              <Badge tone="accent">Nova</Badge>
              <Badge tone="neutral">Rascunho</Badge>
            </div>
          </Card>
          <Card title="Esqueleto">
            <Skeleton lines={4} />
          </Card>
        </div>
      </Section>

      <Section title="@nexus/ui · Diálogo, separadores e avisos" sub="foco preso no diálogo · setas navegam os separadores · erro fica até ser fechado">
        <Card>
          <Tabs
            label="Demonstração"
            active={aba}
            onChange={setAba}
            tabs={[
              { id: 'componentes', label: 'Componentes' },
              { id: 'avisos', label: 'Avisos', count: 4 },
            ]}
          />
          <div className="nx-row-wrap" style={{ marginTop: 16 }}>
            <Button variant="primary" onClick={() => setDialog(true)}>Abrir diálogo</Button>
            <Button variant="secondary" onClick={() => toast.success('Fatura emitida', 'FT A/2026/0103 · 45.900 Kz')}>
              Sucesso
            </Button>
            <Button variant="secondary" onClick={() => toast.warning('Stock baixo', '3 produtos abaixo do mínimo.')}>
              Aviso
            </Button>
            <Button variant="secondary" onClick={() => toast.error('Impressora não respondeu', 'Verifique o cabo USB e tente de novo.')}>
              Erro (fica até fechar)
            </Button>
          </div>
        </Card>

        <Dialog
          open={dialog}
          onClose={() => setDialog(false)}
          title="Anular fatura FT A/2026/0102"
          description="A anulação gera uma nota de crédito e repõe o stock."
          dismissable={false}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(false)}>Voltar</Button>
              <Button
                variant="danger"
                onClick={() => {
                  setDialog(false);
                  toast.success('Fatura anulada', 'Nota de crédito NC A/2026/0007 emitida.');
                }}
              >
                Anular fatura
              </Button>
            </>
          }
        >
          <Input label="Motivo da anulação" required placeholder="ex.: erro no cliente" />
          <p className="nx-body-sm" style={{ color: 'var(--nx-c-text-muted)', margin: 0 }}>
            O motivo fica no registo de auditoria com o seu utilizador e a data.
          </p>
        </Dialog>
      </Section>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <DesignShowcase />
  </ToastProvider>,
);
