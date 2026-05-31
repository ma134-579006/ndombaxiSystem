import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { statusLabel } from '../format';
import { statusColor, theme } from '../theme';

// ── Cartão ───────────────────────────────────────────────────
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// ── Título de secção ─────────────────────────────────────────
export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

// ── Botão ────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'success';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  style,
}: {
  label: string;
  onPress(): void;
  variant?: ButtonVariant;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      android_ripple={{ color: '#FFFFFF22' }}
      style={({ pressed }) => [
        styles.btn,
        VARIANT_STYLE[variant],
        isDisabled && styles.btnDisabled,
        pressed && !isDisabled && styles.btnPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'ghost' ? theme.colors.text : theme.colors.primaryText} />
      ) : (
        <View style={styles.btnContent}>
          {icon ? (
            <Ionicons
              name={icon}
              size={18}
              color={variant === 'ghost' ? theme.colors.text : theme.colors.primaryText}
            />
          ) : null}
          <Text style={[styles.btnLabel, variant === 'ghost' && styles.btnLabelGhost]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ── Estado de encomenda (pill) ───────────────────────────────
export function StatusPill({ status }: { status: string }) {
  const color = statusColor(status);
  return (
    <View style={[styles.pill, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}>
      <View style={[styles.pillDot, { backgroundColor: color }]} />
      <Text style={[styles.pillText, { color }]}>{statusLabel(status)}</Text>
    </View>
  );
}

// ── Chip selecionável (filtros / intervalos) ─────────────────
export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      android_ripple={{ color: '#FFFFFF22' }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

// ── KPI ──────────────────────────────────────────────────────
export function KpiCard({
  label,
  value,
  icon,
  tone = theme.colors.primary,
  style,
}: {
  label: string;
  value: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.kpi, style]}>
      <View style={styles.kpiHeader}>
        {icon ? (
          <View style={[styles.kpiIcon, { backgroundColor: `${tone}22` }]}>
            <Ionicons name={icon} size={16} color={tone} />
          </View>
        ) : null}
        <Text style={styles.kpiLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

// ── Linha chave/valor ────────────────────────────────────────
export function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvKey}>{label}</Text>
      <Text style={styles.kvValue}>{value}</Text>
    </View>
  );
}

// ── Estado vazio / erro / carregamento ───────────────────────
export function EmptyState({
  icon = 'file-tray-outline',
  title,
  subtitle,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={42} color={theme.colors.muted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={theme.colors.primary} size="large" />
      {label ? <Text style={styles.emptySubtitle}>{label}</Text> : null}
    </View>
  );
}

// ── Banner (notificações inline) ─────────────────────────────
export function Banner({
  text,
  tone = 'info',
  icon,
}: {
  text: string;
  tone?: 'info' | 'success' | 'danger';
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const color =
    tone === 'success' ? theme.colors.success : tone === 'danger' ? theme.colors.danger : theme.colors.primary;
  return (
    <View style={[styles.banner, { backgroundColor: `${color}1F`, borderColor: `${color}55` }]}>
      <Ionicons name={icon ?? 'information-circle-outline'} size={18} color={color} />
      <Text style={[styles.bannerText, { color }]}>{text}</Text>
    </View>
  );
}

const VARIANT_STYLE: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: theme.colors.primary },
  success: { backgroundColor: theme.colors.success },
  danger: { backgroundColor: theme.colors.danger },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.border },
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 4,
  },
  sectionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  sectionHint: { color: theme.colors.muted, fontSize: 12 },
  btn: {
    height: 50,
    borderRadius: theme.radius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  btnContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnPressed: { opacity: 0.85 },
  btnDisabled: { opacity: 0.5 },
  btnLabel: { color: theme.colors.primaryText, fontSize: 15, fontWeight: '700' },
  btnLabelGhost: { color: theme.colors.text },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 6,
  },
  pillDot: { width: 7, height: 7, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '700' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { color: theme.colors.muted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: theme.colors.primaryText },
  kpi: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    minWidth: 150,
  },
  kpiHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  kpiIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  kpiLabel: { color: theme.colors.muted, fontSize: 12, fontWeight: '600', flex: 1 },
  kpiValue: { color: theme.colors.text, fontSize: 20, fontWeight: '800' },
  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    gap: 12,
  },
  kvKey: { color: theme.colors.muted, fontSize: 14 },
  kvValue: { color: theme.colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptySubtitle: { color: theme.colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: theme.radius,
    borderWidth: 1,
    padding: 12,
  },
  bannerText: { fontSize: 13, fontWeight: '600', flex: 1 },
});
