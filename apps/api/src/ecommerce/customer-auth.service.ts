import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';

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
  ) {}

  private get secret(): string {
    return this.config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  private sign(schema: string, email: string, name: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: email, email, name, schema, typ: 'customer' },
      { secret: this.secret, expiresIn: '30d' },
    );
  }

  /** Cria/atualiza o registo do cliente (por email) — para histórico/CRM e
   *  para sincronizar com o caixa/gestor. Guarda também o PERFIL (telefone,
   *  morada, província/município/bairro, NIF) quando vier, sem apagar o que já
   *  existe (COALESCE: só sobrepõe com valor novo não vazio). */
  async upsertCustomer(schema: string, email: string, name: string, p: CustomerProfileInput = {}): Promise<void> {
    const v = (s?: string | null) => (s && s.trim() ? s.trim() : null);
    await this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM customers WHERE lower(email) = ${email} LIMIT 1`,
      );
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

  async emailLogin(schema: string, email: string, name?: string, existing?: boolean): Promise<CustomerSession> {
    const e = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) throw new BadRequestException('Email inválido.');
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
