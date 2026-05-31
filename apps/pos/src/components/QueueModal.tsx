import React, { useCallback, useEffect, useState } from 'react';
import { listPendingSales, type PendingSale, type PendingSaleStatus } from '../offline/db';
import { syncController } from '../offline/sync';
import { useSync } from '../offline/useSync';
import { formatKz } from '../format';
import { IconClose, IconCloudOff, IconReceipt, IconSync, IconTrash } from './Icons';

interface Props {
  onClose(): void;
}

const STATUS_LABEL: Record<PendingSaleStatus, string> = {
  PENDING: 'Por sincronizar',
  SYNCING: 'A sincronizar…',
  ERROR: 'Erro — rever',
};

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Fila de vendas offline — revisão manual.
 * Mostra vendas guardadas sem internet; permite reemitir (recebe nº fiscal do
 * servidor) ou descartar as que estão em erro. O nº/hash AGT vêm SEMPRE do
 * servidor; aqui nunca se inventa numeração fiscal.
 */
export function QueueModal({ onClose }: Props) {
  const { online, syncing } = useSync();
  const [sales, setSales] = useState<PendingSale[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const all = await listPendingSales();
    setSales(all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const retry = async (id: number) => {
    setBusy(id);
    try {
      await syncController.retryOne(id);
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const discard = async (id: number) => {
    setBusy(id);
    try {
      await syncController.discard(id);
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const syncAll = async () => {
    await syncController.flush();
    await refresh();
  };

  const hasRetryable = sales.some((s) => s.status !== 'SYNCING');

  return (
    <div className="modal-bg" onClick={onClose}>
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="row" style={{ padding: 16, borderBottom: '1px solid var(--border)', gap: 10 }}>
          <IconReceipt size={20} />
          <h2 style={{ margin: 0, fontSize: 18 }}>
            Fila de vendas offline {sales.length > 0 ? <span className="muted">· {sales.length}</span> : null}
          </h2>
          <span className="spacer" />
          <button className="trash" onClick={onClose} aria-label="Fechar">
            <IconClose size={22} />
          </button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
          {!online ? (
            <div className="banner" style={{ background: 'rgba(245,158,11,.14)', border: '1px solid rgba(245,158,11,.4)', color: '#fcd9a3' }}>
              <IconCloudOff size={18} /> Sem internet. As vendas serão emitidas automaticamente quando a ligação voltar.
            </div>
          ) : null}

          {loading ? (
            <p className="muted" style={{ textAlign: 'center', padding: 16 }}>A carregar…</p>
          ) : sales.length === 0 ? (
            <div className="empty" style={{ padding: 28 }}>
              <IconReceipt size={40} />
              <div>Nenhuma venda em fila.</div>
              <div className="muted" style={{ fontSize: 13 }}>Todas as vendas foram sincronizadas.</div>
            </div>
          ) : (
            <>
              {sales.map((s) => (
                <div key={s.id} className="q-item">
                  <div className="q-head">
                    <div>
                      <div className="q-ref">{s.localRef}</div>
                      <div className="q-meta">
                        {shortTime(s.createdAt)} · {s.customerName || 'Consumidor final'}
                      </div>
                    </div>
                    <span className={`q-status ${s.status.toLowerCase()}`}>{STATUS_LABEL[s.status]}</span>
                  </div>

                  <div className="q-body">
                    <span className="muted" style={{ fontSize: 13 }}>
                      {s.lines.reduce((n, l) => n + l.quantity, 0)} artigo(s)
                    </span>
                    <strong>{formatKz(s.grossTotal)}</strong>
                  </div>

                  {s.status === 'ERROR' && s.lastError ? (
                    <div className="q-error">{s.lastError}</div>
                  ) : null}

                  <div className="q-actions">
                    <button
                      className="btn ghost"
                      style={{ height: 42, flex: 1 }}
                      onClick={() => s.id != null && retry(s.id)}
                      disabled={!online || busy === s.id || s.status === 'SYNCING'}
                    >
                      <IconSync size={16} className={busy === s.id ? 'spin' : undefined} />{' '}
                      {busy === s.id ? 'A emitir…' : 'Reemitir'}
                    </button>
                    <button
                      className="btn danger"
                      style={{ height: 42 }}
                      onClick={() => s.id != null && discard(s.id)}
                      disabled={busy === s.id}
                      title="Descartar venda"
                    >
                      <IconTrash size={16} />
                    </button>
                  </div>
                </div>
              ))}

              <button className="btn block" onClick={syncAll} disabled={!online || syncing || !hasRetryable}>
                <IconSync size={18} className={syncing ? 'spin' : undefined} />{' '}
                {syncing ? 'A sincronizar…' : 'Sincronizar tudo'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
