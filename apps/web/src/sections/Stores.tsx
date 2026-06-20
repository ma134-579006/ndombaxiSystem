import { confirmDialog } from '../components/feedback';
import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CreateStoreInput, ManagerStore } from '../api/types';
import { IconPlus, IconRefresh, IconStore, IconEdit } from '../components/Icons';
import { Modal, Switch } from '../components/ui';

/** Lojas da empresa (multi-loja / lojas filhas). Criar/editar exige administrador.
 *  Suporta seleção em massa → Desativar / Eliminar (a principal nunca; com
 *  histórico fica apenas desativada — igual ao padrão dos Produtos). */
export function Stores() {
  const [items, setItems] = useState<ManagerStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManagerStore | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await api.staff.listStores()); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar lojas.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggleSel = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectable = items.filter((s) => !s.is_default); // a principal nunca é selecionável
  const allSel = selectable.length > 0 && selectable.every((s) => selected.has(s.id));
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(selectable.map((s) => s.id)));

  const bulkDeactivate = async () => {
    setBulkBusy(true); setError(null); setInfo(null);
    let done = 0, skipped = 0;
    try {
      for (const id of selected) {
        const st = items.find((s) => s.id === id);
        if (!st || st.is_default) { skipped++; continue; } // a principal nunca
        await api.staff.updateStore(id, { isActive: false });
        done++;
      }
      setSelected(new Set()); await load();
      setInfo(`${done} loja(s) desativada(s).${skipped ? ` A loja principal não pode ser desativada (${skipped} ignorada).` : ''}`);
    } catch (er) { setError(er instanceof ApiError ? er.message : 'Falha ao desativar.'); }
    finally { setBulkBusy(false); }
  };

  const bulkDelete = async () => {
    if (!(await confirmDialog({ message: `Eliminar ${selected.size} loja(s)? As que têm vendas/stock/equipa ficam apenas desativadas.`, danger: true }))) return;
    setBulkBusy(true); setError(null); setInfo(null);
    let del = 0, deact = 0, skipped = 0;
    try {
      for (const id of selected) {
        const st = items.find((s) => s.id === id);
        if (!st || st.is_default) { skipped++; continue; }
        const r = await api.staff.deleteStore(id);
        if (r.deleted) del++; else deact++;
      }
      setSelected(new Set()); await load();
      setInfo(`${del} eliminada(s)${deact ? `; ${deact} com histórico ficaram desativadas` : ''}.${skipped ? ' A loja principal foi ignorada.' : ''}`);
    } catch (er) { setError(er instanceof ApiError ? er.message : 'Falha ao eliminar.'); }
    finally { setBulkBusy(false); }
  };

  return (
    <>
      <div className="content-head">
        <h2>Lojas da empresa</h2>
        <span className="muted" style={{ fontSize: 13 }}>{items.length} loja(s)</span>
        {selectable.length > 0 ? (
          <label className="row" style={{ gap: 6, fontSize: 12.5, whiteSpace: 'nowrap', cursor: 'pointer', marginLeft: 8 }}>
            <input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Selecionar todas" /> Todas
          </label>
        ) : null}
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
        <button className="btn" onClick={() => setCreating(true)}><IconPlus size={18} /> Nova loja</button>
      </div>

      {selected.size > 0 ? (
        <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px', marginBottom: 12 }}>
          <strong>{selected.size} selecionada(s)</strong>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => setSelected(new Set())} disabled={bulkBusy}>Limpar</button>
          <button className="btn sm warn" onClick={bulkDeactivate} disabled={bulkBusy}>Desativar</button>
          <button className="btn sm danger" onClick={bulkDelete} disabled={bulkBusy}>Eliminar</button>
        </div>
      ) : null}

      {info ? <div className="banner success">{info}</div> : null}
      {error ? <div className="banner danger">{error}</div> : null}

      {loading ? <div className="card"><div className="loading">A carregar…</div></div>
        : items.length === 0 ? (
          <div className="card"><div className="empty"><IconStore size={40} /><p>Ainda só tens a loja principal. Cria as lojas filhas aqui.</p></div></div>
        ) : (
          <div className="pgrid">
            {items.map((s) => (
              <div className={`pcard${selected.has(s.id) ? ' sel' : ''}`} key={s.id}>
                {!s.is_default ? (
                  <label className="pcard-check" onClick={(ev) => ev.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSel(s.id)} />
                  </label>
                ) : null}
                <div className="thumb"><IconStore size={30} /></div>
                <div className="pinfo">
                  <div className="pname">{s.name} {s.is_default ? <span className="pill on">Principal</span> : null}</div>
                  <div className="pcode">{s.code}{s.address ? ` · ${s.address}` : ''}</div>
                  <div className="pfoot">
                    <span className={`pill ${s.is_active ? 'on' : 'off'}`}>{s.is_active ? 'Activa' : 'Inactiva'}</span>
                  </div>
                  <button className="btn sm ghost block" style={{ marginTop: 8 }} onClick={() => setEditing(s)}><IconEdit size={15} /> Editar</button>
                </div>
              </div>
            ))}
          </div>
        )}

      {creating ? <StoreModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} /> : null}
      {editing ? <StoreModal store={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
    </>
  );
}

function StoreModal({ store, onClose, onSaved }: { store?: ManagerStore; onClose(): void; onSaved(): void }) {
  const [code, setCode] = useState(store?.code ?? '');
  const [name, setName] = useState(store?.name ?? '');
  const [address, setAddress] = useState(store?.address ?? '');
  const [isDefault, setIsDefault] = useState(store?.is_default ?? false);
  const [isActive, setIsActive] = useState(store?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    if (!name.trim()) { setErr('Indique o nome da loja.'); return; }
    setBusy(true);
    try {
      if (store) {
        await api.staff.updateStore(store.id, { name: name.trim(), address: address.trim() || undefined, isActive, isDefault });
      } else {
        if (!/^[A-Za-z0-9-]{2,20}$/.test(code.trim())) { setErr('Código inválido (2-20: letras, números, hífen).'); setBusy(false); return; }
        const payload: CreateStoreInput = { code: code.trim(), name: name.trim(), address: address.trim() || undefined, isDefault };
        await api.staff.createStore(payload);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível guardar (precisa de ser administrador).');
    } finally { setBusy(false); }
  };

  return (
    <Modal title={store ? 'Editar loja' : 'Nova loja'} onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      {!store ? (
        <div className="field"><label>Código (único)</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ex.: LOJA2" /></div>
      ) : null}
      <div className="field"><label>Nome</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Loja do Talatona" /></div>
      <div className="field"><label>Morada</label>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Opcional" /></div>
      <div className="switch-row"><span>Loja principal</span><Switch checked={isDefault} onChange={setIsDefault} /></div>
      {store ? <div className="switch-row"><span>Activa</span><Switch checked={isActive} onChange={setIsActive} /></div> : null}
      <button className="btn lg block" style={{ marginTop: 14 }} onClick={save} disabled={busy}>
        {busy ? 'A guardar…' : store ? 'Guardar alterações' : 'Criar loja'}
      </button>
    </Modal>
  );
}
