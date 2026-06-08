import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import {
  STAFF_ROLES, STAFF_ROLE_LABELS,
  type CreateEmployeeInput, type ManagerEmployee, type ManagerStaff, type ManagerStore, type StaffRoleName,
} from '../api/types';
import { IconBuilding, IconEdit, IconImage, IconPlus, IconSearch, IconShield } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz } from '../format';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

interface FormState {
  employeeNumber: string; fullName: string; position: string; department: string;
  baseSalary: string; iban: string; taxId: string; inssNumber: string; photoUrl: string;
}
const EMPTY: FormState = {
  employeeNumber: '', fullName: '', position: '', department: '',
  baseSalary: '', iban: '', taxId: '', inssNumber: '', photoUrl: '',
};

/** Funcionários (RH): ficha com foto (qualquer formato), criar/editar; a foto
 *  aparece no cartão. Criar/editar exige COMPANY_ADMIN (a API valida). */
export function Employees() {
  const [items, setItems] = useState<ManagerEmployee[]>([]);
  const [users, setUsers] = useState<ManagerStaff[]>([]);
  const [stores, setStores] = useState<ManagerStore[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [editing, setEditing] = useState<ManagerEmployee | null>(null);
  const [creating, setCreating] = useState(false);
  const [accessFor, setAccessFor] = useState<ManagerEmployee | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSel = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulkDeactivate = async () => {
    setBulkBusy(true); setError(null);
    try { for (const id of selected) await api.hr.terminateEmployee(id); setSelected(new Set()); await load(); }
    catch (er) { setError(er instanceof ApiError ? er.message : 'Falha ao cessar.'); } finally { setBulkBusy(false); }
  };
  const bulkDelete = async () => {
    if (!window.confirm(`Eliminar ${selected.size} funcionário(s)? Os que têm histórico de folha são apenas cessados.`)) return;
    setBulkBusy(true); setError(null);
    let del = 0, deact = 0;
    try {
      for (const id of selected) { const r = await api.hr.removeEmployee(id); if (r.deleted) del++; else deact++; }
      setSelected(new Set()); await load();
      if (deact > 0) setInfo(`${del} eliminado(s); ${deact} com histórico foram cessados.`);
    } catch (er) { setError(er instanceof ApiError ? er.message : 'Falha ao eliminar.'); } finally { setBulkBusy(false); }
  };

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [emps, us, st] = await Promise.all([
        api.hr.employees(true),
        api.staff.listUsers().catch(() => [] as ManagerStaff[]),
        api.staff.listStores().catch(() => [] as ManagerStore[]),
      ]);
      setItems(emps); setUsers(us); setStores(st);
    }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar funcionários.'); }
    finally { setLoading(false); }
  }, []);

  const usersByName = useMemo(() => {
    const m = new Map<string, ManagerStaff>();
    for (const u of users) m.set(norm(u.name), u);
    return m;
  }, [users]);
  const accessOf = (e: ManagerEmployee) => usersByName.get(norm(e.full_name)) ?? null;

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => { setForm(EMPTY); setFormError(null); setCreating(true); };
  const openEdit = (e: ManagerEmployee) => {
    setForm({
      employeeNumber: e.employee_number, fullName: e.full_name, position: e.position ?? '',
      department: e.department ?? '', baseSalary: e.base_salary, iban: e.iban ?? '',
      taxId: e.tax_id ?? '', inssNumber: e.inss_number ?? '', photoUrl: e.photo_url ?? '',
    });
    setFormError(null); setEditing(e);
  };
  const close = () => { setEditing(null); setCreating(false); };

  const onPickPhoto = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_800_000) { setFormError('Foto demasiado grande (máx. ~1,8 MB).'); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, photoUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setFormError(null);
    if (!form.fullName.trim()) { setFormError('Indique o nome.'); return; }
    const salary = Number(form.baseSalary) || 0;
    setSaving(true);
    try {
      if (editing) {
        await api.hr.updateEmployee(editing.id, {
          fullName: form.fullName.trim(), position: form.position.trim() || undefined,
          department: form.department.trim() || undefined, baseSalary: salary,
          iban: form.iban.trim() || undefined, photoUrl: form.photoUrl || undefined,
        });
      } else {
        if (!form.employeeNumber.trim()) { setFormError('Indique o nº de funcionário.'); setSaving(false); return; }
        const payload: CreateEmployeeInput = {
          employeeNumber: form.employeeNumber.trim(), fullName: form.fullName.trim(),
          position: form.position.trim() || undefined, department: form.department.trim() || undefined,
          baseSalary: salary, iban: form.iban.trim() || undefined,
          taxId: form.taxId.trim() || undefined, inssNumber: form.inssNumber.trim() || undefined,
          photoUrl: form.photoUrl || undefined,
        };
        await api.hr.createEmployee(payload);
      }
      close(); await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Não foi possível guardar (precisa de ser administrador).');
    } finally { setSaving(false); }
  };

  const q = search.trim().toLowerCase();
  const filtered = q ? items.filter((e) => e.full_name.toLowerCase().includes(q) || e.employee_number.toLowerCase().includes(q)) : items;

  return (
    <>
      <div className="content-head">
        <h2>Funcionários</h2>
        <span className="spacer" />
        <button className="btn" onClick={openCreate}><IconPlus size={18} /> Novo funcionário</button>
      </div>

      <div className="card" style={{ padding: '2px 14px' }}>
        <div className="row">
          <IconSearch size={18} />
          <input style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '13px 0', color: 'var(--text)' }}
            value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Procurar por nome ou nº…" />
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 14px' }}>
          <strong>{selected.size} selecionado(s)</strong>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => setSelected(new Set())} disabled={bulkBusy}>Limpar</button>
          <button className="btn sm warn" onClick={bulkDeactivate} disabled={bulkBusy}>Desativar</button>
          <button className="btn sm danger" onClick={bulkDelete} disabled={bulkBusy}>Eliminar</button>
        </div>
      ) : null}

      {info ? <div className="banner success">{info}</div> : null}
      {error ? <div className="banner danger">{error}</div> : null}

      {loading ? <div className="card"><div className="loading">A carregar…</div></div>
        : filtered.length === 0 ? (
          <div className="card"><div className="empty"><IconBuilding size={40} /><p>Sem funcionários. Crie o primeiro.</p></div></div>
        ) : (
          <div className="pgrid">
            {filtered.map((e) => {
              const u = accessOf(e);
              return (
                <div className={`pcard${selected.has(e.id) ? ' sel' : ''}`} key={e.id}>
                  <label className="pcard-check" onClick={(ev) => ev.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSel(e.id)} />
                  </label>
                  <div className="thumb">
                    {e.photo_url ? <img src={e.photo_url} alt={e.full_name} /> : <IconBuilding size={30} />}
                  </div>
                  <div className="pinfo">
                    <div className="pname">{e.full_name}</div>
                    <div className="pcode">{e.employee_number}{e.position ? ` · ${e.position}` : ''}</div>
                    <div className="pfoot">
                      <span className="pprice">{formatKz(Number(e.base_salary))}</span>
                      <span className={`pill ${e.status === 'ACTIVE' ? 'on' : 'off'}`}>{e.status === 'ACTIVE' ? 'Activo' : e.status === 'TERMINATED' ? 'Cessado' : 'Suspenso'}</span>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      {u ? (
                        <span className="pill on" title={u.email} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <IconShield size={11} /> {STAFF_ROLE_LABELS[u.role] ?? u.role}{u.has_pin ? ' · PIN' : ''}
                        </span>
                      ) : e.status === 'ACTIVE' ? (
                        <button className="btn sm ghost block" onClick={() => setAccessFor(e)}>
                          <IconShield size={13} /> Dar acesso ao sistema
                        </button>
                      ) : <span className="muted" style={{ fontSize: 12 }}>Sem acesso</span>}
                    </div>
                    <button className="btn sm ghost block" style={{ marginTop: 8 }} onClick={() => openEdit(e)}><IconEdit size={15} /> Editar</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      {creating || editing ? (
        <Modal title={editing ? 'Editar funcionário' : 'Novo funcionário'} onClose={close}>
          {formError ? <div className="banner danger" style={{ marginBottom: 12 }}>{formError}</div> : null}
          <div className="thumb" style={{ height: 130, borderRadius: 12, border: '1px solid var(--border)', marginBottom: 12, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            {form.photoUrl ? <img src={form.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <IconBuilding size={34} />}
          </div>
          <label className="btn sm ghost block" style={{ marginBottom: 12, cursor: 'pointer' }}>
            <IconImage size={15} /> {form.photoUrl ? 'Trocar foto' : 'Carregar foto'}
            <input type="file" accept="image/*" hidden onChange={(ev) => onPickPhoto(ev.target.files?.[0])} />
          </label>

          {!editing ? (
            <div className="field"><label>Nº de funcionário</label>
              <input value={form.employeeNumber} onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })} placeholder="ex.: F-001" /></div>
          ) : null}
          <div className="field"><label>Nome completo</label>
            <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
          <div className="grid-2">
            <div className="field"><label>Função</label>
              <input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="ex.: Operador de caixa" /></div>
            <div className="field"><label>Departamento</label>
              <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
          </div>
          <div className="grid-2">
            <div className="field"><label>Salário base (Kz)</label>
              <input value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} inputMode="decimal" placeholder="0" /></div>
            <div className="field"><label>IBAN</label>
              <input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="AO06…" /></div>
          </div>
          {!editing ? (
            <div className="grid-2">
              <div className="field"><label>NIF</label>
                <input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} /></div>
              <div className="field"><label>Nº Segurança Social</label>
                <input value={form.inssNumber} onChange={(e) => setForm({ ...form, inssNumber: e.target.value })} /></div>
            </div>
          ) : null}

          <button className="btn lg block" style={{ marginTop: 14 }} onClick={save} disabled={saving}>
            {saving ? 'A guardar…' : editing ? 'Guardar alterações' : 'Criar funcionário'}
          </button>
        </Modal>
      ) : null}

      {accessFor ? (
        <AccessModal
          employee={accessFor}
          stores={stores}
          onClose={() => setAccessFor(null)}
          onCreated={(temp) => {
            setAccessFor(null);
            if (temp) setInfo(`Acesso criado. Senha temporária: ${temp} — entrega ao funcionário (só aparece agora).`);
            else setInfo('Acesso criado.');
            void load();
          }}
        />
      ) : null}
    </>
  );
}

/** Cria um utilizador (acesso ao sistema) ligado a um funcionário (mesmo nome). */
function AccessModal({
  employee, stores, onClose, onCreated,
}: {
  employee: ManagerEmployee;
  stores: ManagerStore[];
  onClose(): void;
  onCreated(temp?: string): void;
}) {
  const guessRole = (): StaffRoleName =>
    /caixa|operador/i.test(employee.position ?? '') ? 'CASHIER'
      : /gerente|gestor|manager/i.test(employee.position ?? '') ? 'STORE_MANAGER'
      : 'ATTENDANT';
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRoleName>(guessRole());
  const [storeId, setStoreId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('Indique um email válido.'); return; }
    if (!/^\d{6}$/.test(pin)) { setErr('Defina o PIN de 6 dígitos — é necessário para o funcionário aparecer e entrar na caixa.'); return; }
    setBusy(true);
    try {
      const r = await api.staff.createUser({
        name: employee.full_name,
        email: email.trim().toLowerCase(),
        role,
        storeId: storeId || undefined,
        pin: pin || undefined,
      });
      onCreated(r.temporaryPassword);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível criar o acesso (precisa de ser administrador).'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Dar acesso — ${employee.full_name}`} onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Cria a conta de acesso deste funcionário. O <strong>papel</strong> define as permissões. Na <strong>caixa</strong>, o operador entra escolhendo o <strong>nome</strong> e digitando o <strong>PIN</strong> — por isso defina um PIN abaixo.
      </p>
      <div className="field"><label>Email (login)</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.ao" inputMode="email" /></div>
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
      <div className="field"><label>PIN da caixa (6 dígitos — necessário para entrar na caixa)</label>
        <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="ex.: 123456" /></div>
      <button className="btn lg block" style={{ marginTop: 8 }} onClick={submit} disabled={busy}>
        {busy ? 'A criar…' : 'Criar acesso'}
      </button>
    </Modal>
  );
}
