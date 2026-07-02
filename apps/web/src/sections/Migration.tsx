import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { MigrationApplyResult, MigrationKind, MigrationPreview, WarehouseRow } from '../api/types';
import { toast, confirmDialog } from '../components/feedback';
import { IconShield, IconCube, IconBuilding, IconStore, IconCheck, IconClose, IconRefresh } from '../components/Icons';

const KIND_LABEL: Record<MigrationKind, string> = { products: 'Produtos', customers: 'Clientes', suppliers: 'Fornecedores' };
const KIND_HINT: Record<MigrationKind, string> = {
  products: 'Nome, código, código de barras, categoria, stock, custo e preço',
  customers: 'Nome, NIF, telefone, e-mail, morada e saldo em dívida',
  suppliers: 'Nome, NIF, telefone, e-mail, morada e conta a pagar',
};
const KIND_ICON: Record<MigrationKind, React.ComponentType<{ size?: number }>> = { products: IconCube, customers: IconBuilding, suppliers: IconStore };
const FIELD_LABEL: Record<string, string> = {
  barcode: 'Código de barras', code: 'Código', name: 'Nome', category: 'Categoria', stock: 'Stock',
  costPrice: 'Valor unitário (custo)', salePrice: 'Valor de venda', profit: 'Lucro',
  taxId: 'NIF/BI', phone: 'Telefone', email: 'E-mail', address: 'Morada', debt: 'Conta a pagar (saldo)', history: 'Histórico/Observações',
};
const ACCEPT = '.xlsx,.xls,.xlsm,.csv,.txt,.xml,.sql';
// Limite de segurança no cliente (o servidor aceita ~30 MB binários / 50 MB de corpo).
const MAX_FILE_MB = 30;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const s = String(reader.result); resolve(s.slice(s.indexOf(',') + 1)); };
    reader.onerror = () => reject(new Error('Não foi possível ler o ficheiro.'));
    reader.readAsDataURL(file);
  });
}

/** Migração inteligente de dados de outros sistemas (Vendus, Primavera, PHC/
 *  "Negócio", SAF-T da AGT, dumps .sql, Excel/CSV genérico) — produtos, clientes
 *  e fornecedores. Mapeamento determinístico de colunas (nunca "alucina"); mostra
 *  sempre uma pré-visualização antes de aplicar; nunca apaga nada (upsert). */
export function Migration() {
  return (
    <>
      <div className="content-head"><h2><IconShield size={20} /> Migração de dados</h2></div>
      <p className="muted mig-intro">
        Traga produtos, clientes e fornecedores de outro sistema. Aceita <strong>Excel</strong> (.xlsx),
        {' '}<strong>CSV</strong>, <strong>SAF-T</strong> da AGT (.xml) e cópias de base de dados (.sql).
        O sistema reconhece as colunas automaticamente e mostra o que vai criar/atualizar antes de gravar —
        <strong> nunca apaga dados existentes</strong>.
      </p>
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
    setError(null); setPreview(null); setResult(null); setBusy(true);
    try {
      const b64 = await readAsBase64(file);
      setFileName(file.name); setContentB64(b64);
      setPreview(await api.migration.preview(kind, b64, file.name));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível ler/analisar o ficheiro.');
    } finally { setBusy(false); }
  };

  const apply = async () => {
    if (!contentB64) return;
    if (!(await confirmDialog({ message: `Importar ${KIND_LABEL[kind].toLowerCase()}? Vai criar/atualizar registos — nada é apagado.` }))) return;
    setBusy(true); setError(null);
    try {
      const r = await api.migration.apply(kind, contentB64, fileName ?? undefined, kind === 'products' ? (storeId || null) : null);
      setResult(r);
      toast.success(`${KIND_LABEL[kind]}: ${r.created} criado(s), ${r.updated} atualizado(s).`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível importar.');
    } finally { setBusy(false); }
  };

  const reset = () => { setFileName(null); setContentB64(null); setPreview(null); setResult(null); setError(null); if (inputRef.current) inputRef.current.value = ''; };

  return (
    <div className="mig-card">
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
          <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => void onPick(e.target.files?.[0])} />
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
          <div className="mig-file"><span className="mig-file-name">{fileName}</span><span className="mig-file-rows">{preview.totalRows} linha(s)</span></div>

          <div className="mig-stats">
            <div className="mig-stat create"><span className="mig-stat-n">{preview.toCreate}</span><span className="mig-stat-l">A criar</span></div>
            <div className="mig-stat update"><span className="mig-stat-n">{preview.toUpdate}</span><span className="mig-stat-l">A atualizar</span></div>
            {preview.toSkip > 0 ? <div className="mig-stat skip"><span className="mig-stat-n">{preview.toSkip}</span><span className="mig-stat-l">Ignoradas</span></div> : null}
          </div>

          <details className="mig-cols">
            <summary>Colunas reconhecidas ({Object.keys(preview.detectedColumns).length})</summary>
            <div className="mig-cols-body">
              {Object.entries(preview.detectedColumns).map(([field, header]) => (
                <div key={field} className="mig-col-row"><span>{FIELD_LABEL[field] ?? field}</span><em>{header}</em></div>
              ))}
              {preview.unmappedColumns.length ? (
                <div className="mig-col-unused">Não usadas: {preview.unmappedColumns.slice(0, 6).join(', ')}{preview.unmappedColumns.length > 6 ? '…' : ''}</div>
              ) : null}
            </div>
          </details>

          {kind === 'products' && preview.detectedColumns.stock ? (
            <label className="mig-field">
              <span>O stock importado entra em</span>
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">Todas as lojas (stock partilhado)</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          ) : null}

          {preview.sample.length ? (
            <div className="mig-sample">
              {preview.sample.map((s, i) => (
                <div key={i} className="mig-sample-row">
                  <span className={`mig-tag ${s.action === 'CREATE' ? 'new' : 'upd'}`}>{s.action === 'CREATE' ? 'Novo' : 'Atualiza'}</span>
                  <span className="mig-sample-data">{Object.entries(s.data).map(([k, v]) => `${k}: ${v ?? '—'}`).join(' · ')}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mig-actions">
            <button className="btn ghost" onClick={reset} disabled={busy}><IconClose size={15} /> Cancelar</button>
            <button className="btn mig-confirm" onClick={() => void apply()} disabled={busy || (preview.toCreate === 0 && preview.toUpdate === 0)}>
              {busy ? <><span className="mig-spinner" aria-hidden /> A importar…</> : <><IconCheck size={16} /> Confirmar {preview.toCreate + preview.toUpdate}</>}
            </button>
          </div>
          {busy ? <p className="mig-note">Ficheiros grandes podem demorar alguns minutos — não feche esta página.</p> : null}
        </div>
      ) : null}

      {result ? (
        <div className="mig-result">
          <div className="banner success mig-msg">
            {result.created} criado(s) · {result.updated} atualizado(s){result.skipped ? ` · ${result.skipped} ignorado(s)` : ''}
          </div>
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
