import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@nexus/tokens/tokens.css';
import '@nexus/ui/styles.css';
import './theme.css';
import { initTheme } from './theme';
import { initAutoUpdate } from './autoUpdate';
import { initScrollReveal } from './scrollReveal';
import { ErrorBoundary } from './components/ErrorBoundary';

initTheme();
initAutoUpdate(); // recarrega sozinho quando há nova versão publicada
initScrollReveal(); // conteúdo materializa-se ao rolar (animação em todo o sistema)

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado');

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
