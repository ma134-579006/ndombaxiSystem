import { useEffect, useRef } from 'react';

/**
 * Deteta a leitura de um scanner de código de barras (modo "keyboard wedge").
 * Os scanners enviam os dígitos muito rápido e terminam com Enter. Distinguimos
 * de digitação humana pela velocidade (<35ms entre teclas) e pelo Enter final.
 * Não interfere quando o utilizador está a escrever num input/textarea.
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  const buffer = useRef('');
  const lastTime = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      // Ignora se o foco está num campo editável (deixa o teclado normal agir).
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return;
      }
      const now = Date.now();
      const gap = now - lastTime.current;
      lastTime.current = now;

      if (e.key === 'Enter') {
        const code = buffer.current.trim();
        buffer.current = '';
        if (code.length >= 3) {
          e.preventDefault();
          onScanRef.current(code);
        }
        return;
      }
      // Só caracteres imprimíveis de 1 char (dígitos/letras do código).
      if (e.key.length === 1) {
        // Reinicia o buffer se houve uma pausa longa (digitação humana).
        if (gap > 120) buffer.current = '';
        buffer.current += e.key;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}
