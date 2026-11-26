import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { confirmDialog } from '../components/feedback';
import { IconPlus } from '../components/Icons';

type Kind = 'units' | 'nc-reasons';
const META: Record<Kind, { title: string; intro: string; add: string; placeholder: string; max: number; col: string }> = {
  units: {
    title: 'Unidades', col: 'Unidade', add: 'Adicionar Unidade', placeholder: 'ex.: rolo, saco, m²', max: 16,
    intro: 'Unidades de medida que aparecem na ficha do produto (Produtos › Unidade).',
  },
  'nc-reasons': {
    title: 'Motivos - Notas Crédito', col: 'Motivo', add: 'Adicionar Motivo', placeholder: 'ex.: Artigo trocado', max: 200,
    intro: 'Motivos propostos ao anular uma venda ou fazer uma devolução (nota de crédito). Continua a poder escrever outro.',
  },
};

/** Configuração › Definições › Unidades / Motivos - Notas Crédito (como no Vendus). */
export function ConfigList({ kind }: { kind: Kind }) {
  const m = META[kind];
  const [rows, setRows] = useState<{ id: string; label: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [novo, setNovo] = useState('');
  const [edit, setEdit] = useState<{ id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.configLists.list(kind).then(setRows).catch((e) => setError(e instanceof ApiError ? e.message : 'Falha ao carregar.')), [kind]);
  useEffect(() => { setRows(null); setEdit(null); setNovo(''); void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await load(); return true; }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); return false; }
    finally { setBusy(false); }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = novo.trim(); if (!v) return;
    if (await run(() => api.configLists.add(kind, v))) setNovo('');
  };
  const save = async () => {
    if (!edit) return;
    if (await run(() => api.configLists.rename(kind, edit.id, edit.label.trim()))) setEdit(null);
  };
  const remove = async (r: { id: string; label: string }) => {
    if (!(await confirmDialog({ message: `Apagar «${r.label}»?`, danger: true }))) return;
    await run(() => api.configLists.remove(kind, r.id));
  };

  return (
    <div className="vd-page cl-page">
      <div className="vd-head">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Configuração</span><span className="sep">/</span><span>{m.title}</span></p>
      </div>
      <p className="muted" style={{ margin: '0 0 12px' }}>{m.intro}</p>
      {error ? <div className="vd-err" role="alert">{error}</div> : null}

      <form className="vd-card vd-filters cl-add" onSubmit={add}>
        <label className="vd-f grow"><input className="vd-in" value={novo} maxLength={m.max} onChange={(e) => setNovo(e.target.value)} placeholder={m.placeholder} aria-label={m.col} /></label>
        <button className="vd-btn ok" type="submit" disabled={busy || !novo.trim()}><IconPlus size={16} /> {m.add}</button>
      </form>

      <div className="vd-card us-card">
        {rows === null ? <div className="vd-empty">A carregar…</div>
          : rows.length === 0 ? <div className="vd-empty">A lista está vazia.</div>
          : (
            <table className="ptable acc-table cl-table">
              <thead><tr><th>{m.col}</th><th aria-label="Opções" /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="wrap">
                      {edit && r.id === edit.id ? (
                        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="cl-edit">
                          <input className="vd-in" autoFocus value={edit.label} maxLength={m.max} onChange={(e) => setEdit({ ...edit, label: e.target.value })} aria-label={`Novo nome de ${r.label}`}
                            onKeyDown={(e) => { if (e.key === 'Escape') setEdit(null); }} />
                        </form>
                      ) : r.label}
                    </td>
                    <td className="num nw">
                      {edit && r.id === edit.id ? <>
                        <button type="button" className="vd-btn ok sm" disabled={busy || !edit.label.trim()} onClick={() => void save()}>Guardar</button>{' '}
                        <button type="button" className="vd-btn plain sm" onClick={() => setEdit(null)}>Cancelar</button>
                      </> : <>
                        <button type="button" className="vd-btn plain sm" disabled={busy} onClick={() => setEdit({ id: r.id, label: r.label })}>Editar</button>{' '}
                        <button type="button" className="vd-btn plain sm cl-del" disabled={busy} onClick={() => void remove(r)}>Apagar</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}
