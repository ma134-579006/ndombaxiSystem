import { confirmDialog, runBulk } from '../components/feedback';
import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Promotion, PromotionInput, PromoType } from '../api/types';
import { Modal, Switch } from '../components/ui';
import { IconPlus, IconSearch, IconStar, IconTrash } from '../components/Icons';
import { AffiliatesCard, BannersCard, CouponsCard, MembersCard } from './StoreMarketing';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [q, setQ] = useState('');
  const [state, setState] = useState<'' | 'on' | 'off'>('');
  const term = q.trim().toLowerCase();
  const list = promos.filter((p) => (!term || `${p.name} ${TYPE_LABEL[p.type]}`.toLowerCase().includes(term))
    && (!state || (state === 'on' ? p.is_active : !p.is_active)));
  const toggleSel = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = list.length > 0 && list.every((p) => selected.has(p.id));
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(list.map((p) => p.id)));

  // Os alertas operacionais (quebras de caixa, stock) já estão no Dashboard — saíram daqui.
  const load = useCallback(async () => {
    try {
      setPromos(await api.promotions.list()); setError(null);
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
    try { await runBulk({ title: 'A eliminar promoções', items: [...selected], run: ([id]) => api.promotions.remove(id) }); setSelected(new Set()); await load(); }
    finally { setBulkBusy(false); }
  };

  return (
    <div className="vd-page">
      {/* Como os Talões de Desconto do Vendus: caminho, Adicionar + Campanhas, pesquisa e lista. */}
      <div className="vd-head">
        <p className="vd-crumb"><span>Promoções</span></p>
        <span className="spacer" />
        <button className="vd-btn" onClick={() => setCreating(true)}><IconPlus size={16} /> Adicionar Promoção</button>
        <button className="vd-btn outline" onClick={() => document.getElementById('promo-campanhas')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Cupões e Campanhas</button>
      </div>
      {error ? <div className="vd-err" role="alert">{error}</div> : null}

      <form className="vd-card vd-filters" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <div className="vd-frow" style={{ alignItems: 'center' }}>
          <label className="vd-f grow"><input className="vd-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisa por nome" aria-label="Pesquisar promoções" /></label>
          <label className="vd-f"><select className="vd-in" value={state} onChange={(e) => setState(e.target.value as '' | 'on' | 'off')} aria-label="Estado">
            <option value="">Todos</option><option value="on">Ativas</option><option value="off">Inativas</option>
          </select></label>
          <button type="submit" className="vd-btn"><IconSearch size={15} /> Pesquisar</button>
        </div>
      </form>

      <div className="vd-card vd-tablecard">
        {selected.size > 0 ? (
          <div className="vd-bulk"><strong>{selected.size} selecionada(s)</strong><span className="spacer" />
            <button className="vd-btn plain sm" onClick={() => setSelected(new Set())} disabled={bulkBusy}>Limpar</button>
            <button className="vd-btn danger sm" onClick={() => void bulkDelete()} disabled={bulkBusy}>Eliminar</button></div>
        ) : null}
        {loading ? <div className="vd-empty">A carregar…</div> : list.length === 0 ? (
          term || state ? <div className="vd-empty">Sem resultados.</div> : (
            <div className="pu-noreg"><IconStar size={56} /><strong>Não existem registos</strong><span>Ainda não adicionou nenhum registo em Promoções? (ex.: «3x2» ou «10% às quartas»)</span>
              <button className="vd-btn outline" onClick={() => setCreating(true)}><IconPlus size={16} /> Adicionar Promoção</button></div>
          )
        ) : (
          <div className="vd-tablewrap">
            <table className="vd-table">
              <thead><tr>
                <th className="chk"><input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Selecionar todas" /></th>
                <th>Nome</th><th>Tipo</th><th>Desconto</th><th>Ativa</th><th aria-label="Ações" />
              </tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td className="chk"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSel(p.id)} aria-label={`Selecionar ${p.name}`} /></td>
                    <td><strong>{p.name}</strong></td>
                    <td>{TYPE_LABEL[p.type]}</td>
                    <td>{describe(p)}</td>
                    <td><Switch checked={p.is_active} onChange={() => toggle(p)} /></td>
                    <td className="num"><button className="vd-btn plain sm" onClick={() => remove(p)} aria-label={`Remover ${p.name}`}><IconTrash size={15} /> Remover</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div id="promo-campanhas" />
      <CouponsCard />
      <MembersCard />
      <BannersCard />
      <AffiliatesCard />

      {creating ? <PromoEditor onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} /> : null}
    </div>
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
  const [endsAt, setEndsAt] = useState('');
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
      if (endsAt) dto.endsAt = new Date(endsAt).toISOString();
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
      <div className="field"><label>Termina em</label><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></div>
      <button className="btn lg block" style={{ marginTop: 12 }} onClick={save} disabled={saving}>{saving ? 'A guardar…' : 'Criar promoção'}</button>
    </Modal>
  );
}
