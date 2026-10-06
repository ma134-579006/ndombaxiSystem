import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CameraRow, OrderLocation, OrderMessage, OrderStatus, WebOrder, WebOrderDetail } from '../api/types';
import { IconCpu, IconTruck } from '../components/Icons';
import { Modal } from '../components/ui';
import { toast } from '../components/feedback';
import { LiveMap } from '../components/LiveMap';
import { Compass, useNavigation } from '../components/RouteCompass';
import { LivePlayer } from './Cameras';
import { formatDate, formatKz, statusLabel } from '../format';
import { pollEvery, stopPoll } from '../poll';

const CHATTABLE = ['PAID', 'SHIPPED', 'DELIVERED'];

const FILTERS: { key: '' | OrderStatus; label: string }[] = [
  { key: '', label: 'Todas' },
  { key: 'PENDING', label: 'Pendentes' },
  { key: 'PAID', label: 'Pagas' },
  { key: 'SHIPPED', label: 'Expedidas' },
  { key: 'DELIVERED', label: 'Entregues' },
];

const STATUS_TONE: Record<string, string> = {
  PENDING: 'var(--warning)',
  PAID: 'var(--primary)',
  SHIPPED: 'var(--violet, #a855f7)',
  DELIVERED: 'var(--success)',
  CANCELLED: 'var(--muted)',
};

function OrderBadge({ status }: { status: string }) {
  const color = STATUS_TONE[status] ?? 'var(--muted)';
  return (
    <span className="badge" style={{ color, borderColor: color }}>
      <span className="dot" /> {statusLabel(status)}
    </span>
  );
}

export function Orders() {
  const [orders, setOrders] = useState<WebOrder[]>([]);
  const [filter, setFilter] = useState<'' | OrderStatus>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<WebOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showGeo, setShowGeo] = useState(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      setOrders(await api.orders.list());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar encomendas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // TEMPO REAL: novas encomendas e mudanças de estado da COZINHA (Pronto)
    // aparecem sem recarregar. Se houver um detalhe aberto, atualiza-o também
    // — assim o gate "aguarda a cozinha" levanta sozinho quando ficar Pronto.
    const t = pollEvery(() => {
      void load({ silent: true });
      setDetail((cur) => {
        if (cur) { api.orders.get(cur.id).then(setDetail).catch(() => undefined); }
        return cur;
      });
    }, 10000);
    return () => stopPoll(t);
  }, [load]);

  const open = async (id: string) => {
    setDetailLoading(true);
    setActionError(null);
    setShowGeo(false);
    try {
      setDetail(await api.orders.get(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao abrir a encomenda.');
    } finally {
      setDetailLoading(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    if (!detail) return;
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      const fresh = await api.orders.get(detail.id);
      setDetail(fresh);
      await load();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'A operação falhou.');
    } finally {
      setBusy(false);
    }
  };

  const filtered = filter ? orders.filter((o) => o.status === filter) : orders;

  return (
    <>
      <div className="content-head">
        <h2>Encomendas online</h2>
        <span className="spacer" />
        <div className="wrapcols" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button key={f.label} className={`chip${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className="banner danger">{error}</div> : null}

      <div className="card">
        {loading ? (
          <div className="loading">A carregar encomendas…</div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <IconTruck size={40} />
            <p>Sem encomendas neste filtro.</p>
          </div>
        ) : (
          filtered.map((o) => (
            <div className="list-row" key={o.id} style={{ cursor: 'pointer' }} onClick={() => open(o.id)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {o.order_number}{' '}
                  <span className="muted" style={{ fontWeight: 500 }}>· {o.customer_name || 'Cliente'}</span>
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  {[o.province, o.municipality].filter(Boolean).join(', ') || '—'} · {formatDate(o.created_at)}
                </div>
              </div>
              <strong>{formatKz(o.gross_total)}</strong>
              <OrderBadge status={o.status} />
            </div>
          ))
        )}
      </div>

      {detailLoading ? (
        <Modal title="Encomenda" onClose={() => setDetail(null)}>
          <div className="loading">A carregar…</div>
        </Modal>
      ) : detail ? (
        <Modal title={detail.order_number} onClose={() => setDetail(null)} wide={showGeo}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <OrderBadge status={detail.status} />
            <strong style={{ fontSize: 18 }}>{formatKz(detail.gross_total)}</strong>
          </div>

          <div className="kv"><span className="k">Cliente</span><span className="v">{detail.customer_name || '—'}</span></div>
          <div className="kv"><span className="k">Telefone</span><span className="v">{detail.customer_phone || '—'}</span></div>
          <div className="kv"><span className="k">NIF</span><span className="v">{detail.customer_tax_id || '—'}</span></div>
          <div className="kv">
            <span className="k">Morada</span>
            <span className="v">{[detail.neighborhood, detail.municipality, detail.province].filter(Boolean).join(', ') || '—'}</span>
          </div>
          <div className="kv"><span className="k">Pagamento</span><span className="v">{detail.payment_method || '—'}</span></div>
          {detail.payment_reference ? (
            <div className="kv"><span className="k">Referência</span>
              <span className="v">{detail.payment_entity ? `Ent. ${detail.payment_entity} · ` : ''}{detail.payment_reference}</span></div>
          ) : null}
          {/* Cozinha (restauração): tempo estimado dado pelo cozinheiro. */}
          {detail.kitchen_status && detail.kitchen_status !== 'NEW' ? (
            <div className="kv"><span className="k">Cozinha</span>
              <span className="v">{detail.kitchen_status === 'READY' ? 'Pronto para entregar'
                : `Em preparação${detail.prep_eta_min ? ` · ~${detail.prep_eta_min} min` : ''}`}</span></div>
          ) : null}

          <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0', paddingTop: 10 }}>
            <strong style={{ fontSize: 14 }}>Artigos</strong>
            {detail.items.map((it) => (
              <div className="kv" key={it.id}>
                <span className="k">{Number(it.quantity)}× {it.description}</span>
                <span className="v">{formatKz(it.gross_amount)}</span>
              </div>
            ))}
          </div>

          {actionError ? <div className="banner danger" style={{ marginBottom: 12 }}>{actionError}</div> : null}

          {/* GATE DA COZINHA: enquanto o pedido está em preparação (a cozinha
              aceitou mas ainda NÃO clicou "Pronto"), o responsável NÃO pode
              expedir/entregar. Só avança quando a cozinha marcar Pronto. */}
          {detail.kitchen_status === 'PREPARING' ? (
            <div className="banner warning" style={{ marginBottom: 12 }}>
              {/* Conteúdo num único span: o .banner é flex e nós de texto soltos
                  viram itens flex — o <strong> era empurrado p/ a direita ("Pro nto"). */}
              <span>
                A cozinha está a preparar este pedido. Só poderá continuar (expedir/entregar)
                quando o cozinheiro marcar <strong>Pronto</strong>.
              </span>
            </div>
          ) : null}

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {detail.status === 'PENDING' ? (
              <>
                <button className="btn success" disabled={busy} onClick={() => act(() => api.orders.pay(detail.id))}>
                  Confirmar pagamento
                </button>
                {detail.payment_reference ? (
                  <button className="btn" disabled={busy}
                    title="Reconhece o pagamento por referência e aprova a encomenda automaticamente"
                    onClick={() => act(() => api.orders.confirmReference({
                      entity: detail.payment_entity ?? undefined,
                      reference: detail.payment_reference!,
                      amount: Number(detail.gross_total),
                    }))}>
                    Confirmar referência paga
                  </button>
                ) : null}
                <button className="btn ghost" disabled={busy} onClick={() => act(() => api.orders.cancel(detail.id))}>
                  Cancelar
                </button>
              </>
            ) : null}
            {detail.status === 'PAID' ? (
              <button className="btn" disabled={busy || detail.kitchen_status === 'PREPARING'} onClick={() => act(() => api.orders.ship(detail.id))}>
                Marcar expedida
              </button>
            ) : null}
            {detail.status === 'SHIPPED' ? (
              <button className="btn success" disabled={busy || detail.kitchen_status === 'PREPARING'} onClick={() => act(() => api.orders.deliver(detail.id))}>
                Marcar entregue
              </button>
            ) : null}
            {detail.invoice_id ? <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>Factura emitida ✓</span> : null}
          </div>

          <div style={{ marginTop: 12 }}>
            <button className="btn ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setShowGeo((v) => !v)}>
              {showGeo ? 'Ocultar localização' : 'Ver localização do cliente (GPS em tempo real)'}
            </button>
            {showGeo ? <LiveOrderMap orderId={detail.id} /> : null}
          </div>

          {CHATTABLE.includes(detail.status) ? (
            <OrderChat orderId={detail.id} />
          ) : (
            <div className="muted" style={{ fontSize: 12, marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              A conversa com o cliente abre depois de a encomenda ser <strong>paga/aprovada</strong>.
            </div>
          )}
        </Modal>
      ) : null}
    </>
  );
}

/** Há quanto tempo foi a última leitura GPS (texto curto). */
function sinceLabel(iso: string | null): string {
  if (!iso) return 'sem leitura';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 10) return 'agora mesmo';
  if (s < 60) return `há ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return `há ${h} h`;
}

/** Distância aproximada em metros entre duas coordenadas (para o trajeto). */
function metersBetween(a: [number, number], b: [number, number]): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Localização do cliente AO VIVO (entrega). Atualiza a cada 4 s e desenha o mapa
 * próprio (LiveMap) com marcador, precisão GPS e o trajeto desde que se abriu.
 * Antes era um iframe do Google Maps que ficava BRANCO nas aplicações.
 */
function LiveOrderMap({ orderId }: { orderId: string }) {
  const [loc, setLoc] = useState<OrderLocation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [copied, setCopied] = useState(false);
  const [, force] = useState(0); // re-render p/ atualizar "há X min"
  // Caminho + bússola a partir deste aparelho até ao cliente.
  const { nav, start, stop } = useNavigation(loc?.lat != null && loc?.lng != null ? { lat: loc.lat, lng: loc.lng } : null);
  // Câmaras da empresa com posição no mapa (tocar → imagem ao vivo).
  const [cams, setCams] = useState<CameraRow[]>([]);
  const [camOpen, setCamOpen] = useState<CameraRow | null>(null);
  useEffect(() => { api.cameras.list().then((r) => setCams(r.filter((c) => c.is_active && c.geo_lat != null && c.geo_lng != null))).catch(() => setCams([])); }, []);

  useEffect(() => {
    let alive = true;
    setTrail([]);
    const tick = () => {
      api.orders.location(orderId).then((r) => {
        if (!alive) return;
        setLoc(r); setErr(null);
        if (r.lat != null && r.lng != null) {
          const pt: [number, number] = [r.lat, r.lng];
          // Só junta ao trajeto quando o cliente se moveu (> 5 m); guarda os últimos 120 pontos.
          setTrail((t) => (t.length && metersBetween(t[t.length - 1], pt) < 5 ? t : [...t.slice(-119), pt]));
        }
      }).catch((e) => { if (alive) setErr(e instanceof ApiError ? e.message : 'Falha ao obter localização.'); });
    };
    tick();
    const t = pollEvery(tick, 4000);
    const c = pollEvery(() => force((n) => n + 1), 1000);
    return () => { alive = false; stopPoll(t); stopPoll(c); };
  }, [orderId]);

  if (err) return <div className="banner danger" style={{ marginTop: 10 }}>{err}</div>;
  if (!loc) return <div className="loading" style={{ marginTop: 10 }}>A obter localização…</div>;

  if (loc.lat == null || loc.lng == null) {
    return (
      <div className="loc-empty">
        <span className="ic" aria-hidden>⌖</span>
        <div>
          <strong>{loc.consent ? 'À espera do sinal GPS do cliente' : 'Localização não partilhada'}</strong>
          {loc.consent
            ? 'A posição aparece aqui assim que o cliente tiver a loja aberta com o GPS ligado.'
            : 'O cliente não autorizou a partilha da localização GPS nesta encomenda. Use a morada de entrega abaixo ou contacte-o.'}
        </div>
      </div>
    );
  }

  const q = `${loc.lat.toFixed(6)},${loc.lng.toFixed(6)}`;
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${q}`;
  const waze = `https://waze.com/ul?ll=${q}&navigate=yes`;
  const fresh = !!loc.updatedAt && Date.now() - new Date(loc.updatedAt).getTime() < 15000;
  const address = [loc.shippingAddress, loc.neighborhood, loc.municipality, loc.province].filter(Boolean).join(', ');
  const copy = async () => {
    try { await navigator.clipboard.writeText(q); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { toast.info(q); }
  };

  return (
    <div className="loc-card">
      <div className="loc-head">
        <h4>Localização do cliente</h4>
        <span className={`loc-pill${fresh ? ' live' : ''}`}><i />{fresh ? 'Ao vivo' : 'Última posição'}</span>
        <span className="loc-meta">
          Atualizado {sinceLabel(loc.updatedAt)}{loc.accuracy != null ? ` · precisão ±${Math.round(loc.accuracy)} m` : ''}
        </span>
      </div>
      <div className="loc-body">
        <LiveMap lat={loc.lat} lng={loc.lng} accuracy={loc.accuracy} trail={trail} live={fresh}
          start={nav.start} route={nav.route} fitKey={nav.fitKey}
          cameras={cams.map((c) => ({ id: c.id, name: c.name, lat: Number(c.geo_lat), lng: Number(c.geo_lng) }))}
          onCamera={(id) => setCamOpen(cams.find((c) => c.id === id) ?? null)} />
        {nav.active && nav.start ? (
          <Compass from={nav.start} to={{ lat: loc.lat, lng: loc.lng }} heading={nav.heading}
            distance={nav.distance} duration={nav.duration} mode={nav.mode} />
        ) : null}
      </div>
      <div className="loc-info">
        <div><span className="k">Cliente</span><span className="v">{loc.customerName || '—'}</span></div>
        <div><span className="k">Telefone</span><span className="v">{loc.customerPhone ? <a href={`tel:${loc.customerPhone}`}>{loc.customerPhone}</a> : '—'}</span></div>
        <div><span className="k">Morada de entrega</span><span className="v">{address || '—'}</span></div>
        <div><span className="k">Coordenadas</span><span className="v">{q}</span></div>
      </div>
      {nav.error ? <div className="banner danger" style={{ margin: '0 16px 10px' }}>{nav.error}</div> : null}
      {camOpen ? (
        <Modal title={`Câmara · ${camOpen.name}`} onClose={() => setCamOpen(null)} wide>
          <LivePlayer cam={camOpen} />
        </Modal>
      ) : null}
      <div className="loc-actions">
        <button type="button" className={`btn${nav.active ? ' on' : ''}`} onClick={() => (nav.active ? stop() : start())}>
          {nav.active ? (nav.start ? 'Parar caminho' : 'A localizar este aparelho…') : 'Traçar caminho até ao cliente'}
        </button>
        <a className="btn ghost" href={dir} target="_blank" rel="noreferrer">Como chegar (Google Maps)</a>
        <a className="btn ghost" href={waze} target="_blank" rel="noreferrer">Abrir no Waze</a>
        <button type="button" className="btn ghost" onClick={() => void copy()}>{copied ? 'Copiado ✓' : 'Copiar coordenadas'}</button>
      </div>
    </div>
  );
}

/** Conversa com o cliente da encomenda (a IA responde quando ninguém está online). */
function OrderChat({ orderId }: { orderId: string }) {
  const [messages, setMessages] = useState<OrderMessage[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try { setMessages(await api.orders.messages(orderId)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao carregar a conversa.'); }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    try {
      await api.orders.reply(orderId, body);
      setText('');
      await load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível enviar.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <strong style={{ fontSize: 14 }}>Conversa com o cliente</strong>
      {err ? <div className="banner danger" style={{ margin: '8px 0' }}>{err}</div> : null}
      <div ref={scroller} style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, margin: '10px 0' }}>
        {messages == null ? <span className="muted" style={{ fontSize: 13 }}>A carregar…</span>
          : messages.length === 0 ? <span className="muted" style={{ fontSize: 13 }}>Ainda sem mensagens. Escreve para iniciar.</span>
          : messages.map((m) => {
            const staff = m.sender_type === 'STAFF';
            const ai = m.sender_type === 'ASSISTANT';
            return (
              <div key={m.id} style={{ alignSelf: staff ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                <div style={{
                  background: staff ? 'var(--primary)' : ai ? 'var(--surface-2)' : 'var(--surface)',
                  color: staff ? '#fff' : 'var(--text)',
                  border: staff ? 'none' : '1px solid var(--border)',
                  borderRadius: 12, padding: '8px 12px', fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, opacity: .8, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {ai ? <IconCpu size={12} /> : null}{m.sender_name}{ai ? ' · IA' : ''}
                  </div>
                  {m.body}
                </div>
              </div>
            );
          })}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
          placeholder="Responder ao cliente…"
          style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 13px', color: 'var(--text)', fontSize: 14 }}
        />
        <button className="btn" onClick={send} disabled={busy || !text.trim()}>Enviar</button>
      </div>
    </div>
  );
}
