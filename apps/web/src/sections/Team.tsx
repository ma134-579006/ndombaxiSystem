import { confirmDialog } from '../components/feedback';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import {
  STAFF_ROLES, STAFF_ROLE_LABELS,
  type CreateStaffInput, type ManagerStaff, type ManagerStore, type StaffRoleName,
} from '../api/types';
import { IconPlus } from '../components/Icons';
import { PermissionsTable, type PermArea } from '../components/PermissionsTable';
import { Modal } from '../components/ui';

/** Configuração › Utilizadores (como no Vendus): contas de acesso com Nome, Email,
 *  Perfil, Estado e «Opções» (editar, PIN da caixa, repor senha, desbloquear,
 *  ativar/desativar); «Adicionar Utilizador» e «Perfis de Utilizadores». */
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
  const [q, setQ] = useState('');
  const [perms, setPerms] = useState<PermArea[] | null>(null);
  const openPerms = async () => {
    const { TENANT_NAV } = await import('../App');
    const out: PermArea[] = [];
    for (const n of TENANT_NAV) {
      if (n.children?.length) for (const c of n.children) out.push({ label: c.label, group: n.label, min: c.min ?? n.min });
      else out.push({ label: n.label, min: n.min });
    }
    setPerms(out);
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const [u, s] = await Promise.all([api.staff.listUsers(), api.staff.listStores().catch(() => [])]);
      setUsers(u); setStores(s);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar os utilizadores.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Painel CONFIG › «Perfis de Utilizadores» abre esta página já com a tabela de permissões.
  useEffect(() => {
    const go = () => { try { sessionStorage.removeItem('lps.users.perms'); } catch { /* */ } void openPerms(); };
    try { if (sessionStorage.getItem('lps.users.perms')) go(); } catch { /* */ }
    window.addEventListener('lps:users-perms', go);
    return () => window.removeEventListener('lps:users-perms', go);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (u: ManagerStaff, fn: () => Promise<unknown>, ok?: string) => {
    setBusyId(u.id); setError(null);
    try { await fn(); if (ok) setInfo(ok); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível concluir a operação.'); }
    finally { setBusyId(null); }
  };
  const resetPwd = async (u: ManagerStaff) => {
    if (!(await confirmDialog({ message: `Repor a senha de ${u.name}?` }))) return;
    setBusyId(u.id);
    try {
      const r = await api.staff.resetPassword(u.id);
      setInfo(`Senha temporária de ${u.email}: ${r.temporaryPassword ?? '(definida)'} — guarde-a, só aparece agora.`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível repor a senha.'); }
    finally { setBusyId(null); }
  };
  const deactivate = async (u: ManagerStaff) => {
    if (!(await confirmDialog({ message: `Desativar ${u.name}? Deixa de poder entrar.`, danger: true }))) return;
    await run(u, () => api.staff.deactivate(u.id), `${u.name} desativado.`);
  };

  const term = q.trim().toLowerCase();
  const list = users.filter((u) => !term || `${u.name} ${u.email} ${STAFF_ROLE_LABELS[u.role] ?? u.role}`.toLowerCase().includes(term))
    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name));
  const locked = (u: ManagerStaff) => !!u.locked_until && Date.parse(u.locked_until) > Date.now();

  return (
    <div className="vd-page us-page">
      <div className="vd-head">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Configuração</span><span className="sep">/</span><span>Utilizadores</span></p>
        <span className="spacer" />
        <button className="vd-btn ok" onClick={() => setCreating(true)}><IconPlus size={16} /> Adicionar Utilizador</button>
        <button className="vd-btn outline" onClick={() => void openPerms()}>Perfis de Utilizadores</button>
      </div>
      {info ? <div className="vd-ok" role="status">{info}</div> : null}
      {error ? <div className="vd-err" role="alert">{error}</div> : null}

      <div className="vd-card vd-filters">
        <label className="vd-f grow"><input className="vd-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisa por nome, email ou perfil" aria-label="Pesquisar utilizadores" /></label>
      </div>

      <div className="vd-card us-card">
        {loading ? <div className="vd-empty">A carregar…</div>
          : list.length === 0 ? <div className="vd-empty">{term ? 'Sem resultados.' : 'Ainda não há utilizadores.'}</div>
          : (
            <table className="ptable acc-table us-table">
              <thead><tr><th>Nome</th><th>Email</th><th>Perfil</th><th>Estado</th><th aria-label="Opções" /></tr></thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id}>
                    <td className="wrap"><button type="button" className="us-name" onClick={() => setEditing(u)}>{u.name}</button>
                      {u.store_id ? <span className="acc-sub">{stores.find((s) => s.id === u.store_id)?.name ?? ''}</span> : null}</td>
                    <td className="wrap">{u.email}</td>
                    <td>{STAFF_ROLE_LABELS[u.role] ?? u.role}{u.has_pin ? <span className="acc-sub">PIN da caixa definido</span> : null}</td>
                    <td className="nw"><span className={u.is_active ? 'us-on' : 'us-off'}>{u.is_active ? 'Ativo' : 'Inativo'}</span>{locked(u) ? <span className="acc-sub us-lock">Bloqueado</span> : null}</td>
                    <td className="num">
                      <Options disabled={busyId === u.id} items={[
                        { label: 'Editar', act: () => setEditing(u) },
                        { label: 'PIN da caixa', act: () => setPinFor(u) },
                        { label: 'Repor senha', act: () => void resetPwd(u) },
                        ...(locked(u) ? [{ label: 'Desbloquear', act: () => void run(u, () => api.staff.unlock(u.id), `Acesso de ${u.name} desbloqueado.`) }] : []),
                        u.is_active
                          ? { label: 'Desativar', danger: true, act: () => void deactivate(u) }
                          : { label: 'Ativar', act: () => void run(u, () => api.staff.updateUser(u.id, { isActive: true }), `${u.name} ativado.`) },
                      ]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {perms ? <PermissionsTable areas={perms} onClose={() => setPerms(null)} /> : null}
      {creating ? <CreateModal stores={stores} onClose={() => setCreating(false)} onCreated={(temp) => { setCreating(false); if (temp) setInfo(`Senha temporária: ${temp} — entregue ao utilizador (só aparece agora).`); void load(); }} /> : null}
      {editing ? <EditModal user={editing} stores={stores} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
      {pinFor ? <PinModal user={pinFor} onClose={() => setPinFor(null)} onSaved={() => { setPinFor(null); setInfo('PIN definido.'); void load(); }} /> : null}
    </div>
  );
}

/** Botão «Opções» com menu (como no Vendus). */
function Options({ items, disabled }: { items: { label: string; act: () => void; danger?: boolean }[]; disabled?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && ref.current?.open) ref.current.open = false; };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, []);
  return (
    <details ref={ref} className="us-opt">
      <summary className="vd-btn plain sm" aria-disabled={disabled}>Opções</summary>
      <div className="us-opt-list" role="menu">
        {items.map((it) => (
          <button key={it.label} type="button" role="menuitem" className={it.danger ? 'danger' : undefined} disabled={disabled}
            onClick={() => { if (ref.current) ref.current.open = false; it.act(); }}>{it.label}</button>
        ))}
      </div>
    </details>
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
