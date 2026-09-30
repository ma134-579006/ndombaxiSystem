import React, { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AppPlatform, AppReleaseInput, AppReleaseRow } from '../api/types';
import { confirmDialog, toast } from '../components/feedback';
import { Switch } from '../components/ui';
import { consumePrefill } from './releaseManifest';

/**
 * Gestão de Downloads — Super Admin.
 *
 * É aqui que se publica cada versão das aplicações. O fluxo é o que o utilizador
 * pediu: ele faz o upload do instalador para onde quiser (Drive, Mega, R2…) e
 * cola aqui o link. NADA de links fixos no código.
 *
 * Dois links distintos, e a diferença importa:
 *   • "Link do ficheiro" — o download direto. Uso do servidor; o cliente final
 *     nunca o vê.
 *   • "Página de downloads" — a página oficial do site para onde a app encaminha
 *     sempre o utilizador. É lá que estão o hash e a versão.
 */

const PLATFORMS: { id: AppPlatform; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    id: 'windows', label: 'Windows', hint: 'Instalador .exe (Windows 10/11, 64-bit)',
    icon: <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 5.5 10.5 4.4v7.1H3zM10.5 12.5v7.1L3 18.5v-6zM11.5 4.3 21 3v8.5h-9.5zM21 12.5V21l-9.5-1.3v-7.2z"/></svg>,
  },
  {
    id: 'android', label: 'Android', hint: 'APK ou AAB (Android 6 ou superior)',
    icon: <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 9h12v8a2 2 0 0 1-2 2h-1v3h-2v-3h-2v3H9v-3H8a2 2 0 0 1-2-2zM4 9.5A1.5 1.5 0 0 1 5.5 11v4A1.5 1.5 0 0 1 2.5 15v-4A1.5 1.5 0 0 1 4 9.5m16 0A1.5 1.5 0 0 1 21.5 11v4a1.5 1.5 0 0 1-3 0v-4A1.5 1.5 0 0 1 20 9.5M7.2 7.8A6 6 0 0 1 12 5.5a6 6 0 0 1 4.8 2.3z"/></svg>,
  },
  {
    id: 'ios', label: 'iPhone (iOS)', hint: 'Ficheiro .ipa ou link da App Store (iOS 13+)',
    icon: <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 3c.1 1.2-.4 2.3-1.1 3.1-.8.9-2 1.5-3 1.4-.1-1.1.4-2.3 1.1-3 .8-.9 2.1-1.5 3-1.5M18.7 17c-.5 1.2-.8 1.7-1.4 2.7-1 1.5-2.3 3.3-4 3.3-1.5 0-1.9-1-4-1-2 0-2.5 1-4 1-1.6 0-2.9-1.7-3.8-3.1C-.7 15.6-.2 9 3.8 8.2c1.2-.2 2 .5 3.1.5 1 0 1.7-.7 3.1-.7 1.3 0 2.4.6 3.1.9-2.8 1.6-2.3 5.6.5 6.3z"/></svg>,
  },
];

function emptyForm(platform: AppPlatform): AppReleaseInput & { notesText: string; fixesText: string } {
  return {
    platform, version: '', minSupported: '', fileUrl: '', downloadPageUrl: '',
    sha256: '', requirements: '', mandatory: false, published: false,
    notesText: '', fixesText: '',
  };
}

function fmtBytes(n: number | null): string {
  if (!n) return '—';
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
}

export function Downloads({ onOpenWizard }: { onOpenWizard?: () => void } = {}) {
  const [rows, setRows] = useState<AppReleaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<AppPlatform>('windows');
  const [form, setForm] = useState(emptyForm('windows'));
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.downloadsAdmin.list());
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Falha ao carregar.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  // Se o Assistente de Publicação deixou um pacote de pré-preenchimento, consome-o
  // ao montar: escolhe a plataforma e preenche o formulário (fica só rever e
  // publicar). O `published` fica sempre em falso — o admin decide.
  useEffect(() => {
    const p = consumePrefill();
    if (!p) return;
    setTab(p.platform);
    setEditingId(null);
    setForm({
      platform: p.platform, version: p.version, minSupported: p.minSupported,
      fileUrl: p.fileUrl, downloadPageUrl: p.downloadPageUrl, sha256: p.sha256,
      requirements: p.requirements, mandatory: p.mandatory, published: false,
      notesText: p.notes.join('\n'), fixesText: p.fixes.join('\n'),
    });
  }, []);

  const byPlatform = useMemo(
    () => rows.filter((r) => r.platform === tab),
    [rows, tab],
  );

  const resetForm = () => setForm(emptyForm(tab));

  // Preenche o formulário a partir de uma versão existente (editar).
  const editRow = (r: AppReleaseRow) => {
    setTab(r.platform);
    setForm({
      platform: r.platform, version: r.version, minSupported: r.minSupported ?? '',
      fileUrl: r.fileUrl, downloadPageUrl: r.downloadPageUrl ?? '', sha256: r.sha256 ?? '',
      requirements: r.requirements ?? '', mandatory: r.mandatory, published: r.published,
      notesText: (r.notes ?? []).join('\n'), fixesText: (r.fixes ?? []).join('\n'),
    });
    setEditingId(r.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async () => {
    if (!form.version.trim()) { toast.warning('Indique a versão (ex.: 1.0.0).'); return; }
    if (!form.fileUrl.trim()) { toast.warning('Cole o link do ficheiro (o instalador que carregou para o Drive/Mega/…).'); return; }
    setSaving(true);
    const payload: AppReleaseInput = {
      platform: form.platform,
      version: form.version.trim(),
      minSupported: form.minSupported?.trim() || undefined,
      fileUrl: form.fileUrl.trim(),
      downloadPageUrl: form.downloadPageUrl?.trim() || undefined,
      sha256: form.sha256?.trim() || undefined,
      requirements: form.requirements?.trim() || undefined,
      mandatory: form.mandatory,
      published: form.published,
      notes: form.notesText.split('\n').map((s) => s.trim()).filter(Boolean),
      fixes: form.fixesText.split('\n').map((s) => s.trim()).filter(Boolean),
    };
    try {
      if (editingId) {
        await api.downloadsAdmin.update(editingId, payload);
        toast.success('Versão atualizada. ✅');
      } else {
        await api.downloadsAdmin.create(payload);
        toast.success('Versão registada. ✅');
      }
      setEditingId(null);
      resetForm();
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível guardar.');
    } finally {
      setSaving(false);
    }
  };

  const publish = async (r: AppReleaseRow) => {
    if (!(await confirmDialog({
      message: `Publicar a versão ${r.version} para ${r.platform}? Passa a ser a versão que os aparelhos vão descarregar (as outras desta plataforma deixam de o ser).`,
    }))) return;
    try {
      await api.downloadsAdmin.publish(r.id);
      toast.success(`Versão ${r.version} publicada. 🚀`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível publicar.');
    }
  };

  const remove = async (r: AppReleaseRow) => {
    if (!(await confirmDialog({ message: `Remover a versão ${r.version} (${r.platform})?`, danger: true }))) return;
    try {
      await api.downloadsAdmin.remove(r.id);
      toast.success('Versão removida.');
      if (editingId === r.id) { setEditingId(null); resetForm(); }
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível remover.');
    }
  };

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <>
      <div className="content-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Gestão de Downloads</h2>
        {onOpenWizard && (
          <button className="btn primary" onClick={onOpenWizard} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5L13 3Z" /></svg>
            Preenchimento assistido
          </button>
        )}
      </div>

      <div className="banner info" style={{ marginBottom: 16 }}>
        Carregue o instalador para onde quiser (Google Drive, Mega, Cloudflare R2, GitHub Release…)
        e cole o link aqui. O cliente é sempre enviado para a <b>página oficial de downloads</b> do
        site — o link direto nunca lhe aparece.
      </div>

      {/* Separadores por plataforma */}
      <div className="tabs" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            className={`btn ${tab === p.id ? 'primary' : 'ghost'}`}
            onClick={() => { setTab(p.id); setEditingId(null); setForm(emptyForm(p.id)); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            {p.icon} {p.label}
          </button>
        ))}
      </div>

      {/* Formulário */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>
          {editingId ? 'Editar versão' : 'Nova versão'} — {PLATFORMS.find((p) => p.id === tab)?.label}
        </h3>
        <p className="muted" style={{ marginTop: -4 }}>{PLATFORMS.find((p) => p.id === tab)?.hint}</p>

        <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Versão *</label>
            <input value={form.version} onChange={(e) => set({ version: e.target.value })} placeholder="1.0.0" />
          </div>
          <div className="field">
            <label>Versão mínima suportada</label>
            <input value={form.minSupported} onChange={(e) => set({ minSupported: e.target.value })} placeholder="deixe vazio se não obrigar" />
          </div>
        </div>

        <div className="field">
          <label>Link do ficheiro (instalador) *</label>
          <input value={form.fileUrl} onChange={(e) => set({ fileUrl: e.target.value })} placeholder="https://drive.google.com/…  ·  https://mega.nz/…  ·  https://github.com/…/releases/…" />
        </div>

        <div className="field">
          <label>Página de downloads (para onde a app encaminha o cliente)</label>
          <input value={form.downloadPageUrl} onChange={(e) => set({ downloadPageUrl: e.target.value })} placeholder="https://ndombaxisystem.com/baixar" />
        </div>

        <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Requisitos mínimos</label>
            <input value={form.requirements} onChange={(e) => set({ requirements: e.target.value })} placeholder="Windows 10 ou superior, 64-bit" />
          </div>
          <div className="field">
            <label>Hash SHA-256 (integridade)</label>
            <input value={form.sha256} onChange={(e) => set({ sha256: e.target.value })} placeholder="cole o hash do ficheiro" />
          </div>
        </div>

        <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Novidades (uma por linha)</label>
            <textarea rows={4} value={form.notesText} onChange={(e) => set({ notesText: e.target.value })} placeholder={'Sincronização mais rápida\nNovo ecrã de arranque'} />
          </div>
          <div className="field">
            <label>Correções (uma por linha)</label>
            <textarea rows={4} value={form.fixesText} onChange={(e) => set({ fixesText: e.target.value })} placeholder={'Corrigido erro ao imprimir recibo'} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 24, margin: '8px 0 16px', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={!!form.mandatory} onChange={(v) => set({ mandatory: v })} />
            Atualização obrigatória (bloqueia a app antiga)
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Switch checked={!!form.published} onChange={(v) => set({ published: v })} />
            Publicar já (torna-a a versão mais recente)
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'A guardar…' : editingId ? 'Guardar alterações' : 'Registar versão'}
          </button>
          {editingId && (
            <button className="btn ghost" onClick={() => { setEditingId(null); resetForm(); }}>Cancelar</button>
          )}
        </div>
      </div>

      {/* Lista de versões da plataforma ativa */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Versões — {PLATFORMS.find((p) => p.id === tab)?.label}</h3>
        {loading ? (
          <div className="loading" style={{ padding: 16 }}>A carregar…</div>
        ) : byPlatform.length === 0 ? (
          <p className="muted">Ainda não há nenhuma versão registada para esta plataforma.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Versão</th><th>Estado</th><th>Tamanho</th><th>Publicada em</th><th></th>
              </tr>
            </thead>
            <tbody>
              {byPlatform.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.version}</b>
                    {r.mandatory && <span className="badge warning" style={{ marginLeft: 6 }}>obrigatória</span>}
                    {r.minSupported && <div className="muted" style={{ fontSize: 12 }}>mín. {r.minSupported}</div>}
                  </td>
                  <td>
                    {r.published
                      ? <span className="badge success">publicada</span>
                      : <span className="badge">rascunho</span>}
                  </td>
                  <td>{fmtBytes(r.fileSize)}</td>
                  <td>{new Date(r.releasedAt).toLocaleDateString('pt-PT')}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {!r.published && (
                      <button className="btn small primary" onClick={() => void publish(r)}>Publicar</button>
                    )}
                    <button className="btn small ghost" onClick={() => editRow(r)}>Editar</button>
                    <button className="btn small danger" onClick={() => void remove(r)}>Remover</button>
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
