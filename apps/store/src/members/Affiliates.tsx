import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError, type AffiliateSummary } from '../api/client';
import type { CatalogProduct } from '../api/types';
import { formatDateTime } from '../format';
import { I, P, Pic, kz, useInfinite, useReveal } from './parts';

type Tab = 'market' | 'sales' | 'mine' | 'balance';
const STATE: Record<string, [string, string]> = {
  PENDING: ['Pendente', 'kw-st-PENDING'], AVAILABLE: ['Disponível', 'kw-st-PAID'], CANCELLED: ['Cancelada', 'kw-st-CANCELLED'],
  REQUESTED: ['Em análise', 'kw-st-PENDING'], PAID: ['Pago', 'kw-st-PAID'], REJECTED: ['Recusado', 'kw-st-CANCELLED'],
};

/** Ligação pública do produto com o código do associado (a loja abre o produto e guarda o código). */
export function affiliateLink(storeCode: string, productCode: string, ref: string): string {
  return `${location.origin}/${encodeURIComponent(storeCode)}?p=${encodeURIComponent(productCode)}&ref=${ref}`;
}

export function Affiliates({ code, token, products, cod, bannerImage, tab, onTab, flash }: {
  code: string; token: string; products: CatalogProduct[]; cod: boolean; bannerImage: string | null;
  tab: Tab; onTab(t: Tab): void; flash(t: string): void;
}) {
  const [market, setMarket] = useState<Map<string, number> | null>(null);
  const [me, setMe] = useState<AffiliateSummary | null>(null);
  const [open, setOpen] = useState<CatalogProduct | null>(null);
  const [q, setQ] = useState('');
  const reload = () => api.membersAffiliate(code, token).then(setMe).catch(() => undefined);
  useEffect(() => { api.membersMarket(code, token).then((r) => setMarket(new Map(r.map((x) => [x.productCode, x.percent])))).catch(() => setMarket(new Map())); void reload(); }, [code, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => {
    if (!market) return [];
    const t = q.trim().toLowerCase();
    return products.filter((p) => market.has(p.code) && (!t || p.name.toLowerCase().includes(t)))
      .sort((a, b) => (b.grossPrice * (market.get(b.code) ?? 0)) - (a.grossPrice * (market.get(a.code) ?? 0)));
  }, [market, products, q]);
  const mine = useMemo(() => {
    const names = new Set((me?.sales ?? []).map((s) => s.product));
    return items.filter((p) => names.has(p.name));
  }, [items, me]);
  const [shown, sentinel] = useInfinite(items.length, 20, `${q}|${items.length}`);
  useReveal(`${tab}-${shown}`);

  const copy = async (text: string, msg: string) => {
    try { await navigator.clipboard.writeText(text); flash(msg); } catch { window.prompt('Copie:', text); }
  };

  const tabs: Array<[Tab, string, string]> = [['sales', 'Minhas Vendas 🔥', 'warn'], ['market', 'Associar-me', ''], ['mine', 'Sou associado(a)', ''], ['balance', 'Saldo e saques', '']];

  return (
    <div className="kw-container kw-aff">
      <h1 className="kw-aff-title"><I d={P.share} size={24} /> Mercado de Associados</h1>
      <div className="kw-aff-banner kw-pop">
        {bannerImage ? <img src={bannerImage} alt="" /> : null}
        <div className="kw-aff-banner-txt">
          <strong>{me ? kz(me.available + me.withdrawn) : '—'}</strong>
          <span>ganhos confirmados</span>
          {me ? <em>O seu código: <b>{me.code}</b></em> : null}
        </div>
      </div>
      <div className="kw-aff-tabs">
        {tabs.map(([k, l, tone]) => <button key={k} className={`${tab === k ? 'on' : ''} ${tone}`} onClick={() => onTab(k)}>{l}</button>)}
      </div>

      {tab === 'market' || tab === 'mine' ? (
        <>
          <div className="kw-aff-search">
            <I d={P.search} size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar produto com comissão" aria-label="Procurar produto" />
          </div>
          {market === null ? <div className="kw-loader" aria-busy="true"><i /><i /><i /></div> : (tab === 'mine' ? mine : items).length === 0 ? (
            <div className="kw-empty">{tab === 'mine' ? 'Ainda sem vendas como associado' : 'Sem produtos com comissão'}</div>
          ) : (
            <>
              <h2 className="kw-aff-h2">Produtos Físicos</h2>
              <div className="kw-grid4">
                {(tab === 'mine' ? mine : items.slice(0, shown)).map((p) => {
                  const pctv = market.get(p.code) ?? 0;
                  return (
                    <article key={p.code} className="kw-card kw-aff-card kw-reveal">
                      <button className="kw-aff-open" onClick={() => setOpen(p)} aria-label={p.name}>
                        <div className="kw-card-img"><Pic p={p} />
                          {(p.sold ?? 0) > 0 ? <span className="kw-card-sold"><I d={P.bag} size={12} />{p.sold}</span> : null}
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
              {tab === 'market' && shown < items.length ? <div ref={sentinel} className="kw-loader" aria-busy="true"><i /><i /><i /></div> : null}
            </>
          )}
        </>
      ) : null}

      {tab === 'sales' ? (
        !me ? <div className="kw-loader" aria-busy="true"><i /><i /><i /></div> : !me.sales.length ? <div className="kw-empty">Ainda sem vendas como associado</div> : (
          <div className="kw-aff-table">
            <table className="kw-spec">
              <thead><tr><th>Encomenda</th><th>Produto</th><th>Data</th><th>Comissão</th><th>Estado</th></tr></thead>
              <tbody>{me.sales.map((s, i) => <tr key={`${s.orderNumber}-${i}`}><td>{s.orderNumber}</td><td>{s.product} × {s.quantity}</td><td>{formatDateTime(s.date)}</td><td><b>{kz(s.amount)}</b></td><td><span className={`kw-pill ${STATE[s.state][1]}`}>{STATE[s.state][0]}</span></td></tr>)}</tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'balance' ? <Balance code={code} token={token} me={me} onDone={() => { void reload(); flash('Pedido de saque enviado'); }} /> : null}

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

function Balance({ code, token, me, onDone }: { code: string; token: string; me: AffiliateSummary | null; onDone(): void }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Multicaixa Express');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!me) return <div className="kw-loader" aria-busy="true"><i /><i /><i /></div>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const a = Number(amount.replace(',', '.'));
    if (!(a > 0)) { setErr('Indique o valor.'); return; }
    if (a > me.balance) { setErr('O valor é maior do que o saldo disponível.'); return; }
    if (details.trim().length < 6) { setErr('Indique o número ou IBAN para receber.'); return; }
    setBusy(true);
    try { await api.membersWithdraw(code, token, { amount: a, method, details: details.trim() }); setAmount(''); setDetails(''); onDone(); }
    catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível pedir o saque.'); }
    finally { setBusy(false); }
  };
  const valid = me.sales.filter((x) => x.state !== 'CANCELLED');
  const since = (days: number) => { const t = Date.now() - days * 86400000; return valid.filter((x) => new Date(x.date).getTime() >= t).reduce((a, x) => a + x.amount, 0); };
  const today = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return valid.filter((x) => new Date(x.date) >= d).reduce((a, x) => a + x.amount, 0); })();
  return (
    <div className="kw-aff-bal">
      <section className="kw-perf">
        <h3>Desempenho de vendas</h3>
        <div><span>Hoje</span><b>{kz(today)}</b></div>
        <div><span>Últimos 7 dias</span><b>{kz(since(7))}</b></div>
        <div><span>Últimos 30 dias</span><b>{kz(since(30))}</b></div>
        <div><span>Número de vendas</span><b>{new Set(valid.map((x) => x.orderNumber)).size}</b></div>
      </section>
      <div className="kw-counters">
        <div className="kw-bal-c main"><b>{kz(me.balance)}</b><span>Saldo disponível</span></div>
        <div className="kw-bal-c"><b>{kz(me.pending)}</b><span>Pendente (encomendas por entregar)</span></div>
        <div className="kw-bal-c"><b>{kz(me.requested)}</b><span>Saques em análise</span></div>
        <div className="kw-bal-c"><b>{kz(me.withdrawn)}</b><span>Já levantado</span></div>
      </div>
      <form className="kw-profile" onSubmit={(e) => void submit(e)}>
        <h3>Fazer saque</h3>
        <label className="kw-f"><span>Valor (Kz)</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} placeholder={String(me.balance)} /></label>
        <label className="kw-f"><span>Receber por</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)}><option>Multicaixa Express</option><option>Transferência bancária</option></select></label>
        <label className="kw-f"><span>{method === 'Multicaixa Express' ? 'Número de telefone' : 'IBAN'}</span><input value={details} onChange={(e) => setDetails(e.target.value)} /></label>
        {err ? <div className="kw-err" role="alert">{err}</div> : null}
        <button className="kw-btn kw-btn-primary" disabled={busy || me.balance <= 0}>{busy ? 'A enviar…' : 'Pedir saque'}</button>
      </form>
      {me.withdrawals.length ? (
        <div className="kw-aff-table">
          <h3>Histórico de transações</h3>
          <table className="kw-spec">
            <thead><tr><th>Data</th><th>Valor</th><th>Por</th><th>Estado</th></tr></thead>
            <tbody>{me.withdrawals.map((w) => <tr key={w.id}><td>{formatDateTime(w.date)}</td><td><b>{kz(w.amount)}</b></td><td>{w.method}</td><td><span className={`kw-pill ${STATE[w.status]?.[1] ?? ''}`}>{STATE[w.status]?.[0] ?? w.status}</span>{w.note ? <small className="kw-muted"> {w.note}</small> : null}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
