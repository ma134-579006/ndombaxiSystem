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
import { isNativeApp } from './config';

// APLICAÇÃO INSTALADA: marca-se o documento para o CSS poder distinguir a app
// do site. Serve para o conteúdo OCUPAR O ECRÃ TODO quando a janela está
// maximizada — no site mantém-se a largura de leitura confortável (ver
// `.app-instalada` em theme.css). Feito antes de desenhar, para não haver um
// instante com o layout do site dentro da app.
if (isNativeApp()) document.documentElement.classList.add('app-instalada');

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
