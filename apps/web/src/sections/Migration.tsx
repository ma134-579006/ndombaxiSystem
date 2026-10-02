import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { MigrationApplyResult, MigrationKind, MigrationPreview, WarehouseRow } from '../api/types';
import { toast, confirmDialog, readFileProgress } from '../components/feedback';
import { IconUpload, IconCube, IconUsers, IconTruck, IconCheck, IconClose, IconRefresh } from '../components/Icons';

const KIND_LABEL: Record<MigrationKind, string> = { products: 'Produtos', customers: 'Clientes', suppliers: 'Fornecedores' };
const KIND_HINT: Record<MigrationKind, string> = {
  products: 'Nome, código, código de barras, categoria, stock, custo e preço',
  customers: 'Nome, NIF, telefone, e-mail, morada e saldo em dívida',
  suppliers: 'Nome, NIF, telefone, e-mail, morada e conta a pagar',
};
// Ícones SEMÂNTICOS: produtos=caixa, clientes=pessoas, fornecedores=camião.
const KIND_ICON: Record<MigrationKind, React.ComponentType<{ size?: number }>> = { products: IconCube, customers: IconUsers, suppliers: IconTruck };
const FIELD_LABEL: Record<string, string> = {
  barcode: 'Código de barras', code: 'Código', name: 'Nome', category: 'Categoria', stock: 'Stock',
  costPrice: 'Valor unitário (custo)', salePrice: 'Valor de venda', profit: 'Lucro',
  taxId: 'NIF/BI', phone: 'Telefone', email: 'E-mail', address: 'Morada', debt: 'Conta a pagar (saldo)', history: 'Histórico/Observações',
};
const ACCEPT = '.xlsx,.xls,.xlsm,.csv,.txt,.xml,.sql';
// Limite de segurança no cliente (o servidor aceita ~30 MB binários / 50 MB de corpo).
const MAX_FILE_MB = 30;

async function readAsBase64(file: File): Promise<string> {
  const s = await readFileProgress(file);
  return s.slice(s.indexOf(',') + 1);
}

/** Migração inteligente de dados de outros sistemas (Vendus, Primavera, PHC/
 *  "Negócio", SAF-T da AGT, dumps .sql, Excel/CSV genérico) — produtos, clientes
 *  e fornecedores. Mapeamento determinístico de colunas (nunca "alucina"); mostra
 *  sempre uma pré-visualização antes de aplicar; nunca apaga nada (upsert). */
export function Migration() {
  return (
    <>
      <div className="content-head"><h2><IconUpload size={20} /> Migração de dados</h2></div>
      <div className="mig-formats">
        {['Excel .xlsx', 'CSV', 'SAF-T .xml (AGT)', 'Base de dados .sql'].map((f) => (
          <span key={f} className="mig-chip">{f}</span>
        ))}
      </div>
      <div className="mig-grid">
        <MigrationCard kind="products" />
        <MigrationCard kind="customers" />
        <MigrationCard kind="suppliers" />
      </div>
    </>
  );
}

function MigrationCard({ kind }: { kind: MigrationKind }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [contentB64, setContentB64] = useState<string | null>(null);
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [result, setResult] = useState<MigrationApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Escolha manual das colunas (só produtos): campo → cabeçalho do ficheiro ('' = não usar).
  const [mapping, setMapping] = useState<Record<string, string> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const Icon = KIND_ICON[kind];

  // Loja de destino do stock — só relevante para produtos. '' = Todas as lojas
  // (stock partilhado); um id de loja = stock só nessa loja.
  const [stores, setStores] = useState<WarehouseRow[]>([]);
  const [storeId, setStoreId] = useState('');
  useEffect(() => { if (kind === 'products') api.inventory.warehouses().then(setStores).catch(() => setStores([])); }, [kind]);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`Ficheiro demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB; máx. ${MAX_FILE_MB} MB). Divida-o em partes e importe cada uma.`);
      return;
    }
    setError(null); setPreview(null); setResult(null); setMapping(null); setBusy(true);
    try {
      const b64 = await readAsBase64(file);
      setFileName(file.name); setContentB64(b64);
      setPreview(await api.migration.preview(kind, b64, file.name));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível ler/analisar o ficheiro.');
    } finally { setBusy(false); }
  };

  /** O utilizador corrigiu uma coluna: refaz a pré-visualização com essa escolha. */
  const remap = async (field: string, header: string) => {
    if (!contentB64 || !preview) return;
    const next = { ...preview.detectedColumns, ...(mapping ?? {}), [field]: header };
    setBusy(true); setError(null);
    try {
      setPreview(await api.migration.preview(kind, contentB64, fileName ?? undefined, next));
      setMapping(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível aplicar esta coluna.');
    } finally { setBusy(false); }
  };

  // Progresso real da importação (processadas / total) — mostrado num ecrã próprio.
  const [progress, setProgress] = useState<{ done: number; total: number; startedAt: number } | null>(null);

  const apply = async () => {
    if (!contentB64) return;
    if (!(await confirmDialog({ message: `Importar ${KIND_LABEL[kind].toLowerCase()}? Vai criar/atualizar registos — nada é apagado.` }))) return;
    setBusy(true); setError(null);
    const total0 = preview?.totalRows ?? 0;
    setProgress({ done: 0, total: total0, startedAt: Date.now() });
    try {
      const sid = kind === 'products' ? (storeId || null) : null;
      const map = kind === 'products' ? mapping : null;
      let r: MigrationApplyResult;
      try {
        const { jobId } = await api.migration.applyAsync(kind, contentB64, fileName ?? undefined, sid, map);
        // Consulta o progresso até terminar.
        for (;;) {
          await new Promise((res) => setTimeout(res, 700));
          const j = await api.migration.job(jobId);
          setProgress((p) => ({ done: j.processed, total: j.total || total0, startedAt: p?.startedAt ?? Date.now() }));
          if (j.status === 'done' && j.result) { r = j.result; break; }
          if (j.status === 'error') throw new Error(j.error || 'Falha na importação.');
        }
      } catch (e) {
        // API ainda sem importação em segundo plano (deploy em curso): pedido único.
        if (!(e instanceof ApiError) || e.status !== 404) throw e;
        r = await api.migration.apply(kind, contentB64, fileName ?? undefined, sid, map);
      }
      setProgress((p) => (p ? { ...p, done: p.total } : p));
      await new Promise((res) => setTimeout(res, 500));
      setResult(r);
      toast.success(`${KIND_LABEL[kind]}: ${r.created} criado(s), ${r.updated} atualizado(s).`);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Não foi possível importar.');
    } finally { setBusy(false); setProgress(null); }
  };

  const reset = () => { setMapping(null); setFileName(null); setContentB64(null); setPreview(null); setResult(null); setError(null); if (inputRef.current) inputRef.current.value = ''; };

  return (
    <div className={`mig-card${preview || result ? ' active' : ''}`}>
      {progress ? <ImportProgress kind={kind} fileName={fileName} {...progress} /> : null}
      <header className="mig-card-head">
        <span className="mig-card-icon" aria-hidden><Icon size={20} /></span>
        <div>
          <h3>{KIND_LABEL[kind]}</h3>
          <p className="mig-card-sub">{KIND_HINT[kind]}</p>
        </div>
      </header>

      {error ? <div className="banner danger mig-msg">{error}</div> : null}

      {!preview && !result ? (
        <>
          <input ref={inputRef} type="file" accept={ACCEPT} hidden aria-label="Escolher ficheiro a importar" onChange={(e) => void onPick(e.target.files?.[0])} />
          <button
            type="button"
            className={`mig-drop${dragOver ? ' over' : ''}${busy ? ' busy' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void onPick(e.dataTransfer.files?.[0]); }}
            disabled={busy}
          >
            {busy ? (
              <><span className="mig-spinner" aria-hidden /> A analisar o ficheiro…</>
            ) : (
              <>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 16V4M8 8l4-4 4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                </svg>
                <strong>Carregar ficheiro</strong>
                <span className="mig-drop-hint">Arraste para aqui ou toque para escolher</span>
              </>
            )}
          </button>
        </>
      ) : null}

      {preview && !result ? (
        <div className="mig-preview">
          <div className="mig-file">
            <span className="mig-file-ic" aria-hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5" /></svg></span>
            <span className="mig-file-name">{fileName}</span>
            <span className="mig-file-rows">{preview.totalRows.toLocaleString('pt-PT')} linhas</span>
            <button type="button" className="btn sm ghost" onClick={reset} disabled={busy}>Trocar ficheiro</button>
          </div>

          <div className="mig-kpis">
            <div className="mig-kpi create"><span className="l">A criar</span><span className="n">{preview.toCreate.toLocaleString('pt-PT')}</span></div>
            <div className="mig-kpi update"><span className="l">A atualizar</span><span className="n">{preview.toUpdate.toLocaleString('pt-PT')}</span></div>
            {kind === 'products' && preview.summary ? (
              <>
                <div className="mig-kpi"><span className="l">Com stock</span><span className="n">{preview.summary.withStock.toLocaleString('pt-PT')}</span><span className="h">{preview.summary.stockTotal.toLocaleString('pt-PT')} unidades no total</span></div>
                <div className="mig-kpi"><span className="l">Com código de barras</span><span className="n">{preview.summary.withBarcode.toLocaleString('pt-PT')}</span><span className="h">entram visíveis na loja online</span></div>
              </>
            ) : null}
            {preview.toSkip > 0 ? <div className="mig-kpi skip"><span className="l">Ignoradas</span><span className="n">{preview.toSkip}</span><span className="h">sem nome</span></div> : null}
          </div>

          <div className="mig-body">
            <div className="mig-col-main">
              {preview.warnings?.length ? (
                <section className="mig-callout warn" role="alert">
                  <h4>Reveja antes de importar <span className="mig-count">{preview.warnings.length}</span></h4>
                  <ul>{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </section>
              ) : (
                <section className="mig-callout ok"><h4>Ficheiro sem problemas detetados</h4></section>
              )}
              {preview.notes?.length ? (
                <section className="mig-callout info">
                  <h4>Como o ficheiro foi lido</h4>
                  <ul>{preview.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                </section>
              ) : null}
            </div>

            <aside className="mig-col-side">
              <section className="mig-panel">
                <h4>Colunas reconhecidas</h4>
                {kind === 'products' && preview.headers ? (
                  ['name', 'code', 'barcode', 'category', 'stock', 'costPrice', 'salePrice'].map((field) => (
                    field === 'stock' && preview.storeStock?.length && !preview.detectedColumns.stock ? (
                      <div key={field} className="mig-map-row">
                        <span className="k">{FIELD_LABEL[field]}</span>
                        <span className="v mig-pill">Por loja: {preview.storeStock.join(', ')}</span>
                      </div>
                    ) : (
                      <label key={field} className="mig-map-row">
                        <span className="k">{FIELD_LABEL[field] ?? field}</span>
                        <select className="mig-select" value={preview.detectedColumns[field] ?? ''} disabled={busy} onChange={(e) => void remap(field, e.target.value)}>
                          <option value="">— não usar —</option>
                          {preview.headers!.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </label>
                    )
                  ))
                ) : (
                  Object.entries(preview.detectedColumns).map(([field, header]) => (
                    <div key={field} className="mig-map-row"><span className="k">{FIELD_LABEL[field] ?? field}</span><span className="v">{header}</span></div>
                  ))
                )}
                {preview.unmappedColumns.length ? (
                  <p className="mig-unused">Não usadas: {preview.unmappedColumns.slice(0, 8).join(', ')}{preview.unmappedColumns.length > 8 ? '…' : ''}</p>
                ) : null}
              </section>

              {kind === 'products' && (preview.detectedColumns.stock || preview.storeStock?.length) ? (
                <section className="mig-panel">
                  <h4>Destino do stock</h4>
                  <select className="mig-select" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                    <option value="">{preview.storeStock?.length ? 'Automático (cada loja do ficheiro recebe o seu stock)' : 'Todas as lojas (stock partilhado)'}</option>
                    {stores.map((st) => <option key={st.id} value={st.id}>Só na loja {st.name}</option>)}
                  </select>
                </section>
              ) : null}
            </aside>
          </div>

          {preview.sample.length ? (
            <section className="mig-panel">
              <h4>Amostra ({preview.sample.length} de {preview.totalRows.toLocaleString('pt-PT')})</h4>
              <div className="mig-table-wrap">
                <table className="mig-table">
                  <thead><tr><th>Ação</th>{Object.keys(preview.sample[0].data).map((k) => <th key={k}>{k}</th>)}</tr></thead>
                  <tbody>
                    {preview.sample.map((row, i) => (
                      <tr key={i}>
                        <td><span className={`mig-tag ${row.action === 'CREATE' ? 'new' : 'upd'}`}>{row.action === 'CREATE' ? 'Novo' : 'Atualiza'}</span></td>
                        {Object.keys(preview.sample[0].data).map((k) => <td key={k}>{row.data[k] === null || row.data[k] === undefined || row.data[k] === '' ? '—' : String(row.data[k])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <div className="mig-actions">
            {busy ? <span className="mig-note">Ficheiros grandes podem demorar alguns minutos — não feche esta página.</span> : <span className="spacer" />}
            <button className="btn ghost" onClick={reset} disabled={busy}><IconClose size={15} /> Cancelar</button>
            <button className="btn mig-confirm" onClick={() => void apply()} disabled={busy || (preview.toCreate === 0 && preview.toUpdate === 0)}>
              {busy ? <><span className="mig-spinner" aria-hidden /> A importar…</> : <><IconCheck size={16} /> Importar {(preview.toCreate + preview.toUpdate).toLocaleString('pt-PT')} {KIND_LABEL[kind].toLowerCase()}</>}
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="mig-result">
          <div className="banner success mig-msg">
            {result.created} criado(s) · {result.updated} atualizado(s){result.skipped ? ` · ${result.skipped} ignorado(s)` : ''}
          </div>
          {result.warnings?.length ? (
            <div className="mig-warn" role="alert"><ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
          ) : null}
          {result.errors.length ? (
            <details className="mig-errors">
              <summary>{result.errors.length} aviso(s)</summary>
              <div className="mig-errors-body">{result.errors.map((e, i) => <div key={i}>{e}</div>)}</div>
            </details>
          ) : null}
          <button className="btn ghost block" onClick={reset}><IconRefresh size={15} /> Importar outro ficheiro</button>
        </div>
      ) : null}
    </div>
  );
}

/** Ecrã de progresso da importação: percentagem real, barra animada, linhas e tempo estimado. */
function ImportProgress({ kind, fileName, done, total, startedAt }: { kind: MigrationKind; fileName: string | null; done: number; total: number; startedAt: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const elapsed = (Date.now() - startedAt) / 1000;
  const eta = done > 0 && done < total ? Math.max(1, Math.round((elapsed / done) * (total - done))) : null;
  const etaLabel = eta === null ? (pct >= 100 ? 'A concluir…' : 'A preparar…') : eta >= 60 ? `cerca de ${Math.ceil(eta / 60)} min restantes` : `cerca de ${eta} s restantes`;
  const finished = pct >= 100;
  return (
    <div className="imp-overlay" role="dialog" aria-modal="true" aria-label="Importação em curso">
      <div className="imp-card">
        <div className="imp-head">
          <span className={`imp-ic${finished ? ' ok' : ''}`} aria-hidden>
            {finished
              ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M8 8l4-4 4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>}
          </span>
          <div className="imp-titles">
            <h4>{finished ? 'Importação concluída' : `A importar ${KIND_LABEL[kind].toLowerCase()}`}</h4>
            {fileName ? <p>{fileName}</p> : null}
          </div>
          <span className="imp-pct" aria-live="polite">{pct}<small>%</small></span>
        </div>
        <div className="imp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <i style={{ width: `${Math.max(pct, 2)}%` }} />
        </div>
        <div className="imp-meta">
          <span><b>{done.toLocaleString('pt-PT')}</b> de {total.toLocaleString('pt-PT')} linhas</span>
          <span>{etaLabel}</span>
        </div>
        <p className="imp-hint">Pode continuar nesta página — não feche o separador até terminar.</p>
      </div>
    </div>
  );
}
