import React from 'react';

/** Ícones SVG profissionais (stroke = currentColor), sem dependências. */
type P = { size?: number; className?: string };

function svg(path: React.ReactNode, fill = false) {
  return function Icon({ size = 22, className }: P) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill ? 'currentColor' : 'none'}
        stroke={fill ? 'none' : 'currentColor'}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {path}
      </svg>
    );
  };
}

export const IconCube = svg(
  <>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M3.27 6.96 12 12.01l8.73-5.05" />
    <path d="M12 22.08V12" />
  </>,
);
export const IconSearch = svg(
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </>,
);
export const IconPlus = svg(
  <>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </>,
);
export const IconMinus = svg(<path d="M5 12h14" />);
export const IconTrash = svg(
  <>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </>,
);
export const IconKeyboard = svg(
  <>
    <rect width="20" height="14" x="2" y="5" rx="2" />
    <path d="M6 9h0M10 9h0M14 9h0M18 9h0M6 13h0M18 13h0M10 13h4" />
  </>,
);
export const IconLogout = svg(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </>,
);
export const IconCheck = svg(<path d="M20 6 9 17l-5-5" />);
export const IconClose = svg(
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>,
);
export const IconBackspace = svg(
  <>
    <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
    <path d="m15 9-6 6M9 9l6 6" />
  </>,
);
export const IconShift = svg(
  <>
    <path d="m12 3 8 9h-5v7H9v-7H4l8-9z" />
  </>,
);
export const IconUser = svg(
  <>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>,
);
export const IconMail = svg(
  <>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </>,
);
export const IconLock = svg(
  <>
    <rect width="18" height="11" x="3" y="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </>,
);
export const IconShield = svg(
  <>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </>,
);
export const IconBuilding = svg(
  <>
    <rect width="16" height="20" x="4" y="2" rx="2" />
    <path d="M9 22v-4h6v4M8 6h0M16 6h0M8 10h0M16 10h0M8 14h0M16 14h0" />
  </>,
);
export const IconCart = svg(
  <>
    <circle cx="8" cy="21" r="1" />
    <circle cx="19" cy="21" r="1" />
    <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
  </>,
);
export const IconReceipt = svg(
  <>
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
    <path d="M8 7h8M8 11h8M8 15h5" />
  </>,
);
export const IconCloud = svg(
  <path d="M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 1 0 6 13.5" />,
);
export const IconCloudOff = svg(
  <>
    <path d="M17.5 19a4.5 4.5 0 0 0 1.6-8.7M9 5.6A6 6 0 0 1 18 10" />
    <path d="M6 13.5A4.5 4.5 0 0 0 7.5 19h8" />
    <path d="m2 2 20 20" />
  </>,
);
export const IconSync = svg(
  <>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </>,
);
