import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AffiliateAssociateRow, AffiliateProductRow, AffiliateWithdrawalRow, StoreBanner, StoreBannerInput, StoreCoupon, StoreCouponInput, StoreMember, StoreReviewRow } from '../api/types';
import { confirmDialog, readFileProgress } from '../components/feedback';
import { Modal, Switch } from '../components/ui';
import { IconPlus, IconTrash } from '../components/Icons';

const kz = (n: number | string) => `${Number(n).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;
const dt = (s: string | null) => (s ? new Date(s).toLocaleDateString('pt-PT') : '—');

/** Cupões da loja online: código, desconto, mínimo, limites e validade. */
export function CouponsCard() {
  const [rows, setRows] = useState<StoreCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.marketing.coupons()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const patch = async (c: StoreCoupon, dto: Partial<StoreCouponInput>) => {
    try { await api.marketing.updateCoupon(c.id, dto); } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); }
    await load();
  };
  const remove = async (c: StoreCoupon) => {
    if (!(await confirmDialog({ message: `Eliminar o cupão ${c.code}?`, danger: true }))) return;
    await api.marketing.removeCoupon(c.id).catch(() => undefined);
    await load();
  };

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center' }}>
        <h3 style={{ margin: 0, flex: 1 }}>Cupões da loja online</h3>
        <button className="btn sm" onClick={() => setCreating(true)}><IconPlus size={15} /> Novo cupão</button>
      </div>
      {error ? <div className="banner danger" style={{ marginTop: 10 }}>{error}</div> : null}
      {loading ? <div className="loading">A carregar…</div> : rows.length === 0 ? (
        <div className="empty"><p>Sem cupões.</p></div>
      ) : (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="vd-table">
            <thead><tr><th>Código</th><th>Desconto</th><th>Mínimo</th><th>Usos</th><th>Validade</th><th>Na montra</th><th>Activo</th><th /></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.code}</strong></td>
                  <td>{c.type === 'PERCENT' ? `${Number(c.value)}%` : kz(c.value)}</td>
                  <td>{Number(c.min_order) > 0 ? kz(c.min_order) : '—'}</td>
                  <td>{c.uses ?? 0}{c.max_uses ? ` / ${c.max_uses}` : ''} <span className="muted">· {c.per_customer} por cliente</span></td>
                  <td>{c.starts_at || c.ends_at ? `${dt(c.starts_at)} – ${dt(c.ends_at)}` : '—'}</td>
                  <td><Switch checked={c.is_public} onChange={(v) => void patch(c, { isPublic: v })} /></td>
                  <td><Switch checked={c.is_active} onChange={(v) => void patch(c, { isActive: v })} /></td>
                  <td><button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => void remove(c)} aria-label={`Eliminar ${c.code}`}><IconTrash size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating ? <CouponEditor onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} /> : null}
    </div>
  );
}

function CouponEditor({ onClose, onSaved }: { onClose(): void; onSaved(): void }) {
  const [code, setCode] = useState('');
  const [type, setType] = useState<'PERCENT' | 'AMOUNT'>('PERCENT');
  const [value, setValue] = useState('10');
  const [minOrder, setMinOrder] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [perCustomer, setPerCustomer] = useState('1');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null); setSaving(true);
    try {
      await api.marketing.createCoupon({
        code: code.trim().toUpperCase(), type, value: Number(value.replace(',', '.')) || 0,
        minOrder: Number(minOrder.replace(',', '.')) || 0,
        maxUses: maxUses ? Number(maxUses) : null, perCustomer: Number(perCustomer) || 1,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        isPublic, isActive: true,
      });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="Novo cupão" onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="field"><label>Código</label><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} maxLength={32} placeholder="BEMVINDO10" /></div>
      <div className="grid-2">
        <div className="field">
          <label>Tipo</label>
          <select value={type} onChange={(e) => setType(e.target.value as 'PERCENT' | 'AMOUNT')}>
            <option value="PERCENT">Percentagem (%)</option>
            <option value="AMOUNT">Valor (Kz)</option>
          </select>
        </div>
        <div className="field"><label>{type === 'PERCENT' ? 'Desconto (%)' : 'Desconto (Kz)'}</label><input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" /></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Compra mínima (Kz)</label><input value={minOrder} onChange={(e) => setMinOrder(e.target.value)} inputMode="decimal" placeholder="0" /></div>
        <div className="field"><label>Usos por cliente</label><input value={perCustomer} onChange={(e) => setPerCustomer(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></div>
      </div>
      <div className="field"><label>Limite total de usos</label><input value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="Sem limite" /></div>
      <div className="grid-2">
        <div className="field"><label>Início</label><input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></div>
        <div className="field"><label>Fim</label><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></div>
      </div>
      <div className="switch-row" style={{ marginTop: 6 }}>
        <strong style={{ fontSize: 14 }}>Mostrar na montra</strong>
        <Switch checked={isPublic} onChange={setIsPublic} />
      </div>
      <button className="btn lg block" style={{ marginTop: 12 }} onClick={() => void save()} disabled={saving || !code.trim()}>{saving ? 'A guardar…' : 'Criar cupão'}</button>
    </Modal>
  );
}

/** Avaliações dos produtos na loja online: ocultar / voltar a mostrar. */
export function ReviewsCard() {
  const [rows, setRows] = useState<StoreReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.marketing.reviews()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (r: StoreReviewRow) => {
    await api.marketing.hideReview(r.id, !r.is_hidden).catch(() => undefined);
    await load();
  };
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Avaliações dos produtos <span className="muted" style={{ fontWeight: 500 }}>({rows.length})</span></h3>
      {error ? <div className="banner danger">{error}</div> : null}
      {loading ? <div className="loading">A carregar…</div> : rows.length === 0 ? (
        <div className="empty"><p>Sem avaliações.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="vd-table">
            <thead><tr><th>Data</th><th>Produto</th><th>Cliente</th><th>Estrelas</th><th>Comentário</th><th>Visível</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={r.is_hidden ? { opacity: 0.55 } : undefined}>
                  <td>{dt(r.created_at)}</td>
                  <td>{r.product_name}</td>
                  <td>{r.customer_name || r.customer_email}</td>
                  <td aria-label={`${r.rating} de 5`} style={{ color: '#f5a623', whiteSpace: 'nowrap' }}>{'★'.repeat(r.rating)}<span style={{ color: 'var(--border)' }}>{'★'.repeat(5 - r.rating)}</span></td>
                  <td style={{ maxWidth: 360 }}>{r.comment || '—'}</td>
                  <td><Switch checked={!r.is_hidden} onChange={() => void toggle(r)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const MEMBER_LABEL: Record<string, string> = { PENDING: 'Pendente', APPROVED: 'Aprovado', REJECTED: 'Recusado' };

/** Associados da loja online (segunda loja): aprovação das adesões pedidas pelos clientes. */
export function MembersCard() {
  const [rows, setRows] = useState<StoreMember[]>([]);
  const [filter, setFilter] = useState<'' | 'PENDING' | 'APPROVED' | 'REJECTED'>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.members.list(filter || undefined)); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar.'); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível concluir.'); }
    await load();
  };
  const revoke = async (m: StoreMember) => {
    if (!(await confirmDialog({ message: `Retirar o acesso de ${m.name}?`, danger: true }))) return;
    await act(() => api.members.revoke(m.id));
  };

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, flex: 1 }}>Associados da loja online</h3>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Estado">
          <option value="">Todos</option><option value="PENDING">Pendentes</option><option value="APPROVED">Aprovados</option><option value="REJECTED">Recusados</option>
        </select>
      </div>
      {error ? <div className="banner danger" style={{ marginTop: 10 }}>{error}</div> : null}
      {loading ? <div className="loading">A carregar…</div> : rows.length === 0 ? (
        <div className="empty"><p>Sem pedidos.</p></div>
      ) : (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="vd-table">
            <thead><tr><th>Nome</th><th>Email</th><th>Telefone</th><th>Pedido</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.name}</strong>{m.note ? <div className="muted wrap">{m.note}</div> : null}</td>
                  <td className="wrap">{m.email.endsWith('@sem-email.lps') ? '—' : m.email}</td>
                  <td>{m.phone ?? '—'}</td>
                  <td>{dt(m.requestedAt)}</td>
                  <td>{MEMBER_LABEL[m.status] ?? m.status}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {m.status !== 'APPROVED' ? <button className="btn sm" onClick={() => void act(() => api.members.approve(m.id))}>Aprovar</button> : null}
                      {m.status === 'PENDING' ? <button className="btn sm ghost" onClick={() => void act(() => api.members.reject(m.id))}>Recusar</button> : null}
                      {m.status === 'APPROVED' ? <button className="btn sm ghost" onClick={() => void revoke(m)}>Retirar acesso</button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Anúncios do carrossel da loja de associados (LPS Kwanza): título, texto, imagem, ligação e ordem. */
export function BannersCard() {
  const [rows, setRows] = useState<StoreBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StoreBanner | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.banners.list()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const patch = async (b: StoreBanner, dto: StoreBannerInput) => {
    try { await api.banners.update(b.id, dto); } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); }
    await load();
  };
  const remove = async (b: StoreBanner) => {
    if (!(await confirmDialog({ message: `Eliminar o anúncio "${b.title}"?`, danger: true }))) return;
    await api.banners.remove(b.id).catch(() => undefined);
    await load();
  };

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center' }}>
        <h3 style={{ margin: 0, flex: 1 }}>Anúncios da loja de associados</h3>
        <button className="btn sm" onClick={() => setEditing('new')}><IconPlus size={15} /> Novo anúncio</button>
      </div>
      {error ? <div className="banner danger" style={{ marginTop: 10 }}>{error}</div> : null}
      {loading ? <div className="loading">A carregar…</div> : rows.length === 0 ? (
        <div className="empty"><p>Sem anúncios.</p></div>
      ) : (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="vd-table">
            <thead><tr><th>Imagem</th><th>Título</th><th>Ligação</th><th>Ordem</th><th>Activo</th><th /></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>{b.imageUrl ? <img src={b.imageUrl} alt="" style={{ width: 96, height: 40, objectFit: 'cover', borderRadius: 4 }} /> : '—'}</td>
                  <td><strong>{b.title}</strong>{b.subtitle ? <div className="muted wrap">{b.subtitle}</div> : null}</td>
                  <td className="wrap">{b.linkUrl ?? '—'}</td>
                  <td>{b.sortOrder}</td>
                  <td><Switch checked={b.isActive} onChange={(v) => void patch(b, { isActive: v })} /></td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn sm ghost" onClick={() => setEditing(b)}>Editar</button>
                      <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => void remove(b)} aria-label={`Eliminar ${b.title}`}><IconTrash size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <BannerEditor banner={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
    </div>
  );
}

function BannerEditor({ banner, onClose, onSaved }: { banner: StoreBanner | null; onClose(): void; onSaved(): void }) {
  const [f, setF] = useState<StoreBannerInput>(() => banner ?? { title: '', subtitle: '', imageUrl: '', linkUrl: '', buttonLabel: '', sortOrder: 0, isActive: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_800_000) { setErr('Imagem demasiado grande (máx. ~1,8 MB).'); return; }
    void readFileProgress(file).then((data) => setF((x) => ({ ...x, imageUrl: data })));
  };
  const save = async () => {
    if (!f.title?.trim()) { setErr('Indique o título.'); return; }
    setBusy(true); setErr(null);
    try {
      const dto: StoreBannerInput = { ...f, sortOrder: Number(f.sortOrder) || 0 };
      if (banner) await api.banners.update(banner.id, dto); else await api.banners.create(dto);
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); }
    finally { setBusy(false); }
  };
  const set = (k: keyof StoreBannerInput) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={banner ? 'Editar anúncio' : 'Novo anúncio'} onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 10 }}>{err}</div> : null}
      <div style={{ display: 'grid', gap: 10 }}>
        <label className="field"><span>Título</span><input value={f.title ?? ''} maxLength={120} onChange={set('title')} /></label>
        <label className="field"><span>Texto</span><input value={f.subtitle ?? ''} maxLength={200} onChange={set('subtitle')} /></label>
        <label className="field"><span>Texto do botão</span><input value={f.buttonLabel ?? ''} maxLength={40} onChange={set('buttonLabel')} /></label>
        <label className="field"><span>Ligação (código do produto, pesquisa ou https://…)</span><input value={f.linkUrl ?? ''} maxLength={300} onChange={set('linkUrl')} /></label>
        <label className="field"><span>Ordem</span><input type="number" value={f.sortOrder ?? 0} onChange={set('sortOrder')} /></label>
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="btn sm ghost" style={{ cursor: 'pointer' }}>
            {f.imageUrl ? 'Trocar imagem' : 'Escolher imagem'}
            <input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          {f.imageUrl ? <><img src={f.imageUrl} alt="" style={{ width: 160, height: 60, objectFit: 'cover', borderRadius: 4 }} /><button type="button" className="btn sm ghost" onClick={() => setF({ ...f, imageUrl: '' })}>Remover</button></> : null}
        </div>
        <button className="btn block" disabled={busy} onClick={() => void save()}>{busy ? 'A guardar…' : 'Guardar'}</button>
      </div>
    </Modal>
  );
}

const W_LABEL: Record<string, string> = { REQUESTED: 'Em análise', PAID: 'Pago', REJECTED: 'Recusado' };

/** Programa de associados da LPS Kwanza: % de comissão por produto, associados e pedidos de saque. */
export function AffiliatesCard() {
  const [tab, setTab] = useState<'products' | 'associates' | 'withdrawals'>('withdrawals');
  const [q, setQ] = useState('');
  const [prods, setProds] = useState<AffiliateProductRow[]>([]);
  const [assoc, setAssoc] = useState<AffiliateAssociateRow[]>([]);
  const [wd, setWd] = useState<AffiliateWithdrawalRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'products') setProds(await api.affiliates.products(q || undefined));
      else if (tab === 'associates') setAssoc(await api.affiliates.associates());
      else setWd(await api.affiliates.withdrawals());
      setError(null);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar.'); }
    finally { setLoading(false); }
  }, [tab, q]);
  useEffect(() => { const t = window.setTimeout(() => void load(), tab === 'products' ? 300 : 0); return () => window.clearTimeout(t); }, [load, tab]);

  const savePct = async (code: string) => {
    const raw = (drafts[code] ?? '').replace(',', '.').trim();
    const v = raw === '' ? null : Number(raw);
    if (v != null && (!(v >= 0) || v > 90)) { setError('A comissão tem de estar entre 0 e 90%.'); return; }
    try { await api.affiliates.setPercent(code, v); setDrafts((d) => { const n = { ...d }; delete n[code]; return n; }); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); }
  };
  const decide = async (w: AffiliateWithdrawalRow, pay: boolean) => {
    if (!(await confirmDialog({ message: pay ? `Marcar como pago o saque de ${kz(w.amount)} a ${w.name}?` : `Recusar o saque de ${kz(w.amount)} a ${w.name}?`, danger: !pay }))) return;
    try { if (pay) await api.affiliates.pay(w.id); else await api.affiliates.reject(w.id); } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível concluir.'); }
    await load();
  };

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, flex: 1 }}>Programa de associados</h3>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className={`btn sm${tab === 'withdrawals' ? '' : ' ghost'}`} onClick={() => setTab('withdrawals')}>Saques</button>
          <button className={`btn sm${tab === 'associates' ? '' : ' ghost'}`} onClick={() => setTab('associates')}>Associados</button>
          <button className={`btn sm${tab === 'products' ? '' : ' ghost'}`} onClick={() => setTab('products')}>Comissões por produto</button>
        </div>
      </div>
      {error ? <div className="banner danger" style={{ marginTop: 10 }}>{error}</div> : null}
      {tab === 'products' ? <input style={{ marginTop: 10, width: '100%' }} placeholder="Procurar produto" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Procurar produto" /> : null}
      {loading ? <div className="loading">A carregar…</div> : (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          {tab === 'products' ? (
            prods.length === 0 ? <div className="empty"><p>Sem produtos.</p></div> : (
              <table className="vd-table">
                <thead><tr><th>Código</th><th>Produto</th><th>Comissão (%)</th><th /></tr></thead>
                <tbody>{prods.map((p) => (
                  <tr key={p.code}>
                    <td>{p.code}</td><td className="wrap">{p.name}</td>
                    <td><input inputMode="decimal" style={{ width: 90 }} value={drafts[p.code] ?? (p.percent == null ? '' : String(p.percent))} onChange={(e) => setDrafts({ ...drafts, [p.code]: e.target.value })} aria-label={`Comissão de ${p.name}`} /></td>
                    <td>{drafts[p.code] !== undefined ? <button className="btn sm" onClick={() => void savePct(p.code)}>Guardar</button> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            )
          ) : tab === 'associates' ? (
            assoc.length === 0 ? <div className="empty"><p>Sem associados.</p></div> : (
              <table className="vd-table">
                <thead><tr><th>Associado</th><th>Código</th><th>Vendas</th><th>Pendente</th><th>Disponível</th><th>Em análise</th><th>Pago</th></tr></thead>
                <tbody>{assoc.map((a) => <tr key={a.id}><td><strong>{a.name}</strong></td><td>{a.code ?? '—'}</td><td>{a.sales}</td><td>{kz(a.pending)}</td><td>{kz(a.available)}</td><td>{kz(a.requested)}</td><td>{kz(a.paid)}</td></tr>)}</tbody>
              </table>
            )
          ) : (
            wd.length === 0 ? <div className="empty"><p>Sem pedidos de saque.</p></div> : (
              <table className="vd-table">
                <thead><tr><th>Data</th><th>Associado</th><th>Valor</th><th>Receber por</th><th>Estado</th><th /></tr></thead>
                <tbody>{wd.map((w) => (
                  <tr key={w.id}>
                    <td>{dt(w.date)}</td><td><strong>{w.name}</strong></td><td>{kz(w.amount)}</td>
                    <td className="wrap">{w.method}{w.details ? <div className="muted">{w.details}</div> : null}</td>
                    <td>{W_LABEL[w.status] ?? w.status}</td>
                    <td>{w.status === 'REQUESTED' ? <div className="row" style={{ gap: 6 }}><button className="btn sm" onClick={() => void decide(w, true)}>Marcar como pago</button><button className="btn sm ghost" onClick={() => void decide(w, false)}>Recusar</button></div> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            )
          )}
        </div>
      )}
    </div>
  );
}
