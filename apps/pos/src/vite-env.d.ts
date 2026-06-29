/// <reference types="vite/client" />

// A lib `qrcode` não traz tipos próprios e não há @types/qrcode instalado — sem
// isto o `tsc --noEmit` falha (TS7016). Declaração ambiente mínima (o uso real é
// QRCode.toDataURL, já tipado como any aqui). Não afeta o runtime/build.
declare module 'qrcode';
