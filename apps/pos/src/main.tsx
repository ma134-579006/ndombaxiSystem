import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';
import { initTheme } from './theme';
import { initPaper } from './print';
import { initAutoUpdate } from './autoUpdate';

initTheme();
initPaper();
// Auto-atualização: só recarrega quando NÃO há venda em curso (carrinho vazio)
// para nunca perder uma venda a meio.
initAutoUpdate({ canReload: () => document.querySelectorAll('.cart-line').length === 0 });

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
