import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { DeviceRow, DeviceSettings, ManagerStore } from '../api/types';
import { toast } from '../components/feedback';
import { Modal } from '../components/ui';

/**
 * Caixas (postos) por loja, no modelo "Definições da caixa" do backoffice de
 * referência. Cada caixa nasce sozinha quando o POS arranca num aparelho; aqui
 * dá-se-lhe nome, loja e as definições que o POS aplica. A série fiscal é
 * mostrada mas nunca se altera (cadeia de hash da AGT).
 */
const PLATFORM: Record<string, string> = { windows: 'Windows', android: 'Android', ios: 'iPhone/iPad', web: 'Navegador' };
const fmtDT = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export function Registers() {
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [stores, setStores] = useState<ManagerStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DeviceRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [d, s] = await Promise.all([api.devices.list(), api.staff.listStores()]);
      setRows(d); setStores(s);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível carregar as caixas.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Agrupadas por loja (como o menu do backoffice: Loja → caixas).
  const groups = useMemo(() => {
    const by = new Map<string, { name: string; items: DeviceRow[] }>();
    for (const s of stores) by.set(s.id, { name: s.name, items: [] });
    const none = { name: 'Sem loja', items: [] as DeviceRow[] };
    for (const r of rows) (r.store_id && by.get(r.store_id) ? by.get(r.store_id)!.items : none.items).push(r);
    const out = [...by.values()].filter((g) => g.items.length > 0);
    if (none.items.length) out.push(none);
    return out;
  }, [rows, stores]);

  return (
    <div className="vd-page">
      <div className="vd-head">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Caixas</span><span className="sep">/</span><span>Lojas</span></p>
      </div>
      {error ? <div className="vd-err" role="alert">{error}</div> : null}
      {loading ? <div className="vd-card vd-empty">A carregar caixas…</div>
        : rows.length === 0 ? <div className="vd-card vd-empty">Sem caixas registadas.</div>
        : groups.map((g) => (
          <div className="vd-card" key={g.name} style={{ marginBottom: 14 }}>
            <p className="vd-sect">{g.name}</p>
            <table className="vd-table">
              <thead><tr><th>Caixa</th><th>Plataforma</th><th>Série</th><th>Documento</th><th>Última atividade</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {g.items.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.name}</b></td>
                    <td>{PLATFORM[r.platform] ?? r.platform}</td>
                    <td>{r.series}</td>
                    <td>{r.settings.defaultDocType === 'FS' ? 'Fatura Simplificada' : 'Fatura'}</td>
                    <td>{fmtDT(r.last_seen_at)}</td>
                    <td>{r.is_active ? <span className="vd-tag ok">Ativa</span> : <span className="vd-tag bad">Inativa</span>}</td>
                    <td className="num"><button className="vd-btn outline" onClick={() => setEditing(r)}>Editar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {editing ? (
        <RegisterForm row={editing} stores={stores} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); toast.success('Caixa guardada.'); void load(); }} />
      ) : null}
    </div>
  );
}

function RegisterForm({ row, stores, onClose, onSaved }: { row: DeviceRow; stores: ManagerStore[]; onClose(): void; onSaved(): void }) {
  const [name, setName] = useState(row.name);
  const [storeId, setStoreId] = useState(row.store_id ?? '');
  const [s, setS] = useState<DeviceSettings>(row.settings);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    if (!name.trim()) { setErr('Indique o nome da caixa.'); return; }
    setBusy(true);
    try {
      await api.devices.update(row.id, { name: name.trim(), storeId: storeId || null, settings: s });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`${row.name} - editar`} onClose={onClose}>
      {err ? <div className="vd-err" role="alert">{err}</div> : null}
      <div className="vd-form">
        <label className="vd-f"><span>Nome da Caixa</span><input className="vd-in" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
        <label className="vd-f"><span>Loja</span><select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">Sem loja</option>
          {stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
        </select></label>
        <label className="vd-f"><span>Série fiscal</span><input className="vd-in" value={row.series} readOnly disabled /></label>
        <label className="vd-f"><span>Documento Predefinido</span><select value={s.defaultDocType} onChange={(e) => setS({ ...s, defaultDocType: e.target.value === 'FS' ? 'FS' : 'FT' })}>
          <option value="FT">Fatura</option><option value="FS">Fatura Simplificada</option>
        </select></label>
        <label className="vd-f"><span>Preços dos Produtos</span><select value={s.pricesWithTax ? '1' : '0'} onChange={(e) => setS({ ...s, pricesWithTax: e.target.value === '1' })}>
          <option value="1">Preços com IVA</option><option value="0">Preços sem IVA</option>
        </select></label>
        <label className="vd-f"><span>Referência dos Produtos</span><select value={s.showReference ? '1' : '0'} onChange={(e) => setS({ ...s, showReference: e.target.value === '1' })}>
          <option value="0">Omitir Referência</option><option value="1">Mostrar Referência</option>
        </select></label>
        <label className="vd-f"><span>Impressão em Papel</span><select value={s.paperWidth ?? ''} onChange={(e) => setS({ ...s, paperWidth: e.target.value === '80' || e.target.value === '58' ? e.target.value : null })}>
          <option value="">Escolha no aparelho</option><option value="80">Talão 80 mm</option><option value="58">Talão 58 mm</option>
        </select></label>
      </div>
      <div className="vd-actions">
        <button className="vd-btn outline" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="vd-btn" onClick={() => void save()} disabled={busy}>{busy ? 'A gravar…' : 'Gravar'}</button>
      </div>
    </Modal>
  );
}
