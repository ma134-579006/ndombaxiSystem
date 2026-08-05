/**
 * O ecrã da atualização obrigatória.
 *
 * Três estados, e nenhum deles é um susto para o utilizador:
 *
 *   1. **A guardar o trabalho** — há uma atualização obrigatória mas ainda há
 *      operações por enviar. NÃO tranca nada: mostra uma faixa a explicar, e o
 *      Gestor continua a trabalhar. É a regra que evita deixar uma empresa sem
 *      sistema e com dias de trabalho por salvar.
 *   2. **Tranca** — a fila está vazia, já não se perde nada. Ecrã por cima de
 *      tudo, com um único caminho: atualizar.
 *   3. **Aviso** — versão nova não obrigatória. Faixa discreta e dispensável.
 *
 * Os estilos são embutidos de propósito: este é o último ecrã que o utilizador
 * vê, e tem de aparecer bem mesmo que uma folha de estilos não tenha carregado.
 */
import React, { useEffect, useState } from 'react';
import { mandatoryUpdate, type UpdateGateState } from './mandatoryUpdate';

interface DesktopUpdateApi { update?: { openDownloadPage?(): Promise<void> } }

/**
 * "Atualizar Agora": abre a página OFICIAL de downloads no navegador do sistema
 * e encerra a aplicação.
 *
 * Nunca se aponta ao ficheiro do instalador diretamente — é na página oficial
 * que estão a versão e o hash com que o lojista confirma que o que descarregou
 * não foi trocado no caminho.
 */
async function openOfficialPage(url: string): Promise<void> {
  const w = window as unknown as {
    ndombaxi?: DesktopUpdateApi;
    Capacitor?: { Plugins?: { App?: { exitApp?(): Promise<void> } } };
  };
  // Desktop: o processo principal abre o navegador e encerra a app em segurança.
  if (w.ndombaxi?.update?.openDownloadPage) {
    await w.ndombaxi.update.openDownloadPage();
    return;
  }
  // Android: navegador do sistema e, a seguir, sair.
  window.open(url, '_blank');
  const exit = w.Capacitor?.Plugins?.App?.exitApp;
  if (exit) { window.setTimeout(() => { void exit(); }, 1200); }
}

function Melhorias({ notes, fixes }: { notes: string[]; fixes: string[] }) {
  const linhas = [...notes, ...fixes].slice(0, 8);
  if (linhas.length === 0) return null;
  return (
    <>
      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 18, marginBottom: 6, opacity: 0.75 }}>
        Melhorias
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7, opacity: 0.9 }}>
        {linhas.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </>
  );
}

function Faixa({ children, tom }: { children: React.ReactNode; tom: 'aviso' | 'trabalho' }) {
  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, top: 0, zIndex: 2147483000,
      padding: '10px 16px', fontSize: 14, fontWeight: 600, textAlign: 'center',
      color: '#fff', background: tom === 'trabalho' ? '#1f2937' : '#2430E8',
      boxShadow: '0 2px 12px rgba(0,0,0,.25)',
    }}>
      {children}
    </div>
  );
}

export function UpdateGate() {
  const [s, setS] = useState<UpdateGateState>(mandatoryUpdate.getState());
  const [dispensado, setDispensado] = useState(false);
  const [aAbrir, setAAbrir] = useState(false);

  useEffect(() => mandatoryUpdate.subscribe(setS), []);

  // Enquanto o ecrã estiver trancado, a página por baixo não pode ser usada nem
  // com o teclado: sem isto, o Tab levava o foco para os campos escondidos atrás.
  useEffect(() => {
    if (!s.blocking) return;
    const trava = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('keydown', trava, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', trava, true);
      document.body.style.overflow = overflow;
    };
  }, [s.blocking]);

  const d = s.decision;
  if (!d || d.state === 'none' || !d.release) return null;

  // 1. Obrigatória, mas ainda há trabalho por salvar → NÃO tranca.
  if (d.state === 'mandatory' && !s.blocking) {
    return (
      <Faixa tom="trabalho">
        Atualização obrigatória — a guardar o seu trabalho antes de continuar
        {s.pending > 0 ? ` (${s.pending} por enviar)` : ''}…
      </Faixa>
    );
  }

  // 3. Aviso dispensável.
  if (d.state === 'optional') {
    if (dispensado) return null;
    return (
      <Faixa tom="aviso">
        Está disponível a versão {d.release.version} do Ndombaxi System.{' '}
        {d.release.downloadPageUrl ? (
          <a href={d.release.downloadPageUrl} target="_blank" rel="noreferrer"
            style={{ color: '#fff', textDecoration: 'underline' }}>Atualizar</a>
        ) : null}
        <button type="button" onClick={() => setDispensado(true)} aria-label="Dispensar"
          style={{
            marginLeft: 14, background: 'transparent', border: 0, color: '#fff',
            fontSize: 18, lineHeight: 1, cursor: 'pointer', opacity: 0.8,
          }}>×</button>
      </Faixa>
    );
  }

  // 2. TRANCA. Sem cancelar, sem ignorar, sem fechar.
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Atualização obrigatória"
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483600,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        background: 'rgba(6,10,20,.92)', backdropFilter: 'blur(6px)',
        fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      <div style={{
        width: '100%', maxWidth: 520, background: '#0f1626', color: '#eef2ff',
        border: '1px solid rgba(255,255,255,.10)', borderRadius: 18, padding: '30px 30px 26px',
        boxShadow: '0 30px 80px rgba(0,0,0,.55)', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.6 }}>
          Ndombaxi System
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: '10px 0 12px' }}>
          Nova versão disponível
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, margin: 0, opacity: 0.85 }}>
          Foi disponibilizada uma nova versão do Ndombaxi System. Para continuar a
          utilizar o sistema é obrigatório atualizar.
        </p>

        <div style={{ display: 'flex', gap: 12, marginTop: 22 }}>
          <div style={{ flex: 1, background: 'rgba(255,255,255,.05)', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 12, opacity: 0.6 }}>Versão instalada</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{s.decision?.current}</div>
          </div>
          <div style={{ flex: 1, background: 'rgba(36,48,232,.20)', borderRadius: 12, padding: '12px 14px', border: '1px solid rgba(99,102,241,.35)' }}>
            <div style={{ fontSize: 12, opacity: 0.75 }}>Nova versão</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{d.release.version}</div>
          </div>
        </div>

        <Melhorias notes={d.release.notes} fixes={d.release.fixes} />

        <button
          type="button"
          autoFocus
          disabled={aAbrir}
          onClick={() => {
            setAAbrir(true);
            void openOfficialPage(d.release!.downloadPageUrl!);
          }}
          style={{
            width: '100%', marginTop: 26, height: 52, borderRadius: 999, border: 0,
            background: '#2430E8', color: '#fff', fontSize: 16, fontWeight: 700,
            cursor: aAbrir ? 'default' : 'pointer', opacity: aAbrir ? 0.75 : 1,
          }}
        >
          {aAbrir ? 'A abrir a página de downloads…' : 'Atualizar Agora'}
        </button>

        <div style={{ marginTop: 14, fontSize: 12, textAlign: 'center', opacity: 0.55 }}>
          Todo o seu trabalho já foi enviado e guardado em segurança.
        </div>
      </div>
    </div>
  );
}
