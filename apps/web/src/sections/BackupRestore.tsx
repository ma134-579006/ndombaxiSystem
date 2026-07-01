import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { RestorePreview, RestoreResult, WarehouseRow } from '../api/types';
import { toast, confirmDialog } from '../components/feedback';
import { IconShield, IconTruck } from '../components/Icons';

const TABLE_LABEL: Record<string, string> = {
  product_categories: 'Categorias', products: 'Produtos', product_recipes: 'Fichas técnicas',
  product_batches: 'Lotes', stores: 'Lojas', stock_items: 'Stock', customers: 'Clientes',
  suppliers: 'Fornecedores', receivables: 'Contas a receber', payables: 'Contas a pagar',
  employees: 'Funcionários', site_settings: 'Configurações',
};

/** Lê um ficheiro como base64 (SEM o prefixo "data:...;base64,"). */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Não foi possível ler o ficheiro.'));
    reader.readAsDataURL(file);
  });
}

/** Restauro de um backup PRÓPRIO do Ndombaxi (.ndbak) — pré-visualiza sempre
 *  antes de aplicar; nunca apaga nada (upsert por id). */
export function BackupRestore() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [contentB64, setContentB64] = useState<string | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Loja de destino do stock cuja loja de origem (no backup) já não existe.
  // '' = essas linhas ficam por conta do próprio restauro (falham isoladamente).
  const [stores, setStores] = useState<WarehouseRow[]>([]);
  const [storeId, setStoreId] = useState('');
  useEffect(() => { api.inventory.warehouses().then(setStores).catch(() => setStores([])); }, []);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setPreview(null); setResult(null); setBusy(true);
    try {
      const b64 = await readAsBase64(file);
      setFileName(file.name); setContentB64(b64);
      setPreview(await api.backup.previewRestore(b64, file.name));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível ler/analisar o ficheiro.');
    } finally { setBusy(false); }
  };

  const apply = async () => {
    if (!contentB64) return;
    if (!(await confirmDialog({ message: 'Restaurar este backup? Vai criar/actualizar os dados indicados. Nada é apagado.' }))) return;
    setBusy(true); setError(null);
    try {
      setResult(await api.backup.applyRestore(contentB64, fileName ?? undefined, storeId || null));
      toast.success('Restauro concluído.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível restaurar.');
    } finally { setBusy(false); }
  };

  const reset = () => { setFileName(null); setContentB64(null); setPreview(null); setResult(null); setError(null); if (inputRef.current) inputRef.current.value = ''; };

  return (
    <>
      <div className="content-head"><h2><IconShield size={20} /> Restauro backup</h2></div>

      <div className="card" style={{ maxWidth: 640 }}>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Sobe um ficheiro <strong>.ndbak</strong> (backup do próprio Ndombaxi System, descarregado em
          "Backup"). O sistema mostra sempre o que vai criar/actualizar antes de aplicar — nunca apaga nada.
        </p>
        {error ? <div className="banner danger">{error}</div> : null}
        {!preview ? (
          <label className="btn lg block" style={{ cursor: 'pointer', textAlign: 'center' }}>
            <input ref={inputRef} type="file" accept=".ndbak,application/gzip,application/octet-stream" hidden
              onChange={(e) => void onPick(e.target.files?.[0])} />
            <IconTruck size={16} /> {busy ? 'A analisar…' : 'Escolher ficheiro de backup (.ndbak)'}
          </label>
        ) : (
          <>
            <p style={{ fontSize: 13 }}>Ficheiro: <strong>{fileName}</strong>{preview.generatedAt ? ` · gerado em ${new Date(preview.generatedAt).toLocaleString('pt-PT')}` : ''}</p>
            <table className="sales-table">
              <thead><tr><th>Tabela</th><th>Linhas</th><th>A criar</th><th>A actualizar</th></tr></thead>
              <tbody>
                {preview.tables.filter((t) => t.rows > 0).map((t) => (
                  <tr key={t.table}>
                    <td data-label="Tabela">{TABLE_LABEL[t.table] ?? t.table}</td>
                    <td data-label="Linhas">{t.rows}</td>
                    <td data-label="A criar">{t.toInsert}</td>
                    <td data-label="A actualizar">{t.toUpdate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!result && preview.tables.some((t) => t.table === 'stock_items' && t.rows > 0) ? (
              <div className="field">
                <label>Se alguma loja do backup já não existir, o stock dela vai para</label>
                <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                  <option value="">(deixar essas linhas por conta do restauro)</option>
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            ) : null}
            {!result ? (
              <div className="row" style={{ gap: 10, marginTop: 12 }}>
                <button className="btn ghost lg" onClick={reset} disabled={busy}>Cancelar</button>
                <button className="btn lg" style={{ flex: 1 }} onClick={() => void apply()} disabled={busy}>
                  {busy ? 'A restaurar…' : 'Confirmar e restaurar'}
                </button>
              </div>
            ) : (
              <>
                <div className="banner success" style={{ marginTop: 12 }}>Restauro aplicado.</div>
                <table className="sales-table">
                  <thead><tr><th>Tabela</th><th>Criados</th><th>Actualizados</th><th>Falhas</th></tr></thead>
                  <tbody>
                    {result.tables.filter((t) => t.inserted + t.updated + t.failed > 0).map((t) => (
                      <tr key={t.table}>
                        <td data-label="Tabela">{TABLE_LABEL[t.table] ?? t.table}</td>
                        <td data-label="Criados">{t.inserted}</td>
                        <td data-label="Actualizados">{t.updated}</td>
                        <td data-label="Falhas">{t.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn lg block" style={{ marginTop: 10 }} onClick={reset}>Concluir</button>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
