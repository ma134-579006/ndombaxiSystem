import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CheckoutResult, PaymentMethod } from '../api/types';
import { IconCheck, IconUpload } from '../components/Icons';
import { formatKz } from '../format';
import { useStore } from '../state/StoreContext';

interface GeneratedRef { available: boolean; entity?: string; reference?: string; amount?: number; expiresAt?: string; message?: string }
function fmtRef(r: string): string { return r.replace(/(\d{3})(?=\d)/g, '$1 ').trim(); }

function fileToBase64(file: File): Promise<{ data: string; name: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = String(r.result);
      const comma = result.indexOf(',');
      resolve({ data: comma >= 0 ? result.slice(comma + 1) : result, name: file.name, mime: file.type });
    };
    r.onerror = () => reject(new Error('Falha ao ler o ficheiro'));
    r.readAsDataURL(file);
  });
}

export function Confirmation({
  order,
  method,
  onTrack,
  onContinue,
}: {
  order: CheckoutResult;
  method: PaymentMethod | null;
  onTrack(): void;
  onContinue(): void;
}) {
  const { code } = useStore();
  const type = method?.type ?? 'CASH';

  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proofDone, setProofDone] = useState(false);

  const [expressPhone, setExpressPhone] = useState('');
  const [paid, setPaid] = useState<string | null>(null);

  // Pagamento por referência: gera a referência dinâmica da encomenda.
  const [genRef, setGenRef] = useState<GeneratedRef | null>(null);
  useEffect(() => {
    if (type !== 'REFERENCE') return;
    api.generateReference(code, order.id)
      .then(setGenRef)
      .catch(() => setGenRef({ available: false, message: 'Não foi possível gerar a referência agora.' }));
  }, [type, code, order.id]);

  const submitProof = async () => {
    setError(null);
    if (!reference.trim() && !file) {
      setError('Indique a referência da operação ou anexe o comprovativo.');
      return;
    }
    setBusy(true);
    try {
      const encoded = file ? await fileToBase64(file) : null;
      await api.uploadProof(code, order.id, {
        methodType: type,
        amount: order.grossTotal,
        reference: reference.trim() || undefined,
        fileName: encoded?.name,
        fileMime: encoded?.mime,
        fileData: encoded?.data,
      });
      setProofDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar o comprovativo.');
    } finally {
      setBusy(false);
    }
  };

  const submitExpress = async () => {
    setError(null);
    if (!/^\d{9,}$/.test(expressPhone.replace(/\s/g, ''))) {
      setError('Indique um número de telemóvel válido.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.payExpress(code, order.id, { expressPhone: expressPhone.replace(/\s/g, '') });
      setPaid(res.invoiceNumber ?? 'Pagamento confirmado');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Pagamento não confirmado.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="card">
        <div className="success-head">
          <div className="ring">
            <IconCheck size={32} />
          </div>
          <div className="num">{order.orderNumber}</div>
          <p className="muted" style={{ margin: '4px 0 0' }}>Encomenda registada com sucesso</p>
        </div>
        <div className="kv" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <span className="k">Total</span>
          <span className="v" style={{ fontSize: 20, fontWeight: 900 }}>{formatKz(order.grossTotal)}</span>
        </div>
      </div>

      {error ? <div className="banner danger" style={{ marginBottom: 16 }}>{error}</div> : null}

      {/* Instruções de pagamento conforme o método */}
      {type === 'MULTICAIXA_EXPRESS' ? (
        <div className="card">
          <h3>Pagar com Multicaixa Express</h3>
          {paid ? (
            <div className="banner success"><IconCheck size={18} /> Pagamento confirmado · {paid}</div>
          ) : (
            <>
              <div className="field">
                <label>Telemóvel associado ao Express</label>
                <input value={expressPhone} onChange={(e) => setExpressPhone(e.target.value)} placeholder="9XX XXX XXX" inputMode="tel" />
              </div>
              <button className="btn block" onClick={submitExpress} disabled={busy}>
                {busy ? 'A confirmar…' : `Pagar ${formatKz(order.grossTotal)}`}
              </button>
            </>
          )}
        </div>
      ) : type === 'CASH' ? (
        <div className="card">
          <h3>Pagamento</h3>
          <p className="muted" style={{ margin: 0 }}>
            Pague em numerário na entrega ou no levantamento. {method?.instructions ?? ''}
          </p>
        </div>
      ) : (
        <div className="card">
          <h3>{type === 'REFERENCE' ? 'Pagamento por referência' : 'Transferência bancária'}</h3>
          <div className="instructions">
            {type === 'BANK_TRANSFER' ? (
              <>
                {method?.bank_name ? `Banco: ${method.bank_name}\n` : ''}
                {method?.iban ? `IBAN: ${method.iban}\n` : ''}
                {method?.account_holder ? `Titular: ${method.account_holder}\n` : ''}
              </>
            ) : genRef?.available ? (
              <>
                {`Entidade: ${genRef.entity}\n`}
                {`Referência: ${fmtRef(genRef.reference ?? '')}\n`}
                {genRef.expiresAt ? `Válida até: ${new Date(genRef.expiresAt).toLocaleDateString('pt-PT')}\n` : ''}
              </>
            ) : genRef && !genRef.available ? (
              <>{genRef.message ?? 'Pagamento por referência indisponível.'}{'\n'}</>
            ) : type === 'REFERENCE' ? (
              <>{'A gerar a referência…\n'}</>
            ) : (
              <>
                {method?.reference_entity ? `Entidade: ${method.reference_entity}\n` : ''}
                {method?.reference_number ? `Referência: ${method.reference_number}\n` : ''}
              </>
            )}
            {`Valor: ${formatKz(order.grossTotal)}`}
            {method?.instructions ? `\n\n${method.instructions}` : ''}
          </div>

          {proofDone ? (
            <div className="banner success" style={{ marginTop: 14 }}>
              <IconCheck size={18} /> Comprovativo enviado. A loja vai validar e confirmar a sua encomenda.
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <div className="field">
                <label>Referência da operação</label>
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Nº da transferência/operação" />
              </div>
              <div className="field">
                <label>Comprovativo (imagem/PDF)</label>
                <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
              <button className="btn block" onClick={submitProof} disabled={busy}>
                <IconUpload size={18} /> {busy ? 'A enviar…' : 'Enviar comprovativo'}
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn ghost block" onClick={onContinue}>Continuar a comprar</button>
        <button className="btn block" onClick={onTrack}>Acompanhar encomenda</button>
      </div>
    </div>
  );
}
