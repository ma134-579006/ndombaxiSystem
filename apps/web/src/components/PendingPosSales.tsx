import React, { useEffect, useState } from 'react';
import { sharedGet } from '../sharedCache';
import { formatKz } from '../format';

/**
 * VENDAS DO CAIXA AINDA POR SUBIR — memória partilhada do aparelho.
 *
 * No Android o Gestão e o Caixa correm na mesma origem e partilham a memória
 * interna: o que o Caixa vendeu sem rede aparece aqui de imediato, sem esperar
 * pela nuvem. Some sozinho quando as vendas sobem (o Caixa atualiza a lista).
 */
const KEY = 'partilha:caixa:vendas-pendentes';

interface Venda {
  localRef: string; createdAt: string; customerName: string | null; grossTotal: number;
  status: string; lastError: string | null;
  lines: { productName: string; quantity: number }[];
}

export function PendingPosSales() {
  const [vendas, setVendas] = useState<Venda[]>([]);
  useEffect(() => {
    let vivo = true;
    const ler = () => { void sharedGet<Venda[]>(KEY).then((v) => { if (vivo) setVendas(Array.isArray(v) ? v : []); }).catch(() => undefined); };
    ler();
    const t = window.setInterval(ler, 5000);
    return () => { vivo = false; window.clearInterval(t); };
  }, []);
  if (vendas.length === 0) return null;
  const total = vendas.reduce((s, v) => s + (Number(v.grossTotal) || 0), 0);
  return (
    <div className="card pps">
      <div className="pps-head">
        <strong>Vendas do Caixa por subir</strong>
        <span className="pps-sum">{vendas.length} · {formatKz(total)}</span>
      </div>
      <p className="muted pps-note">Feitas sem internet neste aparelho. Sobem sozinhas para a nuvem quando a ligação voltar.</p>
      <ul className="pps-list">
        {vendas.slice(0, 8).map((v) => (
          <li key={v.localRef}>
            <span className="pps-ref">{v.localRef}</span>
            <span className="pps-desc">{v.lines.map((l) => `${l.quantity}× ${l.productName}`).join(', ')}</span>
            <span className="pps-val">{formatKz(Number(v.grossTotal) || 0)}</span>
            {v.status === 'ERROR' && v.lastError ? <span className="pps-err">{v.lastError}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
