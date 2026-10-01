import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@nexus/tokens/tokens.css';
import '@nexus/ui/ui.css';
import {
  Alert, Avatar, Badge, Breadcrumb, Button, Card, CardBody, CardHeader, Checkbox, DataTable, Drawer,
  Dropdown, EmptyState, ErrorState, Field, Input, Modal, NavList, PageHeader, Radio, Select, Skeleton,
  Switch, Tabs, Textarea, ToastProvider, Tooltip, useToast,
} from '@nexus/ui';

type Mode = 'light' | 'dark';

const BRAND = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => `--nx-brand-${n}`);
const GRAY = [25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => `--nx-gray-${n}`);
const SHOP = ['--nx-shop-500', '--nx-shop-600', '--nx-shop-700'];
const STATUS = ['--nx-success', '--nx-warning', '--nx-danger', '--nx-info'];
const SEMANTIC = ['--nx-bg', '--nx-surface', '--nx-surface-2', '--nx-surface-raised', '--nx-border', '--nx-border-strong', '--nx-text', '--nx-text-muted', '--nx-text-subtle', '--nx-primary', '--nx-primary-hover', '--nx-primary-soft', '--nx-channel', '--nx-channel-soft', '--nx-success-soft', '--nx-warning-soft', '--nx-danger-soft', '--nx-info-soft', '--nx-selected', '--nx-disabled-bg'];

function Swatch({ v }: { v: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ height: 44, borderRadius: 10, background: `var(${v})`, border: '1px solid var(--nx-border)' }} />
      <code style={{ fontSize: 11, color: 'var(--nx-text-muted)', wordBreak: 'break-all' }}>{v.replace('--nx-', '')}</code>
    </div>
  );
}
const grid = (min: number): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 12 });

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: 48, scrollMarginTop: 120 }}>
      <h2 style={{ fontFamily: 'var(--nx-font-title)', fontSize: 'var(--nx-text-xl)', margin: '0 0 4px' }}>{title}</h2>
      {note && <p style={{ margin: '0 0 16px', color: 'var(--nx-text-muted)', fontSize: 'var(--nx-text-sm)' }}>{note}</p>}
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--nx-text-subtle)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>{children}</div>
    </div>
  );
}

function ToastDemo() {
  const toast = useToast();
  return (
    <>
      <Button variant="secondary" onClick={() => toast({ tone: 'success', message: 'Fatura FT A/2026/0102 emitida.' })}>Sucesso</Button>
      <Button variant="secondary" onClick={() => toast({ tone: 'warning', message: '3 produtos abaixo do stock mínimo.' })}>Aviso</Button>
      <Button variant="secondary" onClick={() => toast({ tone: 'danger', message: 'Falha ao ligar à impressora.' })}>Erro</Button>
      <Button variant="secondary" onClick={() => toast({ tone: 'info', message: 'A sincronizar com a loja online…' })}>Info</Button>
    </>
  );
}

type Inv = { id: string; cliente: string; total: number; estado: string };
const INV: Inv[] = [
  { id: 'FT A/2026/0102', cliente: 'Maria dos Santos', total: 45900, estado: 'Paga' },
  { id: 'FT A/2026/0101', cliente: 'João Baptista', total: 128500, estado: 'Parcial' },
  { id: 'FT A/2026/0100', cliente: 'Consumidor final', total: 9200, estado: 'Anulada' },
];
const tone = (e: string) => (e === 'Paga' ? 'success' : e === 'Parcial' ? 'warning' : 'danger') as 'success' | 'warning' | 'danger';

function Components() {
  const [tab, setTab] = useState('geral');
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [nav, setNav] = useState('painel');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const bad = email.length > 0 && !email.includes('@');
  return (
    <>
      <Section id="buttons" title="Button" note="Variantes, tamanhos (alvo mínimo 32/40/48 px) e estados. Foco visível por teclado em todos.">
        <Row label="Variantes">
          <Button>Primário</Button><Button variant="secondary">Secundário</Button><Button variant="ghost">Ghost</Button>
          <Button variant="danger">Perigo</Button><Button variant="channel">Loja online</Button>
        </Row>
        <Row label="Tamanhos"><Button size="sm">Pequeno</Button><Button>Médio</Button><Button size="lg">Grande</Button></Row>
        <Row label="Estados">
          <Button disabled>Desativado</Button>
          <Button loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1600); }}>{loading ? 'A guardar…' : 'Clicar para carregar'}</Button>
          <Button variant="secondary" iconOnly aria-label="Fechar">✕</Button>
          <Button block>Largura total</Button>
        </Row>
      </Section>

      <Section id="forms" title="Formulários" note="Field liga label, ajuda e erro ao controlo (aria-describedby / aria-invalid). Erros anunciados por leitores de ecrã.">
        <div style={{ ...grid(260), maxWidth: 860 }}>
          <Field label="Nome do produto" required hint="Aparece nas faturas."><Input placeholder="ex.: Óleo alimentar 1L" /></Field>
          <Field label="Email" error={bad ? 'Introduza um email válido.' : undefined} hint="Validação em tempo real."><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.ao" /></Field>
          <Field label="Categoria"><Select defaultValue="m"><option value="m">Mercearia</option><option>Bebidas</option></Select></Field>
          <Field label="Desativado"><Input disabled value="Não editável" readOnly /></Field>
          <Field label="Pesquisa"><Input leading="🔍" placeholder="Pesquisar…" /></Field>
          <Field label="Grande"><Input size="lg" placeholder="48 px" /></Field>
        </div>
        <div style={{ maxWidth: 860, marginTop: 12 }}><Field label="Observações"><Textarea placeholder="Notas internas…" /></Field></div>
        <div style={{ height: 20 }} />
        <Row label="Seleção">
          <Checkbox label="Aceito os termos" defaultChecked /><Checkbox label="Indeterminado" /><Checkbox label="Desativado" disabled />
          <Radio name="r" label="Numerário" defaultChecked /><Radio name="r" label="Multicaixa" /><Radio name="r" label="Desativado" disabled />
          <Switch label="Visível na loja" defaultChecked /><Switch label="Desativado" disabled />
        </Row>
      </Section>

      <Section id="data" title="Dados" note="Cards, badges, avatares e tabela com ordenação (aria-sort), skeleton, vazio e erro.">
        <div style={{ ...grid(300), marginBottom: 20 }}>
          <Card><CardHeader title="Vendas de hoje" actions={<Badge tone="success" dot>+12%</Badge>} /><CardBody><strong style={{ fontFamily: 'var(--nx-font-title)', fontSize: 28 }}>1.254.900 Kz</strong></CardBody></Card>
          <Card interactive pad tabIndex={0}><strong>Cartão interativo</strong><p style={{ margin: '4px 0 0', color: 'var(--nx-text-muted)', fontSize: 13 }}>Hover eleva a sombra.</p></Card>
          <Card pad><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><Avatar name="Manuel Ndombaxi" /><div><strong>Manuel Ndombaxi</strong><div style={{ fontSize: 12, color: 'var(--nx-text-muted)' }}>Gestor</div></div></div></Card>
        </div>
        <Row label="Badges"><Badge>Neutro</Badge><Badge tone="primary">Primário</Badge><Badge tone="success" dot>Ativo</Badge><Badge tone="warning">Pendente</Badge><Badge tone="danger">Suspenso</Badge><Badge tone="info">Info</Badge><Badge tone="channel">Loja</Badge><Avatar name="Ana Lopes" size="sm" /><Avatar name="Ana Lopes" size="lg" /></Row>
        <DataTable<Inv> caption="Faturas recentes" rows={INV} rowKey={(r) => r.id}
          columns={[
            { key: 'id', header: 'Documento', sortable: true },
            { key: 'cliente', header: 'Cliente', sortable: true },
            { key: 'total', header: 'Total', numeric: true, sortable: true, render: (r) => `${r.total.toLocaleString('pt-PT', { useGrouping: 'always' })} Kz` },
            { key: 'estado', header: 'Estado', render: (r) => <Badge tone={tone(r.estado)} dot>{r.estado}</Badge> },
          ]} />
        <div style={{ ...grid(300), marginTop: 20 }}>
          <div><div className="nx-hint" style={{ marginBottom: 6 }}>A carregar</div><DataTable<Inv> caption="A carregar" rows={[]} rowKey={(r) => r.id} loading columns={[{ key: 'a', header: 'Documento' }, { key: 'b', header: 'Total', numeric: true }]} /></div>
          <div><div className="nx-hint" style={{ marginBottom: 6 }}>Vazio</div><DataTable<Inv> caption="Vazio" rows={[]} rowKey={(r) => r.id} columns={[{ key: 'a', header: 'Documento' }]} empty={<EmptyState title="Sem faturas" description="Emita a primeira fatura para a ver aqui." action={<Button size="sm">Nova fatura</Button>} />} /></div>
          <div><div className="nx-hint" style={{ marginBottom: 6 }}>Erro</div><DataTable<Inv> caption="Erro" rows={[]} rowKey={(r) => r.id} columns={[]} error="Não foi possível carregar as faturas." onRetry={() => undefined} /></div>
        </div>
      </Section>

      <Section id="feedback" title="Feedback" note="Alert (estático), Toast (temporário, aria-live), Skeleton, Empty e Error state.">
        <div style={{ display: 'grid', gap: 10, maxWidth: 640, marginBottom: 20 }}>
          <Alert tone="success" title="Fatura emitida">FT A/2026/0102 enviada ao cliente.</Alert>
          <Alert tone="info">A sincronizar o stock com a loja online…</Alert>
          <Alert tone="warning" title="Stock baixo">3 produtos abaixo do mínimo.</Alert>
          <Alert tone="danger" title="Impressora offline">Verifique a ligação USB.</Alert>
        </div>
        <Row label="Toasts"><ToastDemo /></Row>
        <Row label="Skeleton"><div style={{ display: 'grid', gap: 8, width: 300 }}><Skeleton width="65%" /><Skeleton /><Skeleton width="45%" /></div><Skeleton width={48} height={48} radius={24} /></Row>
        <div style={{ ...grid(320) }}>
          <Card><EmptyState title="Nenhum cliente" description="Adicione o primeiro cliente para começar." action={<Button size="sm">Adicionar cliente</Button>} /></Card>
          <Card><ErrorState description="Sem ligação ao servidor." onRetry={() => undefined} /></Card>
        </div>
      </Section>

      <Section id="overlay" title="Overlays" note="Modal e Drawer: foco preso, Escape fecha, foco regressa ao gatilho, scroll do fundo bloqueado. Tooltip aparece com hover e foco.">
        <Row label="Abrir">
          <Button variant="secondary" onClick={() => setModal(true)}>Modal</Button>
          <Button variant="secondary" onClick={() => setDrawer(true)}>Drawer</Button>
          <Tooltip label="Ajuda contextual"><Button variant="ghost" iconOnly aria-label="Ajuda">?</Button></Tooltip>
          <Dropdown trigger={(p) => <Button variant="secondary" {...p}>Ações ▾</Button>}
            items={[{ label: 'Editar', onSelect: () => undefined }, { label: 'Duplicar', onSelect: () => undefined }, { label: 'Anular', danger: true, onSelect: () => undefined }, { label: 'Indisponível', disabled: true, onSelect: () => undefined }]} />
        </Row>
        <Modal open={modal} title="Anular fatura" onClose={() => setModal(false)}
          footer={<><Button variant="ghost" onClick={() => setModal(false)}>Cancelar</Button><Button variant="danger" onClick={() => setModal(false)}>Anular</Button></>}>
          <p style={{ margin: 0 }}>Esta ação não pode ser desfeita. A fatura ficará marcada como anulada.</p>
        </Modal>
        <Drawer open={drawer} title="Filtros" onClose={() => setDrawer(false)} footer={<Button onClick={() => setDrawer(false)}>Aplicar</Button>}>
          <Field label="Estado"><Select><option>Todos</option><option>Pagas</option></Select></Field>
        </Drawer>
      </Section>

      <Section id="nav" title="Navegação" note="Tabs (setas, Home, End), Breadcrumb, NavList com aria-current e PageHeader.">
        <Card pad>
          <PageHeader breadcrumb={<Breadcrumb items={[{ label: 'Início', href: '#' }, { label: 'Vendas', href: '#' }, { label: 'Faturas' }]} />}
            title="Faturas" description="Documentos emitidos nos últimos 30 dias." actions={<><Button variant="secondary">Exportar</Button><Button>Nova fatura</Button></>} />
          <Tabs label="Secções" value={tab} onChange={setTab} tabs={[{ id: 'geral', label: 'Geral' }, { id: 'pagas', label: 'Pagas' }, { id: 'pend', label: 'Pendentes' }, { id: 'off', label: 'Desativada', disabled: true }]} />
          <div style={{ maxWidth: 260, marginTop: 16 }}>
            <NavList label="Menu" current={nav} onSelect={setNav} items={[{ id: 'painel', label: 'Painel' }, { id: 'vendas', label: 'Vendas' }, { id: 'stock', label: 'Stock' }]} />
          </div>
        </Card>
      </Section>
    </>
  );
}

function Tokens() {
  return (
    <>
      <Section id="cores" title="Cores" note="Identidade: índigo #2430E8 (base, tom 600). Laranja da loja = canal integrado, não marca separada.">
        <Row label="Marca — índigo"><div style={{ ...grid(84), width: '100%' }}>{BRAND.map((v) => <Swatch key={v} v={v} />)}</div></Row>
        <Row label="Canal loja — laranja"><div style={{ ...grid(84), width: '100%' }}>{SHOP.map((v) => <Swatch key={v} v={v} />)}</div></Row>
        <Row label="Estado"><div style={{ ...grid(84), width: '100%' }}>{STATUS.map((v) => <Swatch key={v} v={v} />)}</div></Row>
        <Row label="Neutros"><div style={{ ...grid(84), width: '100%' }}>{GRAY.map((v) => <Swatch key={v} v={v} />)}</div></Row>
        <Row label="Semânticos (mudam com o modo claro/escuro)"><div style={{ ...grid(96), width: '100%' }}>{SEMANTIC.map((v) => <Swatch key={v} v={v} />)}</div></Row>
      </Section>
      <Section id="tipografia" title="Tipografia" note="Sora (títulos) + DM Sans (corpo). Escala: 12 · 13,5 · 15 · 18 · 22 · 28 · 36 · 48.">
        {[['4xl', 'Título hero'], ['3xl', 'Título de página'], ['2xl', 'Título de secção'], ['xl', 'Subtítulo'], ['lg', 'Cabeçalho de cartão'], ['md', 'Texto base — o essencial do sistema'], ['sm', 'Texto secundário e tabelas'], ['xs', 'LEGENDAS E RÓTULOS']].map(([k, t]) => (
          <div key={k} style={{ display: 'flex', gap: 16, alignItems: 'baseline', borderBottom: '1px solid var(--nx-border)', padding: '8px 0' }}>
            <code style={{ width: 44, flex: 'none', color: 'var(--nx-text-subtle)', fontSize: 12 }}>{k}</code>
            <span style={{ fontSize: `var(--nx-text-${k})`, fontFamily: ['4xl', '3xl', '2xl', 'xl', 'lg'].includes(k) ? 'var(--nx-font-title)' : 'var(--nx-font-body)', fontWeight: ['4xl', '3xl', '2xl'].includes(k) ? 700 : 500 }}>{t}</span>
          </div>
        ))}
      </Section>
      <Section id="espaco" title="Espaçamento, raios, sombras, motion e breakpoints">
        <Row label="Espaçamento (base 4)">{[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((n) => <div key={n} style={{ textAlign: 'center' }}><div style={{ width: `var(--nx-space-${n})`, height: 24, background: 'var(--nx-primary)', borderRadius: 3, minWidth: 4 }} /><code style={{ fontSize: 11 }}>{n}</code></div>)}</Row>
        <Row label="Raios">{['sm', 'md', 'lg', 'full'].map((r) => <div key={r} style={{ width: 84, height: 56, background: 'var(--nx-primary-soft)', border: '1px solid var(--nx-primary)', borderRadius: `var(--nx-radius-${r})`, display: 'grid', placeItems: 'center', fontSize: 12 }}>{r}</div>)}</Row>
        <Row label="Sombras">{[1, 2, 3].map((n) => <div key={n} style={{ width: 96, height: 56, borderRadius: 12, background: 'var(--nx-surface-raised)', boxShadow: `var(--nx-shadow-${n})`, display: 'grid', placeItems: 'center', fontSize: 12 }}>{n}</div>)}</Row>
        <Row label="Motion">
          <code>micro 120ms</code><code>enter 200ms</code><code>scene 320ms</code><code>ease-out cubic-bezier(.16,1,.3,1)</code><span style={{ fontSize: 13, color: 'var(--nx-text-muted)' }}>prefers-reduced-motion zera as durações.</span>
        </Row>
        <Row label="Breakpoints"><code>xs &lt; 480</code><code>sm ≥ 480</code><code>md ≥ 768</code><code>lg ≥ 1100</code><code>xl ≥ 1440</code></Row>
      </Section>
    </>
  );
}

function Accessibility() {
  const items = [
    'Foco visível (anel 3 px) em todos os controlos; nunca removido.',
    'Alvos de toque ≥ 32 px (sm) e 40–48 px por omissão; ícones exigem aria-label.',
    'Labels ligados a controlos (htmlFor/useId); erros com role="alert" e aria-invalid.',
    'Modal/Drawer: role="dialog", aria-modal, foco preso, Escape fecha, foco regressa ao gatilho.',
    'Tabs: role="tablist", setas/Home/End; Tabela: caption, scope="col", aria-sort.',
    'Cores de estado nunca sozinhas: badges e alertas incluem texto/ícone.',
    'prefers-reduced-motion desliga animações; modo claro/escuro por tokens.',
  ];
  return (
    <Section id="a11y" title="Acessibilidade" note="Regras aplicadas pela biblioteca (WCAG 2.1 AA como alvo).">
      <Card pad><ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6, fontSize: 14 }}>{items.map((i) => <li key={i}>{i}</li>)}</ul></Card>
    </Section>
  );
}

const LINKS = [['cores', 'Cores'], ['tipografia', 'Tipografia'], ['espaco', 'Espaço & motion'], ['buttons', 'Botões'], ['forms', 'Formulários'], ['data', 'Dados'], ['feedback', 'Feedback'], ['overlay', 'Overlays'], ['nav', 'Navegação'], ['a11y', 'Acessibilidade']];

function Page() {
  const [mode, setMode] = useState<Mode>(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [compare, setCompare] = useState(false);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => { document.documentElement.setAttribute('data-nx-mode', mode); document.body.style.background = 'var(--nx-bg)'; document.body.style.margin = '0'; }, [mode]);
  const body = (
    <>
      <Tokens />
      <Components />
      <Accessibility />
    </>
  );
  return (
    <ToastProvider>
      <div className="nx-root" style={{ minHeight: 'calc(100vh / var(--uz, 1))' }}>
        <style>{'@media (max-width: 767px) { .ds-head { position: static !important; } }'}</style>
        <header className="ds-head" style={{ position: 'sticky', top: 0, zIndex: 30, background: 'var(--nx-surface)', borderBottom: '1px solid var(--nx-border)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '10px 20px', maxWidth: 1240, margin: '0 auto' }}>
            <strong style={{ fontFamily: 'var(--nx-font-title)', fontSize: 16 }}>LPS Vendas · Design System</strong>
            <span style={{ flex: 1 }} />
            <Switch label="Comparar claro/escuro" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            <Tabs label="Largura" value={String(width ?? 0)} onChange={(v) => setWidth(v === '0' ? null : Number(v))} tabs={[{ id: '0', label: 'Total' }, { id: '1024', label: '1024' }, { id: '768', label: '768' }, { id: '390', label: '390' }, { id: '320', label: '320' }]} />
            <Button variant="secondary" size="sm" onClick={() => setMode(mode === 'light' ? 'dark' : 'light')} aria-label="Alternar tema">{mode === 'light' ? 'Escuro' : 'Claro'}</Button>
          </div>
          <nav aria-label="Secções" style={{ display: 'flex', gap: 4, overflowX: 'auto', padding: '0 20px 8px', maxWidth: 1240, margin: '0 auto' }}>
            {LINKS.map(([id, l]) => <a key={id} href={`#${id}`} className="nx-btn ghost sm">{l}</a>)}
          </nav>
        </header>
        <main style={{ maxWidth: 1240, margin: '0 auto', padding: '32px 20px' }}>
          <PageHeader title="Biblioteca @nexus/ui" description="Fonte de verdade visual do LPS Vendas: tokens, componentes, estados, responsividade e acessibilidade." />
          <div style={{ display: compare ? 'grid' : 'block', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, alignItems: 'start' }}>
            {(compare ? (['light', 'dark'] as Mode[]) : [mode]).map((m) => (
              <div key={m} data-nx-mode={m} className="nx-root" style={{ width: width ? width : undefined, maxWidth: '100%', margin: width ? '0 auto' : undefined, padding: compare || width ? 16 : 0, borderRadius: 16, border: compare || width ? '1px dashed var(--nx-border-strong)' : 0, overflow: 'hidden' }}>
                {body}
              </div>
            ))}
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Page />);
