import { confirmDialog } from '../components/feedback';
import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { OpsAlert, Promotion, PromotionInput, PromoType } from '../api/types';
import { Modal, Switch } from '../components/ui';
import { IconPlus, IconStar, IconTrash } from '../components/Icons';

const TYPE_LABEL: Record<PromoType, string> = {
  PERCENT: 'Desconto %',
  AMOUNT: 'Desconto valor (Kz)',
  BUY_X_PAY_Y: 'Leve X, paga Y',
  QTY_TIERED: 'Desconto por quantidade',
};

function describe(p: Promotion): string {
  switch (p.type) {
    case 'PERCENT': return `${Number(p.percent ?? 0)}% de desconto`;
    case 'AMOUNT': return `${Number(p.amount ?? 0).toLocaleString('pt-PT')} Kz por unidade`;
    case 'BUY_X_PAY_Y': return `Leve ${p.buy_qty}, paga ${p.pay_qty}`;
    case 'QTY_TIERED': return `${Number(p.tier_percent ?? 0)}% a partir de ${p.min_qty} un`;
    default: return '';
  }
}

export function Promotions() {
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [alerts, setAlerts] = useState<OpsAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSel = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = promos.length > 0 && promos.every((p) => selected.has(p.id));
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(promos.map((p) => p.id)));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, a] = await Promise.all([api.promotions.list(), api.alerts().catch(() => [])]);
      setPromos(p); setAlerts(a); setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (p: Promotion) => {
    await api.promotions.update(p.id, { isActive: !p.is_active }).catch(() => undefined);
    await load();
  };
  const remove = async (p: Promotion) => {
    if (!(await confirmDialog({ message: `Remover "${p.name}"?`, danger: true }))) return;
    await api.promotions.remove(p.id).catch(() => undefined);
    await load();
  };
  const bulkDelete = async () => {
    if (!(await confirmDialog({ message: `Eliminar ${selected.size} promoção(ões)?`, danger: true }))) return;
    setBulkBusy(true);
    try { for (const id of selected) await api.promotions.remove(id).catch(() => undefined); setSelected(new Set()); await load(); }
    finally { setBulkBusy(false); }
  };

  return (
    <>
      <div className="content-head">
        <h2>Promoções & Campanhas</h2>
        <span className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}><IconPlus size={16} /> Nova promoção</button>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}

      {/* Alertas operacionais */}
      {alerts.length > 0 ? (
        <div className="card">
          <h3>🔔 Alertas ({alerts.length})</h3>
          {alerts.slice(0, 8).map((a, i) => (
            <div className="list-row" key={i}>
              <span className="badge" style={{ color: a.level === 'danger' ? 'var(--danger)' : a.level === 'warning' ? 'var(--warning)' : 'var(--primary)', borderColor: 'currentColor' }}>
                {a.category}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{a.title}</div>
                <div className="muted" style={{ fontSize: 13 }}>{a.detail}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px' }}>
          <strong>{selected.size} selecionada(s)</strong>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn sm danger" onClick={() => void bulkDelete()} disabled={bulkBusy}>Eliminar selecionadas</button>
        </div>
      ) : null}

      <div className="card">
        <div className="row" style={{ alignItems: 'center' }}>
          <h3 style={{ margin: 0, flex: 1 }}>Promoções</h3>
          {promos.length > 0 ? (
            <label className="row" style={{ gap: 6, fontSize: 12.5, whiteSpace: 'nowrap', cursor: 'pointer' }}>
              <input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Selecionar todas" /> Todas
            </label>
          ) : null}
        </div>
        {loading ? <div className="loading">A carregar…</div> : promos.length === 0 ? (
          <div className="empty"><IconStar size={40} /><p>Sem promoções. Crie campanhas como “3x2” ou “10% às quartas”.</p></div>
        ) : promos.map((p) => (
          <div className="list-row" key={p.id}>
            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSel(p.id)} aria-label={`Selecionar ${p.name}`} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{p.name} <span className="muted" style={{ fontWeight: 500 }}>· {TYPE_LABEL[p.type]}</span></div>
              <div className="muted" style={{ fontSize: 13 }}>{describe(p)}</div>
            </div>
            <Switch checked={p.is_active} onChange={() => toggle(p)} />
            <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => remove(p)}><IconTrash size={16} /></button>
          </div>
        ))}
      </div>

      {creating ? <PromoEditor onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} /> : null}
    </>
  );
}

function PromoEditor({ onClose, onSaved }: { onClose(): void; onSaved(): void }) {
  const [type, setType] = useState<PromoType>('PERCENT');
  const [name, setName] = useState('');
  const [percent, setPercent] = useState('10');
  const [amount, setAmount] = useState('100');
  const [buyQty, setBuyQty] = useState('3');
  const [payQty, setPayQty] = useState('2');
  const [minQty, setMinQty] = useState('10');
  const [tierPercent, setTierPercent] = useState('5');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    if (!name.trim()) { setErr('Indique o nome da promoção.'); return; }
    setSaving(true);
    try {
      const dto: PromotionInput = { name: name.trim(), type, scope: 'ALL', isActive: true };
      if (type === 'PERCENT') dto.percent = Number(percent) || 0;
      if (type === 'AMOUNT') dto.amount = Number(amount) || 0;
      if (type === 'BUY_X_PAY_Y') { dto.buyQty = Number(buyQty) || 0; dto.payQty = Number(payQty) || 0; }
      if (type === 'QTY_TIERED') { dto.minQty = Number(minQty) || 0; dto.tierPercent = Number(tierPercent) || 0; }
      if (startTime && endTime) { dto.startTime = startTime; dto.endTime = endTime; }
      await api.promotions.create(dto);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível guardar.');
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Nova promoção" onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="field"><label>Nome</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Leve 3 paga 2 — refrigerantes" /></div>
      <div className="field">
        <label>Tipo</label>
        <select value={type} onChange={(e) => setType(e.target.value as PromoType)}>
          {(Object.keys(TYPE_LABEL) as PromoType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      </div>
      {type === 'PERCENT' ? <div className="field"><label>Percentagem (%)</label><input value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="numeric" /></div> : null}
      {type === 'AMOUNT' ? <div className="field"><label>Desconto por unidade (Kz)</label><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" /></div> : null}
      {type === 'BUY_X_PAY_Y' ? (
        <div className="grid-2">
          <div className="field"><label>Leve (X)</label><input value={buyQty} onChange={(e) => setBuyQty(e.target.value)} inputMode="numeric" /></div>
          <div className="field"><label>Paga (Y)</label><input value={payQty} onChange={(e) => setPayQty(e.target.value)} inputMode="numeric" /></div>
        </div>
      ) : null}
      {type === 'QTY_TIERED' ? (
        <div className="grid-2">
          <div className="field"><label>A partir de (un)</label><input value={minQty} onChange={(e) => setMinQty(e.target.value)} inputMode="numeric" /></div>
          <div className="field"><label>Desconto (%)</label><input value={tierPercent} onChange={(e) => setTierPercent(e.target.value)} inputMode="numeric" /></div>
        </div>
      ) : null}
      <div className="grid-2">
        <div className="field"><label>Happy-hour início (opcional)</label><input value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="14:00" /></div>
        <div className="field"><label>Happy-hour fim (opcional)</label><input value={endTime} onChange={(e) => setEndTime(e.target.value)} placeholder="16:00" /></div>
      </div>
      <button className="btn lg block" style={{ marginTop: 12 }} onClick={save} disabled={saving}>{saving ? 'A guardar…' : 'Criar promoção'}</button>
    </Modal>
  );
}
