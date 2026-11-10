import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * JANELA do caixa no modelo do POS de referência (medido no Vendus):
 * ecrã inteiro com o fundo verde-azulado em degradé, barra de título de 50px
 * (título centrado, 24px leve, branco) com o ⊗ branco à direita, e o conteúdo
 * num cartão branco (até 1140px) a 25px da barra. Entra a desvanecer (0,3 s).
 * Fecha no ⊗ ou com Esc — clicar fora NÃO fecha (como na referência).
 */
export function VWindow({ title, titleNode, onClose, children, narrow, footer }: {
  title: string; titleNode?: React.ReactNode; onClose(): void; children: React.ReactNode; narrow?: boolean; footer?: React.ReactNode;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="vw-bg" role="dialog" aria-modal="true" aria-label={title}>
      <header className="vw-head">
        <h2>{titleNode ?? title}</h2>
        <button type="button" className="vw-x" onClick={onClose} aria-label="Fechar">
          <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#fff" /><path d="M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
        </button>
      </header>
      <div className="vw-scroll">
        <div className={`vw-card${narrow ? ' narrow' : ''}`}>{children}</div>
        {footer ? <div className={`vw-foot${narrow ? ' narrow' : ''}`}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Barra de pesquisa no modelo do POS de referência: faixa cinza-clara, ⊗
 * cinzento à esquerda (limpa), campo de 46px com letra de 18px e botão
 * quadrado com a lupa à direita. Abre de imediato (sem animação).
 */
export function VSearch({ value, onChange, onSubmit, placeholder, autoFocus, input, extra }: {
  value: string; onChange(v: string): void; onSubmit?(): void; placeholder?: string; autoFocus?: boolean;
  /** Campo próprio (ex.: com teclado no ecrã); por omissão um <input>. */
  input?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <form className="vs-band" role="search" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
      <button type="button" className="vs-clear" onClick={() => onChange('')} aria-label="Limpar pesquisa">
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" /><path d="M8.4 8.4l7.2 7.2M15.6 8.4l-7.2 7.2" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" /></svg>
      </button>
      <div className="vs-field">
        {input ?? <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} aria-label={placeholder ?? 'Pesquisar'} />}
      </div>
      <button type="submit" className="vs-go" aria-label="Pesquisar">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /></svg>
      </button>
      {extra}
    </form>
  );
}
