/**
 * Segredo do dispositivo no telemóvel — deriva a chave AES que cifra os dados
 * locais e é o equivalente móvel do DPAPI/safeStorage do Windows.
 *
 * Guardamos o segredo com `@capacitor/preferences`, que no Android assenta em
 * `EncryptedSharedPreferences` e no iOS no Keychain — ou seja, protegido pelo
 * sistema, não em texto simples acessível a outra app. O segredo é gerado uma
 * vez, na primeira abertura, e nunca sai do aparelho.
 */
import { Preferences } from '@capacitor/preferences';
import type { DeviceSecretProvider } from '@nexus/offline-core';
import { toBase64, randomBytes } from '@nexus/offline-core';

const KEY = 'ndombaxi.device.secret';

export const mobileDeviceSecret: DeviceSecretProvider = {
  // No iOS o Keychain é hardware-backed (Secure Enclave); no Android depende do
  // aparelho, mas em qualquer caso é o cofre do SO — por isso, `true`.
  hardwareBacked: true,
  async get(): Promise<string> {
    const existing = await Preferences.get({ key: KEY });
    if (existing.value) return existing.value;
    const secret = toBase64(randomBytes(32));
    await Preferences.set({ key: KEY, value: secret });
    return secret;
  },
};
