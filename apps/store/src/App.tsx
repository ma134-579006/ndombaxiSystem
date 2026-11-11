import React from 'react';
import { Splash } from './components/Splash';
import { StorePicker } from './components/StorePicker';
import { KeyboardProvider } from './keyboard/KeyboardProvider';
import { Storefront } from './pages/Storefront';
import { StoreChat } from './components/StoreChat';
import { StoreProvider, useStore } from './state/StoreContext';
import { RepairTrack } from './views/RepairTrack';
import { MandatoryUpdate } from './components/MandatoryUpdate';
import { MembersApp } from './members/MembersApp';
import { isMembersArea } from './members/area';
import { KwanzaApp } from './kwanza/KwanzaApp';
import { KWANZA_APP } from './config';

function Gate() {
  const { code, setCode, status, error } = useStore();

  if (!code) return <StorePicker onOpen={setCode} />;

  if (status === 'loading' || status === 'idle') {
    return (
      <Splash />
    );
  }

  if (status === 'error') {
    return <StorePicker onOpen={setCode} error={error ? `Não foi possível abrir a loja “${code}”: ${error}` : null} />;
  }

  if (isMembersArea()) return <MembersApp />;

  return (
    <>
      <Storefront />
      <StoreChat code={code} />
    </>
  );
}

export function App() {
  // PORTAL DO CLIENTE: se o URL trouxer ?os=<token>&loja=<code> (QR da folha de
  // serviço), mostra o rastreio do reparo — página autónoma, sem gate nem carrinho.
  // LPS KWANZA: marketplace central (todas as empresas), fora de qualquer loja.
  if (KWANZA_APP || window.location.pathname.split('/').filter(Boolean)[0]?.toLowerCase() === 'kwanza') {
    return <><KwanzaApp /><MandatoryUpdate /></>;
  }
  const params = new URLSearchParams(window.location.search);
  const os = params.get('os');
  const loja = params.get('loja') || params.get('code');
  if (os && loja) {
    return (
      <KeyboardProvider>
        <RepairTrack code={loja} token={os} />
      </KeyboardProvider>
    );
  }
  return (
    <StoreProvider>
      <KeyboardProvider>
        <Gate />
      </KeyboardProvider>
      {/* Por cima de tudo: versão antiga da app → bloqueada até atualizar. */}
      <MandatoryUpdate />
    </StoreProvider>
  );
}
