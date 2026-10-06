import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { MailService } from '../common/mail/mail.service';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';

/** Domínio das contas rápidas sem email (nunca se mostra nem se envia email para ele). */
export const PLACEHOLDER_EMAIL_DOMAIN = '@sem-email.lps';
export const isPlaceholderEmail = (e?: string | null): boolean => !!e && e.toLowerCase().endsWith(PLACEHOLDER_EMAIL_DOMAIN);

export interface CustomerSession {
  token: string;
  customer: { email: string; name: string };
}

export interface CustomerProfile {
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  province: string | null;
  municipality: string | null;
  neighborhood: string | null;
  taxId: string | null;
}

export interface CustomerProfileInput {
  name?: string;
  phone?: string | null;
  address?: string | null;
  province?: string | null;
  municipality?: string | null;
  neighborhood?: string | null;
  taxId?: string | null;
}

interface CustomerClaims {
  sub: string;
  email: string;
  name: string;
  schema: string;
  typ: 'customer';
}

/**
 * Login simples do cliente da loja online (§6). Duas vias:
 *  • Email — conta rápida (cria/atualiza o cliente, sem senha).
 *  • Google — valida o ID token no servidor (email verificado) e entra.
 * Devolve um token de cliente (JWT, 30 dias) usado para ver "as minhas
 * encomendas" e conversar com a loja com histórico.
 */
@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly mail: MailService,
  ) {}

  /** Formas de entrar disponíveis nesta instalação (a loja esconde as que não existem). */
  async loginMethods(): Promise<{ email: boolean; google: boolean; quick: boolean }> {
    const email = await this.mail.isEnabled().catch(() => false);
    const google = /\.apps\.googleusercontent\.com$/.test(process.env.GOOGLE_CLIENT_ID ?? '');
    // Conta rápida (sem código) está sempre disponível.
    return { email, google, quick: true };
  }

  private get secret(): string {
    return this.config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  private sign(schema: string, email: string, name: string, expiresIn: string = '30d'): Promise<string> {
    return this.jwt.signAsync(
      { sub: email, email, name, schema, typ: 'customer' },
      { secret: this.secret, expiresIn },
    );
  }

  /**
   * CONTA RÁPIDA — sem código nem formulário: o cliente toca "Criar conta",
   * autoriza o GPS (pedido no telemóvel) e já pode comprar. Nome, telefone e
   * email são opcionais. Sem email, a conta fica ligada a este aparelho (sessão
   * longa). Um email JÁ registado nunca é entregue assim (isso daria a conta de
   * outra pessoa a quem só soubesse o email): para essa usa-se "Entrar".
   */
  async quickSignup(schema: string, p: { name?: string; phone?: string; email?: string }): Promise<CustomerSession> {
    let e = p.email?.trim().toLowerCase() || '';
    if (e) {
      const exists = await this.prisma.runInTenant(schema, (tx) =>
        tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM customers WHERE lower(email) = ${e} LIMIT 1`),
      );
      if (exists[0]) throw new ConflictException('Já existe uma conta com este email nesta loja. Toque em "Entrar".');
    } else {
      e = `cliente-${randomBytes(6).toString('hex')}${PLACEHOLDER_EMAIL_DOMAIN}`;
    }
    const nm = (p.name?.trim() || (p.email ? e.split('@')[0] : 'Cliente')).slice(0, 120);
    await this.upsertCustomer(schema, e, nm, { phone: p.phone });
    return { token: await this.sign(schema, e, nm, '730d'), customer: { email: e, name: nm } };
  }

  /** Cria/atualiza o registo do cliente (por email) — para histórico/CRM e
   *  para sincronizar com o caixa/gestor. Guarda também o PERFIL (telefone,
   *  morada, província/município/bairro, NIF) quando vier, sem apagar o que já
   *  existe (COALESCE: só sobrepõe com valor novo não vazio). */
  async upsertCustomer(
    schema: string, email: string, name: string, p: CustomerProfileInput = {},
    /** Pedidos públicos sem sessão: só CRIA; nunca altera um cliente existente
     *  (senão qualquer anónimo reescrevia o nome/telefone/NIF de outra pessoa). */
    insertOnly = false,
  ): Promise<void> {
    const v = (s?: string | null) => (s && s.trim() ? s.trim() : null);
    await this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM customers WHERE lower(email) = ${email} LIMIT 1`,
      );
      if (rows[0] && insertOnly) return;
      if (rows[0]) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE customers SET
            name = ${name},
            phone        = COALESCE(${v(p.phone)}, phone),
            address      = COALESCE(${v(p.address)}, address),
            province     = COALESCE(${v(p.province)}, province),
            municipality = COALESCE(${v(p.municipality)}, municipality),
            neighborhood = COALESCE(${v(p.neighborhood)}, neighborhood),
            tax_id       = COALESCE(${v(p.taxId)}, tax_id),
            updated_at = now()
          WHERE id = ${rows[0].id}::uuid`);
      } else {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO customers (name, email, phone, address, province, municipality, neighborhood, tax_id)
          VALUES (${name}, ${email}, ${v(p.phone)}, ${v(p.address)}, ${v(p.province)}, ${v(p.municipality)}, ${v(p.neighborhood)}, ${v(p.taxId)})`);
      }
    });
  }

  /** Perfil guardado do cliente (para pré-preencher o checkout). */
  async getProfile(schema: string, email: string): Promise<CustomerProfile> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CustomerProfile[]>(Prisma.sql`
        SELECT name, email, phone, address, province, municipality, neighborhood, tax_id AS "taxId"
        FROM customers WHERE lower(email) = ${email} LIMIT 1`),
    );
    return rows[0] ?? { name: '', email, phone: null, address: null, province: null, municipality: null, neighborhood: null, taxId: null };
  }

  /** Atualiza o perfil do cliente (a partir da "A minha conta"). */
  async updateProfile(schema: string, email: string, name: string, p: CustomerProfileInput): Promise<CustomerProfile> {
    await this.upsertCustomer(schema, email, (p.name?.trim() || name).slice(0, 120), p);
    return this.getProfile(schema, email);
  }

  /**
   * PASSO 1 do login por email: envia um código de 6 dígitos (10 min) para o email.
   * Sem isto qualquer pessoa entrava na conta de um cliente sabendo só o email
   * (encomendas, morada, NIF, dados clínicos). No máximo um código por minuto.
   */
  async sendEmailCode(schema: string, email: string, existing?: boolean): Promise<{ sent: true }> {
    const e = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) throw new BadRequestException('Email inválido.');
    if (!(await this.mail.isEnabled())) {
      throw new BadRequestException('O login por email não está disponível nesta loja. Entre com o Google.');
    }
    if (existing) {
      const rows = await this.prisma.runInTenant(schema, (tx) =>
        tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT 1 AS n FROM customers WHERE lower(email) = ${e} LIMIT 1`),
      );
      if (!rows[0]) throw new BadRequestException('Não encontrámos nenhuma conta com este email nesta loja. Toque em "Criar conta".');
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const sent = await this.prisma.runInTenant(schema, async (tx) => {
      const recent = await tx.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT 1 AS n FROM customer_login_codes WHERE email = ${e} AND created_at > now() - interval '60 seconds'`,
      );
      if (recent[0]) return false;
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO customer_login_codes (email, code_hash, expires_at, attempts, created_at)
        VALUES (${e}, ${hashCode(e, code)}, now() + interval '10 minutes', 0, now())
        ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
          attempts = 0, created_at = now()`);
      return true;
    });
    if (!sent) throw new BadRequestException('Já enviámos um código há menos de um minuto. Verifique o seu email.');
    await this.mail.send(e, 'O seu código de acesso', `O seu código para entrar na loja é: ${code}\n\nVálido durante 10 minutos. Se não pediu este código, ignore este email.`);
    return { sent: true };
  }

  /** Confirma o código (5 tentativas, 10 min) e consome-o. */
  private async verifyEmailCode(schema: string, e: string, code: string | undefined): Promise<void> {
    if (!code || !/^\d{6}$/.test(code)) throw new BadRequestException('Indique o código de 6 dígitos enviado para o seu email.');
    const ok = await this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ code_hash: string; attempts: number; valid: boolean }[]>(
        Prisma.sql`SELECT code_hash, attempts, expires_at > now() AS valid FROM customer_login_codes WHERE email = ${e} FOR UPDATE`,
      );
      const r = rows[0];
      if (!r || !r.valid || r.attempts >= 5) return 'expired' as const;
      if (r.code_hash !== hashCode(e, code)) {
        await tx.$executeRaw(Prisma.sql`UPDATE customer_login_codes SET attempts = attempts + 1 WHERE email = ${e}`);
        return 'wrong' as const;
      }
      await tx.$executeRaw(Prisma.sql`DELETE FROM customer_login_codes WHERE email = ${e}`);
      return 'ok' as const;
    });
    if (ok === 'expired') throw new BadRequestException('O código expirou ou excedeu as tentativas. Peça um novo código.');
    if (ok === 'wrong') throw new BadRequestException('Código incorreto.');
  }

  async emailLogin(schema: string, email: string, name?: string, existing?: boolean, code?: string): Promise<CustomerSession> {
    const e = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) throw new BadRequestException('Email inválido.');
    await this.verifyEmailCode(schema, e, code);
    // Modo ENTRAR (conta existente): não cria nada — se o email não estiver
    // registado nesta loja, avisa o cliente para criar conta primeiro.
    if (existing) {
      const rows = await this.prisma.runInTenant(schema, (tx) =>
        tx.$queryRaw<{ name: string | null }[]>(
          Prisma.sql`SELECT name FROM customers WHERE lower(email) = ${e} LIMIT 1`,
        ),
      );
      if (!rows[0]) {
        throw new BadRequestException('Não encontrámos nenhuma conta com este email nesta loja. Toque em "Criar conta".');
      }
      const nm = (rows[0].name?.trim() || e.split('@')[0]).slice(0, 120);
      return { token: await this.sign(schema, e, nm), customer: { email: e, name: nm } };
    }
    const nm = (name?.trim() || e.split('@')[0]).slice(0, 120);
    await this.upsertCustomer(schema, e, nm).catch(() => undefined);
    return { token: await this.sign(schema, e, nm), customer: { email: e, name: nm } };
  }

  async googleLogin(schema: string, idToken: string): Promise<CustomerSession> {
    if (!idToken) throw new BadRequestException('Falta o token do Google.');
    let payload: Record<string, unknown>;
    try {
      const res = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      );
      if (!res.ok) throw new Error(`tokeninfo ${res.status}`);
      payload = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(`Token Google inválido: ${err instanceof Error ? err.message : 'erro'}`);
      throw new UnauthorizedException('Não foi possível validar a conta Google.');
    }

    const email = String(payload.email ?? '').toLowerCase();
    const emailVerified = payload.email_verified;
    if (!email || emailVerified === false || emailVerified === 'false') {
      throw new UnauthorizedException('A conta Google não tem email verificado.');
    }
    // Verifica que o token foi emitido para a nossa app (se configurado).
    const expected = process.env.GOOGLE_CLIENT_ID;
    const aud = String(payload.aud ?? '');
    if (expected && aud && !aud.startsWith(expected)) {
      this.logger.warn(`Google aud inesperado (${aud})`);
      throw new UnauthorizedException('Conta Google não autorizada para esta loja.');
    }

    const name = String(payload.name ?? payload.given_name ?? email.split('@')[0]);
    await this.upsertCustomer(schema, email, name).catch(() => undefined);
    return { token: await this.sign(schema, email, name), customer: { email, name } };
  }

  /** Valida o token de cliente e garante que pertence a esta loja. */
  async verify(schema: string, authHeader?: string): Promise<CustomerClaims> {
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (!token) throw new UnauthorizedException('Inicie sessão para continuar.');
    let claims: CustomerClaims;
    try {
      claims = await this.jwt.verifyAsync<CustomerClaims>(token, { secret: this.secret });
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
    if (claims.typ !== 'customer' || claims.schema !== schema) {
      throw new UnauthorizedException('Sessão inválida para esta loja.');
    }
    return claims;
  }

  /** Histórico de encomendas do cliente (por email). */
  listOrders(schema: string, email: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT id, order_number, status, payment_method, gross_total, created_at
                   FROM web_orders
                   WHERE lower(customer_email) = ${email}
                   ORDER BY created_at DESC LIMIT 100`,
      ),
    );
  }
}

/** Hash do código (nunca se guarda o código em claro). */
function hashCode(email: string, code: string): string {
  return createHash('sha256').update(`${email}:${code}`).digest('hex');
}
