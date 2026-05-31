import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL } from '../config';
import { SYSTEM_NAME } from '../brand';
import { useAuth } from '../auth/AuthContext';
import { ScreenBackground } from '../components/Background';
import { FooterCredit } from '../components/Brand';
import { Button, Card, KeyValue, SectionTitle } from '../components/ui';
import { useSettings } from '../settings/SettingsContext';
import { theme } from '../theme';

const ROLE_LABELS: Record<string, string> = {
  COMPANY_ADMIN: 'Administrador da empresa',
  STORE_MANAGER: 'Gestor de loja',
  SHIFT_SUPERVISOR: 'Supervisor de turno',
  CASHIER: 'Operador de caixa',
  ATTENDANT: 'Atendedor',
};

export function SettingsScreen() {
  const { user, companyCode, logout } = useAuth();
  const { settings, setVirtualKeyboard } = useSettings();

  return (
    <ScreenBackground glow={false}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>Definições</Text>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Card>
            <View style={styles.profile}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={26} color={theme.colors.primaryText} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.name} numberOfLines={1}>
                  {user?.email ?? 'Utilizador'}
                </Text>
                <Text style={styles.sub}>
                  {user?.role ? ROLE_LABELS[user.role] ?? user.role : '—'}
                </Text>
              </View>
            </View>
            <View style={styles.divider} />
            <KeyValue label="Empresa" value={companyCode ?? '—'} />
            {user?.tenantSchema ? <KeyValue label="Schema" value={user.tenantSchema} /> : null}
          </Card>

          <Card style={styles.block}>
            <SectionTitle>Acessibilidade</SectionTitle>
            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <View style={styles.toggleIcon}>
                  <Ionicons name="keypad-outline" size={18} color={theme.colors.primary} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.toggleTitle}>Teclado no ecrã</Text>
                  <Text style={styles.toggleHint}>
                    Ideal para PCs e terminais táteis (caixa) sem teclado físico.
                  </Text>
                </View>
              </View>
              <Switch
                value={settings.virtualKeyboard}
                onValueChange={setVirtualKeyboard}
                trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                thumbColor={theme.colors.primaryText}
              />
            </View>
          </Card>

          <Card style={styles.block}>
            <SectionTitle>Sistema</SectionTitle>
            <KeyValue label="Servidor" value={API_URL} />
            <KeyValue label="Versão" value={`${SYSTEM_NAME} 3.0`} />
          </Card>

          <View style={styles.block}>
            <Button label="Terminar sessão" icon="log-out-outline" variant="danger" onPress={logout} />
          </View>

          <FooterCredit style={styles.credit} />
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  title: { color: theme.colors.text, fontSize: 26, fontWeight: '900' },
  scroll: { padding: 16, gap: 12 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  sub: { color: theme.colors.muted, fontSize: 13, marginTop: 2 },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 12 },
  block: { marginTop: 0 },
  credit: { marginTop: 18, marginBottom: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggleText: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  toggleIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: `${theme.colors.primary}22`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  toggleHint: { color: theme.colors.muted, fontSize: 12, marginTop: 2, lineHeight: 17 },
});
