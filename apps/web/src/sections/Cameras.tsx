import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CameraRow } from '../api/types';
import { confirmDialog, toast } from '../components/feedback';
import { IconPlus } from '../components/Icons';
import { Modal, Switch } from '../components/ui';
import { makeQrDetector } from '../scan/decoder';

/**
 * CÂMARAS de vigilância:
 *   • CONFIGURAR — ligar uma câmara por QR code (lê a URL/JSON do autocolante
 *     ou da app do DVR) ou pelos dados (URL HLS/MJPEG/MP4); teste de ligação
 *     REAL; gravação por instantâneos (1/min) com retenção de 30 dias e
 *     limpeza automática no servidor.
 *   • ABRIR — ver as câmaras AO VIVO (HLS via hls.js, MJPEG/MP4 via proxy
 *     autenticado da API) + rever gravações por dia.
 * Nota: câmaras RTSP precisam que o DVR/NVR exponha HTTP/HLS (a maioria tem).
 */

export function Cameras({ mode }: { mode: 'config' | 'live' }) {
  const [rows, setRows] = useState<CameraRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CameraRow | 'new' | null>(null);

  const load = async () => {
    setLoading(true);
    try { setRows(await api.cameras.list()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar câmaras.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  if (mode === 'live') return <CamerasLive rows={rows.filter((r) => r.is_active)} loading={loading} error={error} />;

  return (
    <>
      <div className="content-head">
        <h2>Câmaras — Configurar</h2>
        <span className="spacer" />
        <button className="btn" onClick={() => setEditing('new')}><IconPlus size={17} /> Ligar câmara</button>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? <div className="loading" style={{ padding: 26 }}>A carregar…</div>
          : rows.length === 0 ? (
            <div className="empty" style={{ padding: 30 }}>
              <p>Sem câmaras configuradas. Toca em <strong>Ligar câmara</strong> e lê o QR do equipamento ou cola a URL do stream (HLS/MJPEG/MP4) do teu DVR.</p>
            </div>
          ) : rows.map((c) => <CamRow key={c.id} cam={c} onEdit={() => setEditing(c)} onChanged={load} />)}
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        🎞️ Gravação: com a opção «Gravar» ligada e uma <strong>URL de fotograma</strong> definida, o servidor guarda 1 imagem/minuto
        durante <strong>30 dias</strong> — depois apaga automaticamente para libertar espaço. As gravações veem-se em «Câmaras → Abrir».
      </p>

      {editing ? <CamForm cam={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} /> : null}
    </>
  );
}

function CamRow({ cam, onEdit, onChanged }: { cam: CameraRow; onEdit(): void; onChanged(): void }) {
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    try {
      const r = await api.cameras.test(cam.id);
      if (r.ok) toast.success(`«${cam.name}» respondeu (${r.contentType ?? 'stream'} · ${r.kind}). ✅`);
      else toast.error(`«${cam.name}» não respondeu (HTTP ${r.status}). Confirma a URL e a rede.`);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Teste falhou.'); }
    finally { setBusy(false); }
  };
  const toggle = async () => {
    if (cam.is_active && !(await confirmDialog({ message: `Desativar a câmara «${cam.name}»? (não é eliminada — pode reativar quando quiser)` }))) return;
    setBusy(true);
    try { await api.cameras.update(cam.id, { isActive: !cam.is_active }); onChanged(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falhou.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="list-row" style={{ padding: '12px 16px' }}>
      <span style={{ fontSize: 22 }}>📹</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: 14 }}>{cam.name}</strong>
        <span className={`pill ${cam.is_active ? 'on' : 'off'}`} style={{ marginLeft: 8 }}>{cam.is_active ? 'Ativa' : 'Desativada'}</span>
        {cam.record ? <span className="pill" style={{ marginLeft: 6, color: 'var(--danger)' }}>● REC</span> : null}
        <div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cam.stream_url}</div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm ghost" onClick={() => void test()} disabled={busy}>Testar</button>
        <button className="btn sm ghost" onClick={onEdit}>Editar</button>
        <button className="btn sm ghost" onClick={() => void toggle()} disabled={busy}>{cam.is_active ? 'Desativar' : 'Reativar'}</button>
      </div>
    </div>
  );
}

/** Formulário (manual ou por QR). O QR pode conter a URL direta ou um JSON
 *  {"name":…,"stream":…,"snapshot":…} (formato comum em apps de DVR). */
function CamForm({ cam, onClose, onSaved }: { cam: CameraRow | null; onClose(): void; onSaved(): void }) {
  const [name, setName] = useState(cam?.name ?? '');
  const [streamUrl, setStreamUrl] = useState(cam?.stream_url ?? '');
  const [snapshotUrl, setSnapshotUrl] = useState(cam?.snapshot_url ?? '');
  const [record, setRecord] = useState(cam?.record ?? false);
  const [notes, setNotes] = useState(cam?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopScan = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };
  useEffect(() => () => stopScan(), []);

  const applyQr = (raw: string) => {
    try {
      const j = JSON.parse(raw) as { name?: string; stream?: string; streamUrl?: string; url?: string; snapshot?: string; snapshotUrl?: string };
      const su = j.stream ?? j.streamUrl ?? j.url;
      if (su) {
        setStreamUrl(su);
        if (j.name && !name) setName(j.name);
        if (j.snapshot ?? j.snapshotUrl) setSnapshotUrl((j.snapshot ?? j.snapshotUrl)!);
        toast.success('Dados da câmara lidos do QR. ✅');
        return;
      }
    } catch { /* não é JSON → trata como URL */ }
    if (/^https?:\/\//i.test(raw)) { setStreamUrl(raw); toast.success('URL lida do QR. ✅'); }
    else toast.warning(`O QR não contém uma URL HTTP(S): «${raw.slice(0, 60)}»`);
  };

  const startScan = async () => {
    try {
      const detect = await makeQrDetector();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      await new Promise((r) => setTimeout(r, 60));
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        const raw = await detect(videoRef.current);
        if (raw) { applyQr(raw); stopScan(); return; }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch { toast.error('Não foi possível abrir a câmara do dispositivo para ler o QR.'); }
  };

  const save = async () => {
    if (!name.trim() || !streamUrl.trim()) { toast.warning('Dá um nome e a URL do stream.'); return; }
    setSaving(true);
    try {
      const input = { name: name.trim(), streamUrl: streamUrl.trim(), snapshotUrl: snapshotUrl.trim() || undefined, record, notes: notes.trim() || undefined };
      if (cam) await api.cameras.update(cam.id, input);
      else await api.cameras.create(input);
      toast.success(`Câmara «${name.trim()}» ${cam ? 'atualizada' : 'ligada'}. ✅`);
      onSaved();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={cam ? 'Editar câmara' : 'Ligar câmara'} onClose={onClose}>
      <button className="btn ghost block" style={{ marginBottom: 12 }} onClick={() => (scanning ? stopScan() : void startScan())}>
        {scanning ? '✕ Parar leitura' : '🔳 Ler QR code da câmara/DVR'}
      </button>
      {scanning ? (
        <div className="pp-cam" style={{ marginBottom: 12 }}>
          <video ref={videoRef} playsInline muted />
          <div className="muted" style={{ fontSize: 12 }}>Aponta ao QR do equipamento ou da app do DVR…</div>
        </div>
      ) : null}
      <div className="field"><label>Nome</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Entrada da loja" /></div>
      <div className="field"><label>URL do stream (HLS .m3u8 · MJPEG · MP4)</label>
        <input value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)} placeholder="http://192.168.1.50:8080/video.m3u8" />
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>RTSP? Ativa o serviço HTTP/HLS no DVR/NVR (quase todos têm) e cola aqui essa URL.</p></div>
      <div className="field"><label>URL de fotograma JPEG (opcional — necessária p/ gravar)</label>
        <input value={snapshotUrl} onChange={(e) => setSnapshotUrl(e.target.value)} placeholder="http://192.168.1.50:8080/snapshot.jpg" /></div>
      <div className="switch-row"><span>Gravar (1 fotograma/min · retenção 30 dias)</span>
        <Switch checked={record} onChange={setRecord} /></div>
      <div className="field"><label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="localização, credenciais do DVR…" /></div>
      <button className="btn lg block" onClick={() => void save()} disabled={saving}>{saving ? 'A guardar…' : cam ? 'Guardar alterações' : 'Ligar câmara'}</button>
    </Modal>
  );
}

// ── ABRIR: visualização ao vivo + gravações ───────────────────
function CamerasLive({ rows, loading, error }: { rows: CameraRow[]; loading: boolean; error: string | null }) {
  const [open, setOpen] = useState<CameraRow | null>(null);
  return (
    <>
      <div className="content-head"><h2>Câmaras — Ao vivo</h2></div>
      {error ? <div className="banner danger">{error}</div> : null}
      {loading ? <div className="card"><div className="loading">A carregar…</div></div>
        : rows.length === 0 ? (
          <div className="card"><div className="empty" style={{ padding: 26 }}>
            <p>Sem câmaras ativas. Configura a primeira em <strong>Câmaras → Configurar</strong>.</p>
          </div></div>
        ) : (
          <div className="pgrid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))' }}>
            {rows.map((c) => (
              <button key={c.id} className="card" style={{ padding: 10, textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(c)}>
                <LivePlayer cam={c} thumb />
                <div className="row" style={{ marginTop: 8, gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>📹 {c.name}</strong>
                  {c.record ? <span className="pill" style={{ color: 'var(--danger)' }}>● REC</span> : null}
                  <span className="spacer" />
                  <span className="muted" style={{ fontSize: 12 }}>ampliar →</span>
                </div>
              </button>
            ))}
          </div>
        )}
      {open ? <CamViewer cam={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/** Player universal: HLS (hls.js), MP4 (<video>) ou MJPEG (<img> via proxy). */
function LivePlayer({ cam, thumb = false }: { cam: CameraRow; thumb?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const kind = cam.kind !== 'AUTO' ? cam.kind
    : cam.stream_url.toLowerCase().includes('.m3u8') ? 'HLS'
    : /\.(mp4|webm)/i.test(cam.stream_url) ? 'MP4' : 'MJPEG';
  // liga DIRETO à câmara (LAN do gestor) — o proxy /live fica para redes remotas
  const src = cam.stream_url;

  useEffect(() => {
    if (kind !== 'HLS' || !videoRef.current) return;
    let hls: { destroy(): void } | null = null;
    let alive = true;
    void (async () => {
      const v = videoRef.current!;
      if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = cam.stream_url; void v.play().catch(() => undefined); return; }
      const { default: Hls } = await import('hls.js');
      if (!alive) return;
      if (Hls.isSupported()) {
        const h = new Hls({ maxBufferLength: 10 });
        h.loadSource(cam.stream_url);
        h.attachMedia(v);
        h.on(Hls.Events.ERROR, (_e: unknown, d: { fatal?: boolean }) => { if (d?.fatal) setFailed(true); });
        hls = h;
      } else setFailed(true);
    })();
    return () => { alive = false; hls?.destroy(); };
  }, [cam.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const h = thumb ? 170 : 'min(62vh, 560px)';
  if (failed) return <div className="empty" style={{ height: h, display: 'grid', placeItems: 'center' }}><p>Sem sinal — verifica a câmara/rede.</p></div>;
  if (kind === 'MJPEG') {
    return <img src={src} alt={cam.name} style={{ width: '100%', height: h, objectFit: 'cover', borderRadius: 12, background: '#000' }} onError={() => setFailed(true)} />;
  }
  return (
    <video
      ref={videoRef}
      src={kind === 'MP4' ? src : undefined}
      muted autoPlay playsInline controls={!thumb}
      style={{ width: '100%', height: h, objectFit: 'cover', borderRadius: 12, background: '#000' }}
      onError={() => setFailed(true)}
    />
  );
}

function CamViewer({ cam, onClose }: { cam: CameraRow; onClose(): void }) {
  const [tab, setTab] = useState<'live' | 'rec'>('live');
  const [days, setDays] = useState<string[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (tab !== 'rec') return;
    void api.cameras.days(cam.id).then((r) => { setDays(r.days); if (r.days[0]) setDay(r.days[0]); }).catch(() => setDays([]));
  }, [tab, cam.id]);
  useEffect(() => {
    if (!day) return;
    void api.cameras.frames(cam.id, day).then((r) => { setFrames(r.frames); setIdx(r.frames.length - 1); }).catch(() => setFrames([]));
  }, [day, cam.id]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 920 }} onClick={(e) => e.stopPropagation()}>
        <div className="mh"><h3>📹 {cam.name}</h3>
          <span className="spacer" />
          <div className="seg" style={{ marginRight: 10 }}>
            <button className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>Ao vivo</button>
            <button className={tab === 'rec' ? 'on' : ''} onClick={() => setTab('rec')}>Gravações</button>
          </div>
          <button className="btn sm ghost" onClick={onClose}>Fechar</button>
        </div>
        <div className="mb">
          {tab === 'live' ? <LivePlayer cam={cam} /> : (
            <>
              {days.length === 0 ? <div className="empty" style={{ padding: 24 }}><p>Sem gravações ainda. Liga «Gravar» na configuração (com URL de fotograma) — o servidor guarda 30 dias.</p></div> : (
                <>
                  <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    {days.map((d) => <button key={d} className={`chip${day === d ? ' active' : ''}`} onClick={() => setDay(d)}>{d}</button>)}
                  </div>
                  {frames.length ? (
                    <>
                      <RecFrame camId={cam.id} day={day!} file={frames[idx]} />
                      <div className="row" style={{ gap: 10, marginTop: 10, alignItems: 'center' }}>
                        <input type="range" min={0} max={frames.length - 1} value={idx} onChange={(e) => setIdx(Number(e.target.value))} style={{ flex: 1 }} />
                        <span className="muted" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                          {frames[idx]?.replace('.jpg', '').replace(/(\d{2})(\d{2})(\d{2})/, '$1:$2:$3')} · {idx + 1}/{frames.length}
                        </span>
                      </div>
                    </>
                  ) : <div className="empty" style={{ padding: 24 }}><p>Sem fotogramas neste dia.</p></div>}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Fotograma de gravação carregado com autenticação (blob URL). */
function RecFrame({ camId, day, file }: { camId: string; day: string; file: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let obj: string | null = null;
    void api.cameras.frameUrl(camId, day, file).then((u) => { if (alive) { obj = u; setUrl(u); } }).catch(() => setUrl(null));
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj); };
  }, [camId, day, file]);
  if (!url) return <div className="empty" style={{ height: 280, display: 'grid', placeItems: 'center' }}><p>a carregar fotograma…</p></div>;
  return <img src={url} alt={`gravação ${day}`} style={{ width: '100%', maxHeight: '56vh', objectFit: 'contain', borderRadius: 12, background: '#000' }} />;
}
