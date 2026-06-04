import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import {
  STAFF_ROLES, STAFF_ROLE_LABELS,
  type CreateStaffInput, type ManagerStaff, type ManagerStore, type StaffRoleName,
} from '../api/types';
import { IconPlus, IconRefresh, IconBuilding, IconLock, IconEdit, IconShield } from '../components/Icons';
import { Modal } from '../components/ui';

/** Equipa: utilizadores, papéis (permissões), senha, PIN do POS e loja.
 *  Aqui criam-se os acessos — incluindo os Operadores de caixa (POS). */
export function Team() {
  const [users, setUsers] = useState<ManagerStaff[]>([]);
  const [stores, setStores] = useState<ManagerStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ManagerStaff | null>(null);
  const [pinFor, setPinFor] = useState<ManagerStaff | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const storeName = (id: string | null) => stores.find((s) => s.id === id)?.name ?? '—';

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [u, s] = await Promise.all([api.staff.listUsers(), api.staff.listStores().catch(() => [])]);
      setUsers(u); setStores(s);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar a equipa.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const resetPwd = async (u: ManagerStaff) => {
    if (!window.confirm(`Repor a senha de ${u.name}?`)) return;
    setBusyId(u.id);
    try {
      const r = await api.staff.resetPassword(u.id);
      setInfo(`Senha temporária de ${u.email}: ${r.temporaryPassword ?? '(definida)'} — guarde-a, só aparece agora.`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível repor a senha.'); }
    finally { setBusyId(null); }
  };

  const deactivate = async (u: ManagerStaff) => {
    if (!window.confirm(`Desativar ${u.name}? Deixa de poder entrar.`)) return;
    setBusyId(u.id);
    try { await api.staff.deactivate(u.id); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível desativar.'); }
    finally { setBusyId(null); }
  };

  return (
    <>
      <div className="content-head">
        <h2>Equipa & acessos</h2>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
        <button className="btn" onClick={() => setCreating(true)}><IconPlus size={18} /> Novo utilizador</button>
      </div>

      {info ? <div className="banner success">{info}</div> : null}
      {error ? <div className="banner danger">{error}</div> : null}

      <div className="card">
        {loading ? <div className="loading">A carregar…</div>
          : users.length === 0 ? <div className="empty"><IconBuilding size={40} /><p>Sem utilizadores. Cria o primeiro acesso.</p></div>
          : (
            <table className="ptable stack">
              <thead><tr><th>Nome</th><th>Email</th><th>Papel</th><th>Loja</th><th>PIN</th><th>Estado</th><th className="no-print" /></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td data-label="Nome">{u.name}</td>
                    <td data-label="Email">{u.email}</td>
                    <td data-label="Papel"><span className="pill"><IconShield size={12} /> {STAFF_ROLE_LABELS[u.role] ?? u.role}</span></td>
                    <td data-label="Loja">{storeName(u.store_id)}</td>
                    <td data-label="PIN">{u.has_pin ? <span className="pill on">Sim</span> : <span className="pill">—</span>}</td>
                    <td data-label="Estado"><span className={`pill ${u.is_active ? 'on' : 'off'}`}>{u.is_active ? 'Activo' : 'Inactivo'}</span></td>
                    <td className="actions no-print">
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button className="btn sm ghost" disabled={busyId === u.id} onClick={() => setEditing(u)} title="Editar papel/loja"><IconEdit size={14} /></button>
                        <button className="btn sm ghost" disabled={busyId === u.id} onClick={() => setPinFor(u)} title="Definir PIN do POS"><IconLock size={14} /></button>
                        <button className="btn sm ghost" disabled={busyId === u.id} onClick={() => resetPwd(u)}>Repor senha</button>
                        {u.is_active ? <button className="btn sm danger" disabled={busyId === u.id} onClick={() => deactivate(u)}>Desativar</button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {creating ? <CreateModal stores={stores} onClose={() => setCreating(false)} onCreated={(temp) => { setCreating(false); if (temp) setInfo(`Senha temporária: ${temp} — entregue ao funcionário (só aparece agora).`); void load(); }} /> : null}
      {editing ? <EditModal user={editing} stores={stores} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
      {pinFor ? <PinModal user={pinFor} onClose={() => setPinFor(null)} onSaved={() => { setPinFor(null); setInfo('PIN definido.'); void load(); }} /> : null}
    </>
  );
}

function CreateModal({ stores, onClose, onCreated }: { stores: ManagerStore[]; onClose(): void; onCreated(temp?: string): void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRoleName>('CASHIER');
  const [storeId, setStoreId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!name.trim()) { setErr('Indique o nome.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('Email inválido.'); return; }
    if (pin && !/^\d{6}$/.test(pin)) { setErr('O PIN deve ter 6 dígitos.'); return; }
    setBusy(true);
    try {
      const payload: CreateStaffInput = { name: name.trim(), email: email.trim().toLowerCase(), role, storeId: storeId || undefined, pin: pin || undefined };
      const r = await api.staff.createUser(payload);
      onCreated(r.temporaryPassword);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível criar (precisa de ser administrador).'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Novo utilizador / acesso" onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="field"><label>Nome</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label>Email (serve de login)</label><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.ao" /></div>
      <div className="grid-2">
        <div className="field"><label>Papel (permissão)</label>
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRoleName)}>
            {STAFF_ROLES.map((r) => <option key={r} value={r}>{STAFF_ROLE_LABELS[r]}</option>)}
          </select></div>
        <div className="field"><label>Loja</label>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">(sem loja específica)</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
      </div>
      <div className="field"><label>PIN do POS (6 dígitos, opcional)</label>
        <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="ex.: 123456" /></div>
      <p className="muted" style={{ fontSize: 12 }}>A senha é gerada automaticamente e mostrada uma vez (se não definires uma).</p>
      <button className="btn lg block" style={{ marginTop: 8 }} onClick={submit} disabled={busy}>{busy ? 'A criar…' : 'Criar acesso'}</button>
    </Modal>
  );
}

function EditModal({ user, stores, onClose, onSaved }: { user: ManagerStaff; stores: ManagerStore[]; onClose(): void; onSaved(): void }) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<StaffRoleName>(user.role);
  const [storeId, setStoreId] = useState(user.store_id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api.staff.updateUser(user.id, { name: name.trim(), role, storeId: storeId || undefined });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Editar — ${user.name}`} onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="field"><label>Nome</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="grid-2">
        <div className="field"><label>Papel (permissão)</label>
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRoleName)}>
            {STAFF_ROLES.map((r) => <option key={r} value={r}>{STAFF_ROLE_LABELS[r]}</option>)}
          </select></div>
        <div className="field"><label>Loja</label>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">(sem loja específica)</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
      </div>
      <button className="btn lg block" style={{ marginTop: 12 }} onClick={submit} disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</button>
    </Modal>
  );
}

function PinModal({ user, onClose, onSaved }: { user: ManagerStaff; onClose(): void; onSaved(): void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!/^\d{6}$/.test(pin)) { setErr('O PIN deve ter exatamente 6 dígitos.'); return; }
    setBusy(true); setErr(null);
    try { await api.staff.setPin(user.id, pin); onSaved(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível definir o PIN.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={`PIN do POS — ${user.name}`} onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="field"><label>PIN (6 dígitos)</label>
        <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="••••••" autoFocus /></div>
      <button className="btn lg block" style={{ marginTop: 12 }} onClick={submit} disabled={busy}>{busy ? 'A definir…' : 'Definir PIN'}</button>
    </Modal>
  );
}
