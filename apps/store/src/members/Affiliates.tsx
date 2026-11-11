import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError, type AffiliateSummary, type PayoutAccount } from '../api/client';
import type { CatalogProduct } from '../api/types';
import { formatDateTime } from '../format';
import { I, P, Pic, kz, useInfinite, useReveal } from './parts';

/** Secções da área do associado (as mesmas do menu "Vendas" do Kikolo). */
export type AffTab = 'dashboard' | 'sales' | 'market' | 'mine' | 'transactions' | 'accounts';

const STATE: Record<string, [string, string]> = {
  PENDING: ['Pendente', 'kw-st-PENDING'], AVAILABLE: ['Disponível', 'kw-st-PAID'], CANCELLED: ['Cancelada', 'kw-st-CANCELLED'],
  REQUESTED: ['Em análise', 'kw-st-PENDING'], PAID: ['Pago', 'kw-st-PAID'], REJECTED: ['Recusado', 'kw-st-CANCELLED'],
};
const BANKS = ['BFA', 'BAI', 'BIC', 'Millennium Atlântico', 'Standard Bank', 'BCI', 'BPC', 'BNI', 'Banco Económico', 'Banco Sol', 'Banco Keve', 'Banco Yetu', 'Outro'];

/** Ligação pública do produto com o código do associado (a loja abre o produto e guarda o código). */
export function affiliateLink(storeCode: string, productCode: string, ref: string): string {
  return `${location.origin}/${encodeURIComponent(storeCode)}?p=${encodeURIComponent(productCode)}&ref=${ref}`;
}

export function Affiliates({ code, token, products, cod, bannerImage, tab, onTab, flash }: {
  code: string; token: string; products: CatalogProduct[]; cod: boolean; bannerImage: string | null;
  tab: AffTab; onTab(t: AffTab): void; flash(t: string): void;
}) {
  const [market, setMarket] = useState<Map<string, number> | null>(null);
  const [me, setMe] = useState<AffiliateSummary | null>(null);
  const [accounts, setAccounts] = useState<PayoutAccount[] | null>(null);
  const [drawer, setDrawer] = useState(false);
  const reload = () => api.membersAffiliate(code, token).then(setMe).catch(() => undefined);
  const reloadAcc = () => api.membersAccounts(code, token).then(setAccounts).catch(() => setAccounts([]));
  useEffect(() => {
    api.membersMarket(code, token).then((r) => setMarket(new Map(r.map((x) => [x.productCode, x.percent])))).catch(() => setMarket(new Map()));
    void reload(); void reloadAcc();
  }, [code, token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDrawer(false); window.scrollTo({ top: 0 }); }, [tab]);

  const menu = (
    <nav className="kw-affmenu" aria-label="Área do associado">
      <div className="kw-affmenu-g">VENDAS 🔥</div>
      <button className={tab === 'dashboard' ? 'on' : ''} onClick={() => onTab('dashboard')}><I d={P.grid} size={17} /> Painel do associado</button>
      <button className={tab === 'sales' ? 'on' : ''} onClick={() => onTab('sales')}><I d={P.card} size={17} /> Minhas Vendas</button>
      <button className={tab === 'market' || tab === 'mine' ? 'on' : ''} onClick={() => onTab('market')}><I d={P.share} size={17} /> Para Associados <em>Venda +</em></button>
      <button className={tab === 'transactions' ? 'on' : ''} onClick={() => onTab('transactions')}><I d={P.box} size={17} /> Transações (Saques)</button>
      <div className="kw-affmenu-g">CONTA</div>
      <button className={tab === 'accounts' ? 'on' : ''} onClick={() => onTab('accounts')}><I d={P.shield} size={17} /> Contas bancárias</button>
    </nav>
  );

  let body: React.ReactNode;
  if (tab === 'dashboard') body = <Dashboard me={me} market={market} products={products} bannerImage={bannerImage} onTab={onTab} />;
  else if (tab === 'sales') body = <Sales me={me} />;
  else if (tab === 'transactions') body = <Transactions code={code} token={token} me={me} accounts={accounts} onTab={onTab} onDone={() => { void reload(); flash('Pedido de saque enviado'); }} />;
  else if (tab === 'accounts') body = <Accounts code={code} token={token} accounts={accounts} onChange={() => void reloadAcc()} flash={flash} />;
  else body = <Market code={code} products={products} market={market} me={me} cod={cod} bannerImage={bannerImage} tab={tab} onTab={onTab} flash={flash} />;

  return (
    <div className="kw-container kw-affwrap">
      <aside className="kw-affside">{menu}</aside>
      <section className="kw-affmain">
        <button className="kw-btn kw-affmenu-btn" onClick={() => setDrawer(true)}><I d={P.filter} size={16} /> Menu</button>
        {body}
      </section>
      {drawer ? (
        <>
          <div className="kw-scrim" onClick={() => setDrawer(false)} />
          <div className="kw-affdrawer kw-pop" role="dialog" aria-label="Menu">
            <div className="kw-affdrawer-h"><b>Menu</b><button className="kw-x" onClick={() => setDrawer(false)} aria-label="Fechar"><I d={P.close} size={18} /></button></div>
            {menu}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ───────────── painel (como o "Painel do vendedor" do Kikolo) ───────────── */
function Dashboard({ me, market, products, bannerImage, onTab }: { me: AffiliateSummary | null; market: Map<string, number> | null; products: CatalogProduct[]; bannerImage: string | null; onTab(t: AffTab): void }) {
  const now = new Date();
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [day, setDay] = useState(() => new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const [fresh, setFresh] = useState(false);
  const valid = useMemo(() => (me?.sales ?? []).filter((x) => x.state !== 'CANCELLED'), [me]);
  const sumDay = (d: Date) => valid.filter((x) => { const t = new Date(x.date); return t.getFullYear() === d.getFullYear() && t.getMonth() === d.getMonth() && t.getDate() === d.getDate(); }).reduce((a, x) => a + x.amount, 0);
  const sumSince = (days: number) => { const t = Date.now() - days * 86400000; return valid.filter((x) => new Date(x.date).getTime() >= t).reduce((a, x) => a + x.amount, 0); };
  const today = sumDay(day);
  const prev = sumDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1));
  const change = prev > 0 ? Math.round(((today - prev) / prev) * 100) : today > 0 ? 100 : 0;
  const completed = (me?.sales ?? []).filter((x) => x.state === 'AVAILABLE').reduce((a, x) => a + x.amount, 0);
  const orders = new Set(valid.map((x) => x.orderNumber)).size;
  const cancelled = new Set((me?.sales ?? []).filter((x) => x.state === 'CANCELLED').map((x) => x.orderNumber)).size;
  const withdrawn = me?.withdrawn ?? 0;
  const ringTotal = withdrawn + (me?.balance ?? 0) + (me?.pending ?? 0);
  const ring = ringTotal > 0 ? withdrawn / ringTotal : 0;
  const daysWithSales = new Set(valid.map((x) => new Date(x.date).toDateString()));

  // Calendário do mês (segunda a domingo).
  const first = (month.getDay() + 6) % 7;
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - first);
  const cells = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const monthName = month.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });

  const top = useMemo(() => {
    const list = products.filter((p) => market?.has(p.code));
    return [...list].sort((a, b) => (fresh ? (b.views ?? 0) - (a.views ?? 0) : (b.grossPrice * (market?.get(b.code) ?? 0)) - (a.grossPrice * (market?.get(a.code) ?? 0)))).slice(0, 8);
  }, [products, market, fresh]);

  return (
    <div className="kw-dash">
      <h1 className="kw-aff-title"><I d={P.grid} size={22} /> Dashboard</h1>
      <div className="kw-aff-banner kw-pop">
        {bannerImage ? <img src={bannerImage} alt="" /> : null}
        <div className="kw-aff-banner-txt"><strong>Associados</strong><span>LPS Kwanza</span>{me ? <em>O seu código: <b>{me.code}</b></em> : null}</div>
      </div>
      <section className="kw-dash-card">
        <div className="kw-dash-stats">
          <div><span className="kw-dot g"><I d={P.card} size={16} /></span><small>Saldo disponível</small><b>{kz(me?.balance ?? 0)}</b></div>
          <div><span className="kw-dot b"><I d={P.truck} size={16} /></span><small>Vendas em processo</small><b>{kz(me?.pending ?? 0)}</b></div>
          <div><span className="kw-dot o"><I d={P.clock} size={16} /></span><small>Saldo pendente</small><b>{kz(me?.requested ?? 0)}</b></div>
        </div>
        <button className="kw-btn kw-btn-primary" onClick={() => onTab('transactions')}>Solicitar saque</button>
      </section>
      <div className="kw-dash-row">
        <section className="kw-cal" aria-label="Calendário">
          <header>
            <button className="kw-x" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mês anterior"><I d={P.back} size={16} /></button>
            <b>{monthName}</b>
            <button className="kw-x" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Mês seguinte"><I d={P.next} size={16} /></button>
          </header>
          <div className="kw-cal-g">
            {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => <span key={d} className="kw-cal-h">{d}</span>)}
            {cells.map((c) => {
              const out = c.getMonth() !== month.getMonth();
              const sel = c.toDateString() === day.toDateString();
              return <button key={c.toISOString()} className={`${out ? 'out' : ''}${sel ? ' on' : ''}${daysWithSales.has(c.toDateString()) ? ' has' : ''}`} onClick={() => setDay(c)}>{c.getDate()}</button>;
            })}
          </div>
        </section>
        <section className="kw-perf2">
          <h3>Desempenho de vendas</h3>
          <div className="kw-perf2-in">
            <div className="kw-perf2-l">
              <small>{day.toDateString() === new Date().toDateString() ? 'Hoje' : day.toLocaleDateString('pt-PT')} <em className={change >= 0 ? 'up' : 'down'}>{change}% {change >= 0 ? '↗' : '↘'}</em></small>
              <b>{kz(today)}</b>
              <small>Total últimos 7 dias</small><b>{kz(sumSince(7))}</b>
              <small>Total últimos 30 dias</small><b>{kz(sumSince(30))}</b>
            </div>
            <div className="kw-ring" aria-label="Total já retirado">
              <svg viewBox="0 0 120 120" width="150" height="150">
                <circle cx="60" cy="60" r="48" fill="none" stroke="#e8ebf3" strokeWidth="14" />
                {ring > 0 ? <circle cx="60" cy="60" r="48" fill="none" stroke="var(--kw-p)" strokeWidth="14" strokeLinecap="round"
                  strokeDasharray={`${ring * 301.6} 301.6`} transform="rotate(-90 60 60)" className="kw-ring-arc" /> : null}
              </svg>
              <div><b>{kz(withdrawn)}</b><small>Total já retirado</small></div>
            </div>
          </div>
        </section>
      </div>
      <section className="kw-dash-sum">
        <div><span>Vendas completas:</span><b className="g">{kz(completed)}</b></div>
        <div><span>Número de vendas:</span><b>{orders}</b></div>
        <div><span>Vendas canceladas:</span><b>{cancelled}</b></div>
      </section>
      <section className="kw-dash-top">
        <header><h3><I d={P.eye} size={17} /> Seus produtos com mais cliques</h3>
          <label className="kw-switch"><input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} /><i /> Vistos agora</label>
        </header>
        {top.length ? (
          <ul>{top.map((p) => <li key={p.code}><Pic p={p} className="kw-dash-pic" /><span>{p.name}</span><small><I d={P.eye} size={13} /> {p.views ?? 0}</small><b>{kz(Math.round(p.grossPrice * (market?.get(p.code) ?? 0)) / 100)}</b></li>)}</ul>
        ) : <div className="kw-empty">Sem produtos disponíveis</div>}
      </section>
    </div>
  );
}

/* ───────────── minhas vendas ───────────── */
function Sales({ me }: { me: AffiliateSummary | null }) {
  return (
    <div className="kw-dash">
      <h1 className="kw-aff-title"><I d={P.card} size={22} /> Minhas vendas</h1>
      {!me ? <div className="kw-loader" aria-busy="true"><i /><i /><i /></div> : !me.sales.length ? <div className="kw-empty">Ainda sem vendas como associado</div> : (
        <div className="kw-aff-table">
          <h3>Todas as vendas</h3>
          <table className="kw-spec">
            <thead><tr><th>Encomenda</th><th>Produto</th><th>Data</th><th>Comissão</th><th>Estado</th></tr></thead>
            <tbody>{me.sales.map((s, i) => <tr key={`${s.orderNumber}-${i}`}><td>{s.orderNumber}</td><td>{s.product} × {s.quantity}</td><td>{formatDateTime(s.date)}</td><td><b>{kz(s.amount)}</b></td><td><span className={`kw-pill ${STATE[s.state][1]}`}>{STATE[s.state][0]}</span></td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ───────────── mercado de associados ───────────── */
function Market({ code, products, market, me, cod, bannerImage, tab, onTab, flash }: {
  code: string; products: CatalogProduct[]; market: Map<string, number> | null; me: AffiliateSummary | null; cod: boolean; bannerImage: string | null;
  tab: AffTab; onTab(t: AffTab): void; flash(t: string): void;
}) {
  const [open, setOpen] = useState<CatalogProduct | null>(null);
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    if (!market) return [];
    const t = q.trim().toLowerCase();
    return products.filter((p) => market.has(p.code) && (!t || p.name.toLowerCase().includes(t)))
      .sort((a, b) => (b.grossPrice * (market.get(b.code) ?? 0)) - (a.grossPrice * (market.get(a.code) ?? 0)));
  }, [market, products, q]);
  const mine = useMemo(() => { const names = new Set((me?.sales ?? []).map((s) => s.product)); return items.filter((p) => names.has(p.name)); }, [items, me]);
  const list = tab === 'mine' ? mine : items;
  const [shown, sentinel] = useInfinite(list.length, 20, `${q}|${list.length}|${tab}`);
  useReveal(`${tab}-${shown}`);
  const copy = async (text: string, msg: string) => { try { await navigator.clipboard.writeText(text); flash(msg); } catch { window.prompt('Copie:', text); } };

  return (
    <div className="kw-aff">
      <h1 className="kw-aff-title"><I d={P.share} size={24} /> Mercado de Associados</h1>
      <div className="kw-aff-banner kw-pop">
        {bannerImage ? <img src={bannerImage} alt="" /> : null}
        <div className="kw-aff-banner-txt"><strong>{me ? kz(me.available + me.withdrawn) : '—'}</strong><span>ganhos confirmados</span>{me ? <em>O seu código: <b>{me.code}</b></em> : null}</div>
      </div>
      <div className="kw-aff-tabs">
        <button className="warn" onClick={() => onTab('sales')}>Minhas Vendas 🔥</button>
        <button className={tab === 'market' ? 'on' : ''} onClick={() => onTab('market')}>Associar-me</button>
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => onTab('mine')}>Sou associado(a)</button>
        <button onClick={() => onTab('transactions')}>Saldo e saques</button>
      </div>
      <div className="kw-aff-search"><I d={P.search} size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar produto com comissão" aria-label="Procurar produto" /></div>
      {market === null ? <div className="kw-loader" aria-busy="true"><i /><i /><i /></div> : list.length === 0 ? (
        <div className="kw-empty">{tab === 'mine' ? 'Ainda sem vendas como associado' : 'Sem produtos com comissão'}</div>
      ) : (
        <>
          <h2 className="kw-aff-h2">Produtos Físicos</h2>
          <div className="kw-grid4">
            {list.slice(0, shown).map((p) => {
              const pctv = market.get(p.code) ?? 0;
              return (
                <article key={p.code} className="kw-card kw-aff-card kw-reveal">
                  <button className="kw-aff-open" onClick={() => setOpen(p)} aria-label={p.name}>
                    <div className="kw-card-img"><Pic p={p} />
                      {(p.views ?? 0) > 0 ? <span className="kw-card-sold"><I d={P.eye} size={12} />{p.views}</span> : null}
                      <span className="kw-aff-truck"><I d={P.truck} size={14} /></span>
                      {cod ? <span className="kw-card-pay"><i aria-hidden="true" />Pagamento na entrega</span> : null}
                    </div>
                    <div className="kw-aff-body">
                      <h3>{p.name}</h3>
                      <span>Comissão de até</span>
                      <b className="kw-aff-com">{kz(Math.round(p.grossPrice * pctv) / 100)}</b>
                      <span>Valor de venda</span>
                      <b className="kw-aff-val">{kz(p.grossPrice)}</b>
                    </div>
                  </button>
                </article>
              );
            })}
          </div>
          {shown < list.length ? <div ref={sentinel} className="kw-loader" aria-busy="true"><i /><i /><i /></div> : null}
        </>
      )}
      {open && market ? (
        <div className="kw-modal-bg" onClick={() => setOpen(null)}>
          <div className="kw-modal kw-pop" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={open.name}>
            <button className="kw-x kw-modal-x" onClick={() => setOpen(null)} aria-label="Fechar"><I d={P.close} size={20} /></button>
            <div className="kw-modal-img"><Pic p={open} /></div>
            <div className="kw-modal-body">
              {cod ? <span className="kw-card-pay kw-static"><i aria-hidden="true" />Pagamento na entrega</span> : null}
              <h2>{open.name}</h2>
              <table className="kw-spec"><tbody>
                {open.category ? <tr><th>Categoria</th><td>{open.category}</td></tr> : null}
                <tr><th>Comissionamento</th><td>Último clique</td></tr>
                <tr><th>Comissão</th><td>{market.get(open.code)}%</td></tr>
              </tbody></table>
              <div className="kw-aff-modal-p">
                <div><span>Comissão de até</span><b className="kw-aff-com">{kz(Math.round(open.grossPrice * (market.get(open.code) ?? 0)) / 100)}</b></div>
                <div><span>Valor de venda</span><b className="kw-aff-val">{kz(open.grossPrice)}</b></div>
              </div>
              {me ? (
                <>
                  <div className="kw-aff-link"><input readOnly value={affiliateLink(code, open.code, me.code)} aria-label="Ligação de associado" onFocus={(e) => e.currentTarget.select()} /></div>
                  <button className="kw-btn kw-btn-primary kw-block" onClick={() => void copy(affiliateLink(code, open.code, me.code), 'Ligação copiada')}>Copiar ligação de associado</button>
                  <a className="kw-btn kw-btn-outline kw-block" href={`https://wa.me/?text=${encodeURIComponent(`${open.name} — ${kz(open.grossPrice)}\n${affiliateLink(code, open.code, me.code)}`)}`} target="_blank" rel="noopener noreferrer">Partilhar no WhatsApp</a>
                </>
              ) : <div className="kw-loader" aria-busy="true"><i /><i /><i /></div>}
              {open.description ? <><h3>O que você precisa saber sobre este produto</h3><p className="kw-desc">{open.description}</p></> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── transações (saques) ───────────── */
function Transactions({ code, token, me, accounts, onTab, onDone }: { code: string; token: string; me: AffiliateSummary | null; accounts: PayoutAccount[] | null; onTab(t: AffTab): void; onDone(): void }) {
  const [form, setForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [acc, setAcc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (accounts?.length && !acc) setAcc(accounts[0].id); }, [accounts, acc]);
  if (!me) return <div className="kw-loader" aria-busy="true"><i /><i /><i /></div>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const a = Number(amount.replace(',', '.'));
    if (!(a > 0)) { setErr('Indique o valor.'); return; }
    if (a > me.balance) { setErr('O valor é maior do que o saldo disponível.'); return; }
    if (!acc) { setErr('Escolha a conta para receber.'); return; }
    setBusy(true);
    try { await api.membersWithdraw(code, token, { amount: a, accountId: acc }); setAmount(''); setForm(false); onDone(); }
    catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível pedir o saque.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="kw-dash">
      <div className="kw-counters">
        <div className="kw-bal-c main"><b>{kz(me.balance)}</b><span>Saldo disponível</span></div>
        <div className="kw-bal-c"><b>{kz(me.pending)}</b><span>Vendas em processo</span></div>
        <div className="kw-bal-c"><b>{kz(me.requested)}</b><span>Saldo pendente</span></div>
        <div className="kw-bal-c"><b>{kz(me.withdrawn)}</b><span>Total já retirado</span></div>
      </div>
      <div className="kw-trans-head">
        <h1 className="kw-aff-title"><I d={P.box} size={22} /> Histórico de transações</h1>
        <button className="kw-btn kw-btn-green" onClick={() => setForm((v) => !v)} disabled={me.balance <= 0}>FAZER SAQUES</button>
      </div>
      {form ? (
        <form className="kw-profile kw-pop" onSubmit={(e) => void submit(e)}>
          <h3>Fazer saque</h3>
          <label className="kw-f"><span>Valor (Kz)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} placeholder={String(me.balance)} /></label>
          <div className="kw-f"><span>Conta para receber</span>
            {accounts && accounts.length ? (
              <div className="kw-acc-pick">{accounts.map((a) => (
                <label key={a.id} className={`kw-acc-opt${acc === a.id ? ' on' : ''}`}><input type="radio" name="acc" checked={acc === a.id} onChange={() => setAcc(a.id)} />
                  <span><b>{a.method}{a.bank ? ` · ${a.bank}` : ''}</b><small>{a.details} · {a.holder}</small></span></label>
              ))}</div>
            ) : <button type="button" className="kw-btn kw-btn-outline" onClick={() => onTab('accounts')}>+ Registar conta bancária</button>}
          </div>
          {err ? <div className="kw-err" role="alert">{err}</div> : null}
          <button className="kw-btn kw-btn-primary" disabled={busy || !accounts?.length}>{busy ? 'A enviar…' : 'Pedir saque'}</button>
        </form>
      ) : null}
      <div className="kw-aff-table">
        <table className="kw-spec">
          <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Valor</th><th>Estado</th><th>Comprovativo</th></tr></thead>
          <tbody>
            {me.withdrawals.length ? me.withdrawals.map((w) => (
              <tr key={w.id}>
                <td>{formatDateTime(w.date)}</td><td>Saque</td><td>{w.method}{w.details ? <small className="kw-muted"> · {w.details}</small> : null}{w.note ? <div className="kw-muted">{w.note}</div> : null}</td>
                <td><b>{kz(w.amount)}</b></td><td><span className={`kw-pill ${STATE[w.status]?.[1] ?? ''}`}>{STATE[w.status]?.[0] ?? w.status}</span></td>
                <td>{w.proofUrl ? <a className="kw-link" href={w.proofUrl} target="_blank" rel="noopener noreferrer" download={`comprovativo-${w.id}`}>Ver</a> : '—'}</td>
              </tr>
            )) : <tr><td colSpan={6} className="kw-muted" style={{ textAlign: 'center' }}>Sem transações</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ───────────── contas bancárias (até 3) ───────────── */
function Accounts({ code, token, accounts, onChange, flash }: { code: string; token: string; accounts: PayoutAccount[] | null; onChange(): void; flash(t: string): void }) {
  const [method, setMethod] = useState('Transferência bancária');
  const [bank, setBank] = useState('');
  const [holder, setHolder] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = accounts?.length ?? 0;
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (method !== 'Multicaixa Express' && !bank) { setErr('Escolha o banco.'); return; }
    setBusy(true);
    try { await api.membersAddAccount(code, token, { method, bank: method === 'Multicaixa Express' ? undefined : bank, holder, details }); setHolder(''); setDetails(''); setBank(''); onChange(); flash('Conta registada'); }
    catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível registar.'); }
    finally { setBusy(false); }
  };
  const remove = async (a: PayoutAccount) => {
    if (!window.confirm(`Eliminar a conta ${a.details}?`)) return;
    try { await api.membersRemoveAccount(code, token, a.id); onChange(); } catch { /* */ }
  };
  return (
    <div className="kw-dash">
      <h1 className="kw-aff-title"><I d={P.shield} size={22} /> Contas bancárias <small className="kw-muted">{n}/3</small></h1>
      <div className="kw-warn">Os dados bancários têm de estar em seu nome.</div>
      {n < 3 ? (
        <form className="kw-profile" onSubmit={(e) => void add(e)}>
          <h3>Nova conta bancária</h3>
          <label className="kw-f"><span>Receber por</span><select value={method} onChange={(e) => setMethod(e.target.value)}><option>Transferência bancária</option><option>Multicaixa Express</option></select></label>
          {method !== 'Multicaixa Express' ? <label className="kw-f"><span>Banco</span><select value={bank} onChange={(e) => setBank(e.target.value)}><option value="">Escolha o banco</option>{BANKS.map((b) => <option key={b}>{b}</option>)}</select></label> : null}
          <label className="kw-f"><span>Titular</span><input value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="name" /></label>
          <label className="kw-f"><span>{method === 'Multicaixa Express' ? 'Número de telefone' : 'IBAN'}</span><input value={details} onChange={(e) => setDetails(e.target.value)} placeholder={method === 'Multicaixa Express' ? '9XX XXX XXX' : 'AO06 0000 0000 0000 0000 0000 0'} /></label>
          {err ? <div className="kw-err" role="alert">{err}</div> : null}
          <button className="kw-btn kw-btn-primary" disabled={busy}>{busy ? 'A registar…' : 'Registar conta'}</button>
        </form>
      ) : null}
      {accounts === null ? <div className="kw-loader" aria-busy="true"><i /><i /><i /></div> : n === 0 ? <div className="kw-empty">Ainda não registou nenhuma conta bancária</div> : (
        <ul className="kw-accounts">{accounts.map((a) => (
          <li key={a.id} className="kw-pop"><span className="kw-dot b"><I d={a.method === 'Multicaixa Express' ? P.phone : P.card} size={16} /></span>
            <div><b>{a.method}{a.bank ? ` · ${a.bank}` : ''}</b><small>{a.details}</small><small>{a.holder}</small></div>
            <button className="kw-x" onClick={() => void remove(a)} aria-label="Eliminar conta"><I d={P.trash} size={17} /></button></li>
        ))}</ul>
      )}
    </div>
  );
}
