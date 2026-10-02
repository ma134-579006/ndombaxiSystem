import React, { useEffect, useState } from 'react';
import { confirmDialog, toast, runDownload } from '../components/feedback';
import { api, ApiError } from '../api/client';

/**
 * Facturação Electrónica AGT (DP 71/25 · DE 683/25): passo 1 credenciais e chave do
 * software (produtor), passo 2 dados por empresa (chave do contribuinte, séries, fila).
 */
export function EinvoiceCard({ onChanged }: { onChanged?: () => void }) {
  const [cfg, setCfg] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ environment: 'HML', basicUser: '', basicPassword: '', productId: '', productVersion: '', softwareValidationNumber: '' });
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; nif: string }>>([]);
  const [cid, setCid] = useState('');
  const [co, setCo] = useState<Record<string, any> | null>(null);
  const [docs, setDocs] = useState<Array<Record<string, any>>>([]);
  const [tpKey, setTpKey] = useState('');
  const [est, setEst] = useState('1');
  const [sType, setSType] = useState('FT');
  const [sYear, setSYear] = useState(new Date().getFullYear());

  const guard = async (fn: () => Promise<void>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      onChanged?.();
      if (okMsg) toast.success(okMsg);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Operação falhou.');
    } finally {
      setBusy(false);
    }
  };

  const load = async () => {
    try {
      const c = await api.fiscal.feConfig();
      setCfg(c);
      setF((p) => ({
        ...p,
        environment: c.environment,
        basicUser: c.basicUser ?? '',
        productId: c.productId ?? '',
        productVersion: c.productVersion ?? '',
        softwareValidationNumber: c.softwareValidationNumber ?? '',
      }));
    } catch {
      /* mantém */
    }
  };

  useEffect(() => {
    void load();
    api.tenants
      .list({})
      .then((l) => setCompanies(l.map((x) => ({ id: x.id, name: x.name, nif: x.nif }))))
      .catch(() => undefined);
  }, []);

  const loadCompany = async (id: string) => {
    setCid(id);
    if (!id) {
      setCo(null);
      setDocs([]);
      return;
    }
    try {
      const c = await api.fiscal.feCompany(id);
      setCo(c);
      setEst(c.establishmentNumber ?? '1');
      setDocs(await api.fiscal.feDocuments(id));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Falha ao ler a empresa.');
    }
  };

  const save = () =>
    guard(async () => {
      const dto: Record<string, unknown> = {
        environment: f.environment,
        basicUser: f.basicUser,
        productId: f.productId,
        productVersion: f.productVersion,
        softwareValidationNumber: f.softwareValidationNumber,
      };
      if (f.basicPassword) dto.basicPassword = f.basicPassword;
      setCfg(await api.fiscal.feUpdate(dto));
      setF((p) => ({ ...p, basicPassword: '' }));
    }, 'Configuração guardada.');

  const toggle = () =>
    guard(
      async () => {
        setCfg(await api.fiscal.feUpdate({ enabled: !cfg?.enabled }));
      },
      cfg?.enabled ? 'Envio à AGT desactivado.' : 'Envio à AGT activado.',
    );

  const genKey = async () => {
    const ok = await confirmDialog({
      message:
        'Gerar/rodar a chave RSA do software? A nova chave pública tem de ser registada no Portal do Parceiro da AGT (a versão da assinatura incrementa).',
      danger: !!cfg?.hasSoftwareKey,
    });
    if (!ok) return;
    await guard(async () => {
      setCfg(await api.fiscal.feProvisionKey());
    }, 'Chave do software pronta. Exporta a pública e regista-a no Portal do Parceiro.');
  };

  const exportKey = () =>
    guard(async () => {
      await runDownload({
        title: 'A exportar chave pública', fileName: 'chave-publica.txt',
        make: async () => {
          const r = await api.fiscal.feExportKey();
          return { blob: new Blob([r.pem], { type: 'text/plain;charset=utf-8' }), fileName: r.fileName };
        },
      });
    }, 'Chave pública exportada.');

  const saveCompany = (dto: Record<string, unknown>, msg: string) =>
    guard(async () => {
      setCo(await api.fiscal.feSaveCompany(cid, dto));
      setTpKey('');
    }, msg);

  const steps: Array<{ done: boolean; label: string }> = [
    { done: !!cfg?.basicUser && !!cfg?.hasBasicPassword, label: 'Credenciais Basic do produtor' },
    { done: !!cfg?.hasSoftwareKey, label: 'Chave RSA do software gerada' },
    { done: !!cfg?.softwareValidationNumber, label: 'Nº de validação do software' },
    { done: !!cfg?.enabled, label: 'Envio à AGT activado' },
  ];
  const badge = cfg?.enabled ? { t: 'Activa', c: 'ok' } : cfg?.ready ? { t: 'Pronta', c: 'ok' } : { t: 'Por configurar', c: 'off' };
  const tone: Record<string, string> = { VALID: 'ok', INVALID: 'bad', ERROR: 'bad', SENT: 'off', QUEUED: 'off' };
  const stateLabel: Record<string, string> = { VALID: 'Válido', INVALID: 'Inválido', ERROR: 'Erro', SENT: 'Enviado', QUEUED: 'Em fila' };

  return (
    <>
      <div className="fx-card">
        <div className="fx-card-h">
          <div>
            <h3>Produtor do software</h3>
            <p>
              Regime de 2026 (DP 71/25 · DE 683/25): assinaturas JWS RS256 com chave de, no mínimo, 2048 bits. É independente da
              assinatura do SAF-T (Modelo 8). Endpoint: <span className="mono">{cfg?.baseUrl ?? '—'}</span>
            </p>
          </div>
          <span className={`fx-badge ${badge.c}`}><span className={`fx-dot ${badge.c}`} />{badge.t}</span>
        </div>

        <ol className="fx-steps">
          {steps.map((s, i) => (
            <li key={s.label} className={s.done ? 'done' : ''}>
              <span className="n">{s.done ? '✓' : i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>

        <div className="fx-grid" style={{ marginTop: 16 }}>
          <div className="field">
            <label>Ambiente</label>
            <select value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value })}>
              <option value="HML">Homologação (testes)</option>
              <option value="PROD">Produção</option>
            </select>
          </div>
          <div className="field">
            <label>Utilizador Basic</label>
            <input value={f.basicUser} onChange={(e) => setF({ ...f, basicUser: e.target.value })} autoComplete="off" />
          </div>
          <div className="field">
            <label>Palavra-passe Basic {cfg?.hasBasicPassword ? <em className="muted">(definida)</em> : null}</label>
            <input
              type="password"
              value={f.basicPassword}
              onChange={(e) => setF({ ...f, basicPassword: e.target.value })}
              autoComplete="new-password"
              placeholder={cfg?.hasBasicPassword ? 'Deixe vazio para manter' : ''}
            />
          </div>
          <div className="field">
            <label>Nº de validação do software</label>
            <input value={f.softwareValidationNumber} onChange={(e) => setF({ ...f, softwareValidationNumber: e.target.value })} placeholder="ex.: C_134" />
          </div>
          <div className="field">
            <label>Produto (productId)</label>
            <input value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })} />
          </div>
          <div className="field">
            <label>Versão</label>
            <input value={f.productVersion} onChange={(e) => setF({ ...f, productVersion: e.target.value })} />
          </div>
        </div>

        <div className="fx-meta">
          <div><small>Chave do software</small><b>{cfg?.hasSoftwareKey ? `RSA-${cfg.softwareKeyBits}` : 'por gerar'}</b></div>
          <div><small>Versão da assinatura</small><b>{cfg?.hasSoftwareKey ? cfg.signatureVersion : '—'}</b></div>
        </div>

        <div className="fx-actions">
          <button className="btn" onClick={save} disabled={busy}>Guardar</button>
          <button className="btn ghost" onClick={genKey} disabled={busy}>{cfg?.hasSoftwareKey ? 'Rodar chave' : 'Gerar chave RSA-2048'}</button>
          <button className="btn ghost" onClick={exportKey} disabled={busy || !cfg?.hasSoftwareKey}>Exportar chave pública</button>
          <button className="btn ghost" onClick={toggle} disabled={busy || (!cfg?.enabled && !cfg?.ready)}>
            {cfg?.enabled ? 'Desactivar envio' : 'Activar envio à AGT'}
          </button>
        </div>
      </div>

      <div className="fx-card">
        <div className="fx-card-h">
          <div>
            <h3>Por empresa</h3>
            <p>Chave do contribuinte (emitida pela AGT), séries autorizadas e fila de documentos.</p>
          </div>
        </div>
        <div className="field" style={{ maxWidth: 460 }}>
          <label>Empresa</label>
          <select value={cid} onChange={(e) => void loadCompany(e.target.value)}>
            <option value="">Escolher empresa…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name} · NIF {c.nif}</option>
            ))}
          </select>
        </div>

        {co ? (
          <>
            <div className="fx-meta">
              <div><small>Estado</small><b>{co.enabled ? 'Activa' : 'Inactiva'}</b></div>
              <div><small>Chave do contribuinte</small><b>{co.hasTaxpayerKey ? `RSA-${co.taxpayerKeyBits}` : 'em falta'}</b></div>
              <div>
                <small>Séries</small>
                <b>
                  {Object.keys(co.series ?? {}).length
                    ? Object.entries(co.series as Record<string, string>).map(([k, v]) => `${k} → ${v}`).join(' · ')
                    : 'nenhuma'}
                </b>
              </div>
              <div>
                <small>Documentos</small>
                <b>{Object.entries(co.documents ?? {}).map(([k, v]) => `${stateLabel[k] ?? k}: ${v}`).join(' · ') || '—'}</b>
              </div>
            </div>

            <div className="field">
              <label>Chave privada do contribuinte (PEM emitido pela AGT)</label>
              <textarea rows={4} value={tpKey} onChange={(e) => setTpKey(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" spellCheck={false} />
              <small className="muted">Nunca é mostrada de volta depois de guardada.</small>
            </div>

            <div className="fx-grid" style={{ alignItems: 'end' }}>
              <div className="field">
                <label>Estabelecimento</label>
                <input value={est} onChange={(e) => setEst(e.target.value)} />
              </div>
              <div className="field">
                <label>Tipo de documento</label>
                <select value={sType} onChange={(e) => setSType(e.target.value)}>
                  <option value="FT">Factura (FT)</option>
                  <option value="FS">Factura-recibo (FS)</option>
                  <option value="NC">Nota de crédito (NC)</option>
                  <option value="ND">Nota de débito (ND)</option>
                </select>
              </div>
              <div className="field">
                <label>Ano da série</label>
                <input type="number" value={sYear} onChange={(e) => setSYear(Number(e.target.value))} />
              </div>
            </div>

            <div className="fx-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() => saveCompany({ establishmentNumber: est, ...(tpKey ? { taxpayerPrivateKey: tpKey } : {}) }, 'Dados da empresa guardados.')}
              >
                Guardar chave e estabelecimento
              </button>
              <button
                className="btn ghost"
                disabled={busy || !co.hasTaxpayerKey}
                onClick={() =>
                  guard(async () => {
                    await api.fiscal.feRequestSeries(cid, { documentType: sType, year: sYear });
                    await loadCompany(cid);
                  }, 'Série atribuída pela AGT.')
                }
              >
                Pedir série à AGT
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => saveCompany({ enabled: !co.enabled }, co.enabled ? 'Envio desactivado.' : 'Envio activado nesta empresa.')}>
                {co.enabled ? 'Desactivar empresa' : 'Activar empresa'}
              </button>
              <button
                className="btn ghost"
                disabled={busy || !co.enabled}
                onClick={() =>
                  guard(async () => {
                    await api.fiscal.feSync(cid);
                    await loadCompany(cid);
                  }, 'Sincronização feita.')
                }
              >
                Enviar e consultar agora
              </button>
            </div>

            {docs.length ? (
              <div className="fx-table">
                <table className="ptable">
                  <thead>
                    <tr><th>Documento</th><th>Estado</th><th>Tentativas</th><th>Erros</th><th /></tr>
                  </thead>
                  <tbody>
                    {docs.slice(0, 30).map((d) => (
                      <tr key={String(d.id)}>
                        <td className="mono">{String(d.documentNo)}</td>
                        <td><span className={`fx-badge ${tone[String(d.status)] ?? 'off'}`}>{stateLabel[String(d.status)] ?? String(d.status)}</span></td>
                        <td>{String(d.attempts)}</td>
                        <td style={{ fontSize: 12 }}>{d.errors ? JSON.stringify(d.errors).slice(0, 140) : ''}</td>
                        <td>
                          {d.status === 'INVALID' || d.status === 'ERROR' ? (
                            <button
                              className="btn sm ghost"
                              onClick={() =>
                                guard(async () => {
                                  await api.fiscal.feRequeue(cid, String(d.documentNo));
                                  await loadCompany(cid);
                                }, 'Reposto na fila.')
                              }
                            >
                              Repor
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13, margin: '12px 0 0' }}>Escolhe uma empresa para gerir a chave, as séries e a fila de envio.</p>
        )}
      </div>
    </>
  );
}
