/**
 * SERVIDOR DA LOJA — o ecrã que liga os aparelhos ao computador do balcão.
 *
 * Mostra duas caras, conforme onde está a ser aberto:
 *
 *  • **No computador da loja** (app Windows com servidor local): o estado do
 *    servidor e, quando partilhado, o endereço e o código para os outros
 *    aparelhos lerem. É o balcão a dizer "estou aqui".
 *  • **Em qualquer outro aparelho** (telemóvel, tablet, 2.º posto): o campo
 *    para se ligar a esse endereço — e é isso que lhe dá o sistema INTEIRO sem
 *    internet, porque passa a ser a API da loja a responder.
 *
 * Porque é que isto existe em vez de "o telemóvel funcionar sozinho": os
 * módulos do sistema vivem numa API sobre PostgreSQL, e não se corre PostgreSQL
 * num telemóvel. A Caixa tem caminho próprio para vender sem rede nenhuma; o
 * resto do sistema trabalha sem internet falando com o servidor da loja.
 */
import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from '../components/feedback';
import { IconBuilding } from '../components/Icons';
import {
  desligarDoServidorDaLoja, ligarAoServidorDaLoja, servidorDaLoja,
} from '../offline/shopLink';

interface EstadoLocal {
  binaries: boolean; provisioned: boolean; running: boolean;
  sharing?: boolean; lanUrl?: string | null; blocked?: string | null;
  companyCode?: string | null;
}

interface Anfitriao {
  localServer?: {
    status(): Promise<EstadoLocal>;
    setSharing(on: boolean): Promise<{ sharing: boolean; needsRestart: boolean }>;
  };
}

function anfitriao(): Anfitriao['localServer'] | null {
  const w = window as unknown as { ndombaxi?: Anfitriao };
  return w.ndombaxi?.localServer ?? null;
}

export function ShopServerCard() {
  const host = anfitriao();
  return host ? <LadoDoBalcao host={host} /> : <LadoDoAparelho />;
}

/** No computador da loja: o que está a acontecer e como partilhar. */
function LadoDoBalcao({ host }: { host: NonNullable<Anfitriao['localServer']> }) {
  const [e, setE] = useState<EstadoLocal | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const recarregar = () => { void host.status().then(setE).catch(() => setE(null)); };
  useEffect(recarregar, []);

  const alternar = async (ligar: boolean) => {
    setOcupado(true);
    try {
      await host.setSharing(ligar);
      recarregar();
      toast.success(ligar
        ? 'Partilha ligada. Feche e volte a abrir o Ndombaxi System para os outros aparelhos o encontrarem.'
        : 'Partilha desligada. Aplica-se ao reabrir o programa.');
    } finally { setOcupado(false); }
  };

  if (!e) return <div className="card"><div className="loading">A carregar…</div></div>;

  return (
    <div className="card">
      <h3><IconBuilding size={18} /> Servidor desta loja</h3>

      {!e.binaries ? (
        <div className="banner">
          Esta instalação não trouxe o servidor local. Instale a versão mais recente
          do Ndombaxi System para trabalhar sem internet.
        </div>
      ) : !e.provisioned ? (
        <div className="banner">
          A empresa ainda não foi copiada para este computador. Assim que entrar
          uma vez como <strong>administrador com internet</strong>, a cópia é feita
          sozinha e este posto passa a trabalhar sem depender da rede.
        </div>
      ) : !e.running ? (
        <div className="banner">
          Os dados já estão cá. O servidor entra em funcionamento no próximo
          arranque do programa.
          {e.blocked ? <div className="muted" style={{ marginTop: 6 }}>{e.blocked}</div> : null}
        </div>
      ) : (
        <div className="banner ok">
          Este computador está a servir a empresa
          {e.companyCode ? <> <strong>{e.companyCode}</strong></> : null} sem depender da internet.
        </div>
      )}

      <label className="switch-row" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={e.sharing === true} disabled={ocupado || !e.provisioned}
          onChange={(ev) => void alternar(ev.target.checked)} />
        <span>
          <strong>Servir os outros aparelhos da loja</strong>
          <div className="muted" style={{ fontSize: 13 }}>
            Telemóveis, tablets e um segundo posto passam a usar este computador em
            vez da internet. Só a aplicação é partilhada — a base de dados nunca
            sai desta máquina.
          </div>
        </span>
      </label>

      {e.sharing && e.running ? (
        e.lanUrl ? (
          <div style={{ marginTop: 16, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ background: '#fff', padding: 10, borderRadius: 12 }}>
              <QRCodeSVG value={e.lanUrl} size={148} />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 13 }}>Endereço desta loja</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{e.lanUrl}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 8, maxWidth: 340 }}>
                No telemóvel, abra <strong>Configurações → Servidor da loja</strong> e
                leia este código (ou escreva o endereço).
              </div>
            </div>
          </div>
        ) : (
          <div className="banner" style={{ marginTop: 14 }}>
            Partilha ligada, mas este computador ainda não tem endereço na rede
            local. Ligue-o ao Wi-Fi ou ao cabo da loja e reabra o programa.
          </div>
        )
      ) : null}
    </div>
  );
}

/** Nos outros aparelhos: ligar-se ao servidor da loja. */
function LadoDoAparelho() {
  const [atual, setAtual] = useState<string | null>(servidorDaLoja());
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const ligar = () => {
    const r = ligarAoServidorDaLoja(texto);
    if (!r.ok) { setErro(r.motivo); return; }
    setErro(null);
    setAtual(r.url);
    setTexto('');
    toast.success('Ligado ao servidor da loja. O sistema passa a funcionar sem internet dentro da loja.');
  };

  const desligar = () => {
    desligarDoServidorDaLoja();
    setAtual(null);
    toast.success('Desligado. O aparelho volta a usar a internet.');
  };

  return (
    <div className="card">
      <h3><IconBuilding size={18} /> Servidor da loja</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Dentro da loja, este aparelho pode trabalhar através do computador do
        balcão em vez da internet. Compras, stock, funcionários e relatórios
        continuam todos a funcionar — quem responde é o servidor da loja.
      </p>

      {atual ? (
        <>
          <div className="banner ok">Ligado a <strong>{atual}</strong></div>
          <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            Fora da loja, o aparelho volta sozinho a usar a internet.
          </div>
          <button className="btn ghost" style={{ marginTop: 12 }} onClick={desligar}>
            Deixar de usar o servidor da loja
          </button>
        </>
      ) : (
        <>
          <label className="lbl" style={{ marginTop: 12 }}>Endereço mostrado no computador da loja</label>
          <input className="inp" value={texto} placeholder="192.168.1.50:3399"
            inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            onChange={(ev) => { setTexto(ev.target.value); setErro(null); }}
            onKeyDown={(ev) => { if (ev.key === 'Enter') ligar(); }} />
          {erro ? <div className="banner danger" style={{ marginTop: 10 }}>{erro}</div> : null}
          <button className="btn" style={{ marginTop: 12 }} onClick={ligar}>Ligar a esta loja</button>
        </>
      )}
    </div>
  );
}
