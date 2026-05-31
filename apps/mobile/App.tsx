import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthContext';
import { KeyboardScopeProvider } from './src/components/keyboard/KeyboardScope';
import { SettingsProvider } from './src/settings/SettingsContext';
import { RootNavigator } from './src/navigation/RootNavigator';

/**
 * Raiz da aplicação NEXUS Mobile. Ordem dos provedores:
 *   SafeArea → Definições → Autenticação → Teclado no ecrã → Navegação.
 * (O teclado no ecrã precisa das definições e dos safe-area insets, e
 * sobrepõe-se a toda a navegação — incluindo o login.)
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SettingsProvider>
        <AuthProvider>
          <KeyboardScopeProvider>
            <RootNavigator />
          </KeyboardScopeProvider>
        </AuthProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
