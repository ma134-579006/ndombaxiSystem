import React, { useEffect, useRef, useState } from 'react';

/**
 * Grelha que desenha os produtos AOS POUCOS (48 de cada vez) e junta mais quando
 * o cliente chega ao fim. Com milhares de produtos, desenhar tudo de uma vez
 * bloqueava telemóveis (a loja parecia vazia ao abrir pelo QR).
 */
export function ProgressiveGrid<T>({ items, render, step = 48, className = 'ax-grid' }: {
  items: T[]; render(item: T): React.ReactNode; step?: number; className?: string;
}) {
  const [count, setCount] = useState(step);
  const sentinel = useRef<HTMLDivElement | null>(null);

  // Nova lista (filtro/pesquisa/categoria) → recomeça do início.
  useEffect(() => { setCount(step); }, [items, step]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || count >= items.length) return;
    if (typeof IntersectionObserver === 'undefined') { setCount(items.length); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setCount((c) => Math.min(items.length, c + step));
    }, { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [count, items.length, step]);

  return (
    <>
      <div className={className}>{items.slice(0, count).map(render)}</div>
      {count < items.length ? (
        <div ref={sentinel} className="ax-more" aria-live="polite">
          <span className="ax-more-spin" aria-hidden="true" /> A carregar mais produtos… ({count} de {items.length})
        </div>
      ) : null}
    </>
  );
}
