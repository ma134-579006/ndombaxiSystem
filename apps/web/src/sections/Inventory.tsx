import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { StockCountDetail, StockCountRow, WarehouseRow } from '../api/types';
import { Modal } from '../components/ui';
import { IconCheck, IconCube, IconPlus } from '../components/Icons';

/** Inventário profissional: contagens (snapshot→contagem→ajuste) + baixa de stock. */
export function Inventory() {
  const [counts, setCounts] = useState<StockCountRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openCount, setOpenCount] = useState<StockCountDetail | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, w] = await Promise.all([api.inventory.listCounts(), api.inventory.warehouses()]);
      setCounts(c); setWarehouses(w); setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async (warehouseId: string) => {
    try {
      const r = await api.inventory.createCount(warehouseId);
      setCreating(false);
      const detail = await api.inventory.getCount(r.id);
      setOpenCount(detail);
      await load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Falha ao criar contagem.');
    }
  };

  return (
    <>
      <div className="content-head">
        <h2>Inventário</h2>
        <span className="spacer" />
        <button className="btn" onClick={() => setCreating(true)} disabled={warehouses.length === 0}>
          <IconPlus size={16} /> Nova contagem
        </button>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}

      <div className="card">
        <h3>Contagens de inventário</h3>
        {loading ? <div className="loading">A carregar…</div> : counts.length === 0 ? (
          <div className="empty"><IconCube size={40} /><p>Sem contagens. Crie uma para conferir o stock.</p></div>
        ) : counts.map((c) => (
          <div className="list-row" key={c.id} style={{ cursor: 'pointer' }} onClick={async () => setOpenCount(await api.inventory.getCount(c.id))}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{c.reference} <span className="muted" style={{ fontWeight: 500 }}>· {c.warehouse_name}</span></div>
              <div className="muted" style={{ fontSize: 13 }}>{c.items} artigos · {new Date(c.created_at).toLocaleDateString('pt-PT')}</div>
            </div>
            <span className="badge" style={{ color: c.status === 'CLOSED' ? 'var(--success)' : 'var(--warning)', borderColor: 'currentColor' }}>
              {c.status === 'CLOSED' ? 'Fechada' : 'A contar'}
            </span>
          </div>
        ))}
      </div>

      {creating ? (
        <Modal title="Nova contagem de inventário" onClose={() => setCreating(false)}>
          <p className="muted" style={{ marginTop: 0 }}>Escolha o armazém a inventariar:</p>
          {warehouses.map((w) => (
            <button key={w.id} className="btn ghost block" style={{ marginBottom: 8 }} onClick={() => create(w.id)}>
              {w.name} {w.is_default ? '(principal)' : ''}
            </button>
          ))}
        </Modal>
      ) : null}

      {openCount ? <CountSheet detail={openCount} onClose={() => { setOpenCount(null); void load(); }} /> : null}
    </>
  );
}

function CountSheet({ detail, onClose }: { detail: StockCountDetail; onClose(): void }) {
  const [items, setItems] = useState(detail.items);
  const [status, setStatus] = useState(detail.status);
  const [busy, setBusy] = useState(false);

  const setCounted = async (productId: string, value: string) => {
    const counted = Number(value);
    setItems((prev) => prev.map((it) => it.product_id === productId
      ? { ...it, counted_qty: value, difference: String(counted - Number(it.system_qty)) } : it));
    if (value !== '') {
      try { await api.inventory.countItem(detail.id, productId, counted); } catch { /* best-effort */ }
    }
  };

  const close = async () => {
    if (!window.confirm('Fechar a contagem e aplicar os ajustes ao stock?')) return;
    setBusy(true);
    try {
      const r = await api.inventory.closeCount(detail.id);
      alert(`Contagem fechada. ${r.adjusted} produto(s) ajustado(s).`);
      setStatus('CLOSED');
      onClose();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Falha ao fechar.');
    } finally { setBusy(false); }
  };

  const counted = items.filter((i) => i.counted_qty != null && i.counted_qty !== '').length;
  const divergent = items.filter((i) => i.difference != null && Number(i.difference) !== 0).length;

  return (
    <Modal title={`Contagem ${detail.reference}`} onClose={onClose}>
      <div className="row" style={{ gap: 14, marginBottom: 12, fontSize: 13 }}>
        <span className="muted">{counted}/{items.length} contados</span>
        <span style={{ color: divergent ? 'var(--warning)' : 'var(--success)' }}>{divergent} divergências</span>
      </div>
      <div style={{ maxHeight: '52vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it) => {
          const diff = it.difference != null && it.counted_qty != null && it.counted_qty !== '' ? Number(it.difference) : null;
          return (
            <div key={it.id} className="list-row" style={{ padding: '8px 0' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{it.description}</div>
                <div className="muted" style={{ fontSize: 12 }}>{it.product_code} · sistema {Number(it.system_qty)}</div>
              </div>
              {diff != null && diff !== 0 ? (
                <span style={{ fontSize: 12, fontWeight: 700, color: diff < 0 ? 'var(--danger)' : 'var(--warning)' }}>{diff > 0 ? '+' : ''}{diff}</span>
              ) : null}
              <input
                disabled={status === 'CLOSED'}
                style={{ width: 90, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px', color: 'var(--text)', textAlign: 'right' }}
                inputMode="decimal" placeholder="—"
                defaultValue={it.counted_qty ?? ''}
                onBlur={(e) => setCounted(it.product_id, e.target.value)}
              />
            </div>
          );
        })}
      </div>
      {status !== 'CLOSED' ? (
        <button className="btn lg block" style={{ marginTop: 14 }} onClick={close} disabled={busy}>
          <IconCheck size={18} /> {busy ? 'A fechar…' : 'Fechar contagem e ajustar stock'}
        </button>
      ) : <div className="banner success" style={{ marginTop: 14 }}>Contagem fechada.</div>}
    </Modal>
  );
}
