import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { GOOGLE_CLIENT_ID } from '../config';
import { setSession, clearSession } from '../store/customer';
import type { CustomerProfile, CustomerSession, MyClinical, MyOrderRow } from '../api/types';
import { formatKz } from '../format';
import { IconClose, IconStore } from './Icons';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { google?: { accounts?: { id?: unknown } } };
    if (w.google?.accounts?.id) return resolve();
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('gis')));
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('gis'));
    document.head.appendChild(s);
  });
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendente', PAID: 'Pago', SHIPPED: 'Enviado', DELIVERED: 'Entregue', CANCELLED: 'Cancelado',
};

export function CustomerModal({
  code, session, onClose, onOpenOrder, businessType,
}: {
  code: string;
  session: CustomerSession | null;
  onClose(): void;
  onOpenOrder(orderId: string): void;
  businessType?: string;
}) {
  const clinic = businessType === 'CLINIC';
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>{session ? (clinic ? 'A minha área' : 'A minha conta') : 'Entrar'}</h3>
          <span className="spacer" />
          <button className="icon-x" onClick={onClose}><IconClose size={22} /></button>
        </div>
        <div className="mb">
          {session
            ? <Account code={code} session={session} onClose={onClose} onOpenOrder={onOpenOrder} clinic={clinic} />
            : <Login code={code} onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

function Login({ code, onClose }: { code: string; onClose(): void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const gbtn = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_ID.includes('.apps.googleusercontent.com')) return;
    let alive = true;
    loadGis().then(() => {
      if (!alive) return;
      const g = (window as unknown as { google?: any }).google;
      if (!g?.accounts?.id) return;
      g.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp: { credential?: string }) => {
          if (!resp.credential) return;
          setBusy(true); setErr(null);
          try {
            setSession(code, await api.authGoogle(code, resp.credential));
            onClose();
          } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha no login com Google.'); }
          finally { setBusy(false); }
        },
      });
      if (gbtn.current) {
        g.accounts.id.renderButton(gbtn.current, { theme: 'outline', size: 'large', width: 300, text: 'continue_with' });
      }
    }).catch(() => { /* GIS indisponível — fica só o email */ });
    return () => { alive = false; };
  }, [code, onClose]);

  const submit = async () => {
    setErr(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('Indique um email válido.'); return; }
    setBusy(true);
    try {
      setSession(code, await api.authEmail(code, email.trim(), name.trim() || undefined));
      onClose();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  };

  const googleOn = GOOGLE_CLIENT_ID.includes('.apps.googleusercontent.com');

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Entra para <strong>acompanhar as tuas encomendas</strong> e falar com a loja — com histórico e apoio por IA.
      </p>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      {googleOn ? (
        <>
          <div ref={gbtn} style={{ display: 'flex', justifyContent: 'center', minHeight: 44, marginBottom: 4 }} />
          <div className="or-sep"><span>ou com email</span></div>
        </>
      ) : null}
      <div className="field"><label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="o-teu-email@exemplo.com" inputMode="email" /></div>
      <div className="field"><label>Nome (opcional)</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="O teu nome" /></div>
      <button className="btn lg block" onClick={submit} disabled={busy}>{busy ? 'A entrar…' : 'Entrar / Criar conta'}</button>
    </>
  );
}

/** Editor do PERFIL do cliente — preenche uma vez e o checkout não pede de novo. */
function ProfileEditor({ code, token }: { code: string; token: string }) {
  const [p, setP] = useState<CustomerProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.myProfile(code, token).then((r) => { if (alive) { setP(r); if (!(r.province && r.municipality && r.neighborhood)) setOpen(true); } }).catch(() => undefined);
    return () => { alive = false; };
  }, [code, token]);

  if (!p) return null;
  const set = (k: keyof CustomerProfile, v: string) => setP({ ...p, [k]: v });
  const complete = !!(p.province && p.municipality && p.neighborhood);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.updateProfile(code, token, {
        name: p.name ?? undefined, phone: p.phone ?? undefined, address: p.address ?? undefined,
        province: p.province ?? undefined, municipality: p.municipality ?? undefined,
        neighborhood: p.neighborhood ?? undefined, taxId: p.taxId ?? undefined,
      });
      setP(r); setMsg('Dados guardados ✅'); setOpen(false);
    } catch { setMsg('Não foi possível guardar.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div className="acct-head" style={{ padding: 0, border: 'none' }}>
        <h4 style={{ margin: 0 }}>Os meus dados</h4>
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={() => setOpen((o) => !o)}>{open ? 'Fechar' : complete ? 'Editar' : 'Preencher'}</button>
      </div>
      {!open ? (
        <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>
          {complete ? `${p.neighborhood}, ${p.municipality}, ${p.province}${p.phone ? ` · ${p.phone}` : ''}` : 'Preenche os teus dados de entrega — assim não os repetes em cada compra.'}
        </p>
      ) : (
        <div style={{ marginTop: 8 }}>
          {msg ? <div className="banner success" style={{ marginBottom: 10, fontSize: 13 }}><div>{msg}</div></div> : null}
          <div className="field"><label>Nome</label><input value={p.name ?? ''} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="field"><label>Telefone</label><input value={p.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="9XX XXX XXX" inputMode="tel" /></div>
          <div className="field"><label>Província</label><input value={p.province ?? ''} onChange={(e) => set('province', e.target.value)} placeholder="Luanda" /></div>
          <div className="field"><label>Município</label><input value={p.municipality ?? ''} onChange={(e) => set('municipality', e.target.value)} placeholder="Belas" /></div>
          <div className="field"><label>Bairro</label><input value={p.neighborhood ?? ''} onChange={(e) => set('neighborhood', e.target.value)} placeholder="Talatona" /></div>
          <div className="field"><label>Morada (opcional)</label><input value={p.address ?? ''} onChange={(e) => set('address', e.target.value)} placeholder="Rua, nº, referência" /></div>
          <div className="field"><label>NIF (opcional)</label><input value={p.taxId ?? ''} onChange={(e) => set('taxId', e.target.value)} placeholder="NIF para factura" /></div>
          <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A guardar…' : 'Guardar dados'}</button>
        </div>
      )}
    </div>
  );
}

const RX_ST: Record<string, string> = { ISSUED: 'Por dispensar', DISPENSED: 'Dispensada', CANCELLED: 'Cancelada' };
const APPT_ST: Record<string, string> = { SCHEDULED: 'Marcada', DONE: 'Realizada', CANCELLED: 'Cancelada', NO_SHOW: 'Faltou' };
const EXAM_ST: Record<string, string> = { REQUESTED: 'Pedido', COLLECTED: 'Colhido', IN_LAB: 'No laboratório', DONE: 'Concluído', DELIVERED: 'Entregue' };

/** "A minha saúde" — consultas, receitas e resultados de exames do paciente. */
function MyHealth({ code, token }: { code: string; token: string }) {
  const [data, setData] = useState<MyClinical | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.myClinical(code, token)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e instanceof ApiError ? e.message : 'Falha ao carregar a sua saúde.'); });
    return () => { alive = false; };
  }, [code, token]);

  if (err) return <div className="banner danger" style={{ marginTop: 14 }}>{err}</div>;
  if (!data) return <p className="muted" style={{ marginTop: 14 }}>A carregar a sua saúde…</p>;
  if (!data.patient) {
    return (
      <div className="banner" style={{ marginTop: 14, background: 'var(--soft, #f3f6fb)', padding: 12, borderRadius: 10 }}>
        <strong>🩺 A minha saúde</strong>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          Ainda não encontrámos a sua ficha clínica. Marque uma consulta com este e-mail e o seu histórico aparece aqui.
        </p>
      </div>
    );
  }
  const { appointments, prescriptions, exams } = data;
  return (
    <div style={{ marginTop: 16 }}>
      <h4 style={{ margin: '0 0 8px' }}>🩺 A minha saúde</h4>

      <div className="hx-block">
        <div className="hx-ttl">📅 Consultas ({appointments.length})</div>
        {appointments.length === 0 ? <p className="muted" style={{ fontSize: 13, margin: 0 }}>Sem consultas.</p>
          : appointments.slice(0, 6).map((a) => (
            <div key={a.id} className="hx-row">
              <div><strong>{a.when_label}</strong>{a.professional ? ` · ${a.professional}` : ''}<div className="muted" style={{ fontSize: 12 }}>{a.reason || 'consulta'}</div></div>
              <span className="status-pill">{APPT_ST[a.status] ?? a.status}</span>
            </div>
          ))}
      </div>

      <div className="hx-block">
        <div className="hx-ttl">💊 Receitas ({prescriptions.length})</div>
        {prescriptions.length === 0 ? <p className="muted" style={{ fontSize: 13, margin: 0 }}>Sem receitas.</p>
          : prescriptions.slice(0, 6).map((r) => (
            <div key={r.id} className="hx-row">
              <div><strong>{r.number}</strong> · {r.item_count} medicamento(s)<div className="muted" style={{ fontSize: 12 }}>{r.professional || '—'} · {r.issued}</div></div>
              <span className="status-pill">{RX_ST[r.status] ?? r.status}</span>
            </div>
          ))}
      </div>

      <div className="hx-block">
        <div className="hx-ttl">🧪 Exames & resultados ({exams.length})</div>
        {exams.length === 0 ? <p className="muted" style={{ fontSize: 13, margin: 0 }}>Sem exames.</p>
          : exams.slice(0, 6).map((e) => (
            <div key={e.id} className="hx-row">
              <div><strong>{e.exam_type}</strong><div className="muted" style={{ fontSize: 12 }}>{e.requested}{e.result_text && ['DONE', 'DELIVERED'].includes(e.status) ? ` · 📄 ${e.result_text.slice(0, 60)}` : ''}</div></div>
              <span className="status-pill">{EXAM_ST[e.status] ?? e.status}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function Account({
  code, session, onClose, onOpenOrder, clinic,
}: {
  code: string;
  session: CustomerSession;
  onClose(): void;
  onOpenOrder(orderId: string): void;
  clinic?: boolean;
}) {
  const [orders, setOrders] = useState<MyOrderRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.myOrders(code, session.token)
      .then((o) => { if (alive) setOrders(o); })
      .catch((e) => { if (alive) setErr(e instanceof ApiError ? e.message : 'Falha ao carregar encomendas.'); });
    return () => { alive = false; };
  }, [code, session.token]);

  return (
    <>
      <div className="acct-head">
        <div className="avatar"><IconStore size={20} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800 }}>{session.customer.name}</div>
          <div className="muted" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.customer.email}</div>
        </div>
        <button className="btn ghost" onClick={() => { clearSession(code); onClose(); }}>Sair</button>
      </div>

      {clinic ? <MyHealth code={code} token={session.token} /> : null}

      <ProfileEditor code={code} token={session.token} />

      <h4 style={{ margin: '18px 0 8px' }}>{clinic ? 'As minhas compras na farmácia' : 'As minhas encomendas'}</h4>
      {err ? <div className="banner danger">{err}</div>
        : orders == null ? <p className="muted">A carregar…</p>
        : orders.length === 0 ? <p className="muted">Ainda não tens encomendas nesta loja.</p>
        : (
          <div className="my-orders">
            {orders.map((o) => (
              <button key={o.id} className="mo" onClick={() => onOpenOrder(o.id)}>
                <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{o.order_number}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{new Date(o.created_at).toLocaleDateString('pt-PT')}</div>
                </div>
                <span className={`status-pill st-${o.status}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                <strong>{formatKz(Number(o.gross_total))}</strong>
              </button>
            ))}
          </div>
        )}
    </>
  );
}
