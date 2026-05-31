import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError } from '../api/client';
import type {
  LowStockItem,
  SalesRange,
  SalesSeries,
  SalesSeriesPoint,
  SalesSummary,
  TopProduct,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ScreenBackground } from '../components/Background';
import { FooterCredit } from '../components/Brand';
import { Banner, Card, Chip, EmptyState, KeyValue, KpiCard, Loading, SectionTitle } from '../components/ui';
import { formatKz, formatNumber } from '../format';
import { useRealtime } from '../realtime/useRealtime';
import { theme } from '../theme';

const RANGES: { key: SalesRange; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: '7d', label: '7 dias' },
  { key: '1m', label: '1 mês' },
  { key: '3m', label: '3 meses' },
  { key: '6m', label: '6 meses' },
  { key: '1y', label: '1 ano' },
];

const ROLE_LABELS: Record<string, string> = {
  COMPANY_ADMIN: 'Administrador',
  STORE_MANAGER: 'Gestor de loja',
  SHIFT_SUPERVISOR: 'Supervisor',
  CASHIER: 'Operador de caixa',
  ATTENDANT: 'Atendedor',
};

function MiniBars({ points }: { points: SalesSeriesPoint[] }) {
  if (!points.length) {
    return <Text style={styles.chartEmpty}>Sem vendas neste período.</Text>;
  }
  const max = Math.max(...points.map((p) => p.grossTotal), 1);
  return (
    <View style={styles.chart}>
      {points.map((p, i) => {
        const h = Math.max(4, (p.grossTotal / max) * 120);
        return (
          <View key={`${p.bucket}-${i}`} style={styles.barSlot}>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { height: h }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function DashboardScreen() {
  const { user, accessToken } = useAuth();

  const [today, setToday] = useState<SalesSummary | null>(null);
  const [series, setSeries] = useState<SalesSeries | null>(null);
  const [top, setTop] = useState<TopProduct[]>([]);
  const [low, setLow] = useState<LowStockItem[]>([]);
  const [range, setRange] = useState<SalesRange>('7d');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<string | null>(null);

  const rangeRef = useRef<SalesRange>(range);
  rangeRef.current = range;

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [t, s, tp, ls] = await Promise.all([
        api.dashboard.salesToday(),
        api.dashboard.salesSeries(rangeRef.current),
        api.dashboard.topProducts(5),
        api.dashboard.lowStock(),
      ]);
      setToday(t);
      setSeries(s);
      setTop(tp);
      setLow(ls);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar o painel.');
    }
  }, []);

  const loadSeries = useCallback(async (r: SalesRange) => {
    try {
      setSeries(await api.dashboard.salesSeries(r));
    } catch {
      // mantém a série anterior em caso de falha pontual
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadAll();
      setLoading(false);
    })();
  }, [loadAll]);

  const connected = useRealtime(accessToken, {
    onSale: (e) => {
      setLastSale(`Nova venda ${e.number} · ${formatKz(e.grossTotal)}`);
      void loadAll();
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const onPickRange = (r: SalesRange) => {
    setRange(r);
    void loadSeries(r);
  };

  return (
    <ScreenBackground glow={false}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text style={styles.hello}>Painel</Text>
            <Text style={styles.role}>
              {user?.role ? ROLE_LABELS[user.role] ?? user.role : 'Equipa'}
            </Text>
          </View>
          <View style={[styles.live, connected ? styles.liveOn : styles.liveOff]}>
            <View style={[styles.liveDot, { backgroundColor: connected ? theme.colors.success : theme.colors.muted }]} />
            <Text style={styles.liveText}>{connected ? 'Em directo' : 'Offline'}</Text>
          </View>
        </View>

        {loading ? (
          <Loading label="A carregar o painel…" />
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
            }
          >
            {error ? <Banner text={error} tone="danger" icon="cloud-offline-outline" /> : null}
            {lastSale ? <Banner text={lastSale} tone="success" icon="cash-outline" /> : null}

            <View style={styles.kpiGrid}>
              <KpiCard label="Vendas hoje" value={formatKz(today?.grossTotal ?? 0)} icon="trending-up-outline" tone={theme.colors.success} />
              <KpiCard label="Facturas" value={formatNumber(today?.invoiceCount ?? 0)} icon="receipt-outline" />
            </View>
            <View style={styles.kpiGrid}>
              <KpiCard label="IVA do dia" value={formatKz(today?.ivaTotal ?? 0)} icon="calculator-outline" tone={theme.colors.warning} />
              <KpiCard label="Ticket médio" value={formatKz(today?.averageTicket ?? 0)} icon="pricetag-outline" tone="#A855F7" />
            </View>

            <Card style={styles.block}>
              <SectionTitle hint={series ? `${formatKz(series.summary.grossTotal)} no período` : undefined}>
                Evolução de vendas
              </SectionTitle>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRow}
              >
                {RANGES.map((r) => (
                  <Chip key={r.key} label={r.label} active={range === r.key} onPress={() => onPickRange(r.key)} />
                ))}
              </ScrollView>
              <MiniBars points={series?.points ?? []} />
            </Card>

            <Card style={styles.block}>
              <SectionTitle>Produtos mais vendidos</SectionTitle>
              {top.length === 0 ? (
                <EmptyState icon="bag-outline" title="Ainda sem vendas" subtitle="Os produtos aparecem aqui assim que houver facturação." />
              ) : (
                top.map((p, i) => (
                  <View key={p.productCode} style={styles.rankRow}>
                    <Text style={styles.rankNum}>{i + 1}</Text>
                    <View style={styles.flex}>
                      <Text style={styles.rankName} numberOfLines={1}>
                        {p.description || p.productCode}
                      </Text>
                      <Text style={styles.rankSub}>
                        {formatNumber(p.quantity, 0)} un · {p.productCode}
                      </Text>
                    </View>
                    <Text style={styles.rankValue}>{formatKz(p.grossTotal)}</Text>
                  </View>
                ))
              )}
            </Card>

            <Card style={styles.block}>
              <SectionTitle hint={low.length ? `${low.length} alerta(s)` : undefined}>
                Stock baixo
              </SectionTitle>
              {low.length === 0 ? (
                <EmptyState icon="checkmark-circle-outline" title="Stock saudável" subtitle="Nenhum produto abaixo do mínimo." />
              ) : (
                low.slice(0, 8).map((s) => (
                  <KeyValue
                    key={`${s.productCode}-${s.warehouseCode}`}
                    label={`${s.productName} (${s.warehouseCode})`}
                    value={`${formatNumber(s.quantity)} / mín ${formatNumber(s.minQty)}`}
                  />
                ))
              )}
            </Card>

            <FooterCredit style={styles.credit} />
            <View style={styles.bottomPad} />
          </ScrollView>
        )}
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  hello: { color: theme.colors.text, fontSize: 26, fontWeight: '900' },
  role: { color: theme.colors.muted, fontSize: 13, marginTop: 2 },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  liveOn: { borderColor: `${theme.colors.success}55`, backgroundColor: `${theme.colors.success}1A` },
  liveOff: { borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  liveDot: { width: 8, height: 8, borderRadius: 999 },
  liveText: { color: theme.colors.muted, fontSize: 12, fontWeight: '600' },
  scroll: { paddingHorizontal: 16, gap: 12, paddingTop: 4 },
  kpiGrid: { flexDirection: 'row', gap: 12 },
  block: { marginTop: 0 },
  chipsRow: { gap: 8, paddingVertical: 8, paddingRight: 8 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 128, marginTop: 8, gap: 3 },
  barSlot: { flex: 1, alignItems: 'center' },
  barTrack: { height: 120, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  bar: { width: '64%', minWidth: 5, borderRadius: 4, backgroundColor: theme.colors.primary },
  chartEmpty: { color: theme.colors.muted, fontSize: 13, paddingVertical: 24, textAlign: 'center' },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rankNum: { color: theme.colors.muted, fontSize: 15, fontWeight: '800', width: 18, textAlign: 'center' },
  rankName: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  rankSub: { color: theme.colors.muted, fontSize: 12, marginTop: 1 },
  rankValue: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  credit: { marginTop: 14 },
  bottomPad: { height: 24 },
});
