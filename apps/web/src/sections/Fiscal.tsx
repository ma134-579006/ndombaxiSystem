import { confirmDialog, toast } from '../components/feedback';
import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AgtConfig, AgtExtraField, PlatformSigningStatus, UpdateAgtInput } from '../api/types';
import { IconCheck, IconPlus, IconTrash } from '../components/Icons';

export function Fiscal() {
  const [cfg, setCfg] = useState<AgtConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  // Credencial de comunicação AGT: campo write-only (nunca chega em claro do servidor).
  const [apiKeyInput, setApiKeyInput] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setCfg(await api.fiscal.get());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar a configuração fiscal.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const set = <K extends keyof AgtConfig>(k: K, v: AgtConfig[K]) => {
    setOk(false);
    setCfg((c) => (c ? ({ ...c, [k]: v } as AgtConfig) : c));
  };
  const setExtra = (i: number, patch: Partial<AgtExtraField>) =>
    setCfg((c) => (c ? { ...c, extraFields: c.extraFields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) } : c));
  const addExtra = () =>
    setCfg((c) => (c ? { ...c, extraFields: [...c.extraFields, { key: '', label: '', value: '', showOnReceipt: false, showOnReport: false }] } : c));
  const removeExtra = (i: number) =>
    setCfg((c) => (c ? { ...c, extraFields: c.extraFields.filter((_, idx) => idx !== i) } : c));

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const dto: UpdateAgtInput = {
        environment: cfg.environment,
        softwareCertificateNumber: cfg.softwareCertificateNumber,
        productId: cfg.productId,
        productVersion: cfg.productVersion,
        sourceId: cfg.sourceId,
        taxAccountingBasis: cfg.taxAccountingBasis,
        taxEntity: cfg.taxEntity,
        saftVersion: cfg.saftVersion,
        receiptLegend: cfg.receiptLegend ?? '',
        reportFooter: cfg.reportFooter ?? '',
        extraFields: cfg.extraFields.filter((f) => f.key || f.label || f.value),
        communicationEnabled: cfg.communicationEnabled,
        endpointUrl: cfg.endpointUrl ?? '',
        // Só envia a credencial se o gestor escreveu algo (mantém a actual senão).
        ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {}),
      };
      setCfg(await api.fiscal.update(dto));
      setApiKeyInput('');
      setOk(true);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível guardar.');
    } finally {
      setSaving(false);
    }
  };

  const subscribe = async () => {
    if (!(await confirmDialog({ message: 'Marcar o sistema como subscrito à AGT?' }))) return;
    try {
      setCfg(await api.fiscal.subscribe());
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Operação falhou.');
    }
  };

  if (loading) return <div className="loading">A carregar a configuração fiscal…</div>;
  if (!cfg) return <div className="banner danger">{error ?? 'Configuração indisponível.'}</div>;

  return (
    <>
      {ok ? <div className="banner success"><IconCheck size={18} /> Configuração guardada.</div> : null}

      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>Subscrição AGT</h3>
          <span className="spacer" />
          {cfg.subscribed ? (
            <span className="badge" style={{ color: 'var(--success)', borderColor: 'var(--success)' }}><span className="dot" /> Subscrito</span>
          ) : (
            <button className="btn sm" onClick={subscribe}>Subscrever à AGT</button>
          )}
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          Configure aqui, sem código, todos os dados que a AGT fornece e as legendas que constam nos recibos/relatórios.
        </p>
      </div>

      <SigningKeyCard />

      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>Comunicação eletrónica à AGT</h3>
          <span className="spacer" />
          <label className="row" style={{ gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={cfg.communicationEnabled} onChange={(e) => set('communicationEnabled', e.target.checked)} />
            Ativa
          </label>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Contrato da PLATAFORMA com a AGT (Decreto Presidencial 71/25): endpoint e credencial únicos,
          usados por todas as empresas para comunicar os SEUS próprios documentos, sob o seu NIF.
          Enquanto não houver endpoint oficial da AGT, deixa desativado — não afeta a faturação.
        </p>
        <div className="field"><label>URL do serviço web da AGT</label><input value={cfg.endpointUrl ?? ''} onChange={(e) => set('endpointUrl', e.target.value)} placeholder="https://…agt.gov.ao/…" /></div>
        <div className="field">
          <label>Credencial / token {cfg.hasApiKey ? <span className="muted">(guardada: {cfg.apiKeyMask})</span> : <span className="muted">(nenhuma guardada)</span>}</label>
          <input type="password" value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)} placeholder="Deixa vazio para manter a actual" autoComplete="new-password" />
        </div>
      </div>

      <div className="card">
        <h3>Identificação do software (SAF-T)</h3>
        <div className="grid-2">
          <div className="field">
            <label>Ambiente</label>
            <select value={cfg.environment} onChange={(e) => set('environment', e.target.value)}>
              <option value="TEST">TEST</option>
              <option value="PRODUCTION">PRODUCTION</option>
            </select>
          </div>
          <div className="field"><label>Nº de validação AGT</label><input value={cfg.softwareCertificateNumber} onChange={(e) => set('softwareCertificateNumber', e.target.value)} /></div>
        </div>
        <div className="grid-2">
          <div className="field"><label>ProductID</label><input value={cfg.productId} onChange={(e) => set('productId', e.target.value)} /></div>
          <div className="field"><label>Versão do produto</label><input value={cfg.productVersion} onChange={(e) => set('productVersion', e.target.value)} /></div>
        </div>
        <div className="grid-2">
          <div className="field"><label>SourceID</label><input value={cfg.sourceId} onChange={(e) => set('sourceId', e.target.value)} /></div>
          <div className="field"><label>Versão SAF-T</label><input value={cfg.saftVersion} onChange={(e) => set('saftVersion', e.target.value)} /></div>
        </div>
        <div className="grid-2">
          <div className="field"><label>Tax Accounting Basis</label><input value={cfg.taxAccountingBasis} onChange={(e) => set('taxAccountingBasis', e.target.value)} /></div>
          <div className="field"><label>Tax Entity</label><input value={cfg.taxEntity} onChange={(e) => set('taxEntity', e.target.value)} /></div>
        </div>
      </div>

      <div className="card">
        <h3>Legendas dos documentos</h3>
        <div className="field"><label>Legenda do recibo</label><textarea value={cfg.receiptLegend ?? ''} onChange={(e) => set('receiptLegend', e.target.value)} placeholder="Ex.: Processado por programa validado nº …/AGT" /></div>
        <div className="field"><label>Rodapé dos relatórios</label><textarea value={cfg.reportFooter ?? ''} onChange={(e) => set('reportFooter', e.target.value)} /></div>
      </div>

      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>Campos livres</h3>
          <span className="muted" style={{ fontSize: 13 }}>Para qualquer exigência futura da AGT — sem código</span>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={addExtra}><IconPlus size={15} /> Adicionar campo</button>
        </div>
        {cfg.extraFields.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>Sem campos adicionais.</p>
        ) : (
          cfg.extraFields.map((f, i) => (
            <div key={i} style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
              <div className="grid-2">
                <div className="field"><label>Chave</label><input value={f.key} onChange={(e) => setExtra(i, { key: e.target.value })} placeholder="ex.: atcud" /></div>
                <div className="field"><label>Rótulo</label><input value={f.label} onChange={(e) => setExtra(i, { label: e.target.value })} placeholder="ex.: ATCUD" /></div>
              </div>
              <div className="field"><label>Valor</label><input value={f.value} onChange={(e) => setExtra(i, { value: e.target.value })} /></div>
              <div className="row" style={{ gap: 18 }}>
                <label className="row" style={{ gap: 8, fontSize: 13 }}><input type="checkbox" checked={!!f.showOnReceipt} onChange={(e) => setExtra(i, { showOnReceipt: e.target.checked })} /> No recibo</label>
                <label className="row" style={{ gap: 8, fontSize: 13 }}><input type="checkbox" checked={!!f.showOnReport} onChange={(e) => setExtra(i, { showOnReport: e.target.checked })} /> No relatório</label>
                <span className="spacer" />
                <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => removeExtra(i)}><IconTrash size={16} /></button>
              </div>
            </div>
          ))
        )}
      </div>

      <button className="btn lg" onClick={save} disabled={saving}>{saving ? 'A guardar…' : 'Guardar configuração fiscal'}</button>
    </>
  );
}

/**
 * Chave de assinatura fiscal da PLATAFORMA (certificação do software na AGT).
 * O par RSA-2048 é gerado no servidor; a PRIVADA nunca sai de lá (cifrada em
 * repouso). Aqui exporta-se a PÚBLICA (public.pem) para anexar no portal da
 * AGT, junto com a "Versão da Chave Pública" (1, 2, … — incrementa na rotação).
 */
function SigningKeyCard() {
  const [st, setSt] = useState<PlatformSigningStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setSt(await api.fiscal.signingKey()); } catch { /* mantém */ }
  };
  useEffect(() => { void load(); }, []);

  const provision = async () => {
    const msg = st?.hasKey
      ? 'RODAR a chave da plataforma (nova RSA-2048)? A versão incrementa e o portal da AGT terá de receber o novo public.txt. Os documentos já assinados continuam verificáveis.'
      : 'Gerar o par de chaves RSA-2048 da plataforma?';
    if (!(await confirmDialog({ message: msg, danger: !!st?.hasKey }))) return;
    setBusy(true);
    try {
      setSt(await api.fiscal.provisionSigningKey());
      toast.success('Chave da plataforma pronta. Exporta a chave pública (.txt) e anexa no portal da AGT.');
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao gerar a chave.'); }
    finally { setBusy(false); }
  };

  const exportPem = async () => {
    setBusy(true);
    try {
      const r = await api.fiscal.exportPublicKey();
      // Descarrega a chave PÚBLICA como .txt (o portal da AGT exige .txt, não
      // aceita .pem). Conteúdo = mesmo bloco PEM; só a pública sai do servidor.
      const blob = new Blob([r.pem], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = r.fileName || 'public.txt';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Chave pública exportada como ${r.fileName || 'public.txt'} (versão ${r.keyVersion}, ${r.algorithm}) — anexa este .txt no portal da AGT.`);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao exportar.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="row">
        <h3 style={{ margin: 0 }}>🔑 Chave pública (portal AGT)</h3>
        <span className="spacer" />
        {st?.hasKey ? (
          <span className="badge" style={{ color: 'var(--success)', borderColor: 'var(--success)' }}>
            <span className="dot" /> Versão da Chave Pública: {st.keyVersion}
          </span>
        ) : (
          <span className="badge">Sem chave</span>
        )}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Par RSA do PRODUTOR do software (requisito da certificação): a chave privada assina os
        documentos e <strong>nunca sai do servidor</strong>; a pública anexa-se no portal da AGT
        <strong> como ficheiro .txt</strong> (o portal não aceita .pem). No campo «Versão da Chave Pública» do portal indica <strong>{st?.hasKey ? st.keyVersion : 1}</strong>
        {' '}— começa em 1 e incrementa a cada rotação da chave.
      </p>
      {st?.hasKey && st.modulusBits < 2048 ? (
        <div className="banner warn" style={{ fontSize: 12.5 }}>
          ⚠ A chave atual é RSA-{st.modulusBits}: a documentação oficial da Faturação
          Eletrónica AGT (2026) exige <strong>RSA mínimo 2048 bits</strong>.
          Roda a chave para RSA-2048 antes de submeter ao portal (no campo Hash do
          SAF-T continua a ir o hash da cadeia — por desenho, não é bloqueio).
        </div>
      ) : null}
      {st?.hasKey ? (
        <p className="muted" style={{ fontSize: 12 }}>
          {st.algorithm} · RSA-{st.modulusBits} · criada em {st.createdAt ? new Date(st.createdAt).toLocaleString('pt-PT') : '—'}
          {st.previousVersions.length ? ` · versões anteriores: ${st.previousVersions.join(', ')}` : ''}
          <br />Impressão digital (SHA-256): <code style={{ fontSize: 11 }}>{st.publicKeyFingerprint?.slice(0, 32)}…</code>
        </p>
      ) : null}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" onClick={provision} disabled={busy}>
          {busy ? 'A processar…' : st?.hasKey ? '↻ Rodar chave (nova versão, RSA-2048)' : 'Gerar par de chaves RSA-2048'}
        </button>
        <button className="btn ghost" onClick={exportPem} disabled={busy || !st?.hasKey}>
          ⬇ Exportar chave pública (.txt p/ AGT)
        </button>
      </div>
    </div>
  );
}
