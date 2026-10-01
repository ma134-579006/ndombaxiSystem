import React from 'react';

/**
 * Ícones de interface (traço único 1.75, 24×24) — substituem os emojis que
 * apareciam em cartões, atalhos e títulos. Os módulos continuam a declarar o
 * ícone com o emoji de sempre (é legível no código); aqui converte-se para SVG.
 */

const P: Record<string, string> = {
  clipboard: 'M9 4h6v3H9zM8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M9 12h6M9 16h4',
  utensils: 'M7 3v8a2 2 0 0 0 4 0V3M9 3v18M17 21V3c-2.2 1.3-3.5 3.6-3.5 6.5 0 2 1.2 3.5 3.5 3.5',
  chef: 'M7 14a4 4 0 1 1 1.6-7.7A4 4 0 0 1 16 6a4 4 0 1 1 1 8M7 14v6h10v-6M7 17h10',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  delivery: 'M3 7h11v8H3zM14 10h4l3 3v2h-7M7 18a1.5 1.5 0 1 0 0-.01M17 18a1.5 1.5 0 1 0 0-.01',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6M9 16h3',
  users: 'M16 20a5 5 0 0 0-10 0M11 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M21 20a4.5 4.5 0 0 0-3.5-4.4M16 4.3a4 4 0 0 1 0 7.4',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8M20 16v-3',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  car: 'M5 16h14M3 13l2-6h14l2 6v4H3v-4zM7 17v2M17 17v2M7 13h.01M17 13h.01',
  calculator: 'M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 14.5h.01M12 14.5h.01M15 14.5h.01M9 18h.01M12 18h3',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4M8 14h2M12 14h2',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
  box: 'M21 8 12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  bed: 'M3 18V7M3 13h18v5M21 13v-2a3 3 0 0 0-3-3h-7v5M7 11.5a1.5 1.5 0 1 0 0-.01',
  key: 'M15 7a4 4 0 1 1-3.9 4.9L4 19v2h3v-2h2v-2h2l1.1-1.1A4 4 0 0 1 15 7zM16 9.5h.01',
  tag: 'M3 12V4h8l9 9-8 8-9-9zM7.5 8h.01',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2zM10 21h4',
  hourglass: 'M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9',
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l10-10a5 5 0 0 1 7 7l-10 10zM8.5 8.5l7 7',
  steth: 'M6 3v6a4 4 0 0 0 8 0V3M10 13v2a4 4 0 0 0 8 0v-1.5M18 13.5a1.8 1.8 0 1 0 0-.01',
  ambulance: 'M3 7h11v10H3zM14 11h4l3 3v3h-7M7 18a1.5 1.5 0 1 0 0-.01M17 18a1.5 1.5 0 1 0 0-.01M8.5 9.5v5M6 12h5',
  flask: 'M9 3h6M10 3v6l-5.5 9.5A1.6 1.6 0 0 0 6 21h12a1.6 1.6 0 0 0 1.5-2.5L14 9V3M7.5 15h9',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',
  layers: 'M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  factory: 'M3 21V10l6 3V10l6 3V6h6v15H3zM7 17h2M12 17h2M17 17h1',
  cart: 'M9 20a1.4 1.4 0 1 0 0-.01M18 20a1.4 1.4 0 1 0 0-.01M2.5 3.5h2.6l2.1 11.2a1.6 1.6 0 0 0 1.6 1.3h8.1a1.6 1.6 0 0 0 1.6-1.2L20.5 8H6.1',
  bag: 'M6 7h12l1 13H5L6 7zM9 7a3 3 0 0 1 6 0',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  video: 'M3 7h12v10H3zM15 10.5l6-3.5v10l-6-3.5',
  alert: 'M10.3 4.1 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  check: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  printer: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  rocket: 'M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 15l-2-2c1-4 4.5-8.5 11-9-.5 6.5-5 10-9 11zM14 9.5h.01',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3z',
  building: 'M4 21V5l8-2v18M12 8h8v13M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01M3 21h18',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  money: 'M3 6.5h18v11H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 9.5v.01M18 14.5v.01',
  chair: 'M7 3h10v9H7zM6 12h12M7 12v9M17 12v9M7 17h10',
  heart: 'M12 20s-8-4.6-8-10.5A4.5 4.5 0 0 1 12 6.5a4.5 4.5 0 0 1 8 3C20 15.4 12 20 12 20z',
  barrier: 'M3 9h18v5H3zM6 14v6M18 14v6M7 9l-3 5M13 9l-5 5M19 9l-5 5',
  plus: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v8M8 12h8',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  thumbUp: 'M7 11v9H4v-9h3zM7 11l4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7',
  thumbDown: 'M17 13V4h3v9h-3zM17 13l-4 8a2 2 0 0 1-2-2v-4H5.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.7 4H17',
  door: 'M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18M14 12h.01',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
};

/** Emoji (como está escrito nos módulos) → nome do ícone. */
const FROM_EMOJI: Record<string, string> = {
  '📋': 'clipboard', '🍽️': 'utensils', '🍽': 'utensils', '👨‍🍳': 'chef', '📱': 'phone', '🛵': 'delivery', '🧾': 'receipt',
  '🤝': 'users', '👥': 'users', '📊': 'chart', '🛠️': 'wrench', '🛠': 'wrench', '🔧': 'wrench', '🚗': 'car', '🧮': 'calculator',
  '📅': 'calendar', '📆': 'calendar', '🛡️': 'shield', '🛡': 'shield', '📦': 'box', '🛏️': 'bed', '🛏': 'bed', '🔑': 'key',
  '💲': 'tag', '🛎️': 'bell', '🛎': 'bell', '⏳': 'hourglass', '💊': 'pill', '🩺': 'steth', '👤': 'user', '🧑‍⚕️': 'steth',
  '🧑': 'user', '🚑': 'ambulance', '🧪': 'flask', '🛜': 'globe', '⏰': 'clock', '🧹': 'sparkle', '🥖': 'layers', '🥐': 'layers',
  '🏭': 'factory', '🛒': 'cart', '🛍️': 'bag', '🛍': 'bag', '📷': 'camera', '📹': 'video', '⚠️': 'alert', '⚠': 'alert',
  '✅': 'check', '🎉': 'check', '📄': 'doc', '📗': 'doc', '⬇️': 'download', '⬇': 'download', '🖨': 'printer', '🖨️': 'printer',
  '🔎': 'search', '🔍': 'search', '🎙️': 'mic', '🚀': 'rocket', '👁': 'eye', '💬': 'chat', '⭐': 'star', '🏢': 'building',
  '💳': 'card', '💸': 'money', '🪑': 'chair', '💟': 'heart', '🚧': 'barrier', '🆕': 'plus', '⚙️': 'gear', 'ℹ️': 'info',
  '⌨': 'keyboard', '👍': 'thumbUp', '👎': 'thumbDown', '⛔': 'ban', '🚪': 'door', '🍔': 'utensils', '🏨': 'bed', '🏥': 'steth',
};

export function iconName(emojiOrName: string): string | null {
  const k = (emojiOrName || '').trim();
  if (P[k]) return k;
  return FROM_EMOJI[k] ?? FROM_EMOJI[k.replace(/️/g, '')] ?? null;
}

/** Desenha o ícone (aceita o emoji antigo ou o nome). Sem correspondência → nada. */
export function UiIcon({ e, size = 20, className, title }: { e: string; size?: number; className?: string; title?: string }) {
  const n = iconName(e);
  if (!n) return null;
  return (
    <svg className={className ?? 'ui-ic'} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      <path d={P[n]} />
    </svg>
  );
}
