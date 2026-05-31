import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Company, CompanyStatus } from '../api/types';
import { IconBuilding, IconSearch } from '../components/Icons';
import { StatusBadge } from '../components/ui';
import { formatDate } from '../format';

const FILTERS: { key: '' | CompanyStatus; label: string }[] = [
  { key: '', label: 'Todas' },
  { key: 'PENDING', label: 'Pendentes' },
  { key: 'ACTIVE', label: 'Activas' },
  { key: 'SUSPENDED', label: 'Suspensas' },
];

export function Tenants() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filter, setFilter] = useState<'' | CompanyStatus>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusyId(id);
    try {
      await fn();
      await load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Operação falhou.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
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

      <div className="card" style={{ padding: '2px 14px' }}>
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
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
