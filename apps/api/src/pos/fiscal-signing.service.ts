import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  RsaDocumentSigner,
  type SignatureAlgorithm,
  generateSigningKeyPair,
} from '@nexus/agt-xml';
import { decryptSecret, encryptSecret } from '../common/crypto/secret-box';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';

interface SigningKeyRow {
  id: string;
  key_version: number;
  algorithm: string;
  public_key: string;
  private_key_enc: string;
  is_active: boolean;
  created_at: Date;
}

/** Vista pública de uma chave de assinatura — nunca expõe a chave privada. */
export interface PublicSigningKey {
  keyVersion: number;
  algorithm: string;
  publicKey: string;
  isActive: boolean;
  createdAt: Date;
}

/**
 * Gere as chaves de assinatura digital RSA-2048 de cada tenant (§7, AGT).
 * A chave privada é guardada cifrada (AES-256-GCM) no schema do tenant; a
 * pública pode ser exportada para verificação. Rotação por versão incremental.
 */
@Injectable()
export class FiscalSigningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get secret(): string {
    return this.config.get('CONFIG_ENCRYPTION_KEY', { infer: true });
  }

  /**
   * Gera e activa um novo par de chaves RSA-2048 para o tenant, desactivando a
   * chave anterior (rotação). Devolve a chave pública + versão.
   */
  async provision(schema: string): Promise<PublicSigningKey> {
    const { privateKeyPem, publicKeyPem } = generateSigningKeyPair();
    const privateKeyEnc = encryptSecret(privateKeyPem, this.secret);

    return this.prisma.runInTenant(schema, async (tx) => {
      // Próxima versão = max actual + 1.
      const versionRows = await tx.$queryRaw<{ next: number }[]>(
        Prisma.sql`SELECT COALESCE(MAX(key_version), 0) + 1 AS next FROM fiscal_signing_keys`,
      );
      const nextVersion = Number(versionRows[0].next);

      // Desactiva a chave activa anterior (mantém-na para verificar docs antigos).
      await tx.$executeRaw(
        Prisma.sql`UPDATE fiscal_signing_keys SET is_active = FALSE WHERE is_active = TRUE`,
      );

      const rows = await tx.$queryRaw<SigningKeyRow[]>(
        Prisma.sql`INSERT INTO fiscal_signing_keys
            (key_version, algorithm, public_key, private_key_enc, is_active)
          VALUES (${nextVersion}, 'RSA-SHA256', ${publicKeyPem}, ${privateKeyEnc}, TRUE)
          RETURNING *`,
      );
      return this.toPublic(rows[0]);
    });
  }

  /** Lista as chaves (públicas) do tenant — auditoria/rotação. */
  async list(schema: string): Promise<PublicSigningKey[]> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<SigningKeyRow[]>(
        Prisma.sql`SELECT * FROM fiscal_signing_keys ORDER BY key_version DESC`,
      ),
    );
    return rows.map((r) => this.toPublic(r));
  }

  /** Chave pública activa (para exportação/verificação). 404 se não existir. */
  async getActivePublicKey(schema: string): Promise<PublicSigningKey> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<SigningKeyRow[]>(
        Prisma.sql`SELECT * FROM fiscal_signing_keys WHERE is_active = TRUE LIMIT 1`,
      ),
    );
    if (!rows[0]) {
      throw new NotFoundException(
        'Esta empresa ainda não tem chave de assinatura fiscal. Gere uma primeiro.',
      );
    }
    return this.toPublic(rows[0]);
  }

  /**
   * Devolve um assinador pronto a usar com a chave privada activa do tenant,
   * ou `null` se ainda não houver chave configurada (emissão sem assinatura).
   *
   * Pode receber um cliente transaccional (`tx`) para correr dentro da mesma
   * transacção de emissão da factura.
   */
  async getActiveSigner(
    schema: string,
    tx?: Prisma.TransactionClient,
  ): Promise<RsaDocumentSigner | null> {
    const run = async (client: Prisma.TransactionClient) =>
      client.$queryRaw<SigningKeyRow[]>(
        Prisma.sql`SELECT key_version, algorithm, private_key_enc
                   FROM fiscal_signing_keys WHERE is_active = TRUE LIMIT 1`,
      );
    const rows = tx ? await run(tx) : await this.prisma.runInTenant(schema, run);
    if (!rows[0]) return this.getPlatformSigner();

    const privateKeyPem = decryptSecret(rows[0].private_key_enc, this.secret);
    return new RsaDocumentSigner({
      privateKeyPem,
      keyVersion: Number(rows[0].key_version),
      algorithm: rows[0].algorithm as SignatureAlgorithm,
    });
  }

  /**
   * FALLBACK: chave da PLATAFORMA (certificação AGT — a chave do produtor do
   * software). Usada quando o tenant não tem chave própria, para que TODOS os
   * documentos saiam assinados. Lê a linha `integrations` AGT_SIGNING_KEY
   * (nexus_public) — nunca falha a emissão: em erro devolve null (sem assinatura),
   * exatamente o comportamento anterior.
   */
  private async getPlatformSigner(): Promise<RsaDocumentSigner | null> {
    try {
      const row = await this.prisma.integration.findUnique({ where: { key: 'AGT_SIGNING_KEY' } });
      const s = row?.settings as { keyVersion?: number } | null;
      if (!row?.secretEnc || !s || !Number.isFinite(Number(s.keyVersion))) return null;
      const privateKeyPem = decryptSecret(row.secretEnc, this.secret);
      return new RsaDocumentSigner({ privateKeyPem, keyVersion: Number(s.keyVersion) });
    } catch {
      return null;
    }
  }

  private toPublic(r: SigningKeyRow): PublicSigningKey {
    return {
      keyVersion: Number(r.key_version),
      algorithm: r.algorithm,
      publicKey: r.public_key,
      isActive: r.is_active,
      createdAt: r.created_at,
    };
  }
}
