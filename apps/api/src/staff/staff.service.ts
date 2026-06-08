import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PasswordService } from '../auth/password.service';
import { AuditService } from '../audit/audit.service';
import { Role } from '../rbac/roles.enum';
import { CreateStaffDto, ResetPasswordDto, SetPinDto, UpdateStaffDto } from './dto/staff.dto';
import { CreateStoreDto, UpdateStoreDto } from './dto/store.dto';
import { assertAssignableRole } from './staff.roles';
import { StaffRepository, type StaffRow, type StoreRow } from './staff.repository';
import { PlanLimitsService } from '../plans/plan-limits.service';

/** Actor que executa a operação (do JWT). */
export interface StaffActor {
  sub: string;
  role: string;
}

export interface CreatedStaff {
  user: StaffRow;
  /** Só presente quando foi gerada automaticamente (mostrar uma vez ao admin). */
  temporaryPassword?: string;
}

/**
 * Gestão de equipa (funcionários/utilizadores) e lojas de uma empresa.
 * Reservado a COMPANY_ADMIN (criar/editar) — leitura também por gestores.
 * Aplica RBAC: ninguém atribui um papel com mais poder do que o seu.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly repo: StaffRepository,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  private generateTempPassword(): string {
    return randomBytes(9).toString('base64url'); // ~12 caracteres
  }

  // ── Lojas ──────────────────────────────────────────────────
  listStores(schema: string): Promise<StoreRow[]> {
    return this.repo.listStores(schema);
  }

  async createStore(schema: string, actor: StaffActor, dto: CreateStoreDto): Promise<StoreRow> {
    await this.planLimits.assertCanCreate(schema, 'stores');
    const store = await this.repo.createStore(schema, {
      code: dto.code,
      name: dto.name,
      address: dto.address ?? null,
      isDefault: dto.isDefault,
    });
    await this.audit.record({
      actorType: 'TENANT',
      actorId: actor.sub,
      tenantSchema: schema,
      action: 'STORE_CREATED',
      entity: 'Store',
      entityId: store.id,
      after: { code: store.code, name: store.name },
    });
    return store;
  }

  async updateStore(schema: string, id: string, dto: UpdateStoreDto): Promise<StoreRow> {
    await this.repo.getStore(schema, id); // garante existência (404)
    return this.repo.updateStore(schema, id, dto);
  }

  // ── Funcionários ───────────────────────────────────────────
  listStaff(schema: string): Promise<StaffRow[]> {
    return this.repo.listStaff(schema);
  }

  async createStaff(schema: string, actor: StaffActor, dto: CreateStaffDto): Promise<CreatedStaff> {
    await this.planLimits.assertCanCreate(schema, 'users');
    const role = assertAssignableRole(actor.role as Role, dto.role);
    const email = dto.email.toLowerCase();
    if (await this.repo.existsByEmail(schema, email)) {
      throw new ConflictException('Já existe um funcionário com este e-mail.');
    }

    const generated = dto.password ? undefined : this.generateTempPassword();
    const plain = dto.password ?? generated!;
    const passwordHash = await this.passwords.hash(plain);
    const pinHash = dto.pin ? await this.passwords.hash(dto.pin) : null;

    const user = await this.repo.createUser(schema, {
      email,
      name: dto.name,
      role,
      passwordHash,
      storeId: dto.storeId ?? null,
      pinHash,
      mustResetPw: !dto.password, // se a senha foi gerada, obriga a trocar no 1.º login
    });

    await this.audit.record({
      actorType: 'TENANT',
      actorId: actor.sub,
      tenantSchema: schema,
      action: 'STAFF_CREATED',
      entity: 'User',
      entityId: user.id,
      after: { email, role, storeId: user.store_id },
    });

    return { user, temporaryPassword: generated };
  }

  async updateStaff(
    schema: string,
    actor: StaffActor,
    id: string,
    dto: UpdateStaffDto,
  ): Promise<StaffRow> {
    await this.repo.getStaff(schema, id); // 404 se não existir
    const role = dto.role ? assertAssignableRole(actor.role as Role, dto.role) : undefined;
    return this.repo.updateStaff(schema, id, {
      name: dto.name,
      role,
      storeId: dto.storeId,
      isActive: dto.isActive,
    });
  }

  async resetPassword(
    schema: string,
    actor: StaffActor,
    id: string,
    dto: ResetPasswordDto,
  ): Promise<{ temporaryPassword?: string }> {
    await this.repo.getStaff(schema, id);
    const generated = dto.password ? undefined : this.generateTempPassword();
    const plain = dto.password ?? generated!;
    const hash = await this.passwords.hash(plain);
    await this.repo.setPasswordHash(schema, id, hash, !dto.password);
    await this.audit.record({
      actorType: 'TENANT',
      actorId: actor.sub,
      tenantSchema: schema,
      action: 'STAFF_PASSWORD_RESET',
      entity: 'User',
      entityId: id,
    });
    return { temporaryPassword: generated };
  }

  async setPin(schema: string, id: string, dto: SetPinDto): Promise<{ ok: true }> {
    await this.repo.getStaff(schema, id);
    const hash = await this.passwords.hash(dto.pin);
    await this.repo.setPinHash(schema, id, hash);
    return { ok: true };
  }

  async deactivate(schema: string, actor: StaffActor, id: string): Promise<StaffRow> {
    if (actor.sub === id) {
      throw new BadRequestException('Não pode desactivar a sua própria conta.');
    }
    const user = await this.repo.updateStaff(schema, id, { isActive: false });
    await this.audit.record({
      actorType: 'TENANT',
      actorId: actor.sub,
      tenantSchema: schema,
      action: 'STAFF_DEACTIVATED',
      entity: 'User',
      entityId: id,
    });
    return user;
  }
}
