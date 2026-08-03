import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@nexus/tokens/tokens.css';
import './theme.css';
import { initTheme } from './theme';
import { initPaper } from './print';
import { initAutoUpdate } from './autoUpdate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { mandatoryUpdate } from './update/mandatoryUpdate';

initTheme();
initPaper();
// Auto-atualização: só recarrega quando NÃO há venda em curso (carrinho vazio)
// para nunca perder uma venda a meio.
initAutoUpdate({ canReload: () => document.querySelectorAll('.cart-line').length === 0 });
// Verificação da versão INSTALADA (app Windows/Android) contra o servidor
// oficial. Corre em segundo plano e, sem internet, não faz nada — a Caixa abre
// e vende na mesma.
mandatoryUpdate.start();

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado');

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
