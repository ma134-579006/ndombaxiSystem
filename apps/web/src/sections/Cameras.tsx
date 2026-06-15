import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api, ApiError } from '../api/client';
import type { CameraRow } from '../api/types';
import { confirmDialog, toast } from '../components/feedback';
import { IconPlus } from '../components/Icons';
import { Modal, Switch } from '../components/ui';
import { decodeQrFromImage, makeQrDetector } from '../scan/decoder';

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

/** Tem fonte de vídeo para ver no painel (URL de stream ou de fotograma)? */
const hasStream = (c: CameraRow): boolean => !!(c.stream_url || c.snapshot_url);

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
  const [guide, setGuide] = useState(false);
  const test = async () => {
    setBusy(true);
    try {
      const r = await api.cameras.test(cam.id);
      if (r.warning) toast.warning(r.warning);
      else if (r.ok) toast.success(`«${cam.name}» respondeu (${r.contentType ?? 'stream'} · ${r.kind}). ✅`);
      else toast.error(`«${cam.name}» não respondeu (HTTP ${r.status || 'sem ligação'}). Confirma a URL e a rede.`);
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
        {cam.conn_type === 'P2P' ? <span className="pill on" style={{ marginLeft: 6 }}>☁️ Nuvem</span> : null}
        {cam.record ? <span className="pill" style={{ marginLeft: 6, color: 'var(--danger)' }}>● REC</span> : null}
        <div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cam.conn_type === 'P2P' ? `SN: ${cam.device_sn ?? '—'}` : cam.stream_url}</div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {cam.conn_type === 'P2P' ? <button className="btn sm" onClick={() => setGuide(true)}>Guia (3 QR)</button> : null}
        {(cam.conn_type !== 'P2P' || hasStream(cam)) ? <button className="btn sm ghost" onClick={() => void test()} disabled={busy}>Testar</button> : null}
        <button className="btn sm ghost" onClick={onEdit}>Editar</button>
        <button className="btn sm ghost" onClick={() => void toggle()} disabled={busy}>{cam.is_active ? 'Desativar' : 'Reativar'}</button>
      </div>
      {guide ? <CamGuide cam={cam} onClose={() => setGuide(false)} /> : null}
    </div>
  );
}

/** Miniatura para câmaras de nuvem (não há stream HTTP — vê-se na app). */
function P2PThumb() {
  return (
    <div className="empty" style={{ height: 170, display: 'grid', placeItems: 'center', background: '#0b1220', borderRadius: 12, color: '#9fb0c8' }}>
      <div style={{ textAlign: 'center' }}><div style={{ fontSize: 34 }}>☁️📹</div><div style={{ fontSize: 12, marginTop: 4 }}>Câmara de nuvem — toca para o Guia (3 QR)</div></div>
    </div>
  );
}

/**
 * GUIA da câmara de nuvem (igual ao ecrã do DVR): 3 QR — iOS, Android e SN.
 * O utilizador ESCOLHE um: instala a app (iOS/Android) ou lê o SN para adicionar
 * o aparelho. O QR do SN é gerado a partir do número de série guardado.
 */
function CamGuide({ cam, onClose }: { cam: CameraRow; onClose(): void }) {
  const APP_IOS = cam.app_ios || 'https://apps.apple.com/app/xmeye/id898682121';
  const APP_ANDROID = cam.app_android || 'https://play.google.com/store/apps/details?id=com.xm.csee';
  const tiles: { key: string; label: string; value: string; hint: string }[] = [
    { key: 'ios', label: 'iOS', value: APP_IOS, hint: 'iPhone/iPad — instalar a app' },
    { key: 'android', label: 'Android', value: APP_ANDROID, hint: 'Android — instalar a app' },
    { key: 'sn', label: 'SN', value: cam.device_sn || '', hint: 'Adicionar o aparelho (nº de série)' },
  ];
  const [sel, setSel] = useState<string>('');
  const chosen = tiles.find((t) => t.key === sel);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="mh"><h3>Guia — {cam.name}</h3><span className="spacer" /><button className="btn sm ghost" onClick={onClose}>Fechar</button></div>
        <div className="mb">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Escolhe <strong>uma</strong> opção e lê o QR com o teu telemóvel: instala a app (iOS ou Android) e depois lê o <strong>SN</strong> para adicionar a câmara.
          </p>
          <div className="cam-guide-grid">
            {tiles.map((t) => (
              <button key={t.key} className={`cam-guide-tile${sel === t.key ? ' on' : ''}`} onClick={() => setSel(t.key)} disabled={!t.value}>
                <span className="cam-guide-lbl">{t.label}</span>
                <span className="cam-guide-qr">
                  {t.value ? <QRCodeSVG value={t.value} size={150} includeMargin /> : <span className="muted" style={{ fontSize: 12 }}>sem SN</span>}
                </span>
                <span className="muted" style={{ fontSize: 11.5 }}>{t.hint}</span>
              </button>
            ))}
          </div>
          {chosen ? (
            <div className="banner info" style={{ marginTop: 14 }}>
              <div>
                <strong>Escolheste: {chosen.label}.</strong>{' '}
                {chosen.key === 'sn'
                  ? <>Na app oficial, toca em «Adicionar dispositivo» e lê este QR (SN: <code>{chosen.value}</code>).</>
                  : <>Lê este QR para instalar a app. Depois volta e escolhe «SN» para adicionar a câmara.</>}
              </div>
            </div>
          ) : <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>⚠️ Tens de escolher uma das três opções.</p>}
        </div>
      </div>
    </div>
  );
}

/** Formulário (manual ou por QR). O QR pode conter a URL direta ou um JSON
 *  {"name":…,"stream":…,"snapshot":…} (formato comum em apps de DVR). */
function CamForm({ cam, onClose, onSaved }: { cam: CameraRow | null; onClose(): void; onSaved(): void }) {
  const [connType, setConnType] = useState<'STREAM' | 'P2P'>((cam?.conn_type as 'STREAM' | 'P2P') ?? 'P2P');
  const [name, setName] = useState(cam?.name ?? '');
  const [streamUrl, setStreamUrl] = useState(cam?.stream_url ?? '');
  const [snapshotUrl, setSnapshotUrl] = useState(cam?.snapshot_url ?? '');
  const [deviceSn, setDeviceSn] = useState(cam?.device_sn ?? '');
  const [appIos, setAppIos] = useState(cam?.app_ios ?? '');
  const [appAndroid, setAppAndroid] = useState(cam?.app_android ?? '');
  const [record, setRecord] = useState(cam?.record ?? false);
  const [notes, setNotes] = useState(cam?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  // Construtor "por IP" (DVR na rede / DDNS) — gera a URL sem app externa
  const [ipBrand, setIpBrand] = useState<'generic' | 'hikvision' | 'dahua' | 'xmeye'>('xmeye');
  const [ipHost, setIpHost] = useState('');
  const [ipPort, setIpPort] = useState('80');
  const [ipChannel, setIpChannel] = useState('1');
  const [ipUser, setIpUser] = useState('admin');
  const [ipPass, setIpPass] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const stopScan = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };
  useEffect(() => () => stopScan(), []);

  const applyQr = (raw: string) => {
    // Nuvem/P2P: o QR do DVR ("SN") contém o número de série do equipamento.
    if (connType === 'P2P') {
      try {
        const j = JSON.parse(raw) as { sn?: string; serial?: string; deviceId?: string; id?: string; name?: string };
        const sn = j.sn ?? j.serial ?? j.deviceId ?? j.id;
        if (sn) { setDeviceSn(String(sn)); if (j.name && !name) setName(j.name); toast.success('SN lido do QR. ✅'); return; }
      } catch { /* não é JSON → trata como SN em texto */ }
      setDeviceSn(raw.trim());
      toast.success('SN lido do QR. ✅');
      return;
    }
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

  /** Classifica e aplica vários QR (foto do «Guia»): iOS, Android e SN. */
  const applyGuideQrs = (values: string[]) => {
    let snFound = '', iosFound = '', androidFound = '';
    for (const raw of values) {
      const v = raw.trim();
      const low = v.toLowerCase();
      if (/apps\.apple\.com|itunes\.apple\.com/.test(low)) { iosFound = v; continue; }
      if (/play\.google\.com|market:\/\/|android/.test(low)) { androidFound = v; continue; }
      // SN: pode ser JSON {sn:…} ou texto/serial
      try { const j = JSON.parse(v) as { sn?: string; serial?: string; deviceId?: string }; const sn = j.sn ?? j.serial ?? j.deviceId; if (sn) { snFound = String(sn); continue; } } catch { /* texto */ }
      if (!/^https?:\/\//i.test(v)) snFound = v;
    }
    if (snFound) setDeviceSn(snFound);
    if (iosFound) setAppIos(iosFound);
    if (androidFound) setAppAndroid(androidFound);
    const got = [snFound && 'SN', iosFound && 'iOS', androidFound && 'Android'].filter(Boolean).join(', ');
    if (got) toast.success(`Lido do Guia: ${got}. ✅`);
    else toast.warning('Não consegui ler QR nesta imagem. Tenta uma foto mais nítida e de frente.');
  };

  const onPickPhoto = async (file?: File) => {
    if (!file) return;
    setDecoding(true);
    try {
      const values = await decodeQrFromImage(file);
      if (values.length === 0) { toast.warning('Nenhum QR detetado na imagem. Aproxima e foca o ecrã do DVR.'); return; }
      applyGuideQrs(values);
    } catch { toast.error('Falha ao ler a imagem.'); }
    finally { setDecoding(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  /** Constrói a URL de fotograma/stream a partir do IP+credenciais do DVR,
   *  por marca. Vê-se no painel pelo proxy (sem app externa) se o DVR estiver
   *  acessível (porta aberta no router + IP público/DDNS). */
  const buildFromIp = () => {
    const host = ipHost.trim();
    if (!host) { toast.warning('Indica o IP/host do DVR (ex.: 41.x.x.x ou meu-ddns.com).'); return; }
    const port = (ipPort.trim() || '80');
    const ch = Math.max(1, Number(ipChannel) || 1);
    const cred = ipUser.trim() ? `${encodeURIComponent(ipUser.trim())}:${encodeURIComponent(ipPass)}@` : '';
    const base = `http://${cred}${host}:${port}`;
    let snap = '', stream = '';
    if (ipBrand === 'hikvision') {
      snap = `${base}/ISAPI/Streaming/channels/${ch}01/picture`;
    } else if (ipBrand === 'dahua') {
      snap = `${base}/cgi-bin/snapshot.cgi?channel=${ch}`;
    } else if (ipBrand === 'xmeye') {
      snap = `${base}/webcapture.jpg?command=snap&channel=${ch - 1}`;
    } else {
      stream = `${base}/video.mjpg`;
    }
    if (snap) setSnapshotUrl(snap);
    if (stream) setStreamUrl(stream);
    setConnType('STREAM');
    toast.success('URL gerada a partir do IP. Toca em «Testar» para confirmar o sinal. ✅');
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
    if (!name.trim()) { toast.warning('Dá um nome à câmara.'); return; }
    if (connType === 'P2P' && !deviceSn.trim()) { toast.warning('Indica o SN do DVR (lê o QR «SN» do equipamento ou escreve-o).'); return; }
    if (connType === 'STREAM' && !streamUrl.trim()) { toast.warning('Cola a URL do stream (HLS/MJPEG/MP4).'); return; }
    setSaving(true);
    try {
      const input = connType === 'P2P'
        ? { name: name.trim(), connType, deviceSn: deviceSn.trim(), appIos: appIos.trim() || undefined, appAndroid: appAndroid.trim() || undefined,
            streamUrl: streamUrl.trim() || undefined, snapshotUrl: snapshotUrl.trim() || undefined, record, notes: notes.trim() || undefined }
        : { name: name.trim(), connType, streamUrl: streamUrl.trim(), snapshotUrl: snapshotUrl.trim() || undefined, record, notes: notes.trim() || undefined };
      if (cam) await api.cameras.update(cam.id, input);
      else await api.cameras.create(input);
      toast.success(`Câmara «${name.trim()}» ${cam ? 'atualizada' : 'ligada'}. ✅`);
      onSaved();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={cam ? 'Editar câmara' : 'Ligar câmara'} onClose={onClose}>
      {/* Passo único: ler o QR do DVR. Tudo o resto é automático/opcional. */}
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <button className="btn" style={{ flex: 1 }} onClick={() => (scanning ? stopScan() : void startScan())}>
          {scanning ? '✕ Parar' : '🔳 Ler QR do DVR'}
        </button>
        <button className="btn ghost" style={{ flex: 1 }} onClick={() => fileRef.current?.click()} disabled={decoding}>
          {decoding ? 'A ler…' : '🖼️ Foto do Guia'}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => void onPickPhoto(e.target.files?.[0])} />
      {scanning ? (
        <div className="pp-cam" style={{ marginBottom: 12 }}>
          <video ref={videoRef} playsInline muted />
          <div className="muted" style={{ fontSize: 12 }}>Aponta ao QR do ecrã do DVR…</div>
        </div>
      ) : null}

      {connType === 'P2P' && deviceSn ? (
        <div className="banner success" style={{ marginBottom: 12, fontSize: 13 }}><div>✅ Câmara lida — SN <code>{deviceSn}</code>. Dá-lhe um nome e guarda.</div></div>
      ) : null}

      <div className="field"><label>Nome</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Entrada da loja" autoFocus /></div>

      {/* SN manual só quando ainda não foi lido (recurso) */}
      {connType === 'P2P' && !deviceSn ? (
        <div className="field"><label>SN do DVR (ou lê o QR acima)</label>
          <input value={deviceSn} onChange={(e) => setDeviceSn(e.target.value)} placeholder="ex.: 4F2A1B9C8D7E6F50" /></div>
      ) : null}

      <button className="btn ghost sm" style={{ marginBottom: advanced ? 12 : 0 }} onClick={() => setAdvanced((a) => !a)}>
        {advanced ? '▾ Ocultar opções avançadas' : '▸ Opções avançadas (ver no painel, gravar)'}
      </button>

      {advanced ? (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
          <div className="seg block" style={{ marginBottom: 12 }}>
            <button className={connType === 'P2P' ? 'on' : ''} onClick={() => setConnType('P2P')}>☁️ Nuvem (QR/SN)</button>
            <button className={connType === 'STREAM' ? 'on' : ''} onClick={() => setConnType('STREAM')}>🔗 URL de stream</button>
          </div>
          <div className="banner info" style={{ margin: '0 0 12px', fontSize: 12.5 }}>
            <div>📺 Para ver <strong>dentro do painel</strong> (e gravar), o DVR tem de estar acessível pela internet: cola aqui a URL de vídeo/fotograma (HLS/MJPEG/JPEG) com o teu <strong>IP público</strong> ou <strong>DDNS</strong>. Caso contrário, vê-se na app oficial pelo botão <strong>Guia</strong>.</div>
          </div>
          <div style={{ border: '1px dashed var(--border)', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <strong style={{ fontSize: 13 }}>📡 Configurar por IP (DVR na rede)</strong>
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>Preenche os dados do DVR e gera a URL automaticamente (sem app externa).</p>
            <div className="grid-2">
              <div className="field"><label>Marca</label>
                <select value={ipBrand} onChange={(e) => setIpBrand(e.target.value as typeof ipBrand)}>
                  <option value="xmeye">XMEye / AHD genérico</option>
                  <option value="hikvision">Hikvision</option>
                  <option value="dahua">Dahua</option>
                  <option value="generic">Genérico (MJPEG)</option>
                </select></div>
              <div className="field"><label>Canal</label>
                <input value={ipChannel} onChange={(e) => setIpChannel(e.target.value.replace(/\D/g, '') || '1')} inputMode="numeric" placeholder="1" /></div>
            </div>
            <div className="grid-2">
              <div className="field"><label>IP / DDNS</label>
                <input value={ipHost} onChange={(e) => setIpHost(e.target.value)} placeholder="41.x.x.x ou meu-ddns.com" /></div>
              <div className="field"><label>Porta</label>
                <input value={ipPort} onChange={(e) => setIpPort(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="80" /></div>
            </div>
            <div className="grid-2">
              <div className="field"><label>Utilizador</label>
                <input value={ipUser} onChange={(e) => setIpUser(e.target.value)} placeholder="admin" /></div>
              <div className="field"><label>Palavra-passe do DVR</label>
                <input value={ipPass} onChange={(e) => setIpPass(e.target.value)} type="password" placeholder="••••••" /></div>
            </div>
            <button className="btn ghost block" onClick={buildFromIp}>⚙️ Gerar URL a partir do IP</button>
          </div>
          <div className="field"><label>URL de vídeo (HLS .m3u8 · MJPEG · MP4)</label>
            <input value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)} placeholder="http://SEU-DDNS:porta/...m3u8" /></div>
          <div className="field"><label>URL de fotograma JPEG (p/ ver e gravar via servidor)</label>
            <input value={snapshotUrl} onChange={(e) => setSnapshotUrl(e.target.value)} placeholder="http://SEU-DDNS:porta/snapshot.jpg" /></div>
          <div className="switch-row"><span>Gravar (1 fotograma/min · retenção 30 dias)</span>
            <Switch checked={record} onChange={setRecord} /></div>
          {connType === 'P2P' ? (
            <>
              <div className="field"><label>App iOS (link do QR)</label>
                <input value={appIos} onChange={(e) => setAppIos(e.target.value)} placeholder="por omissão: XMEye (App Store)" /></div>
              <div className="field"><label>App Android (link do QR)</label>
                <input value={appAndroid} onChange={(e) => setAppAndroid(e.target.value)} placeholder="por omissão: XMEye (Google Play)" /></div>
            </>
          ) : null}
          <div className="field"><label>Notas</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="localização, credenciais do DVR…" /></div>
        </div>
      ) : null}

      <button className="btn lg block" style={{ marginTop: 14 }} onClick={() => void save()} disabled={saving}>{saving ? 'A guardar…' : cam ? 'Guardar alterações' : 'Ligar câmara'}</button>
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
                {hasStream(c) ? <LivePlayer cam={c} thumb /> : <P2PThumb />}
                <div className="row" style={{ marginTop: 8, gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>📹 {c.name}</strong>
                  {c.conn_type === 'P2P' ? <span className="pill on">☁️ Nuvem</span> : null}
                  {c.record ? <span className="pill" style={{ color: 'var(--danger)' }}>● REC</span> : null}
                  <span className="spacer" />
                  <span className="muted" style={{ fontSize: 12 }}>{hasStream(c) ? 'ampliar →' : 'abrir Guia →'}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      {open ? (hasStream(open) ? <CamViewer cam={open} onClose={() => setOpen(null)} /> : <CamGuide cam={open} onClose={() => setOpen(null)} />) : null}
    </>
  );
}

/**
 * Player universal e RESILIENTE:
 *   • HLS (.m3u8) → hls.js (ligação direta — ideal quando o stream é HTTPS).
 *   • MP4 → <video>.
 *   • MJPEG → <img>.
 *   • Quando ligar direto NÃO é possível (stream HTTP numa página HTTPS =
 *     "mixed-content", ou câmara sem CORS) e existe uma URL de fotograma, o
 *     player passa a buscar fotogramas AO VIVO pelo PROXY do servidor (polling
 *     ~1.5 s) — o browser fala HTTPS com a nossa API e a API fala com a câmara.
 *   • As falhas mostram a CAUSA real (mixed-content, CORS, sem sinal), não um
 *     "sem sinal" genérico.
 */
function LivePlayer({ cam, thumb = false }: { cam: CameraRow; thumb?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [snap, setSnap] = useState<string | null>(null);
  const kind = cam.kind !== 'AUTO' ? cam.kind
    : cam.stream_url.toLowerCase().includes('.m3u8') ? 'HLS'
    : /\.(mp4|webm)/i.test(cam.stream_url) ? 'MP4' : 'MJPEG';
  const pageSecure = typeof location !== 'undefined' && location.protocol === 'https:';
  const streamHttp = /^http:\/\//i.test(cam.stream_url);
  const mixed = pageSecure && streamHttp; // o navegador bloqueia HTTP numa página HTTPS
  // Vê pelo servidor (fotograma ao vivo) quando ligar direto não dá — desde que
  // haja uma URL de fotograma para o servidor ir buscar.
  const useProxy = (kind === 'MJPEG' || mixed) && !!cam.snapshot_url;
  const h = thumb ? 170 : 'min(62vh, 560px)';

  // HLS via hls.js (ligação direta).
  useEffect(() => {
    if (useProxy || kind !== 'HLS' || !videoRef.current) return;
    if (mixed) {
      setFailed('O stream é HTTP e a página é segura (HTTPS) — o navegador bloqueia (mixed-content). Usa um stream HTTPS no DVR, OU define uma «URL de fotograma» para ver via servidor.');
      return;
    }
    let hls: { destroy(): void } | null = null;
    let alive = true;
    void (async () => {
      const v = videoRef.current!;
      if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = cam.stream_url; void v.play().catch(() => undefined); return; }
      const { default: Hls } = await import('hls.js');
      if (!alive) return;
      if (Hls.isSupported()) {
        const hh = new Hls({ maxBufferLength: 10 });
        hh.loadSource(cam.stream_url);
        hh.attachMedia(v);
        hh.on(Hls.Events.ERROR, (_e: unknown, d: { fatal?: boolean }) => {
          if (d?.fatal) setFailed('Sem sinal — a câmara não respondeu ou o stream está protegido por CORS. Define uma «URL de fotograma» para ver via servidor.');
        });
        hls = hh;
      } else setFailed('O navegador não suporta este tipo de stream.');
    })();
    return () => { alive = false; hls?.destroy(); };
  }, [cam.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fotograma AO VIVO via proxy (polling) — resolve mixed-content/CORS.
  useEffect(() => {
    if (!useProxy) return;
    let alive = true; let obj: string | null = null; let timer = 0;
    const tick = async () => {
      try {
        const u = await api.cameras.liveSnapshotUrl(cam.id);
        if (!alive) { URL.revokeObjectURL(u); return; }
        if (obj) URL.revokeObjectURL(obj);
        obj = u; setSnap(u); setFailed(null);
      } catch {
        if (alive) setFailed('Não foi possível obter imagem da câmara (via servidor). Confirma a «URL de fotograma».');
      }
      if (alive) timer = window.setTimeout(() => void tick(), 1500);
    };
    void tick();
    return () => { alive = false; window.clearTimeout(timer); if (obj) URL.revokeObjectURL(obj); };
  }, [cam.id, useProxy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return (
    <div className="empty" style={{ height: h, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 14 }}>
      <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>⚠️ {failed}</p>
    </div>
  );

  if (useProxy) {
    return snap
      ? <img src={snap} alt={cam.name} style={{ width: '100%', height: h, objectFit: 'cover', borderRadius: 12, background: '#000' }} />
      : <div className="empty" style={{ height: h, display: 'grid', placeItems: 'center' }}><p>a ligar à câmara…</p></div>;
  }
  if (kind === 'MJPEG') {
    return <img src={cam.stream_url} alt={cam.name} style={{ width: '100%', height: h, objectFit: 'cover', borderRadius: 12, background: '#000' }}
      onError={() => setFailed('Sem sinal — não foi possível carregar o stream MJPEG. Se a câmara é HTTP, define uma «URL de fotograma» para ver via servidor.')} />;
  }
  return (
    <video
      ref={videoRef}
      src={kind === 'MP4' ? cam.stream_url : undefined}
      muted autoPlay playsInline controls={!thumb}
      style={{ width: '100%', height: h, objectFit: 'cover', borderRadius: 12, background: '#000' }}
      onError={() => setFailed('Sem sinal — verifica a câmara/rede.')}
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
