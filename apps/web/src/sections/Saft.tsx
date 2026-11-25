import React, { useCallback, useEffect, useState } from 'react';
import { runDownload } from '../components/feedback';
import { api, ApiError } from '../api/client';
import type { AgtCommStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { FiscalEngineCompanyCard } from './FiscalEngineCompanyCard';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DOC_TYPE: Record<string, string> = { FT: 'Factura', FR: 'Factura-Recibo', NC: 'Nota de Crédito', ND: 'Nota de Débito', RC: 'Recibo', GR: 'Guia de Remessa', GT: 'Guia de Transporte', PF: 'Factura Pró-forma', OR: 'Orçamento' };
type FeStatus = Awaited<ReturnType<typeof api.fe.status>>;
type FeDoc = Awaited<ReturnType<typeof api.fe.documents>>[number];

/**
 * Administração Geral Tributária — no layout do backoffice de referência:
 *  • início: cartões SAF-T (exportar, "até ao dia 15"), Comunicação à AGT e
 *    Configuração;
 *  • Configuração: Estado da configuração, Séries de faturação (com as séries
 *    comunicadas à AGT; as que faltam são pedidas automaticamente na emissão)
 *    e Documentos rejeitados (com "Repor na fila").
 */
export function Saft() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'COMPANY_ADMIN';
  const now = new Date();
  const [view, setView] = useState<'home' | 'config'>('home');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() === 0 ? 12 : now.getMonth());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [comm, setComm] = useState<AgtCommStatus | null>(null);
  const [commBusy, setCommBusy] = useState(false);
  const [fe, setFe] = useState<FeStatus | null>(null);
  const [feErr, setFeErr] = useState<string | null>(null);
  const [modal, setModal] = useState<'series' | 'rejected' | null>(null);
  const [rejected, setRejected] = useState<FeDoc[] | null>(null);
  const [remote, setRemote] = useState<unknown>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);

  const load = useCallback(() => {
    api.agtComm.status().then(setComm).catch(() => setComm(null));
    api.fe.status().then((s) => { setFe(s); setFeErr(null); }).catch((e) => { setFe(null); setFeErr(e instanceof ApiError ? e.message : null); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const years: number[] = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y--) years.push(y);

  const exportSaft = async () => {
    setMsg(null); setBusy(true);
    try {
      await runDownload({
        title: `A exportar SAF-T de ${MONTHS[month - 1]} ${year}`,
        fileName: `SAFT-AO-${year}-${String(month).padStart(2, '0')}.xml`,
        make: async () => {
          const xml = await api.saft.export(year, month);
          if (!xml || !xml.includes('<AuditFile')) throw new ApiError(0, 'O servidor não devolveu um SAF-T válido.');
          return new Blob([xml], { type: 'application/xml;charset=utf-8' });
        },
      });
      setMsg({ ok: true, text: `SAF-T de ${MONTHS[month - 1]} de ${year} exportado.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Não foi possível exportar o SAF-T.' });
    } finally { setBusy(false); }
  };

  const communicate = async () => {
    setCommBusy(true); setMsg(null);
    try {
      const r = await api.agtComm.communicate();
      setMsg({ ok: !r.failed, text: `${r.sent} documento(s) comunicado(s)${r.failed ? `, ${r.failed} falharam` : ''}.` });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Não foi possível comunicar à AGT.' });
    } finally { setCommBusy(false); }
  };

  const openRejected = async () => {
    setModal('rejected'); setRejected(null);
    try {
      const [inv, err] = await Promise.all([api.fe.documents('INVALID'), api.fe.documents('ERROR')]);
      setRejected([...inv, ...err].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
    } catch { setRejected([]); }
  };
  const requeue = async (no: string) => {
    try {
      const r = await api.fe.requeue(no);
      setMsg({ ok: true, text: r.requeued ? `${no} reposto na fila de envio.` : `${no} já não estava rejeitado.` });
      void openRejected(); load();
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Não foi possível repor o documento.' }); }
  };
  const consultRemote = async () => {
    setRemoteBusy(true);
    try { setRemote(await api.fe.remoteSeries()); } catch (e) { setRemote({ erro: e instanceof ApiError ? e.message : 'Sem resposta da AGT.' }); }
    finally { setRemoteBusy(false); }
  };

  const feActive = !!fe?.enabled;
  const seriesRows = Object.entries(fe?.series ?? {}).map(([k, code]) => ({ type: k.split('-')[0], year: k.split('-')[1], code }))
    .sort((a, b) => b.year.localeCompare(a.year) || a.type.localeCompare(b.type));
  const rejectedCount = (fe?.documents?.INVALID ?? 0) + (fe?.documents?.ERROR ?? 0);

  return (
    <div className="vd-page">
      <div className="vd-head">
        <p className="vd-crumb">
          {view === 'config'
            ? <><button onClick={() => setView('home')}>Administração Geral Tributária</button><span className="sep">/</span><span>Configuração</span></>
            : <span>Administração Geral Tributária</span>}
        </p>
      </div>
      {msg ? <div className={msg.ok ? 'vd-ok' : 'vd-err'} role="status">{msg.text}</div> : null}

      {view === 'home' ? (
        <div className="vd-agt-cards">
          <div className="vd-agt-card">
            <div className="ic"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><text x="8" y="18" fontSize="5" fill="currentColor" stroke="none">XML</text></svg></div>
            <h3>SAF-T</h3>
            <p>Ficheiro SAF-T (AO) com os documentos emitidos no mês, para entregar à AGT.</p>
            <div className="sel">
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Mês">{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Ano">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            </div>
            <div className="act"><button className="vd-btn big" onClick={exportSaft} disabled={busy}>{busy ? 'A exportar…' : 'Exportar'}</button><small>Envie até ao dia 15 de cada mês</small></div>
          </div>
          <div className="vd-agt-card">
            <div className="ic"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg></div>
            <h3>Comunicação AGT</h3>
            <p>{!comm ? '—' : !comm.enabled ? 'Comunicação eletrónica por ativar na plataforma.' : !comm.configured ? 'Endpoint da AGT por configurar.' : `${comm.pending} por comunicar · ${comm.communicated} comunicados.`}</p>
            <div className="act"><button className="vd-btn big" onClick={communicate} disabled={commBusy || !comm?.enabled || !comm?.configured || comm.pending === 0}>{commBusy ? 'A comunicar…' : 'Comunicar'}</button><small>Documentos emitidos ainda não comunicados</small></div>
          </div>
          <div className="vd-agt-card">
            <div className="ic"><svg width="46" height="46" viewBox="0 0 24 24" fill="currentColor"><path d="M12.94 22h-1.89a1.68 1.68 0 0 1-1.68-1.68v-1.09a.34.34 0 0 0-.22-.29.38.38 0 0 0-.41 0l-.74.8a1.67 1.67 0 0 1-2.37 0L4.26 18.4a1.66 1.66 0 0 1-.5-1.19 1.72 1.72 0 0 1 .5-1.21l.74-.74a.34.34 0 0 0 0-.37c-.06-.15-.16-.26-.3-.26H3.68A1.69 1.69 0 0 1 2 12.94v-1.89a1.68 1.68 0 0 1 1.68-1.68h1.09a.34.34 0 0 0 .29-.22.38.38 0 0 0 0-.41L4.26 8a1.67 1.67 0 0 1 0-2.37L5.6 4.26a1.65 1.65 0 0 1 1.18-.5 1.72 1.72 0 0 1 1.22.5l.74.74a.34.34 0 0 0 .37 0c.15-.06.26-.16.26-.3V3.68A1.69 1.69 0 0 1 11.06 2H13a1.68 1.68 0 0 1 1.68 1.68v1.09a.34.34 0 0 0 .22.29.38.38 0 0 0 .41 0l.69-.8a1.67 1.67 0 0 1 2.37 0l1.37 1.34a1.67 1.67 0 0 1 .5 1.19 1.63 1.63 0 0 1-.5 1.21l-.74.74a.34.34 0 0 0 0 .37c.06.15.16.26.3.26h1.09A1.69 1.69 0 0 1 22 11.06V13a1.68 1.68 0 0 1-1.68 1.68h-1.09a.34.34 0 0 0-.29.22.34.34 0 0 0 0 .37l.77.77a1.67 1.67 0 0 1 0 2.37l-1.31 1.33a1.65 1.65 0 0 1-1.18.5 1.72 1.72 0 0 1-1.19-.5l-.77-.74a.34.34 0 0 0-.37 0c-.15.06-.26.16-.26.3v1.09A1.69 1.69 0 0 1 12.94 22zm-1.57-2h1.26v-.77a2.33 2.33 0 0 1 1.46-2.14 2.36 2.36 0 0 1 2.59.47l.54.54.88-.88-.54-.55a2.34 2.34 0 0 1-.48-2.56 2.33 2.33 0 0 1 2.14-1.45H20v-1.29h-.77a2.33 2.33 0 0 1-2.14-1.46 2.36 2.36 0 0 1 .47-2.59l.54-.54-.88-.88-.55.54a2.39 2.39 0 0 1-4-1.67V4h-1.3v.77a2.33 2.33 0 0 1-1.46 2.14 2.36 2.36 0 0 1-2.59-.47l-.54-.54-.88.88.54.55a2.39 2.39 0 0 1-1.67 4H4v1.26h.77a2.33 2.33 0 0 1 2.14 1.46 2.36 2.36 0 0 1-.47 2.59l-.54.54.88.88.55-.54a2.39 2.39 0 0 1 4 1.67z" /><path d="M12 15.5a3.5 3.5 0 1 1 3.5-3.5 3.5 3.5 0 0 1-3.5 3.5zm0-5a1.5 1.5 0 1 0 1.5 1.5 1.5 1.5 0 0 0-1.5-1.5z" /></svg></div>
            <h3>Configuração</h3>
            <p>Estado da Facturação Electrónica, séries comunicadas à AGT e documentos rejeitados.</p>
            <div className="act"><button className="vd-btn big ok" onClick={() => setView('config')}>Configurar</button>{rejectedCount ? <small className="bad">{rejectedCount} documento(s) rejeitado(s)</small> : <small>&nbsp;</small>}</div>
          </div>
        </div>
      ) : (
        <div className="vd-agt-cards cfg">
          <div className="vd-agt-card cfg">
            <div className="hd"><h3>Estado da Configuração</h3><p>{feActive ? 'Comunicação ativa.' : 'Comunicação inativa.'}</p></div>
            <div className="bd">
              <span className={`vd-state ${feActive ? 'ok' : 'off'}`}>{feActive ? '✓ Estado: Ativo' : '! Estado: Inativo'}</span>
              {feErr ? <p className="bad">{feErr}</p> : !fe ? <p>—</p> : (
                <p>
                  Ambiente: <b>{fe.environment === 'PRODUCTION' ? 'Produção' : 'Testes'}</b> · Estabelecimento n.º <b>{fe.establishmentNumber}</b><br />
                  {fe.missingSeries.length ? <span className="bad">Sem série AGT {now.getFullYear()} para: {fe.missingSeries.join(', ')} — é pedida automaticamente na emissão.</span> : 'Séries do ano em dia.'}
                  {!fe.hasTaxpayerKey ? <><br /><span className="bad">Chave do contribuinte por configurar (Super Admin).</span></> : null}
                </p>
              )}
            </div>
          </div>
          <div className="vd-agt-card cfg">
            <div className="hd"><h3>Séries de faturação</h3><p>Consulte as suas séries de faturação.</p></div>
            <div className="bd"><p>Verifique todas as séries de faturação comunicadas à AGT.</p><button className="vd-btn outline-ok" onClick={() => setModal('series')}>Consultar séries</button></div>
          </div>
          <div className="vd-agt-card cfg">
            <div className="hd"><h3>Documentos Rejeitados</h3><p>Consulte a lista de documentos rejeitados pela AGT.</p></div>
            <div className="bd"><p>Verifique os documentos comunicados à AGT e que foram rejeitados pela mesma.</p><button className="vd-btn danger" onClick={() => void openRejected()}>Documentos Rejeitados{rejectedCount ? ` (${rejectedCount})` : ''}</button></div>
          </div>
        </div>
      )}

      {modal ? (
        <div className="vd-modal-bg" onClick={() => setModal(null)}>
          <div className="vd-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <button className="x" onClick={() => setModal(null)} aria-label="Fechar">×</button>
            {modal === 'series' ? (
              <>
                <h2>Séries de Faturação</h2>
                <p className="lead">Séries de faturação já comunicadas à AGT para os documentos emitidos.</p>
                {seriesRows.length === 0 ? (
                  <div className="vd-none"><b>Não existem registos</b><span>Ainda não há séries comunicadas à AGT.</span></div>
                ) : (
                  <table className="vd-table vd-plain"><thead><tr><th>Tipo</th><th>Ano</th><th>Série AGT</th></tr></thead>
                    <tbody>{seriesRows.map((s) => <tr key={`${s.type}-${s.year}`}><td>{DOC_TYPE[s.type] ?? s.type} ({s.type})</td><td>{s.year}</td><td><b>{s.code}</b></td></tr>)}</tbody></table>
                )}
                <p className="foot">Se precisar de emitir um documento de um tipo que ainda não tenha série comunicada, o sistema faz essa comunicação no momento da emissão.</p>
                <div style={{ textAlign: 'center' }}>
                  <button className="vd-btn outline" onClick={() => void consultRemote()} disabled={remoteBusy || !feActive}>{remoteBusy ? 'A consultar a AGT…' : 'Consultar na AGT (limite de emissão)'}</button>
                  {remote ? <pre className="vd-pre">{JSON.stringify(remote, null, 2).slice(0, 4000)}</pre> : null}
                </div>
              </>
            ) : (
              <>
                <h2>Documentos Rejeitados</h2>
                <p className="lead">Documentos comunicados à AGT e rejeitados pela mesma.</p>
                {rejected === null ? <div className="loading">A carregar…</div> : rejected.length === 0 ? (
                  <div className="vd-none"><b>Não existem registos</b><span>Nenhum documento foi rejeitado pela AGT.</span></div>
                ) : (
                  <table className="vd-table vd-plain"><thead><tr><th>Documento</th><th>Estado</th><th>Tentativas</th><th>Motivo</th><th /></tr></thead>
                    <tbody>{rejected.map((d) => (
                      <tr key={d.documentNo}><td><b>{d.documentNo}</b><span className="sub">{new Date(d.createdAt).toLocaleString('pt-PT')}</span></td>
                        <td><span className="vd-badge bad">{d.status === 'INVALID' ? 'Rejeitado' : 'Erro'}</span></td>
                        <td className="ctr">{d.attempts ?? 0}</td>
                        <td style={{ maxWidth: 320, fontSize: 12.5 }}>{typeof d.errors === 'string' ? d.errors : d.errors ? JSON.stringify(d.errors).slice(0, 240) : '—'}</td>
                        <td className="num"><button className="vd-btn sm" onClick={() => void requeue(d.documentNo)}>Repor na fila</button></td></tr>
                    ))}</tbody></table>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
      {view === 'home' ? <FiscalEngineCompanyCard admin={isAdmin} /> : null}
    </div>
  );
}
