import * as SecureStore from 'expo-secure-store';
import type { TokenPair } from '../api/types';

/**
 * Armazenamento seguro (Keychain/Keystore via expo-secure-store) dos tokens e
 * preferências locais. As chaves só podem conter alfanuméricos, ".", "-", "_".
 */
const K_ACCESS = 'nexus.accessToken';
const K_REFRESH = 'nexus.refreshToken';
const K_COMPANY = 'nexus.companyCode';
const K_SETTINGS = 'nexus.settings';

async function setOrDelete(key: string, value: string | null | undefined): Promise<void> {
  if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}

export const storage = {
  async saveTokens(tokens: TokenPair): Promise<void> {
    await SecureStore.setItemAsync(K_ACCESS, tokens.accessToken);
    await SecureStore.setItemAsync(K_REFRESH, tokens.refreshToken);
  },

  async loadTokens(): Promise<TokenPair | null> {
    const accessToken = await SecureStore.getItemAsync(K_ACCESS);
    const refreshToken = await SecureStore.getItemAsync(K_REFRESH);
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken };
  },

  async clearTokens(): Promise<void> {
    await SecureStore.deleteItemAsync(K_ACCESS);
    await SecureStore.deleteItemAsync(K_REFRESH);
  },

  async saveCompanyCode(code: string | null): Promise<void> {
    await setOrDelete(K_COMPANY, code);
  },

  async loadCompanyCode(): Promise<string | null> {
    return SecureStore.getItemAsync(K_COMPANY);
  },

  async saveSettings(json: string): Promise<void> {
    await SecureStore.setItemAsync(K_SETTINGS, json);
  },

  async loadSettings(): Promise<string | null> {
    return SecureStore.getItemAsync(K_SETTINGS);
  },
};
