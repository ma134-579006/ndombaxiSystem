import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { FiscalEngineDocRow, FiscalEngineSaft, FiscalEngineTenantStatus } from '../api/types';
import { runDownload, toast } from '../components/feedback';
import { INDICATOR } from './FiscalEngineAdmin';

const STATE: Record<string, { t: string; c: 'ok' | 'off' | 'bad' }> = {
  RASCUNHO: { t: 'Rascunho', c: 'off' },
  A_PREPARAR: { t: 'A preparar', c: 'off' },
  A_ENVIAR: { t: 'A enviar', c: 'off' },
  CRIADO_NO_VENDUS: { t: 'Criado no Vendus', c: 'off' },
  COMUNICACAO_AGT_PENDENTE: { t: 'Comunicação AGT pendente', c: 'off' },
  AGT_ACEITE: { t: 'Aceite pela AGT', c: 'ok' },
  AGT_REJEITADO: { t: 'Rejeitado pela AGT', c: 'bad' },
  ESTADO_DESCONHECIDO: { t: 'Estado desconhecido', c: 'bad' },
  ERRO_DE_COMUNICACAO: { t: 'Erro de comunicação', c: 'bad' },
  CORRECCAO_NECESSARIA: { t: 'Correcção necessária', c: 'bad' },
};
const FILTERS: [string, string][] = [['', 'Todos'], ['COMUNICACAO_AGT_PENDENTE', 'Pendentes AGT'], ['CORRECCAO_NECESSARIA', 'Correcção'], ['ERRO_DE_COMUNICACAO', 'Erros'], ['ESTADO_DESCONHECIDO', 'Desconhecidos']];
const ENGINE: Record<string, string> = { LPS: 'Motor próprio LPS', VENDUS: 'Cegid Vendus', SUSPENSO: 'Emissão suspensa' };
const RETRYABLE = new Set(['CORRECCAO_NECESSARIA', 'ERRO_DE_COMUNICACAO', 'ESTADO_DESCONHECIDO', 'A_PREPARAR']);

function Badge({ t, c }: { t: string; c: 'ok' | 'off' | 'bad' }) {
  return <span className={`fx-badge ${c}`}><span className={`fx-dot ${c}`} />{t}</span>;
}

/** Empresa → Fiscal: motor fiscal externo (estado, documentos, PDF original, sincronização, SAF-T do Vendus). */
export function FiscalEngineCompanyCard({ admin }: { admin: boolean }) {
  const [st, setSt] = useState<FiscalEngineTenantStatus | null>(null);
  const [docs, setDocs] = useState<FiscalEngineDocRow[]>([]);
  const [filter, setFilter] = useState('');
  const [saft, setSaft] = useState<FiscalEngineSaft[]>([]);
  const [busy, setBusy] = useState(false);
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const load = async (f = filter) => {
    try {
      const s = await api.fiscalEngine.status();
      setSt(s);
      if (s.engine !== 'LPS' || s.account) {
        setDocs(await api.fiscalEngine.documents(f || undefined));
        if (admin) setSaft(await api.fiscalEngine.saftHistory().catch(() => []));
      }
    } catch {
      setSt(null);
    }
  };
  useEffect(() => { void load(); }, []);

  if (!st || (st.engine === 'LPS' && !st.account)) return null;

  const guard = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Operação falhou.'); } finally { setBusy(false); }
  };
  const pdf = (d: FiscalEngineDocRow) => guard(async () => {
    const url = URL.createObjectURL(await api.fiscalEngine.pdf(d.id));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  });
  const ind = INDICATOR[st.indicator] ?? { t: st.indicator, c: 'off' as const };

  return (
    <div className="fx-card" style={{ marginTop: 18 }}>
      <div className="fx-card-h">
        <h3>Motor fiscal · {ENGINE[st.effective.engine]}</h3>
        <Badge {...ind} />
      </div>
      {st.effective.reason ? <div className={`fx-note ${st.effective.engine === 'SUSPENSO' ? 'bad' : ''}`}>{st.effective.reason}</div> : null}
      <div className="fx-meta">
        <div><small>Conta Vendus</small><b>{st.account?.company || '—'}</b></div>
        <div><small>NIF</small><b>{st.account?.fiscalId || '—'}</b></div>
        <div><small>Caixa</small><b>{st.account?.register || '—'}</b></div>
        <div><small>Validade do fornecedor</small><b>{st.validity.status}{st.validity.daysLeft != null ? ` · ${st.validity.daysLeft} dias` : ''}</b></div>
        {Object.entries(st.counts).map(([k, n]) => <div key={k}><small>{STATE[k]?.t ?? k}</small><b>{n}</b></div>)}
      </div>

      <div className="fx-tabs" role="tablist">
        {FILTERS.map(([k, label]) => (
          <button key={k || 'all'} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => { setFilter(k); void load(k); }}>{label}</button>
        ))}
      </div>
      <div className="fe-docs">
        {docs.length === 0 ? <div className="muted">Sem documentos</div> : docs.map((d) => {
          const s = STATE[d.state] ?? { t: d.state, c: 'off' as const };
          return (
            <div key={d.id} className="fe-doc">
              <div>
                <b>{d.number ?? 'Sem número fiscal'}</b>
                <small>{d.kind === 'TEST' ? 'Teste (sem validade fiscal)' : `Ref. interna ${d.internal_number ?? '—'}`} · {new Date(d.created_at).toLocaleString('pt-PT')}</small>
                {d.last_error ? <small>{d.last_error}</small> : null}
                {d.divergence ? <small>{d.divergence}</small> : null}
              </div>
              <div><Badge {...s} />{d.amount_gross ? <small>{Number(d.amount_gross).toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz</small> : null}</div>
              <div className="fe-doc-a">
                <button className="btn ghost sm" disabled={busy || !d.has_pdf} onClick={() => void pdf(d)}>PDF original</button>
                {admin && RETRYABLE.has(d.state) ? <button className="btn ghost sm" disabled={busy} onClick={() => void guard(async () => { await api.fiscalEngine.retry(d.id); await load(); }, 'Reenvio feito (com reconciliação).')}>Reenviar</button> : null}
              </div>
            </div>
          );
        })}
      </div>

      {admin ? (
        <>
          <div className="fx-actions">
            <button className="btn ghost" disabled={busy || !st.account} onClick={() => void guard(async () => { const r = await api.fiscalEngine.syncClients(); toast.success(`Clientes: ${r.created} criados, ${r.linked} ligados, ${r.updated} actualizados${r.errors.length ? `, ${r.errors.length} erros` : ''}`); })}>Sincronizar clientes</button>
            <button className="btn ghost" disabled={busy || !st.account} onClick={() => void guard(async () => { const r = await api.fiscalEngine.syncProducts(); toast.success(`Produtos: ${r.created} criados, ${r.linked} ligados, ${r.updated} actualizados${r.errors.length ? `, ${r.errors.length} erros` : ''}`); })}>Sincronizar produtos</button>
          </div>
          <div className="fx-card-h" style={{ marginTop: 18 }}><h3>SAF-T (AO) do Cegid Vendus</h3></div>
          <div className="fx-grid" style={{ alignItems: 'end' }}>
            <div className="field"><label>Período</label><input type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></div>
            <div className="field">
              <button className="btn" disabled={busy || !st.account || !/^\d{4}-\d{2}$/.test(ym)} onClick={() => void guard(async () => {
                const [y, m] = ym.split('-').map(Number);
                const r = await api.fiscalEngine.saftFetch(y, m);
                setSaft(await api.fiscalEngine.saftHistory());
                if (r.valid) toast.success('SAF-T válido no XSD (AO).'); else toast.error(`SAF-T com ${r.issues.length} problema(s).`);
              })}>Obter do Vendus</button>
            </div>
          </div>
          <div className="fe-docs" style={{ marginTop: 10 }}>
            {saft.map((f) => (
              <div key={f.id} className="fe-doc">
                <div><b>{f.year}-{String(f.month).padStart(2, '0')}</b><small>{new Date(f.fetched_at ?? f.fetchedAt ?? '').toLocaleString('pt-PT')} · SHA-256 {f.sha256.slice(0, 12)}…</small>{!f.valid && f.issues[0] ? <small>{f.issues[0]}</small> : null}</div>
                <div><Badge t={f.valid ? 'XSD válido' : `${f.issues.length} problema(s)`} c={f.valid ? 'ok' : 'bad'} /></div>
                <div className="fe-doc-a">
                  <button className="btn ghost sm" disabled={busy} onClick={() => void runDownload({ title: 'SAF-T Vendus', fileName: `SAFT-AO-Vendus-${f.year}-${String(f.month).padStart(2, '0')}.xml`, make: () => api.fiscalEngine.saftXml(f.id) })}>Descarregar</button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
