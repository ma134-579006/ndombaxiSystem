import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogProduct } from '../api/types';
import { formatKz } from '../format';

export const BRAND = 'LPS Kwanza';

/* ───────────── ícones (traço simples, desenho próprio) ───────────── */
export const P = {
  search: 'M20.71 19.29l-3.4-3.39A7.92 7.92 0 0 0 19 11a8 8 0 1 0-8 8 7.92 7.92 0 0 0 4.9-1.69l3.39 3.4a1 1 0 0 0 1.42 0 1 1 0 0 0 0-1.42zM5 11a6 6 0 1 1 6 6 6 6 0 0 1-6-6z', // eva: search-outline
  cart: 'M21.08 7a2 2 0 0 0-1.7-1H6.58L6 3.74A1 1 0 0 0 5 3H3a1 1 0 0 0 0 2h1.24L7 15.26A1 1 0 0 0 8 16h9a1 1 0 0 0 .89-.55l3.28-6.56A2 2 0 0 0 21.08 7zm-4.7 7H8.76L7.13 8h12.25zM6 19.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0zM16 19.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0z', // eva: shopping-cart-outline
  user: 'M12 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0-6a2 2 0 1 1-2 2 2 2 0 0 1 2-2zM12 13a7 7 0 0 0-7 7 1 1 0 0 0 2 0 5 5 0 0 1 10 0 1 1 0 0 0 2 0 7 7 0 0 0-7-7z', // eva: person-outline
  help: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zM12 6a3.5 3.5 0 0 0-3.5 3.5 1 1 0 0 0 2 0A1.5 1.5 0 1 1 12 11a1 1 0 0 0-1 1v2a1 1 0 0 0 2 0v-1.16A3.49 3.49 0 0 0 12 6zM11 17a1 1 0 1 0 2 0a1 1 0 1 0 -2 0z', // eva: question-mark-circle-outline
  bolt: 'M11.11 23a1 1 0 0 1-.34-.06 1 1 0 0 1-.65-1.05l.77-7.09H5a1 1 0 0 1-.83-1.56l7.89-11.8a1 1 0 0 1 1.17-.38 1 1 0 0 1 .65 1l-.77 7.14H19a1 1 0 0 1 .83 1.56l-7.89 11.8a1 1 0 0 1-.83.44zM6.87 12.8H12a1 1 0 0 1 .74.33 1 1 0 0 1 .25.78l-.45 4.15 4.59-6.86H12a1 1 0 0 1-1-1.11l.45-4.15z', // eva: flash-outline
  back: 'M13.83 19a1 1 0 0 1-.78-.37l-4.83-6a1 1 0 0 1 0-1.27l5-6a1 1 0 0 1 1.54 1.28L10.29 12l4.32 5.36a1 1 0 0 1-.78 1.64z', // eva: arrow-ios-back-outline
  next: 'M10 19a1 1 0 0 1-.64-.23 1 1 0 0 1-.13-1.41L13.71 12 9.39 6.63a1 1 0 0 1 .15-1.41 1 1 0 0 1 1.46.15l4.83 6a1 1 0 0 1 0 1.27l-5 6A1 1 0 0 1 10 19z', // eva: arrow-ios-forward-outline
  close: 'M13.41 12l4.3-4.29a1 1 0 1 0-1.42-1.42L12 10.59l-4.29-4.3a1 1 0 0 0-1.42 1.42l4.3 4.29-4.3 4.29a1 1 0 0 0 0 1.42 1 1 0 0 0 1.42 0l4.29-4.3 4.29 4.3a1 1 0 0 0 1.42 0 1 1 0 0 0 0-1.42z', // eva: close-outline
  trash: 'M21 6h-5V4.33A2.42 2.42 0 0 0 13.5 2h-3A2.42 2.42 0 0 0 8 4.33V6H3a1 1 0 0 0 0 2h1v11a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V8h1a1 1 0 0 0 0-2zM10 4.33c0-.16.21-.33.5-.33h3c.29 0 .5.17.5.33V6h-4zM18 19a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V8h12zM9 17a1 1 0 0 0 1-1v-4a1 1 0 0 0-2 0v4a1 1 0 0 0 1 1zM15 17a1 1 0 0 0 1-1v-4a1 1 0 0 0-2 0v4a1 1 0 0 0 1 1z', // eva: trash-2-outline
  check: 'M9.86 18a1 1 0 0 1-.73-.32l-4.86-5.17a1 1 0 1 1 1.46-1.37l4.12 4.39 8.41-9.2a1 1 0 1 1 1.48 1.34l-9.14 10a1 1 0 0 1-.73.33z', // eva: checkmark-outline
  filter: 'M13.9 22a1 1 0 0 1-.6-.2l-4-3.05a1 1 0 0 1-.39-.8v-3.27l-4.8-9.22A1 1 0 0 1 5 4h14a1 1 0 0 1 .86.49 1 1 0 0 1 0 1l-5 9.21V21a1 1 0 0 1-.55.9 1 1 0 0 1-.41.1zm-3-4.54l2 1.53v-4.55A1 1 0 0 1 13 14l4.3-8H6.64l4.13 8a1 1 0 0 1 .11.46z', // eva: funnel-outline
  out: 'M7 6a1 1 0 0 0 0-2H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h2a1 1 0 0 0 0-2H6V6zM20.82 11.42l-2.82-4a1 1 0 0 0-1.39-.24 1 1 0 0 0-.24 1.4L18.09 11H10a1 1 0 0 0 0 2h8l-1.8 2.4a1 1 0 0 0 .2 1.4 1 1 0 0 0 .6.2 1 1 0 0 0 .8-.4l3-4a1 1 0 0 0 .02-1.18z', // eva: log-out-outline
  grid: 'M9 3H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM5 9V5h4v4zM19 3h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-4 6V5h4v4zM9 13H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2zm-4 6v-4h4v4zM19 13h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2zm-4 6v-4h4v4z', // eva: grid-outline
  mail: 'M19 4H5a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zm-.67 2L12 10.75 5.67 6zM19 18H5a1 1 0 0 1-1-1V7.25l7.4 5.55a1 1 0 0 0 .6.2 1 1 0 0 0 .6-.2L20 7.25V17a1 1 0 0 1-1 1z', // eva: email-outline
  phone: 'M17.4 22A15.42 15.42 0 0 1 2 6.6 4.6 4.6 0 0 1 6.6 2a3.94 3.94 0 0 1 .77.07 3.79 3.79 0 0 1 .72.18 1 1 0 0 1 .65.75l1.37 6a1 1 0 0 1-.26.92c-.13.14-.14.15-1.37.79a9.91 9.91 0 0 0 4.87 4.89c.65-1.24.66-1.25.8-1.38a1 1 0 0 1 .92-.26l6 1.37a1 1 0 0 1 .72.65 4.34 4.34 0 0 1 .19.73 4.77 4.77 0 0 1 .06.76A4.6 4.6 0 0 1 17.4 22zM6.6 4A2.61 2.61 0 0 0 4 6.6 13.41 13.41 0 0 0 17.4 20a2.61 2.61 0 0 0 2.6-2.6v-.33L15.36 16l-.29.55c-.45.87-.78 1.5-1.62 1.16a11.85 11.85 0 0 1-7.18-7.21c-.36-.78.32-1.14 1.18-1.59L8 8.64 6.93 4z', // eva: phone-outline
  bag: 'M20.12 6.71l-2.83-2.83A3 3 0 0 0 15.17 3H8.83a3 3 0 0 0-2.12.88L3.88 6.71A3 3 0 0 0 3 8.83V18a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V8.83a3 3 0 0 0-.88-2.12zm-12-1.42A1.05 1.05 0 0 1 8.83 5h6.34a1.05 1.05 0 0 1 .71.29L17.59 7H6.41zM18 19H6a1 1 0 0 1-1-1V9h14v9a1 1 0 0 1-1 1zM15 11a1 1 0 0 0-1 1 2 2 0 0 1-4 0 1 1 0 0 0-2 0 4 4 0 0 0 8 0 1 1 0 0 0-1-1z', // eva: shopping-bag-outline
  doc: 'M15 16H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2zM9 14h3a1 1 0 0 0 0-2H9a1 1 0 0 0 0 2zM19.74 8.33l-5.44-6a1 1 0 0 0-.74-.33h-7A2.53 2.53 0 0 0 4 4.5v15A2.53 2.53 0 0 0 6.56 22h10.88A2.53 2.53 0 0 0 20 19.5V9a1 1 0 0 0-.26-.67zM14 5l2.74 3h-2a.79.79 0 0 1-.74-.85zm3.44 15H6.56a.53.53 0 0 1-.56-.5v-15a.53.53 0 0 1 .56-.5H12v3.15A2.79 2.79 0 0 0 14.71 10H18v9.5a.53.53 0 0 1-.56.5z', // eva: file-text-outline
  info: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zM11 8a1 1 0 1 0 2 0a1 1 0 1 0 -2 0zM12 10a1 1 0 0 0-1 1v5a1 1 0 0 0 2 0v-5a1 1 0 0 0-1-1z', // eva: info-outline
  star: 'M17.56 21a1 1 0 0 1-.46-.11L12 18.22l-5.1 2.67a1 1 0 0 1-1.45-1.06l1-5.63-4.12-4a1 1 0 0 1-.25-1 1 1 0 0 1 .81-.68l5.7-.83 2.51-5.13a1 1 0 0 1 1.8 0l2.54 5.12 5.7.83a1 1 0 0 1 .81.68 1 1 0 0 1-.25 1l-4.12 4 1 5.63a1 1 0 0 1-.4 1 1 1 0 0 1-.62.18zM12 16.1a.92.92 0 0 1 .46.11l3.77 2-.72-4.21a1 1 0 0 1 .29-.89l3-2.93-4.2-.62a1 1 0 0 1-.71-.56L12 5.25 10.11 9a1 1 0 0 1-.75.54l-4.2.62 3 2.93a1 1 0 0 1 .29.89l-.72 4.16 3.77-2a.92.92 0 0 1 .5-.04z', // eva: star-outline
  heart: 'M12 21a1 1 0 0 1-.71-.29l-7.77-7.78a5.26 5.26 0 0 1 0-7.4 5.24 5.24 0 0 1 7.4 0L12 6.61l1.08-1.08a5.24 5.24 0 0 1 7.4 0 5.26 5.26 0 0 1 0 7.4l-7.77 7.78A1 1 0 0 1 12 21zM7.22 6a3.2 3.2 0 0 0-2.28.94 3.24 3.24 0 0 0 0 4.57L12 18.58l7.06-7.07a3.24 3.24 0 0 0 0-4.57 3.32 3.32 0 0 0-4.56 0l-1.79 1.8a1 1 0 0 1-1.42 0L9.5 6.94A3.2 3.2 0 0 0 7.22 6z', // eva: heart-outline
  truck: 'M21.6 11.22L17 7.52V5a1.91 1.91 0 0 0-1.81-2H3.79A1.91 1.91 0 0 0 2 5v10a2 2 0 0 0 1.2 1.88 3 3 0 1 0 5.6.12h6.36a3 3 0 1 0 5.64 0h.2a1 1 0 0 0 1-1v-4a1 1 0 0 0-.4-.78zM20 12.48V15h-3v-4.92zM7 18a1 1 0 1 1-1-1 1 1 0 0 1 1 1zm5-3H4V5h11v10zm7 3a1 1 0 1 1-1-1 1 1 0 0 1 1 1z', // eva: car-outline
  shield: 'M12 21.85a2 2 0 0 1-1-.25l-.3-.17A15.17 15.17 0 0 1 3 8.23v-.14a2 2 0 0 1 1-1.75l7-3.94a2 2 0 0 1 2 0l7 3.94a2 2 0 0 1 1 1.75v.14a15.17 15.17 0 0 1-7.72 13.2l-.3.17a2 2 0 0 1-.98.25zm0-17.7L5 8.09v.14a13.15 13.15 0 0 0 6.7 11.45l.3.17.3-.17A13.15 13.15 0 0 0 19 8.23v-.14z', // eva: shield-outline
  flag: 'M19.27 4.68a1.79 1.79 0 0 0-1.6-.25 7.53 7.53 0 0 1-2.17.28 8.54 8.54 0 0 1-3.13-.78A10.15 10.15 0 0 0 8.5 3c-2.89 0-4 1-4.2 1.14a1 1 0 0 0-.3.72V20a1 1 0 0 0 2 0v-4.3a6.28 6.28 0 0 1 2.5-.41 8.54 8.54 0 0 1 3.13.78 10.15 10.15 0 0 0 3.87.93 7.66 7.66 0 0 0 3.5-.7 1.74 1.74 0 0 0 1-1.55V6.11a1.77 1.77 0 0 0-.73-1.43zM18 14.59a6.32 6.32 0 0 1-2.5.41 8.36 8.36 0 0 1-3.13-.79 10.34 10.34 0 0 0-3.87-.92 9.51 9.51 0 0 0-2.5.29V5.42A6.13 6.13 0 0 1 8.5 5a8.36 8.36 0 0 1 3.13.79 10.34 10.34 0 0 0 3.87.92 9.41 9.41 0 0 0 2.5-.3z', // eva: flag-outline
  like: 'M7 11v10H3V11zM7 11l4-8a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 21H7',
  dislike: 'M17 13V3h4v10zM17 13l-4 8a2 2 0 0 1-3-2l1-5H5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.2 3H17',
  chat: 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0zM15 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0zM7 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0zM19.07 4.93a10 10 0 0 0-16.28 11 1.06 1.06 0 0 1 .09.64L2 20.8a1 1 0 0 0 .27.91A1 1 0 0 0 3 22h.2l4.28-.86a1.26 1.26 0 0 1 .64.09 10 10 0 0 0 11-16.28zm.83 8.36a8 8 0 0 1-11 6.08 3.26 3.26 0 0 0-1.25-.26 3.43 3.43 0 0 0-.56.05l-2.82.57.57-2.82a3.09 3.09 0 0 0-.21-1.81 8 8 0 0 1 6.08-11 8 8 0 0 1 9.19 9.19z', // eva: message-circle-outline
  pin: 'M12 2a8 8 0 0 0-8 7.92c0 5.48 7.05 11.58 7.35 11.84a1 1 0 0 0 1.3 0C13 21.5 20 15.4 20 9.92A8 8 0 0 0 12 2zm0 17.65c-1.67-1.59-6-6-6-9.73a6 6 0 0 1 12 0c0 3.7-4.33 8.14-6 9.73zM12 6a3.5 3.5 0 1 0 3.5 3.5A3.5 3.5 0 0 0 12 6zm0 5a1.5 1.5 0 1 1 1.5-1.5A1.5 1.5 0 0 1 12 11z', // eva: pin-outline
  card: 'M19 5H5a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V8a3 3 0 0 0-3-3zM4 8a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v1H4zm16 8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5h16zM7 15h4a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2zM15 15h2a1 1 0 0 0 0-2h-2a1 1 0 0 0 0 2z', // eva: credit-card-outline
  box: 'M20.66 7.26c0-.07-.1-.14-.15-.21l-.09-.1a2.5 2.5 0 0 0-.86-.68l-6.4-3a2.7 2.7 0 0 0-2.26 0l-6.4 3a2.6 2.6 0 0 0-.86.68L3.52 7a1 1 0 0 0-.15.2A2.39 2.39 0 0 0 3 8.46v7.06a2.49 2.49 0 0 0 1.46 2.26l6.4 3a2.7 2.7 0 0 0 2.27 0l6.4-3A2.49 2.49 0 0 0 21 15.54V8.46a2.39 2.39 0 0 0-.34-1.2zm-8.95-2.2a.73.73 0 0 1 .58 0l5.33 2.48L12 10.15 6.38 7.54zM5.3 16a.47.47 0 0 1-.3-.43V9.1l6 2.79v6.72zm13.39 0L13 18.61v-6.72l6-2.79v6.44a.48.48 0 0 1-.31.46z', // eva: cube-outline
  clock: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zM16 11h-3V8a1 1 0 0 0-2 0v4a1 1 0 0 0 1 1h4a1 1 0 0 0 0-2z', // eva: clock-outline
  share: 'M18 15a3 3 0 0 0-2.1.86L8 12.34V12v-.33l7.9-3.53A3 3 0 1 0 15 6v.34L7.1 9.86a3 3 0 1 0 0 4.28l7.9 3.53V18a3 3 0 1 0 3-3zm0-10a1 1 0 1 1-1 1 1 1 0 0 1 1-1zM5 13a1 1 0 1 1 1-1 1 1 0 0 1-1 1zm13 6a1 1 0 1 1 1-1 1 1 0 0 1-1 1z', // eva: share-outline
  eye: 'M21.87 11.5c-.64-1.11-4.16-6.68-10.14-6.5-5.53.14-8.73 5-9.6 6.5a1 1 0 0 0 0 1c.63 1.09 4 6.5 9.89 6.5h.25c5.53-.14 8.74-5 9.6-6.5a1 1 0 0 0 0-1zM12.22 17c-4.31.1-7.12-3.59-8-5 1-1.61 3.61-4.9 7.61-5 4.29-.11 7.11 3.59 8 5-1.03 1.61-3.61 4.9-7.61 5zM12 8.5a3.5 3.5 0 1 0 3.5 3.5A3.5 3.5 0 0 0 12 8.5zm0 5a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5z', // eva: eye-outline
  globe: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 2a8.19 8.19 0 0 1 1.79.21 2.61 2.61 0 0 1-.78 1c-.22.17-.46.31-.7.46a4.56 4.56 0 0 0-1.85 1.67 6.49 6.49 0 0 0-.62 3.3c0 1.36 0 2.16-.95 2.87-1.37 1.07-3.46.47-4.76-.07A8.33 8.33 0 0 1 4 12a8 8 0 0 1 8-8zM5 15.8a8.42 8.42 0 0 0 2 .27 5 5 0 0 0 3.14-1c1.71-1.34 1.71-3.06 1.71-4.44a4.76 4.76 0 0 1 .37-2.34 2.86 2.86 0 0 1 1.12-.91 9.75 9.75 0 0 0 .92-.61 4.55 4.55 0 0 0 1.4-1.87A8 8 0 0 1 19 8.12c-1.43.2-3.46.67-3.86 2.53A7 7 0 0 0 15 12a2.93 2.93 0 0 1-.29 1.47l-.1.17c-.65 1.08-1.38 2.31-.39 4 .12.21.25.41.38.61a2.29 2.29 0 0 1 .52 1.08A7.89 7.89 0 0 1 12 20a8 8 0 0 1-7-4.2zm11.93 2.52a6.79 6.79 0 0 0-.63-1.14c-.11-.16-.22-.32-.32-.49-.39-.68-.25-1 .38-2l.1-.17a4.77 4.77 0 0 0 .54-2.43 5.42 5.42 0 0 1 .09-1c.16-.73 1.71-.93 2.67-1a7.94 7.94 0 0 1-2.86 8.28z', // eva: globe-2-outline
  up: 'M18 15a1 1 0 0 1-.64-.23L12 10.29l-5.37 4.32a1 1 0 0 1-1.41-.15 1 1 0 0 1 .15-1.41l6-4.83a1 1 0 0 1 1.27 0l6 5a1 1 0 0 1 .13 1.41A1 1 0 0 1 18 15z', // eva: arrow-ios-upward-outline
  down: 'M12 16a1 1 0 0 1-.64-.23l-6-5a1 1 0 1 1 1.28-1.54L12 13.71l5.36-4.32a1 1 0 0 1 1.41.15 1 1 0 0 1-.14 1.46l-6 4.83A1 1 0 0 1 12 16z', // eva: arrow-ios-downward-outline
};
/** Desenhos em traço (sem equivalente no Eva Icons). */
const STROKE = new Set<string>([P.like, P.dislike]);
/** Ícone: Eva Icons (MIT, akveo — o conjunto do Vendus), preenchido; os poucos sem equivalente em traço. */
export const I = ({ d, size = 20 }: { d: string; size?: number }) => (
  STROKE.has(d)
    ? <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
    : <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={d} /></svg>
);

/** Marca da LPS Kwanza: um "K" próprio (geométrico) num quadrado arredondado. */
export function Mark({ size = 34, inverse = false }: { size?: number; inverse?: boolean }) {
  // inverse = K branco em azul (ícone da app, carregamento); por omissão K azul em branco (cabeçalho).
  const bg = inverse ? 'url(#mk-b)' : '#ffffff';
  const fg = inverse ? '#ffffff' : 'url(#mk-b)';
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs><linearGradient id="mk-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3b5bff" /><stop offset="1" stopColor="#1424b8" /></linearGradient></defs>
      <rect width="40" height="40" rx="10" fill={bg} />
      <path d={K_PATH} fill={fg} />
    </svg>
  );
}
/** Desenho do K (o mesmo no logótipo, no carregamento e no ícone das apps). */
export const K_PATH = 'M9.5 8.5h5.6v9.2l8-9.2h6.9l-8.9 9.8 9.5 13.2h-6.9l-6.5-9.4-2.1 2.3v7.1H9.5z';

/** Carregamento do LPS Kwanza: o K desenha-se em contorno sobre uma camada translúcida. */
export function KLoader({ overlay = true, label = 'A carregar' }: { overlay?: boolean; label?: string }) {
  return (
    <div className={overlay ? 'kk-loading' : 'kk-loading inline'} role="status" aria-live="polite" aria-label={label}>
      <svg className="kk-loading-k" viewBox="0 0 40 40" width="70" height="70" aria-hidden="true">
        <defs><linearGradient id="kk-lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5b7bff" /><stop offset="1" stopColor="#1424b8" /></linearGradient></defs>
        <rect className="kk-loading-sq" x="2" y="2" width="36" height="36" rx="9" pathLength="100" />
        <path className="kk-loading-path" d={K_PATH} pathLength="100" />
      </svg>
    </div>
  );
}

export const pct = (p: CatalogProduct): number =>
  p.promo?.percent ?? (p.listPrice && p.listPrice > p.grossPrice ? Math.round((1 - p.grossPrice / p.listPrice) * 100) : 0);
export const kz = (n: number | string) => formatKz(n).replace(/,00 Kz$/, ' Kz');
export const canBuy = (p: CatalogProduct) => p.inStock || !!p.madeToOrder;

export function Pic({ p, className = '' }: { p: CatalogProduct; className?: string }) {
  const [broken, setBroken] = useState(false);
  return p.imageUrl && !broken
    ? <img className={`kw-pic ${className}`} src={p.imageUrl} alt={p.name} loading="lazy" onError={() => setBroken(true)} />
    : <div className={`kw-pic kw-pic-ph ${className}`} aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</div>;
}

/* ───────────── cartão de produto (desenho do Kikolo, cor da marca azul) ───────────── */
export function Card({ p, onOpen, onAdd, cod, hot }: { p: CatalogProduct; onOpen(): void; onAdd(): void; cod: boolean; hot?: boolean }) {
  const d = pct(p);
  const ok = canBuy(p);
  return (
    <article className="kw-card">
      <div className="kw-card-img">
        <button className="kw-card-imgbtn" onClick={onOpen} aria-label={p.name} tabIndex={-1}><Pic p={p} /></button>
        <button className="kw-card-cart" onClick={onAdd} disabled={!ok} aria-label={`Adicionar ${p.name} ao carrinho`}><I d={P.cart} size={16} /></button>
        {(p.views ?? 0) > 0 ? <span className="kw-card-sold" title="Visualizações"><I d={P.eye} size={13} />{p.views}</span> : null}
        {hot ? <span className="kw-card-hot">Em alta</span> : null}
        {cod ? <span className="kw-card-pay"><i aria-hidden="true" />Pagamento na entrega</span> : null}
        {d > 0 ? <span className="kw-card-off">-{d}%</span> : null}
      </div>
      <button className="kw-card-body" onClick={onOpen}>
        <h3>{p.name}</h3>
        <div className="kw-card-prices">
          {d > 0 && p.listPrice ? <span className="kw-card-old"><s>{kz(p.listPrice)}</s></span> : null}
          <b>{kz(p.grossPrice)}</b>
        </div>
        <div className="kw-card-ship">
          <span className={`kw-card-tag${ok ? '' : ' out'}`}>{ok ? 'Disponível ⚡' : 'Esgotado'}</span>
          {ok ? <small>{p.stockQty != null && !p.madeToOrder && p.stockQty <= 10 ? <>Restam <b>{Math.floor(p.stockQty)}</b></> : <>Pronto para <b>envio</b></>}</small> : null}
        </div>
      </button>
    </article>
  );
}

/** Esqueleto enquanto o catálogo chega (brilho a passar). */
export function CardSkeleton() {
  return <div className="kw-card kw-skel" aria-hidden="true"><div className="kw-card-img" /><div className="kw-skel-l" /><div className="kw-skel-l s" /></div>;
}

/* ───────────── prateleira horizontal com setas (scroll-snap) ───────────── */
export function Shelf({ title, action, items, render, head, icon, className = '' }: {
  title: React.ReactNode; action?: React.ReactNode; items: CatalogProduct[]; render(p: CatalogProduct): React.ReactNode;
  head?: React.ReactNode; icon?: React.ReactNode; className?: string;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState({ l: true, r: false });
  const upd = useCallback(() => {
    const t = track.current; if (!t) return;
    setEdge({ l: t.scrollLeft <= 4, r: t.scrollLeft + t.clientWidth >= t.scrollWidth - 4 });
  }, []);
  useEffect(() => { upd(); }, [items, upd]);
  const go = (dir: number) => { const t = track.current; if (t) t.scrollBy({ left: dir * t.clientWidth * 0.9, behavior: 'smooth' }); };
  if (!items.length) return null;
  const label = typeof title === 'string' ? title : '';
  return (
    <section className={`kw-sec kw-reveal ${className}`}>
      {head ?? <header className="kw-sec-head"><h2>{icon}{title}</h2>{action}</header>}
      <div className="kw-shelf">
        <button className="kw-arrow l" onClick={() => go(-1)} disabled={edge.l} aria-label={`Ver os produtos anteriores de ${label}`}><I d={P.back} size={18} /></button>
        <div className="kw-shelf-track" ref={track} onScroll={upd}>
          {items.map((p) => <div className="kw-shelf-item" key={p.code}>{render(p)}</div>)}
        </div>
        <button className="kw-arrow r" onClick={() => go(1)} disabled={edge.r} aria-label={`Ver mais produtos de ${label}`}><I d={P.next} size={18} /></button>
      </div>
    </section>
  );
}

/* ───────────── carrossel de anúncios (desliza a cada 4 s, setas e pontos) ───────────── */
export interface Slide { id: string; title: string; subtitle?: string | null; image?: string | null; cta?: string | null; tone: number; onClick?: () => void }

export function Carousel({ slides, className = '', interval = 4000 }: { slides: Slide[]; className?: string; interval?: number }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const touch = useRef<number | null>(null);
  const n = slides.length;
  useEffect(() => { if (i >= n) setI(0); }, [n, i]);
  useEffect(() => {
    if (n < 2 || paused) return;
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % n), interval);
    return () => window.clearInterval(t);
  }, [n, paused, interval]);
  if (!n) return null;
  return (
    <div className={`kw-car ${className}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; setPaused(true); }}
      onTouchEnd={(e) => {
        const s = touch.current; touch.current = null; setPaused(false);
        if (s == null) return; const dx = e.changedTouches[0].clientX - s;
        if (Math.abs(dx) > 40) setI((x) => (x + (dx < 0 ? 1 : -1) + n) % n);
      }}>
      <div className="kw-car-track" style={{ transform: `translateX(-${i * 100}%)` }}>
        {slides.map((s, k) => (
          <button key={s.id} className={`kw-slide tone-${s.tone % 4}`} onClick={s.onClick} aria-hidden={k !== i} tabIndex={k === i ? 0 : -1}>
            {s.image ? <img src={s.image} alt="" loading={k === 0 ? 'eager' : 'lazy'} /> : null}
            <span className="kw-slide-txt">
              <strong>{s.title}</strong>
              {s.subtitle ? <small>{s.subtitle}</small> : null}
              {s.cta ? <em>{s.cta}</em> : null}
            </span>
          </button>
        ))}
      </div>
      {n > 1 ? (
        <>
          <div className="kw-car-arrows">
            <button className="kw-car-nav" onClick={() => setI((x) => (x - 1 + n) % n)} aria-label="Slide anterior"><I d={P.back} size={18} /></button>
            <button className="kw-car-nav" onClick={() => setI((x) => (x + 1) % n)} aria-label="Próximo slide"><I d={P.next} size={18} /></button>
          </div>
          <div className="kw-car-dots">
            {slides.map((s, k) => <button key={s.id} className={k === i ? 'on' : ''} onClick={() => setI(k)} aria-label={`Ir para slide ${k + 1}`} />)}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ───────────── contagem decrescente ───────────── */
export function useCountdown(endsAt: string | null): [string, string, string] | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!endsAt) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [endsAt]);
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const z = (v: number) => String(v).padStart(2, '0');
  return [z(Math.min(99, Math.floor(s / 3600))), z(Math.floor((s % 3600) / 60)), z(s % 60)];
}

/* ───────────── revelar secções ao fazer scroll ───────────── */
export function useReveal(dep: unknown) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.kw-reveal:not(.in)'));
    if (!els.length) return;
    // Sem IntersectionObserver (navegadores antigos) ou com movimento reduzido: tudo visível logo.
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof IntersectionObserver === 'undefined' || reduce) { els.forEach((e) => e.classList.add('in')); return; }
    // Entra UMA vez (rolar para cima não volta a esconder) e os blocos que entram juntos escalonam-se.
    let k = 0; let t = 0;
    const show = (el: HTMLElement) => {
      if (el.classList.contains('in')) return;
      el.style.setProperty('--rv', `${Math.min(k++, 6) * 60}ms`);
      el.classList.add('in');
      io.unobserve(el);
      window.clearTimeout(t); t = window.setTimeout(() => { k = 0; }, 120);
    };
    const io = new IntersectionObserver((entries) => { entries.forEach((en) => { if (en.isIntersecting) show(en.target as HTMLElement); }); }, { rootMargin: '0px 0px -6% 0px', threshold: 0.01 });
    els.forEach((e) => io.observe(e));
    // Garantia: o que já está no ecrã nunca fica escondido (observador atrasado, separador em segundo plano).
    let raf = 0;
    const check = () => { raf = 0; const h = window.innerHeight; for (const el of els) { if (el.classList.contains('in')) continue; const r = el.getBoundingClientRect(); if (r.top < h * 0.96 && r.bottom > 0) show(el); } };
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(check); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const first = window.setTimeout(check, 60);
    return () => { io.disconnect(); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); window.clearTimeout(first); window.clearTimeout(t); if (raf) window.cancelAnimationFrame(raf); };
  }, [dep]);
}

/* ───────────── carregamento infinito ───────────── */
export function useInfinite(total: number, step = 20, reset: unknown = null): [number, React.RefObject<HTMLDivElement>] {
  const [n, setN] = useState(step);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => { setN(step); }, [reset, step]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || n >= total) return;
    if (typeof IntersectionObserver === 'undefined') { setN(total); return; }
    const io = new IntersectionObserver((en) => { if (en[0].isIntersecting) setN((x) => Math.min(total, x + step)); }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [n, total, step]);
  return [Math.min(n, total), sentinel];
}

/* ───────────── vistos recentemente (só neste aparelho) ───────────── */
const RV = (code: string) => `ndombaxi.kw.recent.${code}`;
export function readRecent(code: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(RV(code)) || '[]'); return Array.isArray(v) ? v.slice(0, 20) : []; } catch { return []; }
}
export function pushRecent(code: string, productCode: string) {
  try { localStorage.setItem(RV(code), JSON.stringify([productCode, ...readRecent(code).filter((c) => c !== productCode)].slice(0, 20))); } catch { /* indisponível */ }
}
