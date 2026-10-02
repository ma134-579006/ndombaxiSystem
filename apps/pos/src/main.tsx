import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@nexus/tokens/tokens.css';
import './theme.css';
import { initTheme } from './theme';
import { initScrollReveal } from './scrollReveal';
import { initPaper } from './print';
import { initAutoUpdate } from './autoUpdate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TransferHost } from './transfer';
import { mandatoryUpdate } from './update/mandatoryUpdate';
import { isSaleInProgress } from './pos/saleActivity';

initTheme();
initScrollReveal();
initPaper();
// Auto-atualização: só recarrega quando NÃO há venda em curso, para nunca perder
// uma venda a meio. O sinal vem do ESTADO do carrinho (bandeira escrita pelo
// ecrã de vendas) e não do DOM: contar `.cart-line` amarrava a regra a uma
// classe de estilo reutilizável noutras listas.
initAutoUpdate({ canReload: () => !isSaleInProgress() });
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
      <TransferHost />
    </ErrorBoundary>
  </React.StrictMode>,
);
