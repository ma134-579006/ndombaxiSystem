import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import '@nexus/tokens/tokens.css';
import './theme.css';
import { initTheme } from './theme';
import { initAutoUpdate } from './autoUpdate';
import { initScrollReveal } from './scrollReveal';

initTheme();
initAutoUpdate(); // recarrega sozinho quando há nova versão publicada
initScrollReveal(); // conteúdo materializa-se ao rolar (efeito de catálogo premium)

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado');

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
