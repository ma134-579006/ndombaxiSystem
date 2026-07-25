import React from 'react';

type P = { size?: number; className?: string };
function svg(path: React.ReactNode) {
  return function Icon({ size = 20, className }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        {path}
      </svg>
    );
  };
}

export const IconBuilding = svg(
  <>
    <rect width="16" height="20" x="4" y="2" rx="2" />
    <path d="M9 22v-4h6v4M8 6h0M16 6h0M8 10h0M16 10h0M8 14h0M16 14h0" />
  </>,
);
export const IconCpu = svg(
  <>
    <rect width="16" height="16" x="4" y="4" rx="2" />
    <rect width="6" height="6" x="9" y="9" rx="1" />
    <path d="M15 2v2M9 2v2M15 20v2M9 20v2M20 15h2M20 9h2M2 15h2M2 9h2" />
  </>,
);
export const IconReceipt = svg(
  <>
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
    <path d="M8 7h8M8 11h8M8 15h5" />
  </>,
);
export const IconCard = svg(
  <>
    <rect width="20" height="14" x="2" y="5" rx="2" />
    <path d="M2 10h20" />
  </>,
);
export const IconLogout = svg(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </>,
);
export const IconCheck = svg(<path d="M20 6 9 17l-5-5" />);
export const IconClose = svg(
  <>
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </>,
);
export const IconPlus = svg(
  <>
    <path d="M5 12h14" /><path d="M12 5v14" />
  </>,
);
export const IconTrash = svg(
  <>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </>,
);
export const IconEdit = svg(
  <>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
  </>,
);
export const IconPlay = svg(<path d="m6 3 14 9-14 9V3z" />);
export const IconLock = svg(
  <>
    <rect width="18" height="11" x="3" y="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </>,
);
export const IconMail = svg(
  <>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </>,
);
export const IconDownload = svg(
  <>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </>,
);
export const IconShield = svg(
  <>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </>,
);
export const IconSearch = svg(
  <>
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
  </>,
);
export const IconRefresh = svg(
  <>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </>,
);
export const IconStar = svg(
  <path d="M12 3l2.5 6.5L21 10l-5 4.5L17.5 21 12 17l-5.5 4L8 14.5 3 10l6.5-.5z" />,
);
export const IconChart = svg(
  <>
    <path d="M3 3v18h18" />
    <path d="M7 16v-5M12 16V8M17 16v-3" />
  </>,
);
export const IconCube = svg(
  <>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M3.27 6.96 12 12.01l8.73-5.05" />
    <path d="M12 22.08V12" />
  </>,
);
export const IconTruck = svg(
  <>
    <path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h2" />
    <path d="M14 9h4l3 3v5a1 1 0 0 1-1 1h-1" />
    <circle cx="7.5" cy="18.5" r="1.5" />
    <circle cx="17.5" cy="18.5" r="1.5" />
  </>,
);
export const IconStore = svg(
  <>
    <path d="M3 9 4 4h16l1 5" />
    <path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
    <path d="M3 9a2.5 2.5 0 0 0 4.5 0 2.5 2.5 0 0 0 4.5 0 2.5 2.5 0 0 0 4.5 0 2.5 2.5 0 0 0 4.5 0" />
    <path d="M9 21v-6h6v6" />
  </>,
);
export const IconImage = svg(
  <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  </>,
);
export const IconEye = svg(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const IconEyeOff = svg(
  <>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.12 9.12 0 0 0 5.39-1.61" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24M2 2l20 20" />
  </>,
);
export const IconKeyboard = svg(
  <>
    <rect width="20" height="14" x="2" y="5" rx="2" />
    <path d="M6 9h0M10 9h0M14 9h0M18 9h0M6 13h0M18 13h0M10 13h4" />
  </>,
);
export const IconBackspace = svg(
  <>
    <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
    <path d="m15 9-6 6M9 9l6 6" />
  </>,
);
export const IconShift = svg(<path d="m12 3 8 9h-5v7H9v-7H4l8-9z" />);

/* ── Ícones SEMÂNTICOS (Design System enterprise) ─────────────
   Mesmo estilo/peso do conjunto acima (stroke 2, 24px, linecap round).
   Cada módulo tem o ícone que representa EXATAMENTE a função. */

/** Perfil / utilizador individual. */
export const IconUser = svg(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
  </>,
);
/** Clientes — grupo de pessoas. */
export const IconUsers = svg(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.4 2.9-5.5 6.5-5.5s6.5 2.1 6.5 5.5" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.2 15.1c2 .8 3.3 2.5 3.3 4.9" />
  </>,
);
/** Funcionários — crachá de identificação. */
export const IconBadge = svg(
  <>
    <rect width="15" height="18" x="4.5" y="3" rx="2" />
    <path d="M9.5 3h5M12 3v2" />
    <circle cx="12" cy="10.5" r="2.2" />
    <path d="M8 17.5c.6-1.9 2.1-3 4-3s3.4 1.1 4 3" />
  </>,
);
/** Dashboard / visão geral — velocímetro. */
export const IconGauge = svg(
  <>
    <path d="M12 4a9 9 0 0 1 9 9c0 2-.6 3.7-1.7 5.2H4.7A8.9 8.9 0 0 1 3 13a9 9 0 0 1 9-9Z" />
    <path d="m12 13 3.5-3.5" />
    <circle cx="12" cy="13" r="1" />
  </>,
);
/** IA / assistente — faíscas. */
export const IconSparkles = svg(
  <>
    <path d="M12 3 13.9 8.1 19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    <path d="M19 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" />
  </>,
);
/** Inventário / armazém — caixas empilhadas. */
export const IconBoxes = svg(
  <>
    <rect width="7.5" height="7.5" x="3" y="13" rx="1" />
    <rect width="7.5" height="7.5" x="13.5" y="13" rx="1" />
    <rect width="7.5" height="7.5" x="8.25" y="3.5" rx="1" />
    <path d="M12 3.5v3.2M6.75 13v3.2M17.25 13v3.2" />
  </>,
);
/** Compras — carrinho com entrada. */
export const IconCartIn = svg(
  <>
    <circle cx="9" cy="20" r="1.4" />
    <circle cx="17" cy="20" r="1.4" />
    <path d="M2.5 4h2l2.4 11.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.2L20.5 9H6" />
    <path d="M13 3v4M11 5.2 13 7l2-1.8" />
  </>,
);
/** Loja online — carrinho de compras. */
export const IconCart = svg(
  <>
    <circle cx="9" cy="20" r="1.4" />
    <circle cx="17" cy="20" r="1.4" />
    <path d="M2.5 4h2l2.4 11.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.2L20.5 9H6" />
  </>,
);
/** Caixa registadora (POS / operações de caixa). */
export const IconCashRegister = svg(
  <>
    <path d="M4 11h16l1 8a1.5 1.5 0 0 1-1.5 1.7h-15A1.5 1.5 0 0 1 3 19l1-8Z" />
    <path d="M8 11V7a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v4" />
    <path d="M10 6V3.5h7V6M7.5 15h.01M11 15h.01M14.5 15h.01M7.5 18h9" />
  </>,
);
/** Lucros / análise — tendência a subir. */
export const IconTrendUp = svg(
  <>
    <path d="m3 17 6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </>,
);
/** Fluxo de caixa / contas a receber — moedas. */
export const IconCoins = svg(
  <>
    <ellipse cx="9" cy="6.5" rx="6" ry="3" />
    <path d="M3 6.5v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" />
    <path d="M3 11.5v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-2" />
    <path d="M21 9.5v5c0 1.3-1.6 2.4-3.8 2.8" />
  </>,
);
/** Contas a pagar / folha salarial — carteira. */
export const IconWallet = svg(
  <>
    <path d="M20 7V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-1" />
    <path d="M22 9.5v5a1 1 0 0 1-1 1h-4.5a2.75 2.75 0 1 1 0-5.5H21a1 1 0 0 1 1 1Z" />
    <path d="M16.5 12h.01" />
  </>,
);
/** Contabilidade — livro razão. */
export const IconLedger = svg(
  <>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5v15Z" />
    <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
    <path d="M9 7h7M9 11h7" />
  </>,
);
/** Relatórios — documento com gráfico. */
export const IconReport = svg(
  <>
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Z" />
    <path d="M14 2v5h5" />
    <path d="M8.5 17v-3M12 17v-6M15.5 17v-2" />
  </>,
);
/** Auditoria — lupa sobre documento. */
export const IconAudit = svg(
  <>
    <path d="M13 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9" />
    <path d="M13 2v5h5" />
    <circle cx="11" cy="13" r="2.6" />
    <path d="m13 15 2.2 2.2" />
  </>,
);
/** Histórico / movimentos — relógio com seta. */
export const IconHistory = svg(
  <>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v4.5h4.5" />
    <path d="M12 8v4l2.8 1.6" />
  </>,
);
/** Configurações — engrenagem. */
export const IconGear = svg(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01A1.7 1.7 0 0 0 10.05 3V3a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01c.26.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z" />
  </>,
);
/** Permissões / acessos — chave. */
export const IconKey = svg(
  <>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="m11 12 9.5-9.5M16 6l3 3" />
  </>,
);
/** Notificações — sino. */
export const IconBell = svg(
  <>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
  </>,
);
/** Câmaras de vigilância. */
export const IconCamera = svg(
  <>
    <path d="M14.5 4 21 7.5l-2.5 4.3a2 2 0 0 1-2.7.8L7.5 8.2a2 2 0 0 1-.7-2.8L8.5 3l6 1Z" transform="rotate(8 12 8)" />
    <path d="M2 9.5V14a2 2 0 0 0 2 2h3l-2 5" />
    <circle cx="16" cy="8" r="1" />
  </>,
);
/** Férias / calendário. */
export const IconCalendar = svg(
  <>
    <rect width="18" height="17" x="3" y="4.5" rx="2" />
    <path d="M8 2.5v4M16 2.5v4M3 9.5h18" />
  </>,
);
/** Promoções — etiqueta de preço. */
export const IconTag = svg(
  <>
    <path d="M12.6 2.6 21 11a2 2 0 0 1 0 2.8L14 20.9a2 2 0 0 1-2.9 0L2.6 12.6A2 2 0 0 1 2 11.1V4a2 2 0 0 1 2-2h7.1a2 2 0 0 1 1.5.6Z" />
    <circle cx="7.5" cy="7.5" r="1.3" />
  </>,
);
/** Comissões — percentagem. */
export const IconPercent = svg(
  <>
    <path d="m19 5-14 14" />
    <circle cx="7" cy="7" r="2.5" />
    <circle cx="17" cy="17" r="2.5" />
  </>,
);
/** Conciliação / transferências — setas opostas. */
export const IconArrowLeftRight = svg(
  <>
    <path d="M8 3 4 7l4 4M4 7h16" />
    <path d="m16 21 4-4-4-4M20 17H4" />
  </>,
);
/** Banco / gateways — edifício bancário. */
export const IconBank = svg(
  <>
    <path d="m3 9 9-6 9 6H3Z" />
    <path d="M5 9v8M9.5 9v8M14.5 9v8M19 9v8" />
    <path d="M3 20.5h18M3 17h18" />
  </>,
);
/** Suporte — auscultadores com microfone. */
export const IconHeadset = svg(
  <>
    <path d="M4 13a8 8 0 0 1 16 0" />
    <rect width="4" height="6" x="3" y="12" rx="1.6" />
    <rect width="4" height="6" x="17" y="12" rx="1.6" />
    <path d="M19 18a3.5 3.5 0 0 1-3.5 3.5H13" />
  </>,
);
/** Comentários / conversa — balão. */
export const IconMessage = svg(
  <path d="M21 12a8 8 0 0 1-8 8H4.5L3 21.5V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />,
);
/** Integrações — ficha (plug). */
export const IconPlug = svg(
  <>
    <path d="M9 7V3M15 7V3" />
    <path d="M6 7h12v4a6 6 0 0 1-6 6 6 6 0 0 1-6-6V7Z" />
    <path d="M12 17v4" />
  </>,
);
/** Backup — base de dados. */
export const IconDatabase = svg(
  <>
    <ellipse cx="12" cy="5.5" rx="8" ry="3" />
    <path d="M4 5.5V12c0 1.7 3.6 3 8 3s8-1.3 8-3V5.5" />
    <path d="M4 12v6.5c0 1.7 3.6 3 8 3s8-1.3 8-3V12" />
  </>,
);
/** Migração / importação — seta a entrar. */
export const IconUpload = svg(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 8 5-5 5 5M12 3v12" />
  </>,
);
