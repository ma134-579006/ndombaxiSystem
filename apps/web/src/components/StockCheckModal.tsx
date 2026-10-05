import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { StockCheckResult, StockCheckRow } from '../api/client';
import { Modal } from './ui';
import { confirmDialog, toast } from './feedback';

const fmt = (n: number) => new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 3 }).format(n);

function Lista({ rows, total, mostra }: { rows: StockCheckRow[]; total: number; mostra: (r: StockCheckRow) => string }) {
  const vistos = rows.slice(0, 15);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      {vistos.map((r) => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.name} <small className="muted">· {r.code}{r.isActive ? '' : ' · inativo'}</small>
          </span>
          <span className="muted" style={{ whiteSpace: 'nowrap' }}>{mostra(r)}</span>
        </div>
      ))}
      {total > vistos.length ? <small className="muted">… e mais {total - vistos.length}</small> : null}
    </div>
  );
}

/**
 * Verificação de coerência do stock. O número do cartão do produto (stock total) e a
 * soma dos saldos por loja têm de bater; aqui vê-se onde não batem e repara-se o único
 * caso sem ambiguidade (produto com stock mas sem saldo em nenhuma loja — típico de
 * produtos migrados). O resto resolve-se com uma contagem de inventário.
 */
export function StockCheckModal({ onClose }: { onClose(): void }) {
  const [res, setRes] = useState<StockCheckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setErr(null);
    try { setRes(await api.inventory.stockCheck()); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível verificar o stock.'); }
  }, []);
  useEffect(() => { void run(); }, [run]);

  const repair = async () => {
    if (!res) return;
    if (!(await confirmDialog({
      message: `Criar o saldo por loja de ${res.semSaldoPorLoja.total} produto(s) que mostram stock mas não têm saldo em nenhuma loja? O stock total mostrado NÃO muda; fica registado como "Saldo inicial (acerto)" na loja principal.`,
    }))) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.inventory.stockRepair();
      toast.success(`${r.fixed} produto(s) corrigido(s).`);
      setRes(null); await run();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível corrigir.'); }
    finally { setBusy(false); }
  };

  const sem = res?.semSaldoPorLoja; const dif = res?.diferencas;
  const tudoCerto = !!res && sem!.total === 0 && dif!.total === 0;

  return (
    <Modal title="Verificar stock" onClose={onClose}
      footer={sem && sem.total > 0 ? (
        <button className="btn lg block" onClick={repair} disabled={busy}>{busy ? 'A corrigir…' : `Corrigir ${sem.total} produto(s) sem saldo por loja`}</button>
      ) : undefined}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p className="muted" style={{ margin: 0 }}>
          Confirma se o stock que vês no produto bate com os saldos de cada loja (onde as vendas e as entradas realmente mexem).
        </p>
        {err ? <div className="banner danger">{err}</div> : null}
        {!res && !err ? <p className="muted">A verificar…</p> : null}
        {tudoCerto ? <div className="fx-note"><span>Tudo certo: os {fmt(res!.checked)} produtos estão coerentes.</span></div> : null}

        {sem && sem.total > 0 ? (
          <div className="fx-note" style={{ flexDirection: 'column' }}>
            <strong>{fmt(sem.total)} produto(s) com stock mas sem saldo em nenhuma loja</strong>
            <span>Acontece com produtos migrados/importados. O total mostrado está certo; falta o saldo por loja, e é por isso que as vendas e contagens se podem comportar de forma estranha. O botão em baixo cria esse saldo na loja principal (o total não muda).</span>
            <Lista rows={sem.items} total={sem.total} mostra={(r) => `${fmt(r.shown)} un.`} />
          </div>
        ) : null}

        {dif && dif.total > 0 ? (
          <div className="fx-note bad" style={{ flexDirection: 'column' }}>
            <strong>{fmt(dif.total)} produto(s) em que o stock total difere da soma das lojas</strong>
            <span>Não se corrige sozinho: não há como saber qual dos dois números é o certo. Faz uma <b>contagem de inventário</b> destes produtos — a contagem acerta o stock com o que está na prateleira.</span>
            <Lista rows={dif.items} total={dif.total} mostra={(r) => `total ${fmt(r.shown)} · lojas ${fmt(r.stores)}`} />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
