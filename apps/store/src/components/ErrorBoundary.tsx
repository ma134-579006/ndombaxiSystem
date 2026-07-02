import React from 'react';

/**
 * Captura erros de render para que a LOJA nunca fique em "tela branca" para o
 * cliente final. Mostra mensagem clara + recarregar (o carrinho persiste no
 * localStorage) e regista o erro na consola para diagnóstico.
 */
interface State { error: Error | null }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 440, textAlign: 'center', border: '1px solid #e3e6ee', borderRadius: 16, padding: 24, boxShadow: '0 8px 30px rgba(10,20,40,.08)' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
          <h2 style={{ margin: '0 0 8px' }}>Ocorreu um erro inesperado</h2>
          <p style={{ color: '#68738a', fontSize: 14, marginTop: 0 }}>
            A loja encontrou um problema. Recarregue a página — o seu carrinho continua guardado.
          </p>
          <button onClick={() => location.reload()} style={{ marginTop: 12, width: '100%', height: 46, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#f97316,#ea580c)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            Recarregar a loja
          </button>
        </div>
      </div>
    );
  }
}
