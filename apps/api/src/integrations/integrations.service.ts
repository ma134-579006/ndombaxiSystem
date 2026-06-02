import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { decryptSecret, encryptSecret } from '../common/crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';

export interface IntegrationFieldDef { name: string; label: string }
export interface IntegrationCatalogEntry {
  key: string;
  label: string;
  description: string;
  hasBaseUrl: boolean;
  baseUrlLabel: string;
  settingsFields: IntegrationFieldDef[];
  secretLabel: string;
}

/** Catálogo das integrações externas configuráveis pelo Super Admin. O código
 *  está pronto: cada uma activa assim que for preenchida e ligada. */
export const INTEGRATION_CATALOG: IntegrationCatalogEntry[] = [
  {
    key: 'AGT_SAFT', label: 'AGT — Envio do SAF-T',
    description: 'Envio automático do ficheiro SAF-T ao portal da AGT.',
    hasBaseUrl: true, baseUrlLabel: 'Endpoint da API AGT',
    settingsFields: [
      { name: 'softwareCertificateNumber', label: 'Nº de certificação do software' },
      { name: 'taxpayerNif', label: 'NIF do contribuinte' },
    ],
    secretLabel: 'Token / credencial AGT',
  },
  {
    key: 'OPEN_FINANCE', label: 'Open Finance — Banco',
    description: 'Saldos e movimentos bancários ao vivo (Open Finance).',
    hasBaseUrl: true, baseUrlLabel: 'Endpoint da API do banco',
    settingsFields: [
      { name: 'bankCode', label: 'Banco (código)' },
      { name: 'clientId', label: 'Client ID' },
    ],
    secretLabel: 'Client secret',
  },
  {
    key: 'STRIPE', label: 'Stripe — Cobrança recorrente',
    description: 'Cobrança recorrente das subscrições (cartão internacional).',
    hasBaseUrl: false, baseUrlLabel: '',
    settingsFields: [
      { name: 'publishableKey', label: 'Publishable key' },
      { name: 'webhookId', label: 'Webhook ID' },
    ],
    secretLabel: 'Secret key',
  },
  {
    key: 'DOCUSIGN', label: 'DocuSign — Contratos',
    description: 'Assinatura digital de contratos de subscrição.',
    hasBaseUrl: true, baseUrlLabel: 'Base URL DocuSign',
    settingsFields: [
      { name: 'accountId', label: 'Account ID' },
      { name: 'integrationKey', label: 'Integration key' },
    ],
    secretLabel: 'Chave privada / secret',
  },
  {
    key: 'BIOMETRIC', label: 'Ponto biométrico',
    description: 'Controlo de assiduidade por dispositivo biométrico.',
    hasBaseUrl: true, baseUrlLabel: 'Endpoint do dispositivo/ponte',
    settingsFields: [
      { name: 'deviceModel', label: 'Modelo do dispositivo' },
      { name: 'location', label: 'Localização' },
    ],
    secretLabel: 'Token do dispositivo',
  },
];

export interface IntegrationView extends IntegrationCatalogEntry {
  enabled: boolean;
  environment: string;
  baseUrl: string | null;
  settings: Record<string, unknown>;
  hasSecret: boolean;
  lastStatus: string | null;
  lastTestAt: Date | null;
}

export interface UpdateIntegrationInput {
  enabled?: boolean;
  environment?: 'TEST' | 'PRODUCTION';
  baseUrl?: string | null;
  settings?: Record<string, unknown>;
  secret?: string; // se vazio/omitido, mantém o existente
}

/** Configuração ACTIVA (com segredo desencriptado) para os adaptadores usarem. */
export interface ActiveIntegration {
  key: string;
  environment: string;
  baseUrl: string | null;
  settings: Record<string, unknown>;
  secret: string | null;
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get key(): string {
    return this.config.get('CONFIG_ENCRYPTION_KEY', { infer: true });
  }

  private entry(key: string): IntegrationCatalogEntry {
    const e = INTEGRATION_CATALOG.find((c) => c.key === key);
    if (!e) throw new BadRequestException(`Integração desconhecida: ${key}`);
    return e;
  }

  /** Lista todas as integrações (catálogo + estado actual), sem expor segredos. */
  async list(): Promise<IntegrationView[]> {
    const rows = await this.prisma.integration.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return INTEGRATION_CATALOG.map((c) => {
      const r = byKey.get(c.key);
      return {
        ...c,
        enabled: r?.enabled ?? false,
        environment: r?.environment ?? 'TEST',
        baseUrl: r?.baseUrl ?? null,
        settings: (r?.settings as Record<string, unknown>) ?? {},
        hasSecret: !!r?.secretEnc,
        lastStatus: r?.lastStatus ?? null,
        lastTestAt: r?.lastTestAt ?? null,
      };
    });
  }

  async update(key: string, dto: UpdateIntegrationInput): Promise<IntegrationView> {
    const entry = this.entry(key);
    const existing = await this.prisma.integration.findUnique({ where: { key } });
    const secretEnc =
      dto.secret && dto.secret.trim().length > 0
        ? encryptSecret(dto.secret.trim(), this.key)
        : existing?.secretEnc ?? null;

    await this.prisma.integration.upsert({
      where: { key },
      create: {
        key, label: entry.label,
        enabled: dto.enabled ?? false,
        environment: dto.environment ?? 'TEST',
        baseUrl: dto.baseUrl ?? null,
        settings: (dto.settings ?? {}) as object,
        secretEnc,
      },
      update: {
        enabled: dto.enabled ?? existing?.enabled ?? false,
        environment: dto.environment ?? existing?.environment ?? 'TEST',
        baseUrl: dto.baseUrl !== undefined ? dto.baseUrl : existing?.baseUrl ?? null,
        settings: (dto.settings ?? existing?.settings ?? {}) as object,
        secretEnc,
      },
    });
    return (await this.list()).find((v) => v.key === key)!;
  }

  /** Teste de ligação simples (reachability). Guarda o resultado. */
  async test(key: string): Promise<{ ok: boolean; status: string }> {
    const entry = this.entry(key);
    const row = await this.prisma.integration.findUnique({ where: { key } });
    let result: { ok: boolean; status: string };

    if (!row || !row.enabled) {
      result = { ok: false, status: 'Integração desligada' };
    } else if (entry.hasBaseUrl) {
      if (!row.baseUrl) {
        result = { ok: false, status: 'Falta o endpoint (Base URL)' };
      } else if (!isSafePublicUrl(row.baseUrl)) {
        // Defesa SSRF: não deixar o servidor sondar alvos internos/privados.
        result = { ok: false, status: 'URL inválido (use https público, não endereços internos)' };
      } else {
        try {
          const res = await fetch(row.baseUrl, { method: 'GET', signal: AbortSignal.timeout(6000) });
          result = { ok: res.status < 500, status: `Resposta HTTP ${res.status}` };
        } catch (e) {
          result = { ok: false, status: `Sem ligação: ${(e as Error).message}` };
        }
      }
    } else {
      result = row.secretEnc
        ? { ok: true, status: 'Credenciais guardadas' }
        : { ok: false, status: 'Faltam credenciais' };
    }

    await this.prisma.integration.update({
      where: { key },
      data: { lastStatus: result.status, lastTestAt: new Date() },
    }).catch(() => undefined);
    return result;
  }

  /**
   * Configuração ACTIVA de uma integração (segredo desencriptado), para os
   * adaptadores. Devolve null se a integração não existir ou estiver desligada.
   */
  async getActive(key: string): Promise<ActiveIntegration | null> {
    const row = await this.prisma.integration.findUnique({ where: { key } });
    if (!row || !row.enabled) return null;
    let secret: string | null = null;
    if (row.secretEnc) {
      try { secret = decryptSecret(row.secretEnc, this.key); }
      catch (e) { this.logger.error(`Falha ao desencriptar segredo de ${key}`, (e as Error).stack); }
    }
    return {
      key: row.key,
      environment: row.environment,
      baseUrl: row.baseUrl,
      settings: (row.settings as Record<string, unknown>) ?? {},
      secret,
    };
  }
}

/**
 * Defesa SSRF: só permite testar URLs http(s) com host público — bloqueia
 * loopback, redes privadas e link-local (ex.: 169.254.169.254 metadata).
 */
function isSafePublicUrl(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false;
  // IPv4 privado / loopback / link-local
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return false;
  }
  // IPv6 loopback / link-local / ULA
  if (host === '::1' || host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) return false;
  return true;
}
