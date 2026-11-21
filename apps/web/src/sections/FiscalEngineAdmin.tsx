import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { FiscalEngineCatalog, FiscalEngineCompanyDetail, FiscalEngineOverview } from '../api/types';
import { confirmDialog, toast } from '../components/feedback';
import { Switch } from '../components/ui';

/** Indicadores da ligação (backend: fiscal-engine.policy.ts). */
export const INDICATOR: Record<string, { t: string; c: 'ok' | 'off' | 'bad' }> = {
  NAO_CONFIGURADA: { t: 'Integração não configurada', c: 'off' },
  CREDENCIAIS_POR_INSERIR: { t: 'Credenciais por inserir', c: 'off' },
  LIGACAO_NAO_TESTADA: { t: 'Ligação não testada', c: 'off' },
  CREDENCIAIS_INVALIDAS: { t: 'Credenciais inválidas', c: 'bad' },
  CONTA_DIFERENTE: { t: 'Conta Vendus de outro contribuinte', c: 'bad' },
  SUBSCRICAO_INACTIVA: { t: 'Subscrição inactiva', c: 'bad' },
  CAIXA_NAO_API: { t: 'Caixa Vendus não é do tipo API', c: 'bad' },
  SERVICO_INDISPONIVEL: { t: 'Serviço indisponível', c: 'bad' },
  CONTA_IDENTIFICADA: { t: 'Conta identificada', c: 'off' },
  CONFIGURACAO_FISCAL_PENDENTE: { t: 'Configuração fiscal pendente', c: 'off' },
  CERTIFICACAO_POR_CONFIRMAR: { t: 'Certificação do fornecedor por confirmar', c: 'off' },
  VALIDADE_POR_CONFIRMAR: { t: 'Validade do fornecedor por confirmar', c: 'bad' },
  TESTES_PENDENTES: { t: 'Testes pendentes', c: 'off' },
  PRONTO_PARA_ACTIVACAO: { t: 'Pronto para activação', c: 'ok' },
  MOTOR_ACTIVO: { t: 'Motor fiscal activo', c: 'ok' },
  INTEGRACAO_SUSPENSA: { t: 'Integração suspensa', c: 'bad' },
};

const CHECK_LABEL: Record<string, string> = {
  chave: 'API KEY guardada',
  ligacao: 'Ligação testada',
  conta: 'Conta do mesmo NIF',
  pais: 'Conta de Angola (AO)',
  caixa: 'Caixa do tipo API com subscrição activa',
  pagamentos: 'Forma de pagamento Numerário associada',
  fe_vendus: 'Factura Electrónica configurada no Vendus',
  validade: 'Validação AGT do fornecedor confirmada',
  testes: 'Testes em modo Formação concluídos',
  switch: 'Motor externo ligado no Super Admin',
};

const ENGINE: Record<string, string> = { LPS: 'Motor próprio LPS', VENDUS: 'Cegid Vendus', SUSPENSO: 'Emissão suspensa' };
const VALIDITY: Record<string, { t: string; c: 'ok' | 'off' | 'bad' }> = {
  CONFIRMADO: { t: 'Confirmada', c: 'ok' },
  PENDENTE: { t: 'Pendente', c: 'off' },
  EXPIRADO: { t: 'Expirada', c: 'bad' },
};
const PAY_TYPES: [string, string][] = [['CASH', 'Numerário'], ['CARD', 'Cartão (TPA)'], ['TRANSFER', 'Transferência'], ['REFERENCE', 'Referência'], ['EXPRESS', 'Multicaixa Express']];

function Badge({ t, c }: { t: string; c: 'ok' | 'off' | 'bad' }) {
  return <span className={`fx-badge ${c}`}><span className={`fx-dot ${c}`} />{t}</span>;
}

async function fileToBase64(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/** Super Admin → Fiscal → Facturação Electrónica e Software de Terceiros. */
export function FiscalEngineAdmin() {
  const [ov, setOv] = useState<FiscalEngineOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [p, setP] = useState<Record<string, string>>({});
  const [lps, setLps] = useState<Record<string, string>>({});
  const [cid, setCid] = useState('');
  const [co, setCo] = useState<FiscalEngineCompanyDetail | null>(null);
  const [cat, setCat] = useState<FiscalEngineCatalog | null>(null);
  const [key, setKey] = useState('');
  const [reg, setReg] = useState('');
  const [tnif, setTnif] = useState('');
  const [src, setSrc] = useState('');
  const [pay, setPay] = useState<Record<string, string>>({});

  const fill = (o: FiscalEngineOverview) => {
    setOv(o);
    const s = o.settings;
    setP({
      vendusApiVersion: s.vendusApiVersion, providerProducer: s.providerProducer, providerSoftware: s.providerSoftware,
      providerValidationNo: s.providerValidationNo, providerFeCertNo: s.providerFeCertNo, providerVersion: s.providerVersion,
      providerValidFrom: s.providerValidFrom ?? '', providerValidUntil: s.providerValidUntil ?? '', providerEvidenceUrl: s.providerEvidenceUrl,
      providerVerifiedBy: s.providerVerifiedBy, alertDays: s.alertDays.join(', '),
    });
    setLps({ lpsValidationNo: s.lpsValidationNo, lpsValidationVersion: s.lpsValidationVersion });
  };

  const guard = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Operação falhou.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    api.fiscalEngine.overview().then(fill).catch(() => undefined);
  }, []);

  const loadCompany = async (id: string) => {
    setCid(id);
    setCat(null);
    setKey('');
    if (!id) return setCo(null);
    await guard(async () => {
      const d = await api.fiscalEngine.company(id);
      setCo(d);
      setReg(d.link?.registerId ?? '');
      setTnif(d.link?.taxpayerNif ?? '');
      setPay((d.link?.paymentMap as Record<string, string>) ?? {});
    });
  };
  const applyCompany = async (d: FiscalEngineCompanyDetail) => {
    setCo(d);
    setOv(await api.fiscalEngine.overview());
  };

  const saveProvider = (extra: Record<string, unknown> = {}) =>
    guard(async () => {
      const days = p.alertDays.split(/[,\s]+/).filter(Boolean).map(Number);
      const dto: Record<string, unknown> = { ...p, alertDays: days, providerValidFrom: p.providerValidFrom || null, providerValidUntil: p.providerValidUntil || null, ...extra };
      fill(await api.fiscalEngine.saveSettings(dto));
    }, 'Guardado.');

  const uploadEvidence = (kind: 'PROVIDER_VALIDITY' | 'LPS_VALIDATION') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    await guard(async () => {
      const ev = await api.fiscalEngine.uploadEvidence({ kind, filename: f.name, contentType: f.type, base64: await fileToBase64(f) });
      if (kind === 'PROVIDER_VALIDITY') {
        const days = p.alertDays.split(/[,\s]+/).filter(Boolean).map(Number);
        fill(await api.fiscalEngine.saveSettings({ ...p, alertDays: days, providerValidFrom: p.providerValidFrom || null, providerValidUntil: p.providerValidUntil || null, providerEvidenceId: ev.id }));
      } else {
        fill(await api.fiscalEngine.saveLps({ lpsEvidenceId: ev.id }));
      }
    }, 'Evidência carregada.');
  };

  const openEvidence = (id: string | null) =>
    id && guard(async () => {
      const url = URL.createObjectURL(await api.fiscalEngine.evidence(id));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    });

  const toggleSwitch = (on: boolean) => guard(async () => fill(await api.fiscalEngine.saveSettings({ vendusEnabled: on })), on ? 'Motor externo ligado.' : 'Motor externo desligado.');

  const test = () =>
    guard(async () => {
      const r = await api.fiscalEngine.test(cid);
      setCat(r.catalog);
      await applyCompany(r);
      if (r.test.ok) toast.success('Ligação válida.');
      else toast.error(r.test.message || r.test.code);
    });

  const s = ov?.settings;
  const v = ov?.validity;
  const link = co?.link;

  return (
    <>
      {ov?.alerts.map((a) => (
        <div key={a.text} className={`fx-note ${a.level === 'bad' ? 'bad' : ''}`} role="alert">{a.text}</div>
      ))}

      <div className="fx-card">
        <div className="fx-card-h">
          <h3>Cegid Vendus · motor fiscal externo</h3>
          {s ? <Badge t={s.vendusEnabled ? 'Ligado' : 'Desligado'} c={s.vendusEnabled ? 'ok' : 'off'} /> : null}
        </div>
        <div className="switch-row fe-switch">
          <span>Usar motor fiscal externo — Cegid Vendus</span>
          <Switch checked={!!s?.vendusEnabled} onChange={(on) => void toggleSwitch(on)} />
        </div>
        <div className="fx-grid" style={{ marginTop: 12 }}>
          <div className="field"><label>Fornecedor</label><input value="Cegid Vendus" readOnly /></div>
          <div className="field"><label>País</label><input value="Angola" readOnly /></div>
          <div className="field"><label>API Base URL</label><input value={s?.vendusBaseUrl ?? ''} readOnly /></div>
          <div className="field">
            <label>Versão da API</label>
            <select value={p.vendusApiVersion ?? '1.1'} onChange={(e) => setP({ ...p, vendusApiVersion: e.target.value })}>
              <option value="1.1">1.1</option>
              <option value="1.2">1.2</option>
              <option value="1.0">1.0</option>
            </select>
          </div>
        </div>
      </div>

      <div className="fx-card">
        <div className="fx-card-h">
          <h3>Validação AGT do fornecedor</h3>
          {v ? <Badge {...VALIDITY[v.status]} /> : null}
        </div>
        <div className="fx-meta">
          <div><small>Estado</small><b>{v ? VALIDITY[v.status].t : '—'}</b></div>
          <div><small>Dias até ao vencimento</small><b>{v?.daysLeft ?? '—'}</b></div>
          <div><small>Última verificação</small><b>{fmtDate(s?.providerVerifiedAt)}</b></div>
          <div><small>Em falta</small><b>{v?.missing.length ? v.missing.join(', ') : '—'}</b></div>
        </div>
        <div className="fx-grid">
          <div className="field"><label>Produtor legal do software</label><input value={p.providerProducer ?? ''} onChange={(e) => setP({ ...p, providerProducer: e.target.value })} /></div>
          <div className="field"><label>Software</label><input value={p.providerSoftware ?? ''} onChange={(e) => setP({ ...p, providerSoftware: e.target.value })} /></div>
          <div className="field"><label>Número de validação</label><input value={p.providerValidationNo ?? ''} onChange={(e) => setP({ ...p, providerValidationNo: e.target.value })} /></div>
          <div className="field"><label>Certificado de Facturação Electrónica</label><input value={p.providerFeCertNo ?? ''} onChange={(e) => setP({ ...p, providerFeCertNo: e.target.value })} /></div>
          <div className="field"><label>Versão validada</label><input value={p.providerVersion ?? ''} onChange={(e) => setP({ ...p, providerVersion: e.target.value })} /></div>
          <div className="field"><label>Data de início</label><input type="date" value={p.providerValidFrom ?? ''} onChange={(e) => setP({ ...p, providerValidFrom: e.target.value })} /></div>
          <div className="field"><label>Data de validade</label><input type="date" value={p.providerValidUntil ?? ''} onChange={(e) => setP({ ...p, providerValidUntil: e.target.value })} /></div>
          <div className="field"><label>Fonte oficial (URL)</label><input type="url" value={p.providerEvidenceUrl ?? ''} onChange={(e) => setP({ ...p, providerEvidenceUrl: e.target.value })} /></div>
          <div className="field"><label>Responsável pela verificação</label><input value={p.providerVerifiedBy ?? ''} onChange={(e) => setP({ ...p, providerVerifiedBy: e.target.value })} /></div>
          <div className="field"><label>Alertas (dias antes)</label><input value={p.alertDays ?? ''} onChange={(e) => setP({ ...p, alertDays: e.target.value })} inputMode="numeric" /></div>
          <div className="field">
            <label>Documento comprovativo (PDF, PNG, JPEG)</label>
            <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={uploadEvidence('PROVIDER_VALIDITY')} disabled={busy} />
          </div>
        </div>
        <div className="fx-actions">
          <button className="btn" disabled={busy} onClick={() => void saveProvider()}>Guardar</button>
          <button className="btn ghost" disabled={busy} onClick={() => void saveProvider({ verifyNow: true })}>Registar verificação de hoje</button>
          <button className="btn ghost" disabled={busy || !s?.providerEvidenceId} onClick={() => void openEvidence(s?.providerEvidenceId ?? null)}>Ver comprovativo</button>
        </div>
      </div>

      <div className="fx-card">
        <div className="fx-card-h"><h3>Empresas</h3></div>
        <div className="fe-list">
          {ov?.companies.map((c) => (
            <button key={c.id} className={`fe-row ${cid === c.id ? 'on' : ''}`} onClick={() => void loadCompany(c.id)}>
              <span className="fe-row-n"><b>{c.name}</b><small>NIF {c.nif}</small></span>
              <span className="fe-row-s">
                <Badge t={ENGINE[c.effective.engine]} c={c.effective.engine === 'SUSPENSO' ? 'bad' : c.effective.legacy ? 'off' : 'ok'} />
                <Badge {...(INDICATOR[c.indicator] ?? { t: c.indicator, c: 'off' })} />
              </span>
            </button>
          ))}
        </div>
      </div>

      {co ? (
        <div className="fx-card">
          <div className="fx-card-h">
            <h3>{co.company.name}</h3>
            <Badge {...(INDICATOR[co.indicator] ?? { t: co.indicator, c: 'off' })} />
          </div>
          {co.effective.reason ? <div className={`fx-note ${co.effective.engine === 'SUSPENSO' ? 'bad' : ''}`}>{co.effective.reason}</div> : null}
          <ol className="fx-steps">
            {co.checks.map((c, i) => (
              <li key={c.key} className={c.ok ? 'done' : ''}><span className="n">{c.ok ? '✓' : i + 1}</span>{CHECK_LABEL[c.key] ?? c.key}</li>
            ))}
          </ol>

          <div className="fx-meta">
            <div><small>Motor efectivo</small><b>{ENGINE[co.effective.engine]}</b></div>
            <div><small>NIF do contribuinte</small><b>{co.company.nif}</b></div>
            <div><small>API KEY</small><b>{link?.apiKeyMask || '—'}</b></div>
            <div><small>Conta Vendus</small><b>{link?.accountCompany || '—'}</b></div>
            <div><small>NIF da conta</small><b>{link?.accountFiscalId || '—'}</b></div>
            <div><small>País</small><b>{link?.accountCountry || '—'}</b></div>
            <div><small>Caixa</small><b>{link?.registerTitle ? `${link.registerTitle} (${link.registerType || '—'})` : link?.registerId || '—'}</b></div>
            <div><small>Subscrição da caixa</small><b>{link?.registerSubscription || '—'}{link?.registerExpires ? ` · ${link.registerExpires}` : ''}</b></div>
            <div><small>Último teste</small><b>{link?.lastTestAt ? `${fmtDate(link.lastTestAt)} · ${link.lastTestCode}` : '—'}</b></div>
            <div><small>Monitorização</small><b>{link?.health?.code ? `${link.health.code} · ${fmtDate(link.health.at)}` : '—'}</b></div>
            <div><small>Factura Electrónica no Vendus</small><b>{link?.feConfirmedAt ? `${fmtDate(link.feConfirmedAt)} · ${link.feConfirmedBy}` : 'por confirmar'}</b></div>
            <div><small>Testes</small><b>{fmtDate(link?.testsPassedAt)}</b></div>
            <div><small>Activado</small><b>{link?.activatedAt ? `${fmtDate(link.activatedAt)} · ${link.activatedBy}` : '—'}</b></div>
          </div>
          {link?.lastTestMessage ? <div className="fx-note bad">{link.lastTestMessage}</div> : null}

          <div className="fx-grid">
            <div className="field">
              <label>NIF do contribuinte</label>
              <input value={tnif} onChange={(e) => setTnif(e.target.value.toUpperCase().replace(/\s+/g, ''))} inputMode="numeric" placeholder={co.company.companyNif} maxLength={14} />
            </div>
            <div className="field">
              <label>API KEY {link?.apiKeyMask ? <em className="muted">(definida)</em> : null}</label>
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="new-password" spellCheck={false} placeholder={link?.apiKeyMask ? 'Deixe vazio para manter' : ''} />
            </div>
            <div className="field">
              <label>Caixa Vendus</label>
              {cat ? (
                <select value={reg} onChange={(e) => setReg(e.target.value)}>
                  <option value="">Escolher…</option>
                  {cat.registers.map((r) => <option key={r.id} value={r.id}>{r.title} · {r.type} · subscrição {r.subscription_active}</option>)}
                </select>
              ) : (
                <input value={reg} onChange={(e) => setReg(e.target.value)} inputMode="numeric" />
              )}
            </div>
            {cat?.paymentMethods.length ? PAY_TYPES.map(([k, label]) => (
              <div className="field" key={k}>
                <label>Pagamento: {label}</label>
                <select value={pay[k] ?? ''} onChange={(e) => setPay({ ...pay, [k]: e.target.value })}>
                  <option value="">Sem correspondência</option>
                  {cat.paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                </select>
              </div>
            )) : null}
          </div>
          {cat ? (
            <div className="fx-meta">
              <div><small>Impostos AO reconhecidos</small><b>{Object.entries(link?.taxMap ?? {}).map(([a, b]) => `${a}→${b}`).join(' · ') || 'nenhum'}</b></div>
              <div><small>Impostos da conta</small><b>{cat.taxes.map((t) => `${t.id} ${t.rate}% ${t.country}`).join(' · ') || '—'}</b></div>
              <div><small>Motivos de isenção</small><b>{cat.exemptions.map((x) => x.id).join(' · ') || '—'}</b></div>
            </div>
          ) : null}
          {ov && ov.companies.some((c) => c.id !== cid && c.nif === co.company.nif) ? (
            <div className="fx-grid" style={{ alignItems: 'end' }}>
              <div className="field">
                <label>Usar a ligação Vendus de</label>
                <select value={src} onChange={(e) => setSrc(e.target.value)}>
                  <option value="">Escolher…</option>
                  {ov.companies.filter((c) => c.id !== cid && c.nif === co.company.nif).map((c) => <option key={c.id} value={c.id}>{c.name} · NIF {c.nif}</option>)}
                </select>
              </div>
              <div className="field">
                <button className="btn ghost" disabled={busy || !src} onClick={() => void guard(async () => { await applyCompany(await api.fiscalEngine.copyFrom(cid, src)); setSrc(''); }, 'Ligação copiada. Teste a ligação.')}>Usar esta ligação</button>
              </div>
            </div>
          ) : null}
          <label className="fe-check">
            <input type="checkbox" checked={!!link?.feConfirmedAt} disabled={busy || !link} onChange={(e) => void guard(async () => applyCompany(await api.fiscalEngine.configure(cid, { feConfirmed: e.target.checked })))} />
            Factura Electrónica configurada no Backoffice Vendus (Gestão → Factura Electrónica)
          </label>

          <div className="fx-actions">
            <button className="btn" disabled={busy || key.trim().length < 16} onClick={() => void guard(async () => { await applyCompany(await api.fiscalEngine.saveKey(cid, key.trim())); setKey(''); }, 'API KEY guardada.')}>Guardar API KEY</button>
            <button className="btn ghost" disabled={busy || !link?.apiKeyMask} onClick={() => void test()}>Testar ligação</button>
            <button className="btn ghost" disabled={busy || !link} onClick={() => void guard(async () => {
              const changed = tnif !== (link?.taxpayerNif ?? '') && tnif !== '' && tnif !== co.company.companyNif;
              if (changed) {
                const ok = await confirmDialog({ message: `As facturas de ${co.company.name} (NIF ${co.company.companyNif} no LPS) passam a ser emitidas pelo contribuinte com o NIF ${tnif}${link?.accountCompany ? ` (conta Vendus «${link.accountCompany}»)` : ''}. Confirma que é o mesmo contribuinte?`, danger: true });
                if (!ok) return;
              }
              await applyCompany(await api.fiscalEngine.configure(cid, { taxpayerNif: tnif, registerId: reg, paymentMap: pay }));
              toast.success('Guardado.');
            })}>Guardar NIF, caixa e pagamentos</button>
            <button className="btn ghost" disabled={busy || !link?.lastTestOk} onClick={() => void guard(async () => { const r = await api.fiscalEngine.runTests(cid); await applyCompany(r.detail); if (r.ok) toast.success(`Documento de testes ${r.document.number}`); else toast.error(r.document.error ?? r.document.state); })}>Testar emissão (modo Formação)</button>
            <button className="btn ghost" disabled={busy || !link?.apiKeyMask} onClick={() => void guard(async () => applyCompany(await api.fiscalEngine.health(cid)))}>Verificar agora</button>
            <button className="btn primary" disabled={busy || !co.canActivate || co.indicator === 'MOTOR_ACTIVO'} onClick={() => void guard(async () => {
              const ok = await confirmDialog({ message: `Activar o Cegid Vendus como motor fiscal de ${co.company.name}? As novas vendas passam a ter o documento fiscal emitido pelo Vendus.` });
              if (ok) await applyCompany(await api.fiscalEngine.activate(cid));
            })}>Activar motor Vendus</button>
            <button className="btn danger" disabled={busy || co.engine === 'SUSPENSO'} onClick={() => void guard(async () => {
              const reason = window.prompt('Motivo da suspensão da emissão fiscal');
              if (reason && reason.trim().length >= 5) await applyCompany(await api.fiscalEngine.suspend(cid, reason.trim()));
            })}>Suspender emissão</button>
            <button className="btn ghost" disabled={busy || !link?.apiKeyMask || co.indicator === 'MOTOR_ACTIVO'} onClick={() => void guard(async () => {
              const ok = await confirmDialog({ message: 'Remover a API KEY desta empresa?', danger: true });
              if (ok) await applyCompany(await api.fiscalEngine.removeKey(cid));
            })}>Remover API KEY</button>
            <button className="btn ghost" disabled={busy || !ov?.lpsValidation.ok || co.engine === 'LPS'} onClick={() => void guard(async () => {
              const t = window.prompt('Escreva MUDAR PARA MOTOR PRÓPRIO para confirmar');
              if (t) await applyCompany(await api.fiscalEngine.useLps(cid, t));
            })}>Mudar para motor próprio</button>
          </div>
        </div>
      ) : null}

      <div className="fx-card">
        <div className="fx-card-h">
          <h3>Validação própria do LPS Vendas</h3>
          <Badge t={ov?.lpsValidation.ok ? 'Confirmada' : 'Sem validação própria'} c={ov?.lpsValidation.ok ? 'ok' : 'off'} />
        </div>
        <div className="fx-meta">
          <div><small>Em falta</small><b>{ov?.lpsValidation.missing.join(', ') || '—'}</b></div>
          <div><small>Testes aprovados</small><b>{fmtDate(s?.lpsTestsApprovedAt)}</b></div>
          <div><small>Confirmada</small><b>{s?.lpsConfirmedAt ? `${fmtDate(s.lpsConfirmedAt)} · ${s.lpsConfirmedBy}` : '—'}</b></div>
        </div>
        <div className="fx-grid">
          <div className="field"><label>Número de validação próprio</label><input value={lps.lpsValidationNo ?? ''} onChange={(e) => setLps({ ...lps, lpsValidationNo: e.target.value })} /></div>
          <div className="field"><label>Versão autorizada</label><input value={lps.lpsValidationVersion ?? ''} onChange={(e) => setLps({ ...lps, lpsValidationVersion: e.target.value })} /></div>
          <div className="field">
            <label>Evidência oficial (PDF, PNG, JPEG)</label>
            <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={uploadEvidence('LPS_VALIDATION')} disabled={busy} />
          </div>
        </div>
        <div className="fx-actions">
          <button className="btn" disabled={busy} onClick={() => void guard(async () => fill(await api.fiscalEngine.saveLps(lps)), 'Guardado.')}>Guardar</button>
          <button className="btn ghost" disabled={busy || !s?.lpsEvidenceId} onClick={() => void openEvidence(s?.lpsEvidenceId ?? null)}>Ver evidência</button>
          <button className="btn ghost" disabled={busy} onClick={() => void guard(async () => fill(await api.fiscalEngine.saveLps({ testsApproved: true })), 'Testes registados.')}>Registar testes aprovados</button>
          <button className="btn primary" disabled={busy || ov?.lpsValidation.ok} onClick={() => void guard(async () => {
            const ok = await confirmDialog({ message: 'Confirmar a validação AGT própria do LPS Vendas com os dados e a evidência indicados?' });
            if (ok) fill(await api.fiscalEngine.saveLps({ confirm: true }));
          })}>Confirmar validação</button>
        </div>
      </div>
    </>
  );
}
