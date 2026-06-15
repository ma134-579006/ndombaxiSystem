import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { MailConfigView } from '../api/types';
import { toast } from '../components/feedback';
import { Switch } from '../components/ui';

/**
 * Configuração de E-mail (SMTP) — Super Admin. Permite ligar o envio de
 * e-mails (recuperação de senha/PIN, boas-vindas) sem mexer nas env do Render.
 * A password é guardada encriptada e nunca é devolvida em claro.
 */
export function MailSettings() {
  const [cfg, setCfg] = useState<MailConfigView | null>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('465');
  const [secure, setSecure] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fromAddr, setFromAddr] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const c = await api.mailAdmin.get();
      setCfg(c);
      setHost(c.host ?? ''); setPort(String(c.port ?? 465)); setSecure(c.secure);
      setUsername(c.username ?? ''); setFromAddr(c.fromAddr ?? ''); setEnabled(c.enabled);
      setPassword('');
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao carregar.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    if (!host.trim() || !username.trim()) { toast.warning('Indica o servidor (host) e o utilizador (e-mail).'); return; }
    setSaving(true);
    try {
      const c = await api.mailAdmin.save({
        host: host.trim(), port: Number(port) || 465, secure, username: username.trim(),
        fromAddr: fromAddr.trim() || undefined, enabled,
        ...(password ? { password } : {}), // só envia se foi escrita uma nova
      });
      setCfg(c); setPassword('');
      toast.success('Configuração de e-mail guardada. ✅');
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); }
    finally { setSaving(false); }
  };

  const test = async () => {
    if (!/^\S+@\S+\.\S+$/.test(testTo.trim())) { toast.warning('Indica um e-mail válido para o teste.'); return; }
    setTesting(true);
    try {
      const r = await api.mailAdmin.test(testTo.trim());
      r.ok ? toast.success(r.message) : toast.error(r.message);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha no teste.'); }
    finally { setTesting(false); }
  };

  if (loading) return <div className="card"><div className="loading" style={{ padding: 24 }}>A carregar…</div></div>;

  return (
    <>
      <div className="content-head"><h2>E-mail (SMTP)</h2></div>

      <div className={`banner ${cfg?.source === 'db' ? 'success' : cfg?.source === 'env' ? 'info' : 'warning'}`} style={{ marginBottom: 16 }}>
        <div>
          {cfg?.source === 'db' ? '✅ A enviar e-mails com esta configuração (guardada no painel).'
            : cfg?.source === 'env' ? 'ℹ️ A usar a configuração das variáveis do Render. Podes substituí-la aqui.'
            : '⚠️ Sem e-mail configurado — a recuperação de senha/PIN não envia. Preenche abaixo.'}
        </div>
      </div>

      <div className="card">
        <h3>Servidor SMTP</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Recomendado: <strong>Gmail</strong> — host <code>smtp.gmail.com</code>, porta <code>465</code>, seguro. A senha tem de ser uma
          <strong> palavra-passe de app</strong> (16 letras) gerada na conta Google com verificação em 2 passos ativa.
        </p>
        <div className="grid-2">
          <div className="field"><label>Servidor (host)</label>
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.gmail.com" /></div>
          <div className="field"><label>Porta</label>
            <input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" placeholder="465" /></div>
        </div>
        <div className="switch-row"><span>Ligação segura (SSL/TLS — porta 465)</span><Switch checked={secure} onChange={setSecure} /></div>
        <div className="field"><label>Utilizador (e-mail)</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="a-tua-loja@gmail.com" inputMode="email" /></div>
        <div className="field"><label>Palavra-passe {cfg?.hasPassword ? <span className="muted">(guardada: {cfg.passwordMask} — deixa vazio para manter)</span> : null}</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder={cfg?.hasPassword ? '•••••••• (manter)' : 'palavra-passe de app'} autoComplete="new-password" /></div>
        <div className="field"><label>Remetente (opcional)</label>
          <input value={fromAddr} onChange={(e) => setFromAddr(e.target.value)} placeholder="Ndombaxi System <a-tua-loja@gmail.com>" /></div>
        <div className="switch-row"><span>Ativo (usar esta configuração)</span><Switch checked={enabled} onChange={setEnabled} /></div>
        <button className="btn lg block" style={{ marginTop: 8 }} onClick={() => void save()} disabled={saving}>{saving ? 'A guardar…' : 'Guardar configuração'}</button>
      </div>

      <div className="card">
        <h3>Testar envio</h3>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <input style={{ flex: 1, minWidth: 200 }} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="e-mail para receber o teste" inputMode="email" />
          <button className="btn ghost" onClick={() => void test()} disabled={testing}>{testing ? 'A enviar…' : 'Enviar e-mail de teste'}</button>
        </div>
      </div>
    </>
  );
}
