import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ManagerProduct, ServiceOrderDetail, ServiceOrderRow } from '../api/types';
import { toast } from '../components/feedback';
import { IconPlus, IconSearch, IconTrash } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz } from '../format';

const KZ = (n: string | number) => formatKz(Number(n) || 0);
const STATUS: { id: string; label: string }[] = [
  { id: 'OPEN', label: 'Aberta' }, { id: 'QUOTED', label: 'Orçamentada' }, { id: 'APPROVED', label: 'Aprovada' },
  { id: 'IN_PROGRESS', label: 'Em curso' }, { id: 'READY', label: 'Pronta' }, { id: 'DELIVERED', label: 'Entregue' }, { id: 'CANCELLED', label: 'Cancelada' },
];
const SL = (s: string) => STATUS.find((x) => x.id === s)?.label ?? s;
const KIND_L: Record<string, string> = { PART: 'Peça', LABOR: 'Mão-de-obra', SERVICE: 'Serviço' };

/** Ordens de Serviço (mecânica, assistência técnica, recauchutagem…). */
export function ServiceOrders() {
  const [rows, setRows] = useState<ServiceOrderRow[]>([]);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<ServiceOrderDetail | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api.serviceOrders.list(filter || undefined)); } catch { /* */ }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  const openOS = async (id: string) => { try { setDetail(await api.serviceOrders.get(id)); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); } };

  return (
    <>
      <div className="content-head">
        <h2>🛠️ Ordens de serviço</h2>
        <span className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}><IconPlus size={17} /> Nova OS</button>
      </div>

      <div className="card toolbar-sticky" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 12px' }}>
        <button className={`chip${filter === '' ? ' active' : ''}`} onClick={() => setFilter('')}>Todas</button>
        {STATUS.map((s) => <button key={s.id} className={`chip${filter === s.id ? ' active' : ''}`} onClick={() => setFilter(s.id)}>{s.label}</button>)}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? <div className="empty" style={{ padding: 26 }}><p>Sem ordens de serviço.</p></div>
          : rows.map((r) => (
            <button key={r.id} className="list-row" onClick={() => void openOS(r.id)} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', padding: '12px 16px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 14 }}>{r.number} · {r.customer_name || 'Cliente'}{r.source === 'ONLINE' ? <span className="pill" style={{ marginLeft: 6, background: 'var(--primary)', color: '#fff' }}>🌐 Online</span> : null}</strong>
                <div className="muted" style={{ fontSize: 12.5 }}>{r.equipment_label || '—'}{r.assigned_to ? ` · 👤 ${r.assigned_to}` : ''}</div>
              </div>
              <span style={{ fontWeight: 700, marginRight: 8 }}>{KZ(r.total)}</span>
              <span className={`pill ${r.status === 'DELIVERED' ? 'on' : r.status === 'CANCELLED' ? 'off' : ''}`}>{SL(r.status)}</span>
            </button>
          ))}
      </div>

      {creating ? <CreateOS onClose={() => setCreating(false)} onCreated={async (id) => { setCreating(false); await load(); await openOS(id); }} /> : null}
      {detail ? <OSDetail detail={detail} onClose={() => setDetail(null)} onChanged={async () => { setDetail(await api.serviceOrders.get(detail.order.id)); await load(); }} /> : null}
    </>
  );
}

function CreateOS({ onClose, onCreated }: { onClose(): void; onCreated(id: string): void }) {
  const [f, setF] = useState({ customerName: '', customerPhone: '', equipmentType: 'VEHICLE', equipmentLabel: '', equipmentRef: '', problem: '', assignedTo: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const r = await api.serviceOrders.create(f); toast.success('OS aberta.'); onCreated(r.id); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao abrir a OS.'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Nova ordem de serviço" onClose={onClose}>
      <div className="grid-2">
        <div className="field"><label>Cliente</label><input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} placeholder="Nome" /></div>
        <div className="field"><label>Telefone</label><input value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} inputMode="tel" /></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Tipo</label>
          <select value={f.equipmentType} onChange={(e) => setF({ ...f, equipmentType: e.target.value })}>
            <option value="VEHICLE">Viatura</option><option value="DEVICE">Aparelho/Equipamento</option><option value="OTHER">Outro</option>
          </select></div>
        <div className="field"><label>Matrícula / Nº de série</label><input value={f.equipmentRef} onChange={(e) => setF({ ...f, equipmentRef: e.target.value })} placeholder="LD-00-00 / SN…" /></div>
      </div>
      <div className="field"><label>Equipamento</label><input value={f.equipmentLabel} onChange={(e) => setF({ ...f, equipmentLabel: e.target.value })} placeholder="ex.: Toyota Corolla / Portátil HP" /></div>
      <div className="field"><label>Avaria relatada</label><textarea value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} rows={3} placeholder="O que o cliente reporta…" style={{ width: '100%', resize: 'vertical' }} /></div>
      <div className="field"><label>Técnico (opcional)</label><input value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })} /></div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A abrir…' : 'Abrir OS'}</button>
    </Modal>
  );
}

function OSDetail({ detail, onClose, onChanged }: { detail: ServiceOrderDetail; onClose(): void; onChanged(): void }) {
  const o = detail.order;
  const [products, setProducts] = useState<ManagerProduct[]>([]);
  const [q, setQ] = useState('');
  const [diagnosis, setDiagnosis] = useState(o.diagnosis ?? '');
  const [labor, setLabor] = useState({ description: '', price: '' });
  useEffect(() => { api.products.list().then(setProducts).catch(() => undefined); }, []);

  const addPart = async (code: string) => { await api.serviceOrders.addItem(o.id, { productCode: code, quantity: 1 }).catch((e) => toast.error(e instanceof ApiError ? e.message : 'Falha.')); onChanged(); };
  const addLabor = async () => {
    if (!labor.description.trim()) { toast.warning('Descreva a mão-de-obra/serviço.'); return; }
    await api.serviceOrders.addItem(o.id, { kind: 'LABOR', description: labor.description.trim(), unitPrice: Number(labor.price) || 0, quantity: 1 }).catch(() => undefined);
    setLabor({ description: '', price: '' }); onChanged();
  };
  const removeItem = async (id: string) => { await api.serviceOrders.removeItem(id).catch(() => undefined); onChanged(); };
  const setStatus = async (s: string) => { await api.serviceOrders.status(o.id, s).catch(() => undefined); onChanged(); };
  const saveDiagnosis = async () => { await api.serviceOrders.update(o.id, { diagnosis }).catch(() => undefined); toast.success('Diagnóstico guardado.'); onChanged(); };
  const [billing, setBilling] = useState(false);
  const invoice = async () => {
    if (detail.items.length === 0) { toast.warning('Adicione itens antes de faturar.'); return; }
    setBilling(true);
    try { const r = await api.serviceOrders.invoice(o.id); toast.success(`Fatura ${r.invoiceNumber} emitida. OS entregue.`); onClose(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao faturar.'); } finally { setBilling(false); }
  };

  const filtered = q.trim() ? products.filter((p) => `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 20) : products.slice(0, 12);

  return (
    <Modal title={`${o.number} — ${SL(o.status)}`} onClose={onClose}>
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 13.5 }}><strong>{o.customer_name || 'Cliente'}</strong>{o.customer_phone ? ` · ${o.customer_phone}` : ''}</div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{o.equipment_label || '—'}{o.equipment_ref ? ` · ${o.equipment_ref}` : ''}{o.assigned_to ? ` · 👤 ${o.assigned_to}` : ''}</div>
        {o.problem ? <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>🛠️ {o.problem}</div> : null}
      </div>

      <div className="field"><label>Estado</label>
        <select value={o.status} onChange={(e) => void setStatus(e.target.value)}>
          {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select></div>

      <div className="field"><label>Diagnóstico</label>
        <textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical' }} placeholder="Diagnóstico técnico…" />
        <button className="btn sm ghost" style={{ marginTop: 6, alignSelf: 'flex-start' }} onClick={() => void saveDiagnosis()}>Guardar diagnóstico</button>
      </div>

      {/* Peças do stock */}
      <label className="auth-label" style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 600, margin: '6px 0' }}>Adicionar peça (stock)</label>
      <div className="card" style={{ padding: '2px 12px', marginBottom: 8 }}>
        <div className="row"><IconSearch size={18} /><input style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '10px 0', color: 'var(--text)' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar peça…" /></div>
      </div>
      <div className="pgrid" style={{ maxHeight: '18vh', overflowY: 'auto', marginBottom: 10 }}>
        {filtered.map((p) => (
          <button key={p.id} className="pcard" onClick={() => void addPart(p.code)} style={{ cursor: 'pointer', textAlign: 'left' }}>
            <div className="pinfo"><div className="pname" style={{ fontSize: 13 }}>{p.name}</div><div className="pcode">{p.code}</div></div>
          </button>
        ))}
      </div>

      {/* Mão-de-obra / serviço manual */}
      <div className="row" style={{ gap: 8, marginBottom: 12, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, margin: 0 }}><label>Mão-de-obra / serviço</label><input value={labor.description} onChange={(e) => setLabor({ ...labor, description: e.target.value })} placeholder="ex.: Substituição de óleo" /></div>
        <div className="field" style={{ width: 120, margin: 0 }}><label>Preço</label><input value={labor.price} onChange={(e) => setLabor({ ...labor, price: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" placeholder="0" /></div>
        <button className="btn" onClick={() => void addLabor()}>Adicionar</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
        {detail.items.length === 0 ? <div className="empty" style={{ padding: 16 }}><p>Sem itens. Adiciona peças e mão-de-obra.</p></div>
          : detail.items.map((it) => (
            <div key={it.id} className="list-row" style={{ padding: '10px 14px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 13.5 }}>{Number(it.quantity)}× {it.description}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{KIND_L[it.kind] ?? it.kind} · {KZ(it.unit_price)}</div>
              </div>
              <span style={{ fontWeight: 700, marginRight: 8 }}>{KZ(Number(it.unit_price) * Number(it.quantity))}</span>
              <button className="btn sm ghost" onClick={() => void removeItem(it.id)}><IconTrash size={14} /></button>
            </div>
          ))}
      </div>

      <div className="row" style={{ alignItems: 'center' }}>
        <strong style={{ fontSize: 16 }}>Total</strong><span className="spacer" style={{ flex: 1 }} />
        <strong style={{ fontSize: 20 }}>{KZ(o.total)}</strong>
      </div>

      {o.status !== 'DELIVERED' && o.status !== 'CANCELLED' ? (
        <button className="btn lg block success" style={{ marginTop: 12 }} onClick={() => void invoice()} disabled={billing}>
          🧾 {billing ? 'A faturar…' : 'Faturar (AGT) e entregar'}
        </button>
      ) : o.status === 'DELIVERED' ? (
        <div className="banner success" style={{ marginTop: 12 }}>OS entregue/faturada.</div>
      ) : null}
    </Modal>
  );
}
