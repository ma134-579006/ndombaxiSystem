import React from 'react';

/**
 * Captura erros de render para que a app NUNCA fique em "tela branca".
 * Mostra uma mensagem clara + botões de recarregar / terminar sessão, e
 * regista o erro na consola para diagnóstico.
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

  private hardReload = () => {
    try { /* limpa sessão volátil para um arranque limpo */ sessionStorage.clear(); } catch { /* ignore */ }
    location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: '#0c1426', color: '#eaf0fa', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 440, textAlign: 'center', background: '#111a2e', border: '1px solid #233149', borderRadius: 16, padding: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
          <h2 style={{ margin: '0 0 8px' }}>Ocorreu um erro inesperado</h2>
          <p style={{ color: '#93a3c0', fontSize: 14, marginTop: 0 }}>
            A aplicação encontrou um problema. Tente recarregar — os seus dados estão guardados em segurança.
          </p>
          <pre style={{ textAlign: 'left', fontSize: 11, color: '#fca5a5', background: '#0a1020', border: '1px solid #233149', borderRadius: 10, padding: 10, overflow: 'auto', maxHeight: 140 }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button onClick={this.hardReload} style={{ marginTop: 12, width: '100%', height: 46, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#3b82f6,#2563eb)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
