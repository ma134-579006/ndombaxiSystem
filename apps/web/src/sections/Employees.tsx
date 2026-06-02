import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CreateEmployeeInput, ManagerEmployee } from '../api/types';
import { IconBuilding, IconEdit, IconImage, IconPlus, IconSearch } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz } from '../format';

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
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<ManagerEmployee | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await api.hr.employees(true)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar funcionários.'); }
    finally { setLoading(false); }
  }, []);

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

      {error ? <div className="banner danger">{error}</div> : null}

      {loading ? <div className="card"><div className="loading">A carregar…</div></div>
        : filtered.length === 0 ? (
          <div className="card"><div className="empty"><IconBuilding size={40} /><p>Sem funcionários. Crie o primeiro.</p></div></div>
        ) : (
          <div className="pgrid">
            {filtered.map((e) => (
              <div className="pcard" key={e.id}>
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
                  <button className="btn sm ghost block" style={{ marginTop: 8 }} onClick={() => openEdit(e)}><IconEdit size={15} /> Editar</button>
                </div>
              </div>
            ))}
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
    </>
  );
}
