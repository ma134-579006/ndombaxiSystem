import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@nexus/tokens/tokens.css';
import './theme.css';
import { initTheme } from './theme';
import { initAutoUpdate } from './autoUpdate';
import { initScrollReveal } from './scrollReveal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { mandatoryUpdate } from './update/mandatoryUpdate';

initTheme();
initAutoUpdate(); // recarrega sozinho quando há nova versão publicada
// Verificação da versão INSTALADA (app Windows/Android) contra o servidor
// oficial. Em segundo plano; sem internet não faz nada e o Gestor abre na mesma.
mandatoryUpdate.start();
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
