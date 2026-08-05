/**
 * @nexus/ui — Design System único do Ndombaxi System.
 *
 * Um só sítio para botões, campos, cartões, tabelas, diálogos,
 * avisos e estados. Consumido por Web, Caixa e Loja — e portanto,
 * pelos invólucros Desktop (Electron) e Android (Capacitor), que
 * carregam exactamente os mesmos bundles.
 *
 * Regra: nenhuma app volta a definir um botão ou um input seus.
 * Falta alguma variante? Acrescenta-se AQUI, e as três recebem-na.
 */
export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Input, Select, Textarea } from './Field';
export type { InputProps, SelectProps, TextareaProps } from './Field';

export { Card, KpiCard } from './Card';
export type { CardProps, KpiCardProps } from './Card';

export { Dialog } from './Dialog';
export type { DialogProps } from './Dialog';

export { Badge, Skeleton, EmptyState, Spinner, ToastProvider, useToast } from './Feedback';
export type { BadgeProps, SkeletonProps, EmptyStateProps, ToastItem, Tone } from './Feedback';

export { DataTable } from './DataTable';
export type { DataTableProps, Column } from './DataTable';

export { Tabs, TabPanel } from './Tabs';
export type { TabsProps, TabDef } from './Tabs';
