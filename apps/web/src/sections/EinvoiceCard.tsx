import React, { useEffect, useState } from 'react';
import { confirmDialog, toast } from '../components/feedback';
import { api, ApiError } from '../api/client';

/**
 * Facturação Electrónica AGT (DP 71/25 · DE 683/25): credenciais Basic do produtor,
 * chave RSA (≥2048) do software, e por empresa: chave do contribuinte (AGT), séries e fila.
 */
export function EinvoiceCard() {
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
    }, 'Configuração da Facturação Electrónica guardada.');

  const toggle = () =>
    guard(
      async () => {
        setCfg(await api.fiscal.feUpdate({ enabled: !cfg?.enabled }));
      },
      cfg?.enabled ? 'Facturação Electrónica desactivada.' : 'Facturação Electrónica activada.',
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
      const r = await api.fiscal.feExportKey();
      const url = URL.createObjectURL(new Blob([r.pem], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = r.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, 'Chave pública exportada.');

  const saveCompany = (dto: Record<string, unknown>, msg: string) =>
    guard(async () => {
      setCo(await api.fiscal.feSaveCompany(cid, dto));
      setTpKey('');
    }, msg);

  const statusColor: Record<string, string> = {
    VALID: 'var(--success)',
    INVALID: 'var(--danger)',
    ERROR: 'var(--danger)',
    SENT: 'var(--muted)',
    QUEUED: 'var(--muted)',
  };

  return (
    <div className="card">
      <div className="row">
        <h3 style={{ margin: 0 }}>Facturação Electrónica (DP 71/25 · DE 683/25)</h3>
        <span className="spacer" />
        <span className="badge" style={{ color: cfg?.enabled ? 'var(--success)' : undefined }}>
          {cfg?.enabled ? 'Activa' : cfg?.ready ? 'Pronta' : 'Por configurar'}
        </span>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Regime de 2026 (assinaturas JWS RS256, chave ≥ 2048 bits): credenciais <strong>Basic</strong> do produtor (pedir a
        produtores.dfe.dcrr.agt@minfin.gov.ao), chave do software (pública no Portal do Parceiro) e, por empresa, a chave do
        contribuinte emitida pela AGT e as séries pedidas por API. Endpoint: {cfg?.baseUrl ?? '—'}. É independente da
        assinatura do SAF-T (Modelo 8, RSA-1024).
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
        <label className="field">
          <span>Ambiente</span>
          <select value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value })}>
            <option value="HML">Homologação (testes)</option>
            <option value="PROD">Produção</option>
          </select>
        </label>
        <label className="field">
          <span>Utilizador Basic</span>
          <input value={f.basicUser} onChange={(e) => setF({ ...f, basicUser: e.target.value })} autoComplete="off" />
        </label>
        <label className="field">
          <span>Palavra-passe Basic {cfg?.hasBasicPassword ? '(definida)' : ''}</span>
          <input
            type="password"
            value={f.basicPassword}
            onChange={(e) => setF({ ...f, basicPassword: e.target.value })}
            autoComplete="new-password"
            placeholder={cfg?.hasBasicPassword ? 'deixe vazio para manter' : ''}
          />
        </label>
        <label className="field">
          <span>Produto (productId)</span>
          <input value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })} />
        </label>
        <label className="field">
          <span>Versão</span>
          <input value={f.productVersion} onChange={(e) => setF({ ...f, productVersion: e.target.value })} />
        </label>
        <label className="field">
          <span>Nº de validação do software (ex.: C_134)</span>
          <input value={f.softwareValidationNumber} onChange={(e) => setF({ ...f, softwareValidationNumber: e.target.value })} />
        </label>
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Chave do software:{' '}
        {cfg?.hasSoftwareKey ? `RSA-${cfg.softwareKeyBits} · versão da assinatura ${cfg.signatureVersion}` : 'ainda não gerada'}.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={save} disabled={busy}>Guardar</button>
        <button className="btn ghost" onClick={genKey} disabled={busy}>
          {cfg?.hasSoftwareKey ? 'Rodar chave do software' : 'Gerar chave do software (RSA-2048)'}
        </button>
        <button className="btn ghost" onClick={exportKey} disabled={busy || !cfg?.hasSoftwareKey}>Exportar chave pública</button>
        <button className="btn ghost" onClick={toggle} disabled={busy || (!cfg?.enabled && !cfg?.ready)}>
          {cfg?.enabled ? 'Desactivar envio' : 'Activar envio à AGT'}
        </button>
      </div>

      <h4 style={{ marginBottom: 6 }}>Por empresa</h4>
      <select value={cid} onChange={(e) => void loadCompany(e.target.value)} style={{ maxWidth: 420 }}>
        <option value="">— escolher empresa —</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.name} · NIF {c.nif}</option>
        ))}
      </select>
      {co ? (
        <div style={{ marginTop: 10 }}>
          <p className="muted" style={{ fontSize: 12.5 }}>
            {co.enabled ? 'Activa' : 'Inactiva'} · chave do contribuinte: {co.hasTaxpayerKey ? `RSA-${co.taxpayerKeyBits}` : 'em falta'} · séries:{' '}
            {Object.keys(co.series ?? {}).length
              ? Object.entries(co.series as Record<string, string>).map(([k, v]) => `${k}=${v}`).join(', ')
              : 'nenhuma'}{' '}
            · documentos: {Object.entries(co.documents ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}
          </p>
          <label className="field">
            <span>Chave privada do contribuinte (PEM da AGT) — nunca é mostrada de volta</span>
            <textarea rows={4} value={tpKey} onChange={(e) => setTpKey(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" />
          </label>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="field" style={{ maxWidth: 140 }}>
              <span>Estabelecimento</span>
              <input value={est} onChange={(e) => setEst(e.target.value)} />
            </label>
            <button
              className="btn sm"
              disabled={busy}
              onClick={() => saveCompany({ establishmentNumber: est, ...(tpKey ? { taxpayerPrivateKey: tpKey } : {}) }, 'Dados da empresa guardados.')}
            >
              Guardar chave/estabelecimento
            </button>
            <select value={sType} onChange={(e) => setSType(e.target.value)}>
              <option>FT</option>
              <option>FS</option>
              <option>NC</option>
              <option>ND</option>
            </select>
            <input type="number" value={sYear} onChange={(e) => setSYear(Number(e.target.value))} style={{ width: 90 }} />
            <button
              className="btn sm ghost"
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
            <button className="btn sm" disabled={busy} onClick={() => saveCompany({ enabled: !co.enabled }, co.enabled ? 'Envio desactivado.' : 'Envio activado nesta empresa.')}>
              {co.enabled ? 'Desactivar empresa' : 'Activar empresa'}
            </button>
            <button
              className="btn sm ghost"
              disabled={busy || !co.enabled}
              onClick={() =>
                guard(async () => {
                  await api.fiscal.feSync(cid);
                  await loadCompany(cid);
                }, 'Sincronização feita.')
              }
            >
              Enviar/consultar agora
            </button>
          </div>
          {docs.length ? (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table className="ptable">
                <thead>
                  <tr><th>Documento</th><th>Estado</th><th>Tentativas</th><th>Erros</th><th /></tr>
                </thead>
                <tbody>
                  {docs.slice(0, 30).map((d) => (
                    <tr key={String(d.id)}>
                      <td>{String(d.documentNo)}</td>
                      <td style={{ color: statusColor[String(d.status)] }}>{String(d.status)}</td>
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
        </div>
      ) : null}
    </div>
  );
}
