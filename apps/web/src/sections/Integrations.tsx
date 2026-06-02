import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Integration } from '../api/types';
import { IconCpu, IconRefresh } from '../components/Icons';
import { Switch } from '../components/ui';

/** Integrações externas configuradas 100% pelo Super Admin (AGT, Open Finance,
 *  Stripe, DocuSign, biometria). Segredos guardados encriptados; o código activa
 *  cada integração assim que for preenchida e ligada. */
export function Integrations() {
  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems(await api.integrations.list()); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar integrações.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div className="content-head">
        <h2>Integrações externas</h2>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => void load()}><IconRefresh size={15} /> Atualizar</button>
      </div>

      <div className="banner info" style={{ marginBottom: 12 }}>
        Configure aqui as ligações externas. O sistema usa-as automaticamente assim que ficarem <strong>Ligadas</strong> e preenchidas — sem alterar código. As credenciais são guardadas encriptadas.
      </div>

      {error ? <div className="banner danger">{error}</div> : null}

      {loading ? <div className="card"><div className="loading">A carregar…</div></div> : (
        <div className="pgrid">
          {items.map((it) => <IntegrationCard key={it.key} it={it} onSaved={(u) => setItems((arr) => arr.map((x) => x.key === u.key ? u : x))} />)}
        </div>
      )}
    </>
  );
}

function IntegrationCard({ it, onSaved }: { it: Integration; onSaved(u: Integration): void }) {
  const [enabled, setEnabled] = useState(it.enabled);
  const [environment, setEnvironment] = useState(it.environment);
  const [baseUrl, setBaseUrl] = useState(it.baseUrl ?? '');
  const [settings, setSettings] = useState<Record<string, string>>(() => {
    const s: Record<string, string> = {};
    for (const f of it.settingsFields) s[f.name] = String(it.settings?.[f.name] ?? '');
    return s;
  });
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [test, setTest] = useState<string | null>(it.lastStatus);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const u = await api.integrations.update(it.key, {
        enabled, environment,
        baseUrl: it.hasBaseUrl ? baseUrl.trim() : undefined,
        settings,
        secret: secret.trim() || undefined,
      });
      setSecret('');
      onSaved(u);
      setMsg('Guardado ✓');
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Erro ao guardar.');
    } finally { setBusy(false); }
  };

  const runTest = async () => {
    setBusy(true); setTest('A testar…');
    try { const r = await api.integrations.test(it.key); setTest(`${r.ok ? '✓' : '✗'} ${r.status}`); }
    catch (e) { setTest(e instanceof ApiError ? e.message : 'Falha no teste.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
        <div className="kpi-ic" style={{ marginBottom: 0 }}><IconCpu size={18} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{it.label}</div>
          <div className="muted" style={{ fontSize: 12 }}>{it.description}</div>
        </div>
        <Switch checked={enabled} onChange={setEnabled} />
      </div>

      <div className="field" style={{ margin: 0 }}>
        <label>Ambiente</label>
        <select value={environment} onChange={(e) => setEnvironment(e.target.value as 'TEST' | 'PRODUCTION')}>
          <option value="TEST">Teste</option>
          <option value="PRODUCTION">Produção</option>
        </select>
      </div>

      {it.hasBaseUrl ? (
        <div className="field" style={{ margin: 0 }}>
          <label>{it.baseUrlLabel}</label>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" />
        </div>
      ) : null}

      {it.settingsFields.map((f) => (
        <div className="field" style={{ margin: 0 }} key={f.name}>
          <label>{f.label}</label>
          <input value={settings[f.name] ?? ''} onChange={(e) => setSettings((s) => ({ ...s, [f.name]: e.target.value }))} />
        </div>
      ))}

      <div className="field" style={{ margin: 0 }}>
        <label>{it.secretLabel} {it.hasSecret ? <span className="muted">(configurado — deixe vazio para manter)</span> : null}</label>
        <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={it.hasSecret ? '••••••••' : ''} autoComplete="new-password" />
      </div>

      {test ? <div className="muted" style={{ fontSize: 12 }}>Último teste: {test}</div> : null}
      {msg ? <div className="muted" style={{ fontSize: 12 }}>{msg}</div> : null}

      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" disabled={busy} onClick={save}>Guardar</button>
        <button className="btn sm ghost" disabled={busy} onClick={runTest}>Testar ligação</button>
        <span className="spacer" />
        <span className={`pill ${enabled ? 'on' : 'off'}`}>{enabled ? 'Ligada' : 'Desligada'}</span>
      </div>
    </div>
  );
}
