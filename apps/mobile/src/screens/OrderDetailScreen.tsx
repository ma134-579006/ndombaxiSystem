import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError } from '../api/client';
import type { OrderMessage, WebOrderDetail } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ScreenBackground } from '../components/Background';
import { KeyboardField } from '../components/KeyboardField';
import { Banner, Button, Card, KeyValue, Loading, SectionTitle, StatusPill } from '../components/ui';
import { formatKz, formatNumber, formatTime, paymentLabel } from '../format';
import type { OrdersStackParamList } from '../navigation/types';
import { useRealtime } from '../realtime/useRealtime';
import { theme } from '../theme';

const CHATTABLE = ['PAID', 'SHIPPED', 'DELIVERED'];

type Props = NativeStackScreenProps<OrdersStackParamList, 'OrderDetail'>;

export function OrderDetailScreen({ route }: Props) {
  const { id } = route.params;
  const { user, accessToken } = useAuth();

  const [order, setOrder] = useState<WebOrderDetail | null>(null);
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const addMessage = useCallback((m: OrderMessage) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }, []);

  const loadOrder = useCallback(async () => {
    const detail = await api.orders.get(id);
    setOrder(detail);
    if (CHATTABLE.includes(detail.status)) {
      try {
        setMessages(await api.orders.messages(id));
      } catch {
        // chat ainda indisponível — ignora
      }
    }
  }, [id]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadOrder();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Falha ao carregar a encomenda.');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadOrder]);

  useRealtime(accessToken, {
    onOrderMessage: (m) => {
      if (m.order_id === id) addMessage(m);
    },
  });

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    return () => clearTimeout(t);
  }, [messages.length]);

  const runAction = useCallback(
    (label: string, action: () => Promise<unknown>, confirm = true) => {
      const exec = async () => {
        setBusy(true);
        setError(null);
        try {
          await action();
          await loadOrder();
        } catch (e) {
          const msg = e instanceof ApiError ? e.message : 'Operação falhou.';
          Alert.alert('Erro', msg);
        } finally {
          setBusy(false);
        }
      };
      if (confirm) {
        Alert.alert(label, 'Confirmar esta operação?', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Confirmar', onPress: () => void exec() },
        ]);
      } else {
        void exec();
      }
    },
    [loadOrder],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const msg = await api.orders.sendMessage(id, text, user?.email);
      addMessage(msg);
      setDraft('');
    } catch (e) {
      Alert.alert('Erro', e instanceof ApiError ? e.message : 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  }, [draft, sending, id, user?.email, addMessage]);

  if (loading) {
    return (
      <ScreenBackground glow={false}>
        <Loading label="A carregar encomenda…" />
      </ScreenBackground>
    );
  }

  if (!order) {
    return (
      <ScreenBackground glow={false}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.pad}>
            <Banner text={error ?? 'Encomenda não encontrada.'} tone="danger" icon="alert-circle-outline" />
          </View>
        </SafeAreaView>
      </ScreenBackground>
    );
  }

  const canChat = CHATTABLE.includes(order.status);

  return (
    <ScreenBackground glow={false}>
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={90}
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            {error ? <Banner text={error} tone="danger" icon="alert-circle-outline" /> : null}

            <Card>
              <View style={styles.topRow}>
                <Text style={styles.orderNo}>{order.order_number}</Text>
                <StatusPill status={order.status} />
              </View>
              <Text style={styles.total}>{formatKz(order.gross_total)}</Text>
              <View style={styles.divider} />
              <KeyValue label="Cliente" value={order.customer_name} />
              {order.customer_phone ? <KeyValue label="Telefone" value={order.customer_phone} /> : null}
              {order.customer_tax_id ? <KeyValue label="NIF" value={order.customer_tax_id} /> : null}
              <KeyValue label="Pagamento" value={paymentLabel(order.payment_method)} />
              {order.province || order.municipality ? (
                <KeyValue
                  label="Localização"
                  value={[order.neighborhood, order.municipality, order.province].filter(Boolean).join(', ')}
                />
              ) : null}
              {order.shipping_address ? <KeyValue label="Morada" value={order.shipping_address} /> : null}
              <View style={styles.divider} />
              <KeyValue label="Base tributável" value={formatKz(order.net_total)} />
              <KeyValue label="IVA" value={formatKz(order.iva_total)} />
            </Card>

            <Card style={styles.block}>
              <SectionTitle hint={`${order.items.length} artigo(s)`}>Artigos</SectionTitle>
              {order.items.map((it) => (
                <View key={it.id} style={styles.item}>
                  <View style={styles.flex}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {it.description}
                    </Text>
                    <Text style={styles.itemMeta}>
                      {formatNumber(it.quantity, 0)} × {formatKz(it.unit_price)}
                    </Text>
                  </View>
                  <Text style={styles.itemTotal}>{formatKz(it.gross_amount)}</Text>
                </View>
              ))}
            </Card>

            {/* Acções logísticas conforme o estado */}
            {order.status === 'PENDING' ? (
              <View style={styles.actions}>
                <Button
                  label="Confirmar pagamento"
                  icon="cash-outline"
                  variant="success"
                  loading={busy}
                  onPress={() => runAction('Confirmar pagamento', () => api.orders.pay(id))}
                />
                <Button
                  label="Cancelar encomenda"
                  icon="close-circle-outline"
                  variant="danger"
                  disabled={busy}
                  onPress={() => runAction('Cancelar encomenda', () => api.orders.cancel(id))}
                />
              </View>
            ) : null}
            {order.status === 'PAID' ? (
              <View style={styles.actions}>
                <Button
                  label="Marcar como expedida"
                  icon="cube-outline"
                  loading={busy}
                  onPress={() => runAction('Expedir encomenda', () => api.orders.ship(id))}
                />
              </View>
            ) : null}
            {order.status === 'SHIPPED' ? (
              <View style={styles.actions}>
                <Button
                  label="Marcar como entregue"
                  icon="checkmark-done-outline"
                  variant="success"
                  loading={busy}
                  onPress={() => runAction('Entregar encomenda', () => api.orders.deliver(id))}
                />
              </View>
            ) : null}

            {/* Conversa com o cliente */}
            <Card style={styles.block}>
              <SectionTitle>Conversa com o cliente</SectionTitle>
              {!canChat ? (
                <Text style={styles.chatLocked}>
                  A conversa abre depois de a encomenda ser aprovada/paga.
                </Text>
              ) : messages.length === 0 ? (
                <Text style={styles.chatLocked}>Ainda sem mensagens. Diga olá ao cliente 👋</Text>
              ) : (
                messages.map((m) => {
                  const mine = m.sender_type === 'STAFF';
                  const bot = m.sender_type === 'ASSISTANT';
                  return (
                    <View
                      key={m.id}
                      style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
                    >
                      <View style={styles.bubbleHead}>
                        {bot ? <Ionicons name="sparkles-outline" size={12} color={theme.colors.primary} /> : null}
                        <Text style={[styles.bubbleName, mine && styles.bubbleNameMine]}>
                          {m.sender_name}
                        </Text>
                        <Text style={styles.bubbleTime}>{formatTime(m.created_at)}</Text>
                      </View>
                      <Text style={[styles.bubbleBody, mine && styles.bubbleBodyMine]}>{m.body}</Text>
                    </View>
                  );
                })
              )}
            </Card>
            <View style={styles.bottomPad} />
          </ScrollView>

          {canChat ? (
            <View style={styles.composer}>
              <View style={styles.flex}>
                <KeyboardField
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Escreva uma mensagem…"
                  multiline
                  submitLabel="Enviar"
                  onSubmitEditing={send}
                />
              </View>
              <Pressable
                onPress={send}
                disabled={sending || !draft.trim()}
                style={[styles.sendBtn, (sending || !draft.trim()) && styles.sendBtnOff]}
              >
                <Ionicons name="send" size={20} color={theme.colors.primaryText} />
              </Pressable>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  pad: { padding: 16 },
  scroll: { padding: 16, gap: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orderNo: { color: theme.colors.text, fontSize: 18, fontWeight: '800' },
  total: { color: theme.colors.text, fontSize: 28, fontWeight: '900', marginTop: 8 },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 10 },
  block: { marginTop: 0 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  itemName: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  itemMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  itemTotal: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  actions: { gap: 10 },
  chatLocked: { color: theme.colors.muted, fontSize: 13, paddingVertical: 12, textAlign: 'center' },
  bubble: { maxWidth: '88%', borderRadius: 14, padding: 10, marginVertical: 5 },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: theme.colors.primary },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: theme.colors.surfaceAlt },
  bubbleHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  bubbleName: { color: theme.colors.muted, fontSize: 11, fontWeight: '700' },
  bubbleNameMine: { color: '#DCEBFF' },
  bubbleTime: { color: theme.colors.muted, fontSize: 10 },
  bubbleBody: { color: theme.colors.text, fontSize: 14, lineHeight: 19 },
  bubbleBodyMine: { color: theme.colors.primaryText },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
  },
  sendBtn: {
    width: 50,
    height: 50,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { opacity: 0.5 },
  bottomPad: { height: 8 },
});
