import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';
import { initTheme } from './theme';
import { initPaper } from './print';

initTheme();
initPaper();

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
