import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateSigningKeyPair, RSA_DOC_MODULUS_LENGTH } from '@nexus/agt-xml';
import { createHash } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../common/crypto/secret-box';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';

/** Linha `integrations` onde vive a chave da PLATAFORMA (sem migração de BD). */
const INTEGRATION_KEY = 'AGT_SIGNING_KEY';

interface StoredSettings {
  keyVersion: number;
  algorithm: string;
  publicKey: string;
  createdAt: string;
  /** Tamanho do módulo RSA (1024 = compatível com o Hash do SAF-T; 2048 = legado). */
  modulusBits?: number;
  /** Chaves públicas anteriores (verificação de documentos antigos após rotação).
   *  As privadas antigas são DESCARTADAS — só servem para assinar, não verificar. */
  history: Array<{ keyVersion: number; publicKey: string; createdAt: string; retiredAt: string }>;
}

export interface PlatformSigningStatus {
  hasKey: boolean;
  /** "Versão da Chave Pública" — o valor a indicar no portal da AGT.
   *  Começa em 1 e incrementa a cada rotação (a AGT usa-o para saber que chave
   *  verifica que documentos; é também a versão impressa junto do hash). */
  keyVersion: number;
  algorithm: string;
  modulusBits: number;
  createdAt: string | null;
  /** SHA-256 do PEM público (conferência visual sem expor nada sensível). */
  publicKeyFingerprint: string | null;
  previousVersions: number[];
}

/**
 * Chave de assinatura fiscal da PLATAFORMA (certificação do software na AGT).
 *
 * No modelo de certificação (que a AGT herda do regime português), quem assina
 * os documentos é o PRODUTOR do software: o par RSA é gerado pelo produtor, a
 * chave PÚBLICA (public.pem) é anexada no portal da AGT com a respetiva
 * "Versão da Chave Pública", e a PRIVADA nunca sai do servidor.
 *
 * Segurança: a privada é cifrada em repouso (AES-256-GCM via secret-box) e não
 * existe NENHUM endpoint que a devolva. Rotação = nova versão (v+1); as
 * públicas antigas ficam no histórico para verificar documentos já emitidos.
 */
@Injectable()
export class PlatformSigningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get encKey(): string {
    return this.config.get('CONFIG_ENCRYPTION_KEY', { infer: true });
  }

  private async getRow() {
    return this.prisma.integration.findUnique({ where: { key: INTEGRATION_KEY } });
  }

  private parseSettings(value: unknown): StoredSettings | null {
    const s = value as StoredSettings | null;
    if (!s || typeof s.publicKey !== 'string' || !Number.isFinite(Number(s.keyVersion))) return null;
    return { ...s, keyVersion: Number(s.keyVersion), history: Array.isArray(s.history) ? s.history : [] };
  }

  /** Estado (sem nunca expor a chave privada). */
  async status(): Promise<PlatformSigningStatus> {
    const row = await this.getRow();
    const s = row ? this.parseSettings(row.settings) : null;
    if (!s) {
      return {
        hasKey: false, keyVersion: 0, algorithm: 'RSA-SHA256', modulusBits: RSA_DOC_MODULUS_LENGTH,
        createdAt: null, publicKeyFingerprint: null, previousVersions: [],
      };
    }
    return {
      hasKey: true,
      keyVersion: s.keyVersion,
      algorithm: s.algorithm,
      // Chaves criadas antes do campo existir eram RSA-2048.
      modulusBits: s.modulusBits ?? 2048,
      createdAt: s.createdAt,
      publicKeyFingerprint: createHash('sha256').update(s.publicKey).digest('hex'),
      previousVersions: s.history.map((h) => h.keyVersion),
    };
  }

  /**
   * Gera (ou RODA) o par de chaves da plataforma. Por omissão RSA-1024 —
   * PREVENÇÃO: é o único tamanho cuja assinatura (172 base64) cabe no campo
   * Hash do SAF-T (máx. 172), como no modelo português que a AGT herda. A
   * pública anterior vai para o histórico; a privada anterior é destruída.
   */
  async provision(modulusBits: number = RSA_DOC_MODULUS_LENGTH): Promise<PlatformSigningStatus> {
    const bits = modulusBits === 2048 ? 2048 : RSA_DOC_MODULUS_LENGTH;
    const { privateKeyPem, publicKeyPem } = generateSigningKeyPair(bits);
    const privateKeyEnc = encryptSecret(privateKeyPem, this.encKey);
    const now = new Date().toISOString();

    const row = await this.getRow();
    const prev = row ? this.parseSettings(row.settings) : null;
    const nextVersion = (prev?.keyVersion ?? 0) + 1;
    const history = prev
      ? [...prev.history, { keyVersion: prev.keyVersion, publicKey: prev.publicKey, createdAt: prev.createdAt, retiredAt: now }]
      : [];
    const settings: StoredSettings = {
      keyVersion: nextVersion, algorithm: 'RSA-SHA256', publicKey: publicKeyPem, createdAt: now, modulusBits: bits, history,
    };

    await this.prisma.integration.upsert({
      where: { key: INTEGRATION_KEY },
      create: {
        key: INTEGRATION_KEY,
        label: 'Chave de assinatura fiscal da plataforma (AGT)',
        enabled: true,
        settings: settings as object,
        secretEnc: privateKeyEnc,
      },
      update: { settings: settings as object, secretEnc: privateKeyEnc, enabled: true },
    });
    return this.status();
  }

  /** public.pem para anexar no portal da AGT (404 se ainda não houver chave). */
  async exportPublicKey(): Promise<{ fileName: string; pem: string; keyVersion: number; algorithm: string }> {
    const row = await this.getRow();
    const s = row ? this.parseSettings(row.settings) : null;
    if (!s) throw new NotFoundException('Ainda não existe chave da plataforma. Gere a chave primeiro.');
    // Sanidade: o PEM tem de ser um bloco PUBLIC KEY (SPKI) válido.
    if (!/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/.test(s.publicKey)) {
      throw new NotFoundException('Chave pública corrompida — gere uma nova chave.');
    }
    return { fileName: 'public.pem', pem: s.publicKey, keyVersion: s.keyVersion, algorithm: s.algorithm };
  }

  /** Privada decifrada — SÓ para o motor de assinatura (nunca sai por API). */
  async getPrivateKeyForSigning(): Promise<{ privateKeyPem: string; keyVersion: number } | null> {
    const row = await this.getRow();
    const s = row ? this.parseSettings(row.settings) : null;
    if (!s || !row?.secretEnc) return null;
    try {
      return { privateKeyPem: decryptSecret(row.secretEnc, this.encKey), keyVersion: s.keyVersion };
    } catch {
      return null;
    }
  }
}
