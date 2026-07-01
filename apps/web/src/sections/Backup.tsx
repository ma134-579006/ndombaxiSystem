import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { BackupMeta, BackupSettings } from '../api/types';
import { toast, confirmDialog } from '../components/feedback';
import { IconShield, IconTruck, IconTrash, IconRefresh } from '../components/Icons';
import { Switch } from '../components/ui';

const TABLE_LABEL: Record<string, string> = {
  product_categories: 'Categorias', products: 'Produtos', product_recipes: 'Fichas técnicas',
  product_batches: 'Lotes', stores: 'Lojas', stock_items: 'Stock', customers: 'Clientes',
  suppliers: 'Fornecedores', receivables: 'Contas a receber', payables: 'Contas a pagar',
  employees: 'Funcionários', site_settings: 'Configurações',
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
function fmtDate(s: string | null): string {
  if (!s) return 'nunca';
  try { return new Date(s).toLocaleString('pt-PT'); } catch { return s; }
}

/** Backup dos dados de gestão (produtos, clientes, fornecedores, contas, etc.):
 *  manual ou automático (diário/semanal). Nunca inclui credenciais nem facturas
 *  (já protegidas pela imutabilidade fiscal — DP 71/25). */
export function Backup() {
  const [settings, setSettings] = useState<BackupSettings | null>(null);
  const [list, setList] = useState<BackupMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([api.backup.settings(), api.backup.list()]);
      setSettings(s); setList(l);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao carregar o backup.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const toggleAuto = async (v: boolean) => {
    setSavingSettings(true);
    try { setSettings(await api.backup.updateSettings({ autoEnabled: v })); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); }
    finally { setSavingSettings(false); }
  };
  const setFrequency = async (freq: string) => {
    setSavingSettings(true);
    try { setSettings(await api.backup.updateSettings({ frequency: freq })); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); }
    finally { setSavingSettings(false); }
  };

  const runNow = async () => {
    setRunning(true);
    try { await api.backup.run(); toast.success('Backup criado com sucesso.'); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível criar o backup.'); }
    finally { setRunning(false); }
  };

  const download = async (id: string) => {
    try {
      const { content, fileName } = await api.backup.download(id);
      const blob = new Blob([Uint8Array.from(atob(content), (c) => c.charCodeAt(0))], { type: 'application/gzip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível descarregar.'); }
  };

  const remove = async (id: string) => {
    if (!(await confirmDialog({ message: 'Remover este backup? Esta ação não pode ser desfeita.' }))) return;
    try { await api.backup.remove(id); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível remover.'); }
  };

  if (loading) return <div className="loading">A carregar…</div>;

  return (
    <>
      <div className="content-head"><h2><IconShield size={20} /> Backup</h2></div>

      <div className="card" style={{ maxWidth: 640 }}>
        <h3 style={{ marginTop: 0 }}>Backup automático</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Guarda periodicamente os dados de gestão (produtos, clientes, fornecedores, stock,
          contas a pagar/receber, funcionários, configurações) para nunca se perderem.
        </p>
        <div className="switch-row">
          <span>Ativar backup automático</span>
          <Switch checked={settings?.autoEnabled ?? false} onChange={(v) => void toggleAuto(v)} />
        </div>
        {settings?.autoEnabled ? (
          <div className="field" style={{ maxWidth: 220 }}>
            <label>Frequência</label>
            <select value={settings.frequency} onChange={(e) => void setFrequency(e.target.value)} disabled={savingSettings}>
              <option value="DAILY">Diário</option>
              <option value="WEEKLY">Semanal</option>
            </select>
          </div>
        ) : null}
        <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Último backup automático: {fmtDate(settings?.lastAt ?? null)}</p>
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
        <div className="row">
          <h3 style={{ margin: 0 }}>Backup manual</h3>
          <span className="spacer" />
          <button className="btn lg" onClick={() => void runNow()} disabled={running}>
            {running ? 'A criar…' : <><IconRefresh size={16} /> Fazer backup agora</>}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 4px' }}><h3 style={{ margin: 0 }}>Backups guardados</h3></div>
        {list.length === 0 ? (
          <div className="empty" style={{ padding: 16 }}><p>Ainda não há backups. Faz o primeiro acima.</p></div>
        ) : (
          <table className="sales-table">
            <thead><tr><th>Data</th><th>Tipo</th><th>Conteúdo</th><th>Tamanho</th><th>Autor</th><th></th></tr></thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.id}>
                  <td data-label="Data">{fmtDate(b.created_at)}</td>
                  <td data-label="Tipo">{b.kind === 'AUTO' ? 'Automático' : 'Manual'}</td>
                  <td data-label="Conteúdo" style={{ fontSize: 12.5 }}>
                    {Object.entries(b.tables_meta).filter(([, n]) => n > 0).map(([t, n]) => `${TABLE_LABEL[t] ?? t}: ${n}`).join(' · ') || '—'}
                  </td>
                  <td data-label="Tamanho">{fmtBytes(b.size_bytes)}</td>
                  <td data-label="Autor">{b.created_by_name ?? '—'}</td>
                  <td data-label="">
                    <button className="btn sm ghost" onClick={() => void download(b.id)} title="Descarregar"><IconTruck size={14} /></button>
                    <button className="btn sm ghost" onClick={() => void remove(b.id)} title="Remover"><IconTrash size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
