import React from 'react';
import { createRoot } from 'react-dom/client';
import { installModalClose } from './modalClose';
import { installFieldLabels } from './fieldLabels';
import { installBigScreen } from './bigScreen';
import { App } from './App';
import '@nexus/tokens/tokens.css';
import './theme.css';
import './vendus.css';
import { initTheme } from './theme';
import { initTouchUi } from './touchUi';
import { initAutoUpdate } from './autoUpdate';
import { initScrollReveal } from './scrollReveal';
import { initStickyStack } from './stickyStack';
import { initFloatingMenus } from './floatingMenus';
import { initTableStack } from './tableStack';
import { ErrorBoundary } from './components/ErrorBoundary';
import { mandatoryUpdate } from './update/mandatoryUpdate';
import { isNativeApp } from './config';
import { startI18n } from '@nexus/i18n';
import { startBackgroundOutbox } from './offline/prefetch';
import { initSeo } from './seo';

// APLICAÇÃO INSTALADA: marca-se o documento para o CSS poder distinguir a app
// do site. Serve para o conteúdo OCUPAR O ECRÃ TODO quando a janela está
// maximizada — no site mantém-se a largura de leitura confortável (ver
// `.app-instalada` em theme.css). Feito antes de desenhar, para não haver um
// instante com o layout do site dentro da app.
if (isNativeApp()) document.documentElement.classList.add('app-instalada');

initSeo(); // canonical e noindex: só o domínio novo aparece no Google
initTheme();
void startI18n(); // idioma do sistema (PT/EN/FR/ES), partilhado com a Caixa
initTouchUi(); // ecrãs táteis: comportamento de telemóvel + campos acima do teclado
initAutoUpdate(); // recarrega sozinho quando há nova versão publicada
// Verificação da versão INSTALADA (app Windows/Android) contra o servidor
// oficial. Em segundo plano; sem internet não faz nada e o Gestor abre na mesma.
mandatoryUpdate.start();
// Fila das alterações feitas sem rede: sobe sozinha quando a rede volta, mesmo
// sem ninguém ter entrado (só nas apps instaladas).
startBackgroundOutbox();
initScrollReveal();
initStickyStack(); // conteúdo materializa-se ao rolar (animação em todo o sistema)
initFloatingMenus(); // menus "Opções" das tabelas por cima de tudo (não ficam cortados)
initTableStack(); // telemóvel: tabelas viram cartões «Coluna: valor» (0 scroll horizontal)

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado');

installModalClose();
installFieldLabels(); // rótulos dos formulários ligados aos campos (leitor de ecrã, toque no rótulo)
installBigScreen();
createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
