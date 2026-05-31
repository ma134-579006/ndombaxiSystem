import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError } from '../api/client';
import type { WebOrder } from '../api/types';
import { ScreenBackground } from '../components/Background';
import { Banner, Chip, EmptyState, Loading, StatusPill } from '../components/ui';
import { formatDateTime, formatKz, statusLabel } from '../format';
import type { OrdersStackParamList } from '../navigation/types';
import { theme } from '../theme';

const FILTERS = ['Todas', 'PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const;
type Filter = (typeof FILTERS)[number];

export function OrdersScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<OrdersStackParamList, 'OrdersList'>>();
  const [orders, setOrders] = useState<WebOrder[]>([]);
  const [filter, setFilter] = useState<Filter>('Todas');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setOrders(await api.orders.list());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar encomendas.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        setLoading(true);
        await load();
        if (alive) setLoading(false);
      })();
      return () => {
        alive = false;
      };
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const visible = filter === 'Todas' ? orders : orders.filter((o) => o.status === filter);

  return (
    <ScreenBackground glow={false}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>Encomendas</Text>
          <Text style={styles.count}>{orders.length}</Text>
        </View>

        <View style={styles.filters}>
          <FlatList
            horizontal
            data={FILTERS}
            keyExtractor={(f) => f}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersRow}
            renderItem={({ item }) => (
              <Chip
                label={item === 'Todas' ? 'Todas' : statusLabel(item)}
                active={filter === item}
                onPress={() => setFilter(item)}
              />
            )}
          />
        </View>

        {loading ? (
          <Loading label="A carregar encomendas…" />
        ) : (
          <FlatList
            data={visible}
            keyExtractor={(o) => o.id}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
            }
            ListHeaderComponent={
              error ? (
                <View style={styles.bannerWrap}>
                  <Banner text={error} tone="danger" icon="cloud-offline-outline" />
                </View>
              ) : null
            }
            ListEmptyComponent={
              <EmptyState
                icon="cart-outline"
                title="Sem encomendas"
                subtitle="Não há encomendas neste filtro."
              />
            }
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() =>
                  navigation.navigate('OrderDetail', { id: item.id, orderNumber: item.order_number })
                }
                android_ripple={{ color: '#FFFFFF11' }}
              >
                <View style={styles.flex}>
                  <View style={styles.rowTop}>
                    <Text style={styles.orderNo}>{item.order_number}</Text>
                    <StatusPill status={item.status} />
                  </View>
                  <Text style={styles.customer} numberOfLines={1}>
                    {item.customer_name}
                  </Text>
                  <Text style={styles.meta}>{formatDateTime(item.created_at)}</Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={styles.total}>{formatKz(item.gross_total)}</Text>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
                </View>
              </Pressable>
            )}
          />
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  title: { color: theme.colors.text, fontSize: 26, fontWeight: '900' },
  count: {
    color: theme.colors.muted,
    fontSize: 14,
    fontWeight: '700',
    backgroundColor: theme.colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  filters: { paddingBottom: 6 },
  filtersRow: { gap: 8, paddingHorizontal: 16 },
  list: { padding: 16, gap: 10, flexGrow: 1 },
  bannerWrap: { marginBottom: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    gap: 12,
  },
  rowPressed: { opacity: 0.7 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  orderNo: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
  customer: { color: theme.colors.text, fontSize: 14 },
  meta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: 6, flexDirection: 'row' },
  total: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
});
