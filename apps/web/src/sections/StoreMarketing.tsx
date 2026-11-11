import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { StoreCoupon, StoreCouponInput, StoreMember, StoreReviewRow } from '../api/types';
import { confirmDialog } from '../components/feedback';
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
