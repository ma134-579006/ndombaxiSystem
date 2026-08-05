import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Dialog, EmptyState, Skeleton, type Tone } from '@nexus/ui';
import { listPendingSales, type PendingSale, type PendingSaleStatus } from '../offline/db';
import { syncController } from '../offline/sync';
import { useSync } from '../offline/useSync';
import { formatKz } from '../format';
import { IconCloudOff, IconReceipt, IconSync, IconTrash } from './Icons';

interface Props {
  onClose(): void;
}

const STATUS: Record<PendingSaleStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Por sincronizar', tone: 'warning' },
  SYNCING: { label: 'A sincronizar…', tone: 'info' },
  ERROR: { label: 'Erro — rever', tone: 'danger' },
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
  // Descartar apaga uma venda REAL que ainda não chegou ao servidor. Passa a
  // exigir uma segunda confirmação no próprio cartão — antes bastava um toque
  // num ícone, e o dinheiro dessa venda desaparecia sem pergunta nem desfazer.
  const [confirmDiscard, setConfirmDiscard] = useState<number | null>(null);

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
      setConfirmDiscard(null);
      await refresh();
    }
  };

  const syncAll = async () => {
    await syncController.flush();
    await refresh();
  };

  const hasRetryable = sales.some((s) => s.status !== 'SYNCING');

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Fila de vendas offline${sales.length > 0 ? ` · ${sales.length}` : ''}`}
      footer={
        sales.length > 0 ? (
          <Button
            variant="primary"
            block
            onClick={syncAll}
            disabled={!online || syncing || !hasRetryable}
            icon={<IconSync size={18} className={syncing ? 'spin' : undefined} />}
          >
            {syncing ? 'A sincronizar…' : 'Sincronizar tudo'}
          </Button>
        ) : undefined
      }
    >
      {!online ? (
        <div
          className="banner"
          role="status"
          style={{
            background: 'var(--nx-c-warning-soft)',
            border: '1px solid var(--nx-c-warning)',
            color: 'var(--nx-c-warning)',
          }}
        >
          <IconCloudOff size={18} /> Sem internet. As vendas serão emitidas automaticamente quando a ligação voltar.
        </div>
      ) : null}

      {loading ? (
        <Skeleton lines={3} height={72} />
      ) : sales.length === 0 ? (
        <EmptyState
          icon={<IconReceipt size={26} />}
          title="Nenhuma venda em fila"
          text="Todas as vendas foram sincronizadas."
        />
      ) : (
        sales.map((s) => (
          <div key={s.id} className="q-item">
            <div className="q-head">
              <div>
                <div className="q-ref">{s.localRef}</div>
                <div className="q-meta">
                  {shortTime(s.createdAt)} · {s.customerName || 'Consumidor final'}
                </div>
              </div>
              <Badge dot tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge>
            </div>

            <div className="q-body">
              <span className="nx-caption">
                {s.lines.reduce((n, l) => n + l.quantity, 0)} artigo(s)
              </span>
              <strong className="nx-num">{formatKz(s.grossTotal)}</strong>
            </div>

            {s.status === 'ERROR' && s.lastError ? (
              <div className="q-error" role="alert">{s.lastError}</div>
            ) : null}

            {confirmDiscard === s.id ? (
              <div className="q-actions" role="alertdialog" aria-label="Confirmar descarte">
                <span className="nx-body-sm" style={{ flex: 1, color: 'var(--nx-c-danger)' }}>
                  Descartar esta venda? Não há como a recuperar.
                </span>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDiscard(null)}>
                  Manter
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={busy === s.id}
                  onClick={() => s.id != null && discard(s.id)}
                >
                  Descartar
                </Button>
              </div>
            ) : (
              <div className="q-actions">
                <Button
                  variant="secondary"
                  style={{ flex: 1 }}
                  onClick={() => s.id != null && retry(s.id)}
                  disabled={!online || busy === s.id || s.status === 'SYNCING'}
                  icon={<IconSync size={16} className={busy === s.id ? 'spin' : undefined} />}
                >
                  {busy === s.id ? 'A emitir…' : 'Reemitir'}
                </Button>
                <Button
                  variant="danger"
                  aria-label={`Descartar venda ${s.localRef}`}
                  onClick={() => setConfirmDiscard(s.id ?? null)}
                  disabled={busy === s.id}
                  icon={<IconTrash size={16} />}
                />
              </div>
            )}
          </div>
        ))
      )}
    </Dialog>
  );
}
