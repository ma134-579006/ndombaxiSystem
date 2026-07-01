import { confirmDialog, toast } from '../components/feedback';
import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AgtConfig, AgtExtraField, UpdateAgtInput } from '../api/types';
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
