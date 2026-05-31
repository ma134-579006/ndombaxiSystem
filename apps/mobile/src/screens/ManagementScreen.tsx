import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiError } from '../api/client';
import type { StaffUser, Store } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ScreenBackground } from '../components/Background';
import { FooterCredit } from '../components/Brand';
import { KeyboardField } from '../components/KeyboardField';
import { Banner, Button, Card, Chip, EmptyState, Loading, SectionTitle } from '../components/ui';
import { theme } from '../theme';

const ROLE_LEVEL: Record<string, number> = {
  SUPER_ADMIN: 0,
  COMPANY_ADMIN: 1,
  REGIONAL_MANAGER: 2,
  STORE_MANAGER: 3,
  SHIFT_SUPERVISOR: 4,
  CASHIER: 5,
  ATTENDANT: 6,
};
const ROLE_LABELS: Record<string, string> = {
  COMPANY_ADMIN: 'Administrador',
  REGIONAL_MANAGER: 'Gestor regional',
  STORE_MANAGER: 'Gestor de loja',
  SHIFT_SUPERVISOR: 'Supervisor',
  CASHIER: 'Operador de caixa',
  ATTENDANT: 'Atendedor',
};
const ASSIGNABLE_ROLES = [
  'COMPANY_ADMIN',
  'REGIONAL_MANAGER',
  'STORE_MANAGER',
  'SHIFT_SUPERVISOR',
  'CASHIER',
  'ATTENDANT',
];

export function ManagementScreen() {
  const { user } = useAuth();
  const actorLevel = user?.role ? ROLE_LEVEL[user.role] ?? 6 : 6;
  const canEdit = actorLevel <= ROLE_LEVEL.COMPANY_ADMIN; // só COMPANY_ADMIN cria
  const assignableRoles = useMemo(
    () => ASSIGNABLE_ROLES.filter((r) => ROLE_LEVEL[r] >= actorLevel),
    [actorLevel],
  );

  const [stores, setStores] = useState<Store[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);

  // Formulários inline
  const [showStore, setShowStore] = useState(false);
  const [storeCode, setStoreCode] = useState('');
  const [storeName, setStoreName] = useState('');
  const [storeAddress, setStoreAddress] = useState('');
  const [storeDefault, setStoreDefault] = useState(false);
  const [savingStore, setSavingStore] = useState(false);

  const [showStaff, setShowStaff] = useState(false);
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRole, setStaffRole] = useState('');
  const [staffStore, setStaffStore] = useState<string | null>(null);
  const [staffPin, setStaffPin] = useState('');
  const [savingStaff, setSavingStaff] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [s, u] = await Promise.all([api.staff.listStores(), api.staff.listUsers()]);
      setStores(s);
      setStaff(u);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar a gestão.');
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const storeName_ = (id: string | null) =>
    id ? stores.find((s) => s.id === id)?.name ?? '—' : 'Sem loja';

  const createStore = async () => {
    if (!storeCode.trim() || !storeName.trim()) {
      Alert.alert('Dados em falta', 'Indique o código e o nome da loja.');
      return;
    }
    setSavingStore(true);
    try {
      await api.staff.createStore({
        code: storeCode.trim(),
        name: storeName.trim(),
        address: storeAddress.trim() || undefined,
        isDefault: storeDefault,
      });
      setStoreCode('');
      setStoreName('');
      setStoreAddress('');
      setStoreDefault(false);
      setShowStore(false);
      await load();
    } catch (e) {
      Alert.alert('Erro', e instanceof ApiError ? e.message : 'Não foi possível criar a loja.');
    } finally {
      setSavingStore(false);
    }
  };

  const createStaff = async () => {
    if (!staffName.trim() || !staffEmail.trim() || !staffRole) {
      Alert.alert('Dados em falta', 'Indique nome, e-mail e papel.');
      return;
    }
    if (staffPin && !/^\d{6}$/.test(staffPin)) {
      Alert.alert('PIN inválido', 'O PIN deve ter exactamente 6 dígitos.');
      return;
    }
    setSavingStaff(true);
    try {
      const res = await api.staff.createUser({
        name: staffName.trim(),
        email: staffEmail.trim(),
        role: staffRole,
        storeId: staffStore ?? undefined,
        pin: staffPin || undefined,
      });
      if (res.temporaryPassword) {
        setSecret({ who: res.user.email, password: res.temporaryPassword });
      }
      setStaffName('');
      setStaffEmail('');
      setStaffRole('');
      setStaffStore(null);
      setStaffPin('');
      setShowStaff(false);
      await load();
    } catch (e) {
      Alert.alert('Erro', e instanceof ApiError ? e.message : 'Não foi possível criar o funcionário.');
    } finally {
      setSavingStaff(false);
    }
  };

  const deactivate = (u: StaffUser) => {
    Alert.alert('Desactivar funcionário', `Desactivar "${u.name}"? Deixa de poder entrar.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desactivar',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.staff.deactivateUser(u.id);
            await load();
          } catch (e) {
            Alert.alert('Erro', e instanceof ApiError ? e.message : 'Operação falhou.');
          }
        },
      },
    ]);
  };

  const resetPw = (u: StaffUser) => {
    Alert.alert('Repor palavra-passe', `Gerar nova palavra-passe temporária para "${u.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Gerar',
        onPress: async () => {
          try {
            const res = await api.staff.resetPassword(u.id);
            if (res.temporaryPassword) setSecret({ who: u.email, password: res.temporaryPassword });
          } catch (e) {
            Alert.alert('Erro', e instanceof ApiError ? e.message : 'Operação falhou.');
          }
        },
      },
    ]);
  };

  return (
    <ScreenBackground glow={false}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>Gestão</Text>
          <Text style={styles.sub}>Equipa & Lojas</Text>
        </View>

        {loading ? (
          <Loading label="A carregar…" />
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
            }
          >
            {error ? <Banner text={error} tone="danger" icon="cloud-offline-outline" /> : null}
            {!canEdit ? (
              <Banner text="Só o administrador da empresa pode criar/editar." tone="info" icon="lock-closed-outline" />
            ) : null}
            {secret ? (
              <Card style={styles.secretCard}>
                <View style={styles.row}>
                  <Ionicons name="key-outline" size={18} color={theme.colors.warning} />
                  <Text style={styles.secretTitle}>Palavra-passe temporária</Text>
                </View>
                <Text style={styles.secretWho}>{secret.who}</Text>
                <Text selectable style={styles.secretPw}>
                  {secret.password}
                </Text>
                <Text style={styles.secretHint}>Partilhe com o funcionário. Não voltará a ser mostrada.</Text>
                <Button label="Ok, copiei" variant="ghost" onPress={() => setSecret(null)} />
              </Card>
            ) : null}

            {/* ── Lojas ── */}
            <Card style={styles.block}>
              <View style={styles.sectionHead}>
                <SectionTitle hint={`${stores.length}`}>Lojas</SectionTitle>
                {canEdit ? (
                  <Pressable onPress={() => setShowStore((v) => !v)} style={styles.addBtn}>
                    <Ionicons name={showStore ? 'close' : 'add'} size={20} color={theme.colors.primary} />
                  </Pressable>
                ) : null}
              </View>

              {showStore ? (
                <View style={styles.form}>
                  <KeyboardField label="Código" placeholder="LOJA-002" value={storeCode} onChangeText={setStoreCode} autoCapitalize="characters" autoCorrect={false} />
                  <KeyboardField label="Nome" placeholder="Nome da loja" value={storeName} onChangeText={setStoreName} />
                  <KeyboardField label="Morada (opcional)" placeholder="Endereço" value={storeAddress} onChangeText={setStoreAddress} />
                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>Loja principal</Text>
                    <Switch value={storeDefault} onValueChange={setStoreDefault} trackColor={{ false: theme.colors.border, true: theme.colors.primary }} thumbColor={theme.colors.primaryText} />
                  </View>
                  <Button label="Criar loja" icon="storefront-outline" loading={savingStore} onPress={createStore} />
                </View>
              ) : null}

              {stores.length === 0 ? (
                <EmptyState icon="storefront-outline" title="Sem lojas" />
              ) : (
                stores.map((s) => (
                  <View key={s.id} style={styles.itemRow}>
                    <View style={styles.flex}>
                      <Text style={styles.itemName}>
                        {s.name} {s.is_default ? <Text style={styles.badge}>· principal</Text> : null}
                      </Text>
                      <Text style={styles.itemMeta}>
                        {s.code}
                        {s.address ? ` · ${s.address}` : ''}
                        {!s.is_active ? ' · inactiva' : ''}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </Card>

            {/* ── Equipa ── */}
            <Card style={styles.block}>
              <View style={styles.sectionHead}>
                <SectionTitle hint={`${staff.length}`}>Equipa</SectionTitle>
                {canEdit ? (
                  <Pressable onPress={() => setShowStaff((v) => !v)} style={styles.addBtn}>
                    <Ionicons name={showStaff ? 'close' : 'add'} size={20} color={theme.colors.primary} />
                  </Pressable>
                ) : null}
              </View>

              {showStaff ? (
                <View style={styles.form}>
                  <KeyboardField label="Nome" placeholder="Nome do funcionário" value={staffName} onChangeText={setStaffName} />
                  <KeyboardField label="E-mail" placeholder="nome@empresa.ao" value={staffEmail} onChangeText={setStaffEmail} autoCapitalize="none" autoCorrect={false} />
                  <Text style={styles.pickLabel}>Papel</Text>
                  <View style={styles.chips}>
                    {assignableRoles.map((r) => (
                      <Chip key={r} label={ROLE_LABELS[r] ?? r} active={staffRole === r} onPress={() => setStaffRole(r)} />
                    ))}
                  </View>
                  <Text style={styles.pickLabel}>Loja</Text>
                  <View style={styles.chips}>
                    <Chip label="Sem loja" active={staffStore === null} onPress={() => setStaffStore(null)} />
                    {stores.map((s) => (
                      <Chip key={s.id} label={s.name} active={staffStore === s.id} onPress={() => setStaffStore(s.id)} />
                    ))}
                  </View>
                  <KeyboardField label="PIN do POS (opcional)" placeholder="000000" value={staffPin} onChangeText={setStaffPin} numeric maxLength={6} />
                  <Button label="Criar funcionário" icon="person-add-outline" loading={savingStaff} onPress={createStaff} />
                </View>
              ) : null}

              {staff.length === 0 ? (
                <EmptyState icon="people-outline" title="Sem funcionários" />
              ) : (
                staff.map((u) => (
                  <View key={u.id} style={styles.staffRow}>
                    <View style={styles.flex}>
                      <Text style={[styles.itemName, !u.is_active && styles.muted]}>{u.name}</Text>
                      <Text style={styles.itemMeta}>
                        {ROLE_LABELS[u.role] ?? u.role} · {storeName_(u.store_id)}
                        {u.has_pin ? ' · PIN' : ''}
                        {!u.is_active ? ' · inactivo' : ''}
                      </Text>
                      <Text style={styles.itemEmail}>{u.email}</Text>
                    </View>
                    {canEdit && u.is_active ? (
                      <View style={styles.actions}>
                        <Pressable onPress={() => resetPw(u)} style={styles.iconAction}>
                          <Ionicons name="key-outline" size={18} color={theme.colors.muted} />
                        </Pressable>
                        <Pressable onPress={() => deactivate(u)} style={styles.iconAction}>
                          <Ionicons name="person-remove-outline" size={18} color={theme.colors.danger} />
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                ))
              )}
            </Card>

            <FooterCredit style={styles.credit} />
            <View style={{ height: 24 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  muted: { color: theme.colors.muted },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { color: theme.colors.text, fontSize: 26, fontWeight: '900' },
  sub: { color: theme.colors.muted, fontSize: 13, marginTop: 2 },
  scroll: { padding: 16, gap: 12 },
  block: { marginTop: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${theme.colors.primary}22`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: { gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border, marginBottom: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  pickLabel: { color: theme.colors.muted, fontSize: 13, fontWeight: '600', marginLeft: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.colors.border },
  staffRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderTopWidth: 1, borderTopColor: theme.colors.border },
  itemName: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  itemMeta: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  itemEmail: { color: theme.colors.muted, fontSize: 12, marginTop: 1 },
  badge: { color: theme.colors.primary, fontSize: 12, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 6 },
  iconAction: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secretCard: { borderColor: `${theme.colors.warning}55`, gap: 6 },
  secretTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  secretWho: { color: theme.colors.muted, fontSize: 13 },
  secretPw: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: 'monospace',
    paddingVertical: 6,
  },
  secretHint: { color: theme.colors.muted, fontSize: 12, marginBottom: 6 },
  credit: { marginTop: 14 },
});
