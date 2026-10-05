import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TransferHost } from './transfer';
import '@nexus/tokens/tokens.css';
import './theme.css';
import { initTheme } from './theme';
import { initTouchUi } from './touchUi';
import { initAutoUpdate } from './autoUpdate';
import { initScrollReveal } from './scrollReveal';
import { initNativeApp, isNativeApp } from './native';

initTheme();
initTouchUi(); // ecrãs táteis: comportamento de telemóvel + campos acima do teclado
initNativeApp(); // app Android: ligações diretas e botão voltar
if (!isNativeApp) initAutoUpdate(); // site: recarrega sozinho quando há nova versão publicada (a app traz a sua)
initScrollReveal(); // conteúdo materializa-se ao rolar (efeito de catálogo premium)

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
