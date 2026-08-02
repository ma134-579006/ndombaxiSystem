import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { DocumentIdentity } from '../api/types';
import { IconCheck, IconImage } from '../components/Icons';
import { openCaixaTerminal } from '../config';

/** Nível de cada papel (0 = mais poder), igual ao backend. */
const ROLE_LEVEL: Record<string, number> = {
  SUPER_ADMIN: 0, COMPANY_ADMIN: 1, REGIONAL_MANAGER: 2, STORE_MANAGER: 3,
  SHIFT_SUPERVISOR: 4, CASHIER: 5, ATTENDANT: 6,
};

/** Configurações da conta do gestor: foto, nome, NIF da empresa, alterar
 *  palavra-passe e PIN. Página bonita e 100% responsiva. */
export function Profile() {
  const { user, companyCode } = useAuth();
  const uid = user?.sub || '';
  // «Abrir caixa»: disponível para gestor/gerente/admin/supervisor (não atendente/operador).
  const isTenant = user?.subjectType === 'TENANT';
  const canOpenCash = isTenant && (ROLE_LEVEL[user?.role ?? ''] ?? 9) <= ROLE_LEVEL.SHIFT_SUPERVISOR;
  const openCash = () => openCaixaTerminal({
    staff: user?.email || '',
    nome: user?.name,
    empresa: companyCode || undefined,
  });
  const [name, setName] = useState(user?.name || '');
  const [photo, setPhoto] = useState<string | null>(null);
  const [brand, setBrand] = useState<DocumentIdentity | null>(null);
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.branding().then(setBrand).catch(() => undefined);
    api.staff.listUsers().then((list) => {
      const me = list.find((u) => u.id === uid);
      if (me) { setName(me.name); setPhoto(me.photo_url ?? null); }
    }).catch(() => undefined);
  }, [uid]);

  const flash = (m: string) => { setMsg(m); setErr(null); setTimeout(() => setMsg(null), 3000); };
  const fail = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Não foi possível guardar.');

  const onPhoto = (f?: File) => {
    if (!f) return;
    if (f.size > 1_800_000) { setErr('Imagem demasiado grande (máx. ~1,8 MB).'); return; }
    const r = new FileReader();
    r.onload = () => setPhoto(String(r.result));
    r.readAsDataURL(f);
  };

  const saveProfile = async () => {
    setErr(null); setBusy(true);
    try {
      await api.staff.updateUser(uid, { name: name.trim() || undefined, photoUrl: photo ?? undefined });
      flash('Perfil guardado. Atualize a página para ver a nova foto no topo.');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const changePassword = async () => {
    setErr(null);
    if (pw.length < 8) { setErr('A nova palavra-passe deve ter pelo menos 8 caracteres.'); return; }
    if (pw !== pw2) { setErr('As palavras-passe não coincidem.'); return; }
    setBusy(true);
    try { await api.staff.resetPassword(uid, pw); setPw(''); setPw2(''); flash('Senha alterada.'); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };

  const changePin = async () => {
    setErr(null);
    if (!/^\d{6}$/.test(pin)) { setErr('O PIN deve ter 6 dígitos.'); return; }
    setBusy(true);
    try { await api.staff.setPin(uid, pin); setPin(''); flash('PIN alterado.'); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="content-head"><h2>Configurações da conta</h2></div>
      {msg ? <div className="banner success">{msg}</div> : null}
      {err ? <div className="banner danger">{err}</div> : null}

      {canOpenCash ? (
        <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, flex: 'none', display: 'grid', placeItems: 'center', fontSize: 26, background: 'linear-gradient(135deg, var(--primary), #7c4dff)', boxShadow: '0 6px 20px rgba(79,124,255,.35)' }}>🛒</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h3 style={{ margin: '0 0 2px' }}>Abrir caixa</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Entra no terminal de venda com o teu próprio perfil — só te pede o PIN, sem login tradicional.
              {' '}Define primeiro o teu PIN da caixa em <strong>Segurança</strong>.
            </p>
          </div>
          <button className="btn lg" onClick={openCash} style={{ flex: 'none' }}>🛒 Abrir caixa</button>
        </div>
      ) : null}

      <div className="cols-2">
        {/* Perfil: foto + nome + email + NIF */}
        <div className="card">
          <h3>Perfil</h3>
          <div className="row" style={{ gap: 16, alignItems: 'center', marginBottom: 14 }}>
            <div style={{ width: 84, height: 84, borderRadius: 18, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface-2)', display: 'grid', placeItems: 'center', flex: 'none' }}>
              {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <IconImage size={30} />}
            </div>
            <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
              <IconImage size={15} /> {photo ? 'Trocar foto' : 'Adicionar foto'}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
            </label>
          </div>
          <div className="field"><label>Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="O seu nome" /></div>
          <div className="field"><label>Email (login)</label>
            <input value={user?.email || ''} disabled /></div>
          <div className="field"><label>NIF da empresa</label>
            <input value={brand?.nif || ''} disabled placeholder="—" />
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>O NIF define-se no registo da empresa. Para alterar, contacte o suporte.</p></div>
          <button className="btn lg block" onClick={saveProfile} disabled={busy}><IconCheck size={17} /> Guardar perfil</button>
        </div>

        {/* Segurança: password + PIN */}
        <div className="card">
          <h3>Segurança</h3>
          <div className="field"><label>Nova palavra-passe</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="mín. 8 caracteres" /></div>
          <div className="field"><label>Confirmar palavra-passe</label>
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
          <button className="btn block" onClick={changePassword} disabled={busy}>Alterar palavra-passe</button>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '18px 0' }} />

          <div className="field"><label>PIN da caixa (6 dígitos)</label>
            <input inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="ex.: 123456" /></div>
          <button className="btn block" onClick={changePin} disabled={busy}>Alterar PIN</button>
        </div>
      </div>
    </div>
  );
}
