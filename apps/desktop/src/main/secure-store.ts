/**
 * Segredo do dispositivo, guardado no cofre do sistema operativo.
 *
 * É este segredo que deriva a chave AES que cifra a base de dados local. No
 * Windows, o `safeStorage` do Electron assenta na DPAPI: o valor fica ligado à
 * CONTA DE UTILIZADOR da máquina. Copiar o ficheiro para outro computador não
 * serve de nada — a chave não vai com ele.
 *
 * Quando a DPAPI não está disponível (sessão sem perfil, algumas configurações
 * de domínio), guardamos o segredo em claro e dizemos-o. Um sistema que finge
 * estar cifrado é pior do que um que admite não estar: o gestor não pode tomar
 * decisões sobre um risco que lhe foi escondido.
 */
import { app, safeStorage } from 'electron';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

interface StoredSecret {
  /** 'dpapi' = protegido pelo SO; 'plain' = apenas ofuscado. */
  mode: 'dpapi' | 'plain';
  value: string;
}

function secretFile(): string {
  return path.join(app.getPath('userData'), 'device.key');
}

/** Devolve o segredo desta instalação, criando-o na primeira execução. */
export function deviceSecret(): { secret: string; hardwareBacked: boolean } {
  const file = secretFile();

  if (fs.existsSync(file)) {
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredSecret;
      if (stored.mode === 'dpapi' && safeStorage.isEncryptionAvailable()) {
        return {
          secret: safeStorage.decryptString(Buffer.from(stored.value, 'base64')),
          hardwareBacked: true,
        };
      }
      return { secret: stored.value, hardwareBacked: false };
    } catch {
      // Ficheiro ilegível: geramos um novo. Perde-se o acesso às credenciais
      // offline em cache (exige um login online), mas nunca dados de vendas —
      // esses estão na base de dados, não aqui.
    }
  }

  const fresh = crypto.randomBytes(32).toString('base64');
  const protectable = safeStorage.isEncryptionAvailable();
  const payload: StoredSecret = protectable
    ? { mode: 'dpapi', value: safeStorage.encryptString(fresh).toString('base64') }
    : { mode: 'plain', value: fresh };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload), { mode: 0o600 });
  return { secret: fresh, hardwareBacked: protectable };
}
