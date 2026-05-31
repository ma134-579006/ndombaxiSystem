import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../api/client';
import { SYSTEM_MODULE, SYSTEM_NAME } from '../brand';
import { ScreenBackground } from '../components/Background';
import { FooterCredit, Logo } from '../components/Brand';
import { KeyboardField } from '../components/KeyboardField';
import { Banner, Button } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import { theme } from '../theme';

export function LoginScreen() {
  const { login, companyCode: savedCode } = useAuth();
  const { settings, setVirtualKeyboard } = useSettings();

  const [companyCode, setCompanyCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFa, setTwoFa] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pré-preenche o último código de empresa usado neste dispositivo.
  useEffect(() => {
    if (savedCode && !companyCode) setCompanyCode(savedCode);
  }, [savedCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setError(null);
    if (!companyCode.trim() || !email.trim() || !password) {
      setError('Preencha empresa, e-mail e palavra-passe.');
      return;
    }
    setLoading(true);
    try {
      await login({
        companyCode: companyCode.trim().toLowerCase(),
        email: email.trim(),
        password,
        twoFaToken: twoFa.trim() || undefined,
      });
      // Navegação muda automaticamente para a área autenticada.
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Não foi possível entrar. Tente novamente.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.brand}>
              <Logo size={84} />
              <Text style={styles.brandName}>{SYSTEM_NAME}</Text>
              <Text style={styles.brandTag}>{SYSTEM_MODULE}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Iniciar sessão</Text>
              <Text style={styles.cardSubtitle}>Aceda à gestão da sua loja</Text>

              {error ? (
                <View style={styles.errorWrap}>
                  <Banner text={error} tone="danger" icon="alert-circle-outline" />
                </View>
              ) : null}

              <View style={styles.fields}>
                <KeyboardField
                  label="Empresa"
                  icon="business-outline"
                  placeholder="codigo-da-empresa"
                  value={companyCode}
                  onChangeText={setCompanyCode}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <KeyboardField
                  label="E-mail"
                  icon="mail-outline"
                  placeholder="nome@empresa.ao"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <KeyboardField
                  label="Palavra-passe"
                  icon="lock-closed-outline"
                  placeholder="••••••••"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                />
                <KeyboardField
                  label="Código 2FA (se activo)"
                  icon="shield-checkmark-outline"
                  placeholder="000000"
                  value={twoFa}
                  onChangeText={setTwoFa}
                  numeric
                  maxLength={6}
                  submitLabel="Entrar"
                  onSubmitEditing={submit}
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={styles.toggleText}>
                  <Ionicons name="keypad-outline" size={18} color={theme.colors.muted} />
                  <View style={styles.flex}>
                    <Text style={styles.toggleTitle}>Teclado no ecrã</Text>
                    <Text style={styles.toggleHint}>Para PCs/terminais táteis sem teclado</Text>
                  </View>
                </View>
                <Switch
                  value={settings.virtualKeyboard}
                  onValueChange={setVirtualKeyboard}
                  trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                  thumbColor={theme.colors.primaryText}
                />
              </View>

              <Button label="Entrar" icon="log-in-outline" onPress={submit} loading={loading} />
            </View>

            <FooterCredit style={styles.footer} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingBottom: 360 },
  brand: { alignItems: 'center', marginBottom: 28 },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: theme.colors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  brandName: { color: theme.colors.text, fontSize: 25, fontWeight: '900', letterSpacing: 1, textAlign: 'center' },
  brandTag: { color: theme.colors.muted, fontSize: 13, marginTop: 2, letterSpacing: 1 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 22,
  },
  cardTitle: { color: theme.colors.text, fontSize: 22, fontWeight: '800' },
  cardSubtitle: { color: theme.colors.muted, fontSize: 14, marginTop: 2, marginBottom: 16 },
  errorWrap: { marginBottom: 14 },
  fields: { gap: 14 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 18,
    gap: 12,
  },
  toggleText: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  toggleTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  toggleHint: { color: theme.colors.muted, fontSize: 12 },
  footer: { color: theme.colors.muted, fontSize: 12, textAlign: 'center', marginTop: 24 },
});
