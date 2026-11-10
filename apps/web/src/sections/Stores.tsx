import { confirmDialog, toast } from '../components/feedback';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CreateStoreInput, DeviceRow, ManagerStore } from '../api/types';
import { RegisterForm } from './Registers';
import { Modal, Switch } from '../components/ui';

/** Lojas da empresa (multi-loja / lojas filhas). Criar/editar exige administrador.
 *  Suporta seleção em massa → Desativar / Eliminar (a principal nunca; com
 *  histórico fica apenas desativada — igual ao padrão dos Produtos). */
export function Stores() {
  const [items, setItems] = useState<ManagerStore[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManagerStore | null>(null);
  const [creating, setCreating] = useState(false);
  const [editReg, setEditReg] = useState<DeviceRow | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [s, d] = await Promise.all([api.staff.listStores(), api.devices.list().catch(() => [] as DeviceRow[])]);
      setItems(s); setDevices(d);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar lojas.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);

  const toggleActive = async (s: ManagerStore) => {
    setMenu(null);
    if (s.is_default) { toast.error('A loja principal não pode ser desativada.'); return; }
    try { await api.staff.updateStore(s.id, { isActive: !s.is_active }); toast.success(s.is_active ? 'Loja desativada.' : 'Loja ativada.'); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível alterar a loja.'); }
  };
  const remove = async (s: ManagerStore) => {
    setMenu(null);
    if (s.is_default) { toast.error('A loja principal não pode ser eliminada.'); return; }
    if (!(await confirmDialog({ message: `Eliminar a loja "${s.name}"? Com vendas, stock ou equipa fica apenas desativada.`, danger: true }))) return;
    try { const r = await api.staff.deleteStore(s.id); toast.success(r.deleted ? 'Loja eliminada.' : 'Loja com histórico: ficou desativada.'); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível eliminar a loja.'); }
  };
  const fmtDT = (v: string | null) => (v ? new Date(v).toLocaleDateString('pt-PT') : '—');

  // Modelo do backoffice de referência: um cartão por loja (nome + Opções) com a
  // tabela das suas caixas; "Adicionar Loja" no topo.
  const orphan = devices.filter((d) => !d.store_id || !items.some((s) => s.id === d.store_id));
  return (
    <div className="vd-page">
      <div className="vd-head">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Definições</span><span className="sep">/</span><span>Lojas</span></p>
        <span className="spacer" />
        <button className="vd-btn" onClick={() => setCreating(true)}>+ Adicionar Loja</button>
      </div>
      {error ? <div className="vd-err" role="alert">{error}</div> : null}
      {loading ? <div className="vd-card vd-empty">A carregar…</div> : (
        <>
          {items.map((s) => {
            const regs = devices.filter((d) => d.store_id === s.id);
            return (
              <section className="vd-card st-card" key={s.id}>
                <div className="st-head">
                  <h3>{s.name}{s.is_default ? <span className="vd-tag ok" style={{ marginLeft: 10 }}>Principal</span> : null}{!s.is_active ? <span className="vd-tag bad" style={{ marginLeft: 10 }}>Inativa</span> : null}</h3>
                  <span className="spacer" />
                  <div className="vd-opts" ref={menu === s.id ? menuRef : undefined}>
                    <button className="vd-btn outline" aria-expanded={menu === s.id} onClick={() => setMenu((m) => (m === s.id ? null : s.id))}>Opções ▾</button>
                    {menu === s.id ? (
                      <div className="vd-drop" role="menu">
                        <button role="menuitem" onClick={() => { setMenu(null); setEditing(s); }}>Editar</button>
                        {!s.is_default ? <button role="menuitem" onClick={() => void toggleActive(s)}>{s.is_active ? 'Desativar' : 'Ativar'}</button> : null}
                        {!s.is_default ? <><hr /><button role="menuitem" className="danger" onClick={() => void remove(s)}>Eliminar</button></> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                {s.address ? <p className="st-sub">{s.code} · {s.address}</p> : <p className="st-sub">{s.code}</p>}
                <table className="vd-table st-regs">
                  <thead><tr><th>Caixa</th><th>Série</th><th>Última atividade</th><th>Estado</th><th aria-label="Opções" /></tr></thead>
                  <tbody>
                    {regs.length === 0 ? <tr><td colSpan={5} className="st-none">Sem caixas</td></tr> : regs.map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td>{r.series}</td>
                        <td style={{ color: 'var(--primary)' }}>{fmtDT(r.last_seen_at)}</td>
                        <td>{r.is_active ? '✓ Ativa' : 'Inativa'}</td>
                        <td className="num"><button className="vd-btn plain sm-opt" onClick={() => setEditReg(r)}>Editar</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
          {orphan.length ? (
            <section className="vd-card st-card">
              <div className="st-head"><h3>Caixas sem loja</h3></div>
              <table className="vd-table st-regs">
                <thead><tr><th>Caixa</th><th>Série</th><th>Última atividade</th><th>Estado</th><th aria-label="Opções" /></tr></thead>
                <tbody>
                  {orphan.map((r) => (
                    <tr key={r.id}><td>{r.name}</td><td>{r.series}</td><td style={{ color: 'var(--primary)' }}>{fmtDT(r.last_seen_at)}</td><td>{r.is_active ? '✓ Ativa' : 'Inativa'}</td>
                      <td className="num"><button className="vd-btn plain sm-opt" onClick={() => setEditReg(r)}>Editar</button></td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </>
      )}

      {creating ? <StoreModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); toast.success('Loja criada.'); void load(); }} /> : null}
      {editing ? <StoreModal store={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast.success('Loja guardada.'); void load(); }} /> : null}
      {editReg ? <RegisterForm row={editReg} stores={items} onClose={() => setEditReg(null)} onSaved={() => { setEditReg(null); toast.success('Caixa guardada.'); void load(); }} /> : null}
    </div>
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
