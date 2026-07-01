import React, { useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { MigrationApplyResult, MigrationKind, MigrationPreview } from '../api/types';
import { toast, confirmDialog } from '../components/feedback';
import { IconShield, IconTruck, IconCube, IconBuilding, IconStore } from '../components/Icons';

const KIND_LABEL: Record<MigrationKind, string> = { products: 'Produtos', customers: 'Clientes', suppliers: 'Fornecedores' };
const KIND_ICON: Record<MigrationKind, React.ComponentType<{ size?: number }>> = { products: IconCube, customers: IconBuilding, suppliers: IconStore };
const FIELD_LABEL: Record<string, string> = {
  barcode: 'Código de barras', code: 'Código', name: 'Nome', category: 'Categoria', stock: 'Stock',
  costPrice: 'Valor unitário (custo)', salePrice: 'Valor de venda', profit: 'Lucro',
  taxId: 'NIF/BI', phone: 'Telefone', email: 'E-mail', address: 'Morada', debt: 'Conta a pagar (saldo)', history: 'Histórico/Observações',
};

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const s = String(reader.result); resolve(s.slice(s.indexOf(',') + 1)); };
    reader.onerror = () => reject(new Error('Não foi possível ler o ficheiro.'));
    reader.readAsDataURL(file);
  });
}

/** Migração inteligente de dados de outros sistemas (Vendus, Primavera, PHC/
 *  "Negócio", Excel genérico) — produtos, clientes e fornecedores. Mapeamento
 *  determinístico de colunas (nunca "alucina"); mostra sempre uma pré-visualização
 *  antes de aplicar; nunca apaga nada (upsert). */
export function Migration() {
  return (
    <>
      <div className="content-head"><h2><IconShield size={20} /> Migração</h2></div>
      <p className="muted" style={{ fontSize: 13, maxWidth: 720 }}>
        Sobe um ficheiro Excel/CSV exportado de outro sistema (Vendus, Primavera, "Negócio", ou
        genérico) para trazer produtos, clientes ou fornecedores. O sistema reconhece as colunas
        mais comuns automaticamente e mostra sempre o que vai criar/actualizar antes de gravar —
        nunca apaga dados existentes.
      </p>
      <div className="pgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
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
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const Icon = KIND_ICON[kind];

  const onPick = async (file: File | undefined) => {
    if (!file) return;
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
    if (!(await confirmDialog({ message: `Importar ${KIND_LABEL[kind].toLowerCase()}? Vai criar/actualizar registos — nada é apagado.` }))) return;
    setBusy(true); setError(null);
    try {
      const r = await api.migration.apply(kind, contentB64, fileName ?? undefined);
      setResult(r);
      toast.success(`${KIND_LABEL[kind]}: ${r.created} criado(s), ${r.updated} actualizado(s).`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível importar.');
    } finally { setBusy(false); }
  };

  const reset = () => { setFileName(null); setContentB64(null); setPreview(null); setResult(null); setError(null); if (inputRef.current) inputRef.current.value = ''; };

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <Icon size={18} /><h3 style={{ margin: 0 }}>{KIND_LABEL[kind]}</h3>
      </div>
      {error ? <div className="banner danger" style={{ fontSize: 12.5 }}>{error}</div> : null}

      {!preview ? (
        <label className="btn block" style={{ cursor: 'pointer', textAlign: 'center' }}>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,.txt" hidden onChange={(e) => void onPick(e.target.files?.[0])} />
          <IconTruck size={15} /> {busy ? 'A analisar…' : 'Escolher ficheiro (.xlsx/.csv)'}
        </label>
      ) : !result ? (
        <>
          <p className="muted" style={{ fontSize: 12 }}>
            {fileName} · {preview.totalRows} linha(s)
            {preview.unmappedColumns.length ? <> · colunas não usadas: {preview.unmappedColumns.slice(0, 4).join(', ')}{preview.unmappedColumns.length > 4 ? '…' : ''}</> : null}
          </p>
          <div className="legend" style={{ fontSize: 12, marginBottom: 8 }}>
            <strong>Colunas reconhecidas:</strong>
            {Object.entries(preview.detectedColumns).map(([field, header]) => (
              <div key={field}>{FIELD_LABEL[field] ?? field}: <em>{header}</em></div>
            ))}
          </div>
          <div className="grid-2" style={{ marginBottom: 8 }}>
            <div className="field" style={{ margin: 0 }}><label>A criar</label><strong style={{ color: 'var(--success)' }}>{preview.toCreate}</strong></div>
            <div className="field" style={{ margin: 0 }}><label>A actualizar</label><strong>{preview.toUpdate}</strong></div>
          </div>
          {preview.toSkip > 0 ? <p className="muted" style={{ fontSize: 12 }}>{preview.toSkip} linha(s) sem nome — ignoradas.</p> : null}
          {preview.sample.length ? (
            <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px', marginBottom: 8 }}>
              {preview.sample.map((s, i) => (
                <div key={i} style={{ fontSize: 11.5, padding: '3px 0', borderBottom: i < preview.sample.length - 1 ? '1px solid var(--border)' : undefined }}>
                  <span className={`pill ${s.action === 'CREATE' ? 'on' : ''}`} style={{ marginRight: 6 }}>{s.action === 'CREATE' ? 'Novo' : 'Actualiza'}</span>
                  {Object.entries(s.data).map(([k, v]) => `${k}: ${v ?? '—'}`).join(' · ')}
                </div>
              ))}
            </div>
          ) : null}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost sm" onClick={reset} disabled={busy}>Cancelar</button>
            <button className="btn sm" style={{ flex: 1 }} onClick={() => void apply()} disabled={busy || (preview.toCreate === 0 && preview.toUpdate === 0)}>
              {busy ? 'A importar…' : `Confirmar (${preview.toCreate + preview.toUpdate})`}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="banner success" style={{ fontSize: 12.5 }}>
            {result.created} criado(s) · {result.updated} actualizado(s){result.skipped ? ` · ${result.skipped} ignorado(s)` : ''}
          </div>
          {result.errors.length ? (
            <div className="legend" style={{ fontSize: 11, marginTop: 6 }}>
              {result.errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          ) : null}
          <button className="btn sm block" style={{ marginTop: 8 }} onClick={reset}>Importar outro ficheiro</button>
        </>
      )}
    </div>
  );
}
