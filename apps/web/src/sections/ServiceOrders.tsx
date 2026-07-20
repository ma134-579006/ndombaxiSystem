import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ManagerProduct, ServiceAgendaRow, ServiceChecklistItem, ServiceEquipment, ServiceOrderDetail, ServiceOrderRow } from '../api/types';
import { toast } from '../components/feedback';
import { IconPlus, IconSearch, IconTrash } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz } from '../format';

const KZ = (n: string | number) => formatKz(Number(n) || 0);

/** Gera e descarrega o PDF (fatura fiscal) de um documento emitido. Import
 *  dinâmico do gerador (+jsPDF) — só carrega quando se imprime. */
async function printInvoicePdf(invoiceId: string): Promise<void> {
  const [{ buildInvoicePdf, invoiceFileName }, sale, identity] = await Promise.all([
    import('../pdf/invoicePdf'),
    api.sales.detail(invoiceId),
    api.branding().catch(() => null),
  ]);
  const pdf = await buildInvoicePdf(sale, identity);
  pdf.save(invoiceFileName(sale));
}

/** Gera e descarrega a FOLHA DE OBRA (PDF) da Mecânica. */
async function printWorkOrder(detail: ServiceOrderDetail): Promise<void> {
  const [{ buildWorkOrderPdf, workOrderFileName }, identity] = await Promise.all([
    import('../pdf/workOrderPdf'),
    api.branding().catch(() => null),
  ]);
  const pdf = await buildWorkOrderPdf(detail, identity);
  pdf.save(workOrderFileName(detail.order));
}
const STATUS: { id: string; label: string }[] = [
  { id: 'OPEN', label: 'Aberta' }, { id: 'QUOTED', label: 'Orçamentada' }, { id: 'APPROVED', label: 'Aprovada' },
  { id: 'IN_PROGRESS', label: 'Em curso' }, { id: 'READY', label: 'Pronta' }, { id: 'DELIVERED', label: 'Entregue' }, { id: 'CANCELLED', label: 'Cancelada' },
];
const SL = (s: string) => STATUS.find((x) => x.id === s)?.label ?? s;
const KIND_L: Record<string, string> = { PART: 'Peça', LABOR: 'Mão-de-obra', SERVICE: 'Serviço' };
const WARRANTY: { d: number; label: string }[] = [
  { d: 0, label: 'Sem garantia' }, { d: 90, label: '90 dias' }, { d: 180, label: '180 dias' }, { d: 365, label: '1 ano' },
];
const KIND_EQ: Record<string, string> = { VEHICLE: 'Viatura', DEVICE: 'Aparelho', OTHER: 'Outro' };

/** Ordens de Serviço (mecânica, assistência técnica, recauchutagem…). */
export function ServiceOrders() {
  // Deep-link do Centro de Comando: LÊ no inicializador (sem remover — o
  // StrictMode invoca-o 2× e uma remoção aqui consumiria o valor no 1º run) e
  // REMOVE num efeito. Ler já no arranque evita a corrida em que o 1º load sem
  // filtro respondia depois do load filtrado e sobrescrevia a lista.
  const [tab, setTab] = useState<'orders' | 'agenda' | 'equipments'>(() => {
    try { const t = sessionStorage.getItem('ndx_srv_tab'); return t === 'equipments' ? 'equipments' : t === 'agenda' ? 'agenda' : 'orders'; }
    catch { return 'orders'; }
  });
  const [rows, setRows] = useState<ServiceOrderRow[]>([]);
  const [filter, setFilter] = useState(() => {
    try { return sessionStorage.getItem('ndx_srv_status') ?? ''; } catch { return ''; }
  });
  useEffect(() => {
    try { sessionStorage.removeItem('ndx_srv_tab'); sessionStorage.removeItem('ndx_srv_status'); }
    catch { /* sessionStorage indisponível */ }
  }, []);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<ServiceOrderDetail | null>(null);

  const load = useCallback(async () => {
    try { setRows(await api.serviceOrders.list(filter || undefined)); } catch { /* */ }
  }, [filter]);
  useEffect(() => { if (tab === 'orders') void load(); }, [load, tab]);

  const openOS = async (id: string) => { try { setDetail(await api.serviceOrders.get(id)); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); } };

  return (
    <>
      <div className="content-head">
        <h2>🛠️ Assistência técnica</h2>
        <span className="spacer" />
        {tab === 'orders' ? <button className="btn" onClick={() => setCreating(true)}><IconPlus size={17} /> Nova OS</button> : null}
      </div>

      <div className="card toolbar-sticky" style={{ display: 'flex', gap: 6, padding: '8px 10px' }}>
        <button className={`chip${tab === 'orders' ? ' active' : ''}`} onClick={() => setTab('orders')}>🛠️ Ordens</button>
        <button className={`chip${tab === 'agenda' ? ' active' : ''}`} onClick={() => setTab('agenda')}>📅 Agenda</button>
        <button className={`chip${tab === 'equipments' ? ' active' : ''}`} onClick={() => setTab('equipments')}>💻 Equipamentos</button>
      </div>

      {tab === 'equipments' ? <EquipmentsTab /> : tab === 'agenda' ? <AgendaTab onOpen={(id) => void openOS(id)} /> : (
      <>
      <div className="card toolbar-sticky" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 12px', top: 52 }}>
        <button className={`chip${filter === '' ? ' active' : ''}`} onClick={() => setFilter('')}>Todas</button>
        {STATUS.map((s) => <button key={s.id} className={`chip${filter === s.id ? ' active' : ''}`} onClick={() => setFilter(s.id)}>{s.label}</button>)}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.length === 0 ? <div className="empty" style={{ padding: 26 }}><p>Sem ordens de serviço.</p></div>
          : rows.map((r) => (
            <button key={r.id} className="list-row" onClick={() => void openOS(r.id)} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', padding: '12px 16px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 14 }}>{r.number} · {r.customer_name || 'Cliente'}{r.source === 'ONLINE' ? <span className="pill" style={{ marginLeft: 6, background: 'var(--primary)', color: '#fff' }}>🌐 Online</span> : null}</strong>
                <div className="muted" style={{ fontSize: 12.5 }}>{r.equipment_label || '—'}{r.assigned_to ? ` · 👤 ${r.assigned_to}` : ''}</div>
              </div>
              <span style={{ fontWeight: 700, marginRight: 8 }}>{KZ(r.total)}</span>
              <span className={`pill ${r.status === 'DELIVERED' ? 'on' : r.status === 'CANCELLED' ? 'off' : ''}`}>{SL(r.status)}</span>
            </button>
          ))}
      </div>
      </>
      )}

      {creating ? <CreateOS onClose={() => setCreating(false)} onCreated={async (id) => { setCreating(false); await load(); await openOS(id); }} /> : null}
      {detail ? <OSDetail detail={detail} onClose={() => setDetail(null)} onChanged={async () => { setDetail(await api.serviceOrders.get(detail.order.id)); await load(); }} /> : null}
    </>
  );
}

/** Agenda da oficina: OS marcadas, agrupadas por dia (usa GET /service-orders/agenda). */
function AgendaTab({ onOpen }: { onOpen(id: string): void }) {
  const [rows, setRows] = useState<ServiceAgendaRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    api.serviceOrders.agenda()
      .then((r) => { if (alive) setRows(r); })
      .catch(() => undefined)
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  const groups = React.useMemo(() => {
    const m = new Map<string, ServiceAgendaRow[]>();
    for (const r of rows) {
      const d = new Date(r.scheduled_at);
      const key = d.toISOString().slice(0, 10);
      (m.get(key) ?? m.set(key, []).get(key)!).push(r);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);
  const todayKey = new Date().toISOString().slice(0, 10);
  const dayLabel = (key: string) => {
    const d = new Date(key + 'T00:00:00');
    const s = d.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
    return key === todayKey ? `Hoje · ${s}` : s.charAt(0).toUpperCase() + s.slice(1);
  };
  if (loading) return <div className="card"><div className="loading">A carregar agenda…</div></div>;
  if (!rows.length) return <div className="card"><div className="empty" style={{ padding: 26 }}><p>Sem marcações. Agende uma OS na sua ficha (Receção &amp; inspeção → Marcação).</p></div></div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {groups.map(([key, items]) => (
        <div key={key} className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', fontWeight: 800, fontSize: 13.5, background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', color: key === todayKey ? 'var(--primary)' : 'var(--text)' }}>
            {dayLabel(key)} · {items.length}
          </div>
          {items.map((r) => (
            <button key={r.id} className="list-row" onClick={() => onOpen(r.id)}
              style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', padding: '11px 16px', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontWeight: 800, fontSize: 14, width: 52, color: 'var(--primary)' }}>{new Date(r.scheduled_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 13.5 }}>{r.number} · {r.customer_name || 'Cliente'}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{r.equipment_label || '—'}{r.equipment_ref ? ` · ${r.equipment_ref}` : ''}{r.assigned_to ? ` · 👤 ${r.assigned_to}` : ''}</div>
              </div>
              <span className="pill">{SL(r.status)}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function CreateOS({ onClose, onCreated }: { onClose(): void; onCreated(id: string): void }) {
  const [f, setF] = useState({ customerName: '', customerPhone: '', equipmentId: '', equipmentType: 'VEHICLE', equipmentLabel: '', equipmentRef: '', problem: '', assignedTo: '', warrantyDays: 0 });
  const [equips, setEquips] = useState<ServiceEquipment[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.serviceOrders.equipments().then(setEquips).catch(() => undefined); }, []);
  const pickEquip = (id: string) => {
    const e = equips.find((x) => x.id === id);
    if (!e) { setF({ ...f, equipmentId: '' }); return; }
    setF({ ...f, equipmentId: id, equipmentType: e.kind, equipmentLabel: e.label, equipmentRef: e.plate || e.serial || '', customerName: e.customer_name || f.customerName });
  };
  const save = async () => {
    setBusy(true);
    try {
      // Campos opcionais vazios têm de ir como `undefined` (não ""): o DTO valida
      // @Length(1,…) e o @IsOptional só ignora undefined/null — enviar "" dava 400.
      const clean = (s: string) => (s.trim() ? s.trim() : undefined);
      const r = await api.serviceOrders.create({
        customerName: clean(f.customerName),
        customerPhone: clean(f.customerPhone),
        equipmentId: f.equipmentId || undefined,
        equipmentType: f.equipmentType,
        equipmentLabel: clean(f.equipmentLabel),
        equipmentRef: clean(f.equipmentRef),
        problem: clean(f.problem),
        assignedTo: clean(f.assignedTo),
        warrantyDays: f.warrantyDays,
      });
      toast.success('OS aberta.'); onCreated(r.id);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao abrir a OS.'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Nova ordem de serviço" onClose={onClose}>
      {equips.length > 0 ? (
        <div className="field"><label>Equipamento registado (opcional)</label>
          <select value={f.equipmentId} onChange={(e) => pickEquip(e.target.value)}>
            <option value="">— novo / sem registo —</option>
            {equips.map((e) => <option key={e.id} value={e.id}>{e.label}{e.plate ? ` (${e.plate})` : e.serial ? ` (${e.serial})` : ''}{e.customer_name ? ` · ${e.customer_name}` : ''}</option>)}
          </select></div>
      ) : null}
      <div className="grid-2">
        <div className="field"><label>Cliente</label><input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} placeholder="Nome" /></div>
        <div className="field"><label>Telefone</label><input value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} inputMode="tel" /></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Tipo</label>
          <select value={f.equipmentType} onChange={(e) => setF({ ...f, equipmentType: e.target.value })}>
            <option value="VEHICLE">Viatura</option><option value="DEVICE">Aparelho/Equipamento</option><option value="OTHER">Outro</option>
          </select></div>
        <div className="field"><label>Matrícula / Nº de série</label><input value={f.equipmentRef} onChange={(e) => setF({ ...f, equipmentRef: e.target.value })} placeholder="LD-00-00 / SN…" /></div>
      </div>
      <div className="field"><label>Equipamento</label><input value={f.equipmentLabel} onChange={(e) => setF({ ...f, equipmentLabel: e.target.value })} placeholder="ex.: Toyota Corolla / Portátil HP" /></div>
      <div className="field"><label>Avaria relatada</label><textarea value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} rows={3} placeholder="O que o cliente reporta…" style={{ width: '100%', resize: 'vertical' }} /></div>
      <div className="grid-2">
        <div className="field"><label>Técnico (opcional)</label><input value={f.assignedTo} onChange={(e) => setF({ ...f, assignedTo: e.target.value })} /></div>
        <div className="field"><label>Garantia</label>
          <select value={f.warrantyDays} onChange={(e) => setF({ ...f, warrantyDays: Number(e.target.value) })}>
            {WARRANTY.map((w) => <option key={w.d} value={w.d}>{w.label}</option>)}
          </select></div>
      </div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A abrir…' : 'Abrir OS'}</button>
    </Modal>
  );
}

/** Equipamentos/viaturas registados (reutilizáveis nas OS). */
function EquipmentsTab() {
  const [rows, setRows] = useState<ServiceEquipment[]>([]);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => { try { setRows(await api.serviceOrders.equipments()); } catch { /* */ } }, []);
  useEffect(() => { void load(); }, [load]);
  const filtered = q.trim() ? rows.filter((r) => `${r.label} ${r.plate ?? ''} ${r.serial ?? ''} ${r.customer_name ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) : rows;
  return (
    <>
      <div className="card toolbar-sticky" style={{ display: 'flex', gap: 8, padding: '8px 10px', top: 52, alignItems: 'center' }}>
        <div className="row" style={{ flex: 1 }}><IconSearch size={18} /><input style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '8px 0', color: 'var(--text)' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar equipamento/viatura…" /></div>
        <button className="btn" onClick={() => setCreating(true)}><IconPlus size={16} /> Registar</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {filtered.length === 0 ? <div className="empty" style={{ padding: 24 }}><p>Sem equipamentos registados.</p></div>
          : filtered.map((e) => {
            const overKm = e.km != null && e.next_service_km != null && e.km >= e.next_service_km;
            return (
              <div key={e.id} className="list-row" style={{ padding: '10px 14px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 13.5 }}>{KIND_EQ[e.kind] ?? e.kind}: {e.label}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {[e.brand, e.model].filter(Boolean).join(' ')}{e.plate ? ` · ${e.plate}` : ''}{e.serial ? ` · SN ${e.serial}` : ''}{e.customer_name ? ` · 👤 ${e.customer_name}` : ''}
                    {e.km != null ? ` · ${e.km.toLocaleString('pt-PT')} km` : ''}
                  </div>
                  {overKm ? <div style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 700 }}>⚠ Revisão devida (≥ {e.next_service_km?.toLocaleString('pt-PT')} km)</div> : null}
                </div>
              </div>
            );
          })}
      </div>
      {creating ? <CreateEquipment onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await load(); }} /> : null}
    </>
  );
}

function CreateEquipment({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const [f, setF] = useState({ kind: 'DEVICE', label: '', brand: '', model: '', serial: '', plate: '', vin: '', color: '', year: '', km: '', nextServiceKm: '', customerName: '' });
  const [busy, setBusy] = useState(false);
  const isVehicle = f.kind === 'VEHICLE';
  const save = async () => {
    if (!f.label.trim()) { toast.warning('Indique o equipamento.'); return; }
    setBusy(true);
    try {
      await api.serviceOrders.createEquipment({
        kind: f.kind, label: f.label.trim(), brand: f.brand.trim() || undefined, model: f.model.trim() || undefined,
        serial: f.serial.trim() || undefined, plate: f.plate.trim() || undefined, vin: f.vin.trim() || undefined,
        color: f.color.trim() || undefined, year: f.year ? Number(f.year) : undefined,
        km: f.km ? Number(f.km) : undefined, nextServiceKm: f.nextServiceKm ? Number(f.nextServiceKm) : undefined,
        customerName: f.customerName.trim() || undefined,
      });
      toast.success('Equipamento registado.'); onCreated();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Registar equipamento" onClose={onClose}>
      <div className="grid-2">
        <div className="field"><label>Tipo</label>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="VEHICLE">Viatura</option><option value="DEVICE">Aparelho/Equipamento</option><option value="OTHER">Outro</option>
          </select></div>
        <div className="field"><label>Cliente</label><input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} placeholder="Nome" /></div>
      </div>
      <div className="field"><label>Designação</label><input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="ex.: Toyota Corolla / Portátil HP" /></div>
      <div className="grid-2">
        <div className="field"><label>Marca</label><input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} /></div>
        <div className="field"><label>Modelo</label><input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></div>
      </div>
      {isVehicle ? (
        <>
          <div className="grid-2">
            <div className="field"><label>Matrícula</label><input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} placeholder="LD-00-00" /></div>
            <div className="field"><label>VIN / Chassi</label><input value={f.vin} onChange={(e) => setF({ ...f, vin: e.target.value })} /></div>
          </div>
          <div className="grid-2">
            <div className="field"><label>Km atual</label><input value={f.km} onChange={(e) => setF({ ...f, km: e.target.value.replace(/\D/g, '') })} inputMode="numeric" /></div>
            <div className="field"><label>Próxima revisão (km)</label><input value={f.nextServiceKm} onChange={(e) => setF({ ...f, nextServiceKm: e.target.value.replace(/\D/g, '') })} inputMode="numeric" /></div>
          </div>
        </>
      ) : (
        <div className="field"><label>Nº de série / IMEI</label><input value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} /></div>
      )}
      <div className="grid-2">
        <div className="field"><label>Cor</label><input value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></div>
        <div className="field"><label>Ano</label><input value={f.year} onChange={(e) => setF({ ...f, year: e.target.value.replace(/\D/g, '') })} inputMode="numeric" /></div>
      </div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A guardar…' : 'Registar'}</button>
    </Modal>
  );
}

// ── MECÂNICA (oficina auto) ──────────────────────────────────────────────
const FUEL: { id: string; label: string }[] = [
  { id: 'EMPTY', label: 'Vazio' }, { id: 'LOW', label: '¼' }, { id: 'HALF', label: '½' }, { id: 'HIGH', label: '¾' }, { id: 'FULL', label: 'Cheio' },
];
const FUEL_LABEL: Record<string, string> = Object.fromEntries(FUEL.map((f) => [f.id, f.label]));
const DEFAULT_CHECKLIST: { key: string; label: string }[] = [
  { key: 'lights', label: 'Luzes' }, { key: 'tyres', label: 'Pneus' }, { key: 'brakes', label: 'Travões' },
  { key: 'oil', label: 'Óleo' }, { key: 'coolant', label: 'Líquidos' }, { key: 'battery', label: 'Bateria' },
  { key: 'wipers', label: 'Escovas' }, { key: 'spare', label: 'Estepe' }, { key: 'triangle', label: 'Triângulo/colete' },
  { key: 'jack', label: 'Macaco' }, { key: 'radio', label: 'Rádio/multimédia' }, { key: 'docs', label: 'Documentos' },
];
const DEVICE_CHECKLIST: { key: string; label: string }[] = [
  { key: 'screen', label: 'Ecrã' }, { key: 'touch', label: 'Toque' }, { key: 'buttons', label: 'Botões' },
  { key: 'frontcam', label: 'Câmara frontal' }, { key: 'backcam', label: 'Câmara traseira' }, { key: 'speaker', label: 'Coluna' },
  { key: 'mic', label: 'Microfone' }, { key: 'battery', label: 'Bateria' }, { key: 'charging', label: 'Carregamento' },
  { key: 'sim', label: 'SIM/rede' }, { key: 'wifi', label: 'Wi-Fi' }, { key: 'fingerprint', label: 'Biometria' },
];
function mergeChecklist(saved: ServiceChecklistItem[] | null | undefined, base: { key: string; label: string }[]): ServiceChecklistItem[] {
  const byKey = new Map((saved ?? []).map((c) => [c.key, c]));
  const merged = base.map((d) => byKey.get(d.key) ?? { ...d, ok: undefined });
  // mantém itens gravados que não estejam na lista padrão
  for (const s of saved ?? []) if (!base.some((d) => d.key === s.key)) merged.push(s);
  return merged;
}
const MIN_LABEL = (m?: number | null) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}min` : ''}` : `${m}min`);
/** ISO → valor para <input type="datetime-local"> (hora local). */
function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Reduz uma imagem a no máx. `max` px no lado maior e devolve data URL JPEG. */
function downscale(file: File, max = 1100, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d'); if (!ctx) return reject(new Error('canvas'));
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject; img.src = String(r.result);
    };
    r.onerror = reject; r.readAsDataURL(file);
  });
}

/** Pad de assinatura (canvas). Chama onSave com o data URL PNG. */
function SignaturePad({ value, onSave }: { value?: string | null; onSave(dataUrl: string): void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [editing, setEditing] = useState(!value);
  const pos = (e: React.PointerEvent) => {
    const c = ref.current!; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const start = (e: React.PointerEvent) => {
    drawing.current = true; const c = ref.current!; const ctx = c.getContext('2d')!;
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a';
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); (e.target as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; const p = pos(e);
    ctx.lineTo(p.x, p.y); ctx.stroke(); dirty.current = true;
  };
  const end = () => { drawing.current = false; };
  const clear = () => { const c = ref.current; if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height); dirty.current = false; };
  if (!editing && value) {
    return (
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <img src={value} alt="assinatura" style={{ height: 60, background: '#fff', borderRadius: 8, border: '1px solid var(--border)', padding: 4 }} />
        <button className="btn sm ghost" onClick={() => { setEditing(true); setTimeout(clear, 0); }}>Assinar de novo</button>
      </div>
    );
  }
  return (
    <div>
      <canvas ref={ref} width={520} height={150}
        style={{ width: '100%', maxWidth: 340, height: 120, background: '#fff', borderRadius: 10, border: '1px dashed var(--border)', touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <button className="btn sm ghost" onClick={clear}>Limpar</button>
        <button className="btn sm" onClick={() => { if (!dirty.current) { toast.warning('Assine antes de guardar.'); return; } onSave(ref.current!.toDataURL('image/png')); toast.success('Assinatura guardada.'); }}>Guardar assinatura</button>
      </div>
    </div>
  );
}

/** Painel de RECEÇÃO do veículo (Mecânica): KM, combustível, estado, checklist,
 *  fotos, assinatura e tempo estimado. Aditivo — só aparece no vertical Serviços. */
function ReceptionPanel({ o, isVehicle, onChanged }: { o: ServiceOrderDetail['order']; isVehicle: boolean; onChanged(): void }) {
  const [open, setOpen] = useState(!o.received_at);
  const [km, setKm] = useState(o.km_in != null ? String(o.km_in) : '');
  const [fuel, setFuel] = useState(o.fuel_level ?? '');
  const [state, setState] = useState(o.vehicle_state ?? '');
  const [est, setEst] = useState(o.est_minutes != null ? String(o.est_minutes) : '');
  const [sched, setSched] = useState(() => toLocalInput(o.scheduled_at));
  const [imei, setImei] = useState(o.imei ?? '');
  const [unlock, setUnlock] = useState(o.unlock_code ?? '');
  const [checklist, setChecklist] = useState<ServiceChecklistItem[]>(() => mergeChecklist(o.checklist, isVehicle ? DEFAULT_CHECKLIST : DEVICE_CHECKLIST));
  const [photos, setPhotos] = useState(o.photos ?? []);
  const [sig, setSig] = useState(o.signature ?? '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggle = (key: string) => setChecklist((cs) => cs.map((c) => c.key === key ? { ...c, ok: c.ok === true ? false : c.ok === false ? undefined : true } : c));
  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const next = [...photos];
      for (const f of Array.from(files).slice(0, 8)) next.push({ url: await downscale(f), caption: '' });
      setPhotos(next.slice(0, 12));
    } catch { toast.error('Falha a processar a foto.'); }
  };
  const save = async () => {
    setBusy(true);
    try {
      await api.serviceOrders.receive(o.id, {
        kmIn: km ? Number(km) : undefined,
        fuelLevel: fuel || undefined,
        vehicleState: state || undefined,
        checklist: checklist.filter((c) => c.ok !== undefined || c.note),
        photos, signature: sig || undefined,
        estMinutes: est ? Number(est) : undefined,
        scheduledAt: sched ? new Date(sched).toISOString() : undefined,
        imei: imei.trim() || undefined,
        unlockCode: unlock.trim() || undefined,
      });
      toast.success('Receção guardada.');
      onChanged();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao guardar a receção.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <button className="row" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, alignItems: 'center' }} onClick={() => setOpen((v) => !v)}>
        <strong style={{ fontSize: 14 }}>{isVehicle ? '🚗' : '📱'} Receção &amp; inspeção</strong>
        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{o.received_at ? `recebido ${new Date(o.received_at).toLocaleDateString('pt-PT')}` : 'por preencher'}</span>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="muted">{open ? '▲' : '▼'}</span>
      </button>
      {open ? (
        <div style={{ marginTop: 12 }}>
          {isVehicle ? (
            <div className="grid-2">
              <div className="field"><label>Quilometragem</label>
                <input value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="ex.: 145000" /></div>
              <div className="field"><label>Combustível</label>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {FUEL.map((f) => (
                    <button key={f.id} className={`btn sm ${fuel === f.id ? '' : 'ghost'}`} onClick={() => setFuel(fuel === f.id ? '' : f.id)}>{f.label}</button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid-2">
              <div className="field"><label>IMEI / Nº de série</label>
                <input value={imei} onChange={(e) => setImei(e.target.value)} placeholder="ex.: 356789…" inputMode="numeric" /></div>
              <div className="field"><label>Código de desbloqueio</label>
                <input value={unlock} onChange={(e) => setUnlock(e.target.value)} placeholder="PIN / padrão / palavra-passe" autoComplete="off" /></div>
            </div>
          )}

          <div className="field"><label>{isVehicle ? 'Estado do veículo (riscos, amolgadelas, observações)' : 'Estado físico (riscos, ecrã, humidade, observações)'}</label>
            <textarea value={state} onChange={(e) => setState(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical' }} placeholder={isVehicle ? 'Descreva o estado à entrada…' : 'Descreva o estado físico do aparelho…'} /></div>

          <label className="auth-label" style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 600, margin: '6px 0' }}>Checklist de inspeção</label>
          <div className="pgrid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 6, marginBottom: 10 }}>
            {checklist.map((c) => (
              <button key={c.key} className="btn sm ghost" onClick={() => toggle(c.key)}
                style={{ justifyContent: 'flex-start', borderColor: c.ok === true ? 'var(--success)' : c.ok === false ? 'var(--danger, #e5484d)' : 'var(--border)' }}
                title="Toque para alternar: OK → problema → por verificar">
                <span style={{ marginRight: 6 }}>{c.ok === true ? '✅' : c.ok === false ? '⚠️' : '⬜'}</span>{c.label}
              </button>
            ))}
          </div>

          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
            <div className="field" style={{ width: 140, margin: 0 }}><label>Tempo estimado (min)</label>
              <input value={est} onChange={(e) => setEst(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="ex.: 120" /></div>
            <div className="field" style={{ width: 210, margin: 0 }}><label>📅 Marcação (agenda)</label>
              <input type="datetime-local" value={sched} onChange={(e) => setSched(e.target.value)} /></div>
            <label className="btn ghost sm">
              📷 Fotos ({photos.length})
              <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void addPhotos(e.target.files)} />
            </label>
          </div>
          {photos.length ? (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {photos.map((p, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={p.url} alt="" style={{ width: 66, height: 66, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                  <button className="btn sm ghost" style={{ position: 'absolute', top: -6, right: -6, padding: '1px 5px', borderRadius: 999 }}
                    onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="field"><label>Assinatura do cliente</label>
            <SignaturePad value={sig} onSave={(d) => setSig(d)} /></div>

          <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A guardar…' : 'Guardar receção'}</button>
        </div>
      ) : null}
    </div>
  );
}

/** Barra de fluxo da oficina: aprovar orçamento, iniciar/concluir trabalho, tempos. */
function WorkflowBar({ o, onChanged }: { o: ServiceOrderDetail['order']; onChanged(): void }) {
  const [busy, setBusy] = useState('');
  const act = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(key);
    try { await fn(); toast.success(okMsg); onChanged(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); }
    finally { setBusy(''); }
  };
  const s = o.status;
  return (
    <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <strong style={{ fontSize: 13 }}>Fluxo:</strong>
      {(s === 'OPEN' || s === 'QUOTED') ? (
        <button className="btn sm" disabled={!!busy} onClick={() => void act('approve', () => api.serviceOrders.approveQuote(o.id), 'Orçamento aprovado.')}>✔ Aprovar orçamento</button>
      ) : null}
      {s === 'APPROVED' ? (
        <button className="btn sm" disabled={!!busy} onClick={() => void act('start', () => api.serviceOrders.startWork(o.id), 'Trabalho iniciado.')}>▶ Iniciar trabalho</button>
      ) : null}
      {s === 'IN_PROGRESS' ? (
        <button className="btn sm success" disabled={!!busy} onClick={() => void act('finish', () => api.serviceOrders.finishWork(o.id), 'Trabalho concluído.')}>■ Concluir trabalho</button>
      ) : null}
      {o.quote_approved_at ? <span className="muted" style={{ fontSize: 12 }}>Aprovado{o.quote_approved_by ? ` por ${o.quote_approved_by}` : ''}</span> : null}
      <span className="spacer" style={{ flex: 1 }} />
      <span className="muted" style={{ fontSize: 12 }}>⏱ Est: {MIN_LABEL(o.est_minutes)} · Real: {MIN_LABEL(o.actual_minutes)}</span>
    </div>
  );
}

function OSDetail({ detail, onClose, onChanged }: { detail: ServiceOrderDetail; onClose(): void; onChanged(): void }) {
  const o = detail.order;
  const isVehicle = (o.equipment_type ?? '').toUpperCase() === 'VEHICLE';
  const [products, setProducts] = useState<ManagerProduct[]>([]);
  const [q, setQ] = useState('');
  const [diagnosis, setDiagnosis] = useState(o.diagnosis ?? '');
  const [labor, setLabor] = useState({ description: '', price: '' });
  useEffect(() => { api.products.list().then(setProducts).catch(() => undefined); }, []);

  const addPart = async (code: string) => {
    try {
      const r = await api.serviceOrders.addItem(o.id, { productCode: code, quantity: 1 });
      // Compra automática: peça sem stock suficiente → avisa e encaminha para a
      // sugestão de reposição (Inventário → Reposição), sem bloquear a OS.
      if (r.lowStock) toast.warning(`Sem stock de "${r.lowStockName ?? 'peça'}" (${r.inStock ?? 0} em stock). Peça reposição em Inventário → Reposição.`);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); }
    onChanged();
  };
  const addLabor = async () => {
    if (!labor.description.trim()) { toast.warning('Descreva a mão-de-obra/serviço.'); return; }
    await api.serviceOrders.addItem(o.id, { kind: 'LABOR', description: labor.description.trim(), unitPrice: Number(labor.price) || 0, quantity: 1 }).catch(() => undefined);
    setLabor({ description: '', price: '' }); onChanged();
  };
  const removeItem = async (id: string) => { await api.serviceOrders.removeItem(id).catch(() => undefined); onChanged(); };
  const setStatus = async (s: string) => { await api.serviceOrders.status(o.id, s).catch(() => undefined); onChanged(); };
  const saveDiagnosis = async () => { await api.serviceOrders.update(o.id, { diagnosis }).catch(() => undefined); toast.success('Diagnóstico guardado.'); onChanged(); };
  const setWarranty = async (d: number) => { await api.serviceOrders.update(o.id, { warrantyDays: d }).catch(() => undefined); onChanged(); };
  const [billing, setBilling] = useState(false);
  const [reprinting, setReprinting] = useState(false);
  const invoice = async () => {
    if (detail.items.length === 0) { toast.warning('Adicione itens antes de faturar.'); return; }
    setBilling(true);
    try {
      // Emite o documento fiscal → regista no Caixa (turno aberto da loja) →
      // baixa stock/atualiza financeiro (no servidor). Depois gera a impressão.
      const r = await api.serviceOrders.invoice(o.id);
      toast.success(`Fatura ${r.invoiceNumber} emitida. OS entregue e registada no Caixa.`);
      try { await printInvoicePdf(r.invoiceId); }
      catch { toast.warning('Fatura emitida, mas o PDF falhou. Use "Imprimir 2ª via".'); }
      onChanged();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao faturar.'); }
    finally { setBilling(false); }
  };
  const reprint = async () => {
    if (!o.invoice_id) return;
    setReprinting(true);
    try { await printInvoicePdf(o.invoice_id); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao gerar a 2ª via.'); }
    finally { setReprinting(false); }
  };

  const filtered = q.trim() ? products.filter((p) => `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 20) : products.slice(0, 12);

  return (
    <Modal title={`${o.number} — ${SL(o.status)}`} onClose={onClose}>
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 13.5 }}><strong>{o.customer_name || 'Cliente'}</strong>{o.customer_phone ? ` · ${o.customer_phone}` : ''}</div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{o.equipment_label || '—'}{o.equipment_ref ? ` · ${o.equipment_ref}` : ''}{o.assigned_to ? ` · 👤 ${o.assigned_to}` : ''}</div>
        {o.problem ? <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>🛠️ {o.problem}</div> : null}
      </div>

      {o.status !== 'CANCELLED' ? <WorkflowBar o={o} onChanged={onChanged} /> : null}
      {o.status !== 'CANCELLED' ? <ReceptionPanel o={o} isVehicle={isVehicle} onChanged={onChanged} /> : null}

      <div className="grid-2">
        <div className="field"><label>Estado</label>
          <select value={o.status} onChange={(e) => void setStatus(e.target.value)}>
            {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select></div>
        <div className="field"><label>Garantia</label>
          <select value={o.warranty_days ?? 0} onChange={(e) => void setWarranty(Number(e.target.value))}>
            {WARRANTY.map((w) => <option key={w.d} value={w.d}>{w.label}</option>)}
          </select>
          {o.warranty_until ? <span className="muted" style={{ fontSize: 11.5 }}>Válida até {new Date(o.warranty_until).toLocaleDateString('pt-PT')}</span> : null}
        </div>
      </div>

      <div className="field"><label>Diagnóstico</label>
        <textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical' }} placeholder="Diagnóstico técnico…" />
        <button className="btn sm ghost" style={{ marginTop: 6, alignSelf: 'flex-start' }} onClick={() => void saveDiagnosis()}>Guardar diagnóstico</button>
      </div>

      {/* Peças do stock */}
      <label className="auth-label" style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 600, margin: '6px 0' }}>Adicionar peça (stock)</label>
      <div className="card" style={{ padding: '2px 12px', marginBottom: 8 }}>
        <div className="row"><IconSearch size={18} /><input style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '10px 0', color: 'var(--text)' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar peça…" /></div>
      </div>
      <div className="pgrid" style={{ maxHeight: '18vh', overflowY: 'auto', marginBottom: 10 }}>
        {filtered.map((p) => (
          <button key={p.id} className="pcard" onClick={() => void addPart(p.code)} style={{ cursor: 'pointer', textAlign: 'left' }}>
            <div className="pinfo"><div className="pname" style={{ fontSize: 13 }}>{p.name}</div><div className="pcode">{p.code}</div></div>
          </button>
        ))}
      </div>

      {/* Mão-de-obra / serviço manual */}
      <div className="row" style={{ gap: 8, marginBottom: 12, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1, margin: 0 }}><label>Mão-de-obra / serviço</label><input value={labor.description} onChange={(e) => setLabor({ ...labor, description: e.target.value })} placeholder="ex.: Substituição de óleo" /></div>
        <div className="field" style={{ width: 120, margin: 0 }}><label>Preço</label><input value={labor.price} onChange={(e) => setLabor({ ...labor, price: e.target.value.replace(/[^\d.]/g, '') })} inputMode="decimal" placeholder="0" /></div>
        <button className="btn" onClick={() => void addLabor()}>Adicionar</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
        {detail.items.length === 0 ? <div className="empty" style={{ padding: 16 }}><p>Sem itens. Adiciona peças e mão-de-obra.</p></div>
          : detail.items.map((it) => (
            <div key={it.id} className="list-row" style={{ padding: '10px 14px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 13.5 }}>{Number(it.quantity)}× {it.description}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{KIND_L[it.kind] ?? it.kind} · {KZ(it.unit_price)}</div>
              </div>
              <span style={{ fontWeight: 700, marginRight: 8 }}>{KZ(Number(it.unit_price) * Number(it.quantity))}</span>
              <button className="btn sm ghost" onClick={() => void removeItem(it.id)}><IconTrash size={14} /></button>
            </div>
          ))}
      </div>

      <div className="row" style={{ alignItems: 'center' }}>
        <strong style={{ fontSize: 16 }}>Total</strong><span className="spacer" style={{ flex: 1 }} />
        <strong style={{ fontSize: 20 }}>{KZ(o.total)}</strong>
      </div>

      <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => void printWorkOrder(detail).catch(() => toast.error('Falha ao gerar a folha de obra.'))}>
        🖨️ Imprimir folha de obra
      </button>

      {o.status !== 'DELIVERED' && o.status !== 'CANCELLED' ? (
        <button className="btn lg block success" style={{ marginTop: 12 }} onClick={() => void invoice()} disabled={billing}>
          🧾 {billing ? 'A faturar…' : 'Faturar (AGT) e entregar'}
        </button>
      ) : o.status === 'DELIVERED' ? (
        <div className="banner success" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>OS entregue e faturada.</span>
          {o.invoice_id ? (
            <button className="btn sm" onClick={() => void reprint()} disabled={reprinting}>
              🧾 {reprinting ? 'A gerar…' : 'Imprimir 2ª via'}
            </button>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
