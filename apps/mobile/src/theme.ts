/** Paleta e espaçamentos partilhados pela app (tema escuro profissional). */
export const theme = {
  colors: {
    bg: '#0B1221',
    surface: '#131C2E',
    surfaceAlt: '#1B2740',
    border: '#26324C',
    primary: '#3B82F6',
    primaryText: '#FFFFFF',
    text: '#E6ECF5',
    muted: '#8C9CB8',
    success: '#22C55E',
    warning: '#F59E0B',
    danger: '#EF4444',
  },
  spacing: (n: number) => n * 4,
  radius: 12,
} as const;

export type Theme = typeof theme;

/** Cor associada a cada estado de encomenda. */
export function statusColor(status: string): string {
  switch (status) {
    case 'PENDING':
      return theme.colors.warning;
    case 'PAID':
      return theme.colors.primary;
    case 'SHIPPED':
      return '#A855F7';
    case 'DELIVERED':
      return theme.colors.success;
    case 'CANCELLED':
      return theme.colors.danger;
    default:
      return theme.colors.muted;
  }
}
