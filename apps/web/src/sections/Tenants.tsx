import { confirmDialog, toast } from '../components/feedback';
import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Company, CompanyStatus } from '../api/types';
import { IconBuilding, IconSearch } from '../components/Icons';
import { StatusBadge, Modal } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { formatDate } from '../format';

const FILTERS: { key: '' | CompanyStatus; label: string }[] = [
  { key: '', label: 'Todas' },
  { key: 'PENDING', label: 'Pendentes' },
  { key: 'ACTIVE', label: 'Activas' },
  { key: 'SUSPENDED', label: 'Suspensas' },
  { key: 'CANCELLED', label: 'Rejeitadas' },
];

export function Tenants() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filter, setFilter] = useState<'' | CompanyStatus>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bonusFor, setBonusFor] = useState<Company | null>(null);
  const { enterShadow } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCompanies(await api.tenants.list({ status: filter || undefined, search: search || undefined }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar empresas.');
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    void load();
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id: string, fn: () => Promise<Company>, confirmMsg?: string) => {
    if (confirmMsg && !(await confirmDialog({ message: confirmMsg }))) return;
    setBusyId(id);
    try {
      await fn();
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Operação falhou.');
    } finally {
      setBusyId(null);
    }
  };

  const resetPwd = async (c: Company) => {
    const email = window.prompt(`Repor senha de "${c.name}".\nE-mail do utilizador (vazio = responsável ${c.responsibleEmail}):`, '');
    if (email === null) return;
    setBusyId(c.id);
    try {
      const r = await api.tenants.resetPassword(c.id, email.trim() || undefined);
      toast.success(`Senha temporária de ${r.email}:\n\n${r.temporaryPassword}\n\nGuarde-a — só é mostrada agora. Foi também enviada por e-mail.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível repor a senha.');
    } finally { setBusyId(null); }
  };

  const exportData = async (c: Company) => {
    setBusyId(c.id);
    try {
      const data = await api.tenants.exportData(c.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${c.code}-dados-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível exportar.');
    } finally { setBusyId(null); }
  };

  const enterShadowFor = async (c: Company) => {
    setBusyId(c.id);
    try {
      const r = await api.tenants.impersonate(c.id);
      enterShadow(r.tokens, r.companyCode, r.companyName);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível entrar em modo shadow.');
    } finally { setBusyId(null); }
  };

  const remove = async (c: Company) => {
    const typed = window.prompt(`⚠️ ELIMINAR "${c.name}" apaga TODOS os dados (schema) de forma irreversível.\nPara confirmar, escreva o código da empresa: ${c.code}`, '');
    if (typed === null) return;
    if (typed.trim() !== c.code) { toast.error('Código não coincide. Cancelado.'); return; }
    setBusyId(c.id);
    try {
      await api.tenants.remove(c.id);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível eliminar.');
    } finally { setBusyId(null); }
  };

  return (
    <>
      <div className="sticky-top">
        <div className="content-head">
          <h2>Empresas registadas</h2>
          <span className="spacer" />
          <div className="wrapcols">
            {FILTERS.map((f) => (
              <button key={f.label} className={`chip${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card toolbar-sticky" style={{ padding: '2px 14px' }}>
          <div className="row">
            <IconSearch size={18} />
            <input
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '13px 0', color: 'var(--text)' }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
              placeholder="Procurar por nome, código ou NIF… (Enter)"
            />
          </div>
        </div>
      </div>

      {error ? <div className="banner danger">{error}</div> : null}

      <div className="card">
        {loading ? (
          <div className="loading">A carregar empresas…</div>
        ) : companies.length === 0 ? (
          <div className="empty">
            <IconBuilding size={40} />
            <p>Sem empresas neste filtro.</p>
          </div>
        ) : (
          companies.map((c) => (
            <div className="list-row" key={c.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {c.name} <span className="muted" style={{ fontWeight: 500 }}>· {c.code}</span>
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  NIF {c.nif} · {c.plan?.name ?? c.planId} · {c.responsibleEmail} · {formatDate(c.createdAt)}
                </div>
                <PlanStateLine c={c} />
              </div>
              <StatusBadge status={c.status} />
              <div className="row" style={{ gap: 8 }}>
                {c.status === 'PENDING' ? (
                  <>
                    <button className="btn sm success" disabled={busyId === c.id} onClick={() => act(c.id, () => api.tenants.approve(c.id))}>
                      Aprovar
                    </button>
                    <button className="btn sm ghost" disabled={busyId === c.id} onClick={() => act(c.id, () => api.tenants.reject(c.id), `Rejeitar "${c.name}"?`)}>
                      Rejeitar
                    </button>
                  </>
                ) : null}
                {c.status === 'ACTIVE' ? (
                  <button className="btn sm warn" disabled={busyId === c.id} onClick={() => act(c.id, () => api.tenants.suspend(c.id), `Suspender "${c.name}"?`)}>
                    Suspender
                  </button>
                ) : null}
                {c.status === 'SUSPENDED' ? (
                  <button className="btn sm success" disabled={busyId === c.id} onClick={() => act(c.id, () => api.tenants.reactivate(c.id))}>
                    Reactivar
                  </button>
                ) : null}
                {c.status !== 'PENDING' && c.status !== 'CANCELLED' ? (
                  <button className={`btn sm ${c.planExpired ? 'success' : 'ghost'}`} disabled={busyId === c.id} onClick={() => setBonusFor(c)} title="Reativar plano / conceder dias ou meses de bónus">
                    {c.planExpired ? 'Reativar' : 'Bónus / dias'}
                  </button>
                ) : null}
                {c.status === 'ACTIVE' || c.status === 'SUSPENDED' ? (
                  <button className="btn sm ghost" disabled={busyId === c.id} onClick={() => enterShadowFor(c)} title="Entrar no painel da empresa (shadow)">
                    Entrar (shadow)
                  </button>
                ) : null}
                {c.status !== 'PENDING' && c.status !== 'CANCELLED' ? (
                  <button className="btn sm ghost" disabled={busyId === c.id} onClick={() => resetPwd(c)} title="Forçar reset de senha">
                    Repor senha
                  </button>
                ) : null}
                <button className="btn sm ghost" disabled={busyId === c.id} onClick={() => exportData(c)} title="Exportar dados (RGPD)">
                  Exportar
                </button>
                {c.status === 'SUSPENDED' || c.status === 'CANCELLED' ? (
                  <button className="btn sm danger" disabled={busyId === c.id} onClick={() => remove(c)} title="Eliminar empresa e dados">
                    Eliminar
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      {bonusFor ? (
        <BonusModal
          company={bonusFor}
          onClose={() => setBonusFor(null)}
          onDone={async () => { setBonusFor(null); await load(); }}
        />
      ) : null}
    </>
  );
}

/** Linha com o estado REAL do plano: expirado, dias restantes ou validade. */
function PlanStateLine({ c }: { c: Company }) {
  if (c.status === 'PENDING' || c.status === 'CANCELLED') return null;
  if (c.planExpired) {
    return <div style={{ fontSize: 12.5, marginTop: 3, color: 'var(--danger)', fontWeight: 700 }}>⚠ Plano EXPIRADO{c.planExpiresAt ? ` em ${formatDate(c.planExpiresAt)}` : ''} — sem acesso</div>;
  }
  if (c.planDaysLeft != null) {
    const soon = c.planDaysLeft <= 5;
    return <div style={{ fontSize: 12.5, marginTop: 3, color: soon ? 'var(--warning)' : 'var(--muted)', fontWeight: soon ? 700 : 500 }}>
      🗓️ {c.planDaysLeft} dia(s) restante(s){c.planExpiresAt ? ` · até ${formatDate(c.planExpiresAt)}` : ''}
    </div>;
  }
  return null;
}

/** Reativar / conceder bónus de dias e/ou meses a uma empresa. */
function BonusModal({ company, onClose, onDone }: { company: Company; onClose(): void; onDone(): void }) {
  const [months, setMonths] = useState('0');
  const [days, setDays] = useState(company.planExpired ? '30' : '0');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const PRESETS: { m: number; d: number; label: string }[] = [
    { m: 0, d: 7, label: '+7 dias' }, { m: 0, d: 15, label: '+15 dias' },
    { m: 1, d: 0, label: '+1 mês' }, { m: 3, d: 0, label: '+3 meses' }, { m: 12, d: 0, label: '+1 ano' },
  ];
  const save = async () => {
    const m = Number(months) || 0, d = Number(days) || 0;
    if (m === 0 && d === 0) { setErr('Indique pelo menos 1 dia ou 1 mês.'); return; }
    setBusy(true); setErr(null);
    try {
      await api.tenants.grantBonus(company.id, { months: m, days: d, note: note.trim() || undefined });
      toast.success(`Plano de "${company.name}" reativado/estendido (+${m}m ${d}d).`);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Falha ao conceder bónus.');
      setBusy(false);
    }
  };
  return (
    <Modal title={`Reativar / Bónus — ${company.name}`} onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      {company.planExpired
        ? <div className="banner danger" style={{ marginBottom: 12 }}>Plano expirado. O tempo concedido restabelece o acesso imediatamente.</div>
        : company.planDaysLeft != null
          ? <div className="banner info" style={{ marginBottom: 12 }}>Restam {company.planDaysLeft} dia(s). O bónus soma-se ao tempo que ainda falta.</div>
          : null}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="chip" onClick={() => { setMonths(String(p.m)); setDays(String(p.d)); }}>{p.label}</button>
        ))}
      </div>
      <div className="grid-2">
        <div className="field"><label>Meses</label><input value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></div>
        <div className="field"><label>Dias</label><input value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></div>
      </div>
      <div className="field"><label>Nota (opcional)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: cortesia, compensação…" /></div>
      <button className="btn lg block" style={{ marginTop: 6 }} onClick={save} disabled={busy}>
        {busy ? 'A aplicar…' : company.planExpired ? 'Reativar plano' : 'Conceder bónus'}
      </button>
    </Modal>
  );
}
