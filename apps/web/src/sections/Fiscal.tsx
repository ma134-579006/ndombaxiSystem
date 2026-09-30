import { confirmDialog, toast } from '../components/feedback';
import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AgtConfig, AgtExtraField, PlatformSigningStatus, UpdateAgtInput } from '../api/types';
import { IconCard, IconCheck, IconCpu, IconPlus, IconReceipt, IconTrash } from '../components/Icons';
import { EinvoiceCard } from './EinvoiceCard';

type Tab = 'saft' | 'fe' | 'docs';

function Dot({ tone }: { tone: 'ok' | 'off' | 'bad' }) {
  return <span className={`fx-dot ${tone}`} aria-hidden="true" />;
}

export function Fiscal() {
  const [cfg, setCfg] = useState<AgtConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>('saft');
  // Credencial de comunicação AGT: campo write-only (nunca chega em claro do servidor).
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [key, setKey] = useState<PlatformSigningStatus | null>(null);
  const [fe, setFe] = useState<Record<string, any> | null>(null);

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
  const refreshStatus = useCallback(async () => {
    try { setKey(await api.fiscal.signingKey()); } catch { /* mantém */ }
    try { setFe(await api.fiscal.feConfig()); } catch { /* mantém */ }
  }, []);
  useEffect(() => { void load(); void refreshStatus(); }, [refreshStatus]);

  const set = <K extends keyof AgtConfig>(k: K, v: AgtConfig[K]) => {
    setDirty(true);
    setCfg((c) => (c ? ({ ...c, [k]: v } as AgtConfig) : c));
  };
  const setExtra = (i: number, patch: Partial<AgtExtraField>) => {
    setDirty(true);
    setCfg((c) => (c ? { ...c, extraFields: c.extraFields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) } : c));
  };
  const addExtra = () => {
    setDirty(true);
    setCfg((c) => (c ? { ...c, extraFields: [...c.extraFields, { key: '', label: '', value: '', showOnReceipt: false, showOnReport: false }] } : c));
  };
  const removeExtra = (i: number) => {
    setDirty(true);
    setCfg((c) => (c ? { ...c, extraFields: c.extraFields.filter((_, idx) => idx !== i) } : c));
  };

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
      setDirty(false);
      toast.success('Configuração fiscal guardada.');
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

  const saftOk = !!key?.hasKey && key.modulusBits === 1024;
  const feState = fe?.enabled ? 'Activa' : fe?.ready ? 'Pronta' : 'Por configurar';

  return (
    <div className="fx">
      <div className="fx-stats">
        <div className="fx-stat">
          <span className="ic"><IconCheck size={20} /></span>
          <div>
            <div className="lb">Subscrição AGT</div>
            <div className="vl"><Dot tone={cfg.subscribed ? 'ok' : 'off'} />{cfg.subscribed ? 'Subscrito' : 'Não subscrito'}</div>
            <div className="sb">{cfg.environment === 'PRODUCTION' ? 'Ambiente de produção' : 'Ambiente de testes'}</div>
          </div>
        </div>
        <div className="fx-stat">
          <span className="ic"><IconReceipt size={20} /></span>
          <div>
            <div className="lb">SAF-T · Modelo 8</div>
            <div className="vl"><Dot tone={saftOk ? 'ok' : 'bad'} />{saftOk ? `Chave v${key?.keyVersion} · RSA-1024` : key?.hasKey ? `Chave RSA-${key.modulusBits}` : 'Sem chave'}</div>
            <div className="sb">{saftOk ? 'Assina o campo Hash (172 car.)' : 'Requer RSA-1024 com SHA-1'}</div>
          </div>
        </div>
        <div className="fx-stat">
          <span className="ic"><IconCpu size={20} /></span>
          <div>
            <div className="lb">Facturação electrónica</div>
            <div className="vl"><Dot tone={fe?.enabled ? 'ok' : 'off'} />{feState}</div>
            <div className="sb">{fe?.hasSoftwareKey ? `Chave do software RSA-${fe.softwareKeyBits} · v${fe.signatureVersion}` : 'Chave do software por gerar'}</div>
          </div>
        </div>
      </div>

      <div className="fx-tabs" role="tablist" aria-label="Secções fiscais">
        <button role="tab" aria-selected={tab === 'saft'} className={tab === 'saft' ? 'on' : ''} onClick={() => setTab('saft')}>SAF-T e certificação</button>
        <button role="tab" aria-selected={tab === 'fe'} className={tab === 'fe' ? 'on' : ''} onClick={() => setTab('fe')}>Facturação electrónica</button>
        <button role="tab" aria-selected={tab === 'docs'} className={tab === 'docs' ? 'on' : ''} onClick={() => setTab('docs')}>Documentos e legendas</button>
      </div>

      {tab === 'saft' ? (
        <>
          {!cfg.subscribed ? (
          <div className="fx-card">
            <div className="fx-card-h">
              <div>
                <h3>Subscrição à AGT</h3>
                <p>Estado do registo do sistema junto da AGT. Os dados que a AGT fornece e as legendas dos recibos configuram-se aqui, sem código.</p>
              </div>
              <button className="btn sm" onClick={subscribe}>Subscrever à AGT</button>
            </div>
          </div>
          ) : null}

          <SigningKeyCard st={key} onChanged={refreshStatus} />

          <div className="fx-card">
            <div className="fx-card-h">
              <div>
                <h3>Identificação do software (SAF-T)</h3>
                <p>Dados que vão no cabeçalho do ficheiro SAF-T (AO) e na certificação do programa.</p>
              </div>
            </div>
            <div className="fx-grid">
              <div className="field">
                <label>Ambiente</label>
                <select value={cfg.environment} onChange={(e) => set('environment', e.target.value)}>
                  <option value="TEST">Testes</option>
                  <option value="PRODUCTION">Produção</option>
                </select>
              </div>
              <div className="field"><label>Nº de validação AGT</label><input value={cfg.softwareCertificateNumber} onChange={(e) => set('softwareCertificateNumber', e.target.value)} /></div>
              <div className="field"><label>ProductID</label><input value={cfg.productId} onChange={(e) => set('productId', e.target.value)} /></div>
              <div className="field"><label>Versão do produto</label><input value={cfg.productVersion} onChange={(e) => set('productVersion', e.target.value)} /></div>
              <div className="field"><label>SourceID</label><input value={cfg.sourceId} onChange={(e) => set('sourceId', e.target.value)} /></div>
              <div className="field"><label>Versão SAF-T</label><input value={cfg.saftVersion} onChange={(e) => set('saftVersion', e.target.value)} /></div>
              <div className="field"><label>Tax Accounting Basis</label><input value={cfg.taxAccountingBasis} onChange={(e) => set('taxAccountingBasis', e.target.value)} /></div>
              <div className="field"><label>Tax Entity</label><input value={cfg.taxEntity} onChange={(e) => set('taxEntity', e.target.value)} /></div>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'fe' ? <EinvoiceCard onChanged={refreshStatus} /> : null}

      {tab === 'docs' ? (
        <>
          <div className="fx-card">
            <div className="fx-card-h">
              <div>
                <h3>Legendas dos documentos</h3>
                <p>Textos fixos impressos nos recibos e nos rodapés dos relatórios.</p>
              </div>
            </div>
            <div className="field"><label>Legenda do recibo</label><textarea value={cfg.receiptLegend ?? ''} onChange={(e) => set('receiptLegend', e.target.value)} placeholder="Ex.: Processado por programa validado nº …/AGT" /></div>
            <div className="field"><label>Rodapé dos relatórios</label><textarea value={cfg.reportFooter ?? ''} onChange={(e) => set('reportFooter', e.target.value)} /></div>
          </div>

          <div className="fx-card">
            <div className="fx-card-h">
              <div>
                <h3>Campos livres</h3>
                <p>Para qualquer exigência futura da AGT, sem alterar código.</p>
              </div>
              <button className="btn sm ghost" onClick={addExtra}><IconPlus size={15} /> Adicionar campo</button>
            </div>
            {cfg.extraFields.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>Sem campos adicionais.</p>
            ) : (
              cfg.extraFields.map((f, i) => (
                <div key={i} className="fx-extra">
                  <div className="fx-grid">
                    <div className="field"><label>Chave</label><input value={f.key} onChange={(e) => setExtra(i, { key: e.target.value })} placeholder="ex.: atcud" /></div>
                    <div className="field"><label>Rótulo</label><input value={f.label} onChange={(e) => setExtra(i, { label: e.target.value })} placeholder="ex.: ATCUD" /></div>
                    <div className="field"><label>Valor</label><input value={f.value} onChange={(e) => setExtra(i, { value: e.target.value })} /></div>
                  </div>
                  <div className="row" style={{ gap: 18 }}>
                    <label className="row" style={{ gap: 8, fontSize: 13 }}><input type="checkbox" checked={!!f.showOnReceipt} onChange={(e) => setExtra(i, { showOnReceipt: e.target.checked })} /> No recibo</label>
                    <label className="row" style={{ gap: 8, fontSize: 13 }}><input type="checkbox" checked={!!f.showOnReport} onChange={(e) => setExtra(i, { showOnReport: e.target.checked })} /> No relatório</label>
                    <span className="spacer" />
                    <button className="icon-btn" style={{ width: 36, height: 36 }} onClick={() => removeExtra(i)} aria-label="Remover campo"><IconTrash size={16} /></button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      ) : null}

      {tab !== 'fe' ? (
        <div className="fx-save">
          <span className="muted" style={{ fontSize: 13 }}>{dirty ? 'Tens alterações por guardar.' : 'Tudo guardado.'}</span>
          <button className="btn" onClick={save} disabled={saving || !dirty}>{saving ? 'A guardar…' : 'Guardar configuração'}</button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Chave de assinatura do SAF-T (Modelo 8 da AGT): RSA de 1024 bits, hash SHA-1.
 * A PRIVADA nunca sai do servidor (cifrada em repouso); exporta-se só a pública
 * (.txt) para a Declaração Modelo 8, com a «Versão da Chave Pública».
 */
function SigningKeyCard({ st, onChanged }: { st: PlatformSigningStatus | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  const provision = async () => {
    const msg = st?.hasKey
      ? 'RODAR a chave da plataforma (nova RSA-1024, Modelo 8)? A versão incrementa e a AGT terá de receber a nova chave pública (public.txt) com a Declaração Modelo 8 ANTES de submeteres novos documentos. Os documentos já assinados continuam verificáveis.'
      : 'Gerar o par de chaves RSA-1024 da plataforma (Modelo 8 da AGT)?';
    if (!(await confirmDialog({ message: msg, danger: !!st?.hasKey }))) return;
    setBusy(true);
    try {
      await api.fiscal.provisionSigningKey();
      onChanged();
      toast.success('Chave da plataforma pronta. Exporta a chave pública (.txt) e anexa no portal da AGT.');
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao gerar a chave.'); }
    finally { setBusy(false); }
  };

  const exportPem = async () => {
    setBusy(true);
    try {
      const r = await api.fiscal.exportPublicKey();
      // O portal da AGT exige .txt (não aceita .pem); o conteúdo é o mesmo bloco PEM.
      const blob = new Blob([r.pem], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = r.fileName || 'public.txt';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Chave pública exportada (${r.fileName || 'public.txt'}, versão ${r.keyVersion}).`);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao exportar.'); }
    finally { setBusy(false); }
  };

  const ok = !!st?.hasKey && st.modulusBits === 1024;

  return (
    <div className="fx-card">
      <div className="fx-card-h">
        <div>
          <h3>Chave de assinatura do SAF-T (Modelo 8)</h3>
          <p>Par RSA do produtor do software. A privada assina os documentos e nunca sai do servidor; a pública vai à AGT, em ficheiro .txt, com a Declaração Modelo 8.</p>
        </div>
        <span className={`fx-badge ${ok ? 'ok' : 'bad'}`}><Dot tone={ok ? 'ok' : 'bad'} />{st?.hasKey ? `Versão ${st.keyVersion}` : 'Sem chave'}</span>
      </div>

      {!ok ? (
        <div className="fx-note bad" role="alert">
          <span>
            <strong>{st?.hasKey ? `A chave actual é RSA-${st.modulusBits}.` : 'Ainda não há chave.'}</strong>{' '}
            O Modelo 8 exige RSA de 1024 bits com SHA-1 (assinatura de 172 caracteres no campo Hash). Enquanto a chave não cumprir, os documentos saem sem assinatura AGT e o SAF-T é rejeitado.
          </span>
        </div>
      ) : null}

      {st?.hasKey ? (
        <div className="fx-meta">
          <div><small>Algoritmo</small><b>RSA-{st.modulusBits}</b></div>
          <div><small>Versão</small><b>{st.keyVersion}</b></div>
          <div><small>Criada em</small><b>{st.createdAt ? new Date(st.createdAt).toLocaleDateString('pt-PT') : '—'}</b></div>
          <div><small>Versões anteriores</small><b>{st.previousVersions.length ? st.previousVersions.join(', ') : 'nenhuma'}</b></div>
          <div style={{ gridColumn: '1 / -1' }}><small>Impressão digital (SHA-256)</small><b className="mono">{st.publicKeyFingerprint?.slice(0, 40)}…</b></div>
        </div>
      ) : null}

      <div className="fx-actions">
        <button className="btn" onClick={provision} disabled={busy}>{busy ? 'A processar…' : st?.hasKey ? 'Rodar chave' : 'Gerar chave RSA-1024'}</button>
        <button className="btn ghost" onClick={exportPem} disabled={busy || !st?.hasKey}>Exportar chave pública (.txt)</button>
      </div>
    </div>
  );
}
