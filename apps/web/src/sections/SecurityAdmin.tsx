import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { SecurityView } from '../api/types';
import { toast } from '../components/feedback';
import { Switch } from '../components/ui';

/**
 * Super Admin → Segurança (2FA): canais dos códigos (e-mail pelo SMTP e WhatsApp pela Meta
 * Cloud API configurada em Integrações), modelo do WhatsApp, validade, teste e desbloqueio.
 */
export function SecurityAdmin({ onGo }: { onGo?(section: string): void }) {
  const [v, setV] = useState<SecurityView | null>(null);
  const [cfg, setCfg] = useState<SecurityView['config'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [test, setTest] = useState<{ channel: 'EMAIL' | 'WHATSAPP'; target: string }>({ channel: 'EMAIL', target: '' });
  const [who, setWho] = useState('');
  const load = () => api.security.get().then((r) => { setV(r); setCfg(r.config); }).catch((e) => setErr(e instanceof ApiError ? e.message : 'Falha ao carregar.'));
  useEffect(() => { void load(); }, []);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível.'); } finally { setBusy(false); } };
  if (!v || !cfg) return <div>{err ? <div className="banner danger">{err}</div> : <div className="card">A carregar…</div>}</div>;
  const s = v.stats;
  return (
    <div className="sec-page">
      <div className="content-head"><h2>Segurança (2FA)</h2></div>
      {err ? <div className="banner danger">{err}</div> : null}
      <div className="sec-kpis">
        <div className="sec-kpi main"><span>Contas com 2FA</span><b>{s.total}</b></div>
        <div className="sec-kpi"><span>Super Admin</span><b>{s.platform}</b></div>
        <div className="sec-kpi"><span>Empresas</span><b>{s.tenant}</b></div>
        <div className="sec-kpi"><span>Associados</span><b>{s.kwanza}</b></div>
        <div className="sec-kpi"><span>Por e-mail · WhatsApp</span><b>{s.email} · {s.whatsapp}</b></div>
      </div>
      <div className="cols-2">
        <div className="card sec-card">
          <h3>Canais dos códigos</h3>
          <div className="sec-ch">
            <div className="sec-ch-row">
              <span className={`sec-dot ${v.channels.email ? 'ok' : 'off'}`} />
              <div><b>E-mail</b><small>{v.channels.email ? 'A enviar pelo SMTP' : 'SMTP por configurar'}</small></div>
              <Switch checked={cfg.allowEmail} onChange={(x: boolean) => setCfg({ ...cfg, allowEmail: x })} />
            </div>
            {!v.channels.email ? <button className="btn ghost sm" onClick={() => onGo?.('mail')}>Configurar o SMTP</button> : null}
            <div className="sec-ch-row">
              <span className={`sec-dot ${v.channels.whatsapp ? 'ok' : 'off'}`} />
              <div><b>WhatsApp</b><small>{v.channels.whatsapp ? 'Meta Cloud API ligada' : 'Integração por configurar'}</small></div>
              <Switch checked={cfg.allowWhatsapp} onChange={(x: boolean) => setCfg({ ...cfg, allowWhatsapp: x })} />
            </div>
            {!v.channels.whatsapp ? <button className="btn ghost sm" onClick={() => onGo?.('integrations')}>Configurar o WhatsApp</button> : null}
          </div>
          <div className="field"><label>Modelo do WhatsApp (Meta · Autenticação)</label><input value={cfg.waTemplate ?? ''} onChange={(e) => setCfg({ ...cfg, waTemplate: e.target.value })} placeholder="codigo_verificacao" /></div>
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}><label>Idioma do modelo</label><input value={cfg.waLang} onChange={(e) => setCfg({ ...cfg, waLang: e.target.value })} /></div>
            <div className="field" style={{ flex: 1 }}><label>Validade (minutos)</label><input type="number" min={3} max={30} value={cfg.codeMinutes} onChange={(e) => setCfg({ ...cfg, codeMinutes: Number(e.target.value) || 10 })} /></div>
          </div>
          <label className="sec-check"><input type="checkbox" checked={cfg.waAuthButton} onChange={(e) => setCfg({ ...cfg, waAuthButton: e.target.checked })} /> Botão "copiar código" no modelo</label>
          <button className="btn block" disabled={busy} onClick={() => void run(async () => { const r = await api.security.save(cfg); setV(r); setCfg(r.config); toast.success('Segurança guardada'); })}>Guardar</button>
        </div>
        <div className="sec-side">
          <div className="card sec-card">
            <h3>Enviar código de teste</h3>
            <div className="sec-seg" role="radiogroup">
              {(['EMAIL', 'WHATSAPP'] as const).map((c) => <button key={c} role="radio" aria-checked={test.channel === c} className={test.channel === c ? 'on' : ''} onClick={() => setTest({ ...test, channel: c })}>{c === 'EMAIL' ? 'E-mail' : 'WhatsApp'}</button>)}
            </div>
            <div className="field"><label>{test.channel === 'EMAIL' ? 'E-mail' : 'Número de WhatsApp'}</label><input value={test.target} onChange={(e) => setTest({ ...test, target: e.target.value })} /></div>
            <button className="btn block" disabled={busy || test.target.trim().length < 6} onClick={() => void run(async () => { await api.security.test(test.channel, test.target); toast.success('Código de teste enviado'); })}>Enviar teste</button>
          </div>
          <div className="card sec-card">
            <h3>Desbloquear uma conta</h3>
            <div className="field"><label>E-mail, telefone ou código do associado</label><input value={who} onChange={(e) => setWho(e.target.value)} /></div>
            <button className="btn danger block" disabled={busy || who.trim().length < 4} onClick={() => void run(async () => { const r = await api.security.disableUser(who.trim()); toast.success(`2FA desligada em ${r.disabled} conta${r.disabled === 1 ? '' : 's'}`); setWho(''); void load(); })}>Desligar a 2FA desta conta</button>
          </div>
        </div>
      </div>
    </div>
  );
}
