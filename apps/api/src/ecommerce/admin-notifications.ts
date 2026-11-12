import { Body, Controller, Delete, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenancy/tenant-context';

export interface AdminNotificationInput { kind: string; title: string; body?: string | null; section?: string | null; ref?: string | null }

/**
 * Central de notificações do painel de cada empresa: encomendas da loja online, pedidos e
 * mensagens dos associados do LPS Kwanza, saques… Cada notificação pode ser marcada como lida
 * ou eliminada (uma a uma ou várias de uma vez).
 */
@Injectable()
export class AdminNotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async push(schema: string, n: AdminNotificationInput): Promise<void> {
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw(Prisma.sql`
      INSERT INTO admin_notifications (kind, title, body, section, ref)
      VALUES (${n.kind.slice(0, 40)}, ${n.title.slice(0, 160)}, ${(n.body ?? '').slice(0, 400) || null}, ${n.section ?? null}, ${n.ref ?? null})`)).catch(() => undefined);
  }

  async list(schema: string, unreadOnly = false) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const items = await tx.$queryRaw<{ id: string; kind: string; title: string; body: string | null; section: string | null; ref: string | null; read_at: Date | null; created_at: Date }[]>(Prisma.sql`
        SELECT id, kind, title, body, section, ref, read_at, created_at FROM admin_notifications
        WHERE (${unreadOnly} = FALSE OR read_at IS NULL) ORDER BY created_at DESC LIMIT 200`);
      const unread = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS n FROM admin_notifications WHERE read_at IS NULL`);
      return {
        unread: Number(unread[0]?.n ?? 0),
        items: items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, body: i.body, section: i.section, ref: i.ref, read: !!i.read_at, createdAt: i.created_at.toISOString() })),
      };
    });
  }

  async read(schema: string, ids: string[] | 'all', read = true) {
    await this.prisma.runInTenant(schema, (tx) => (ids === 'all'
      ? tx.$executeRaw(Prisma.sql`UPDATE admin_notifications SET read_at = ${read ? Prisma.sql`now()` : null} WHERE ${read ? Prisma.sql`read_at IS NULL` : Prisma.sql`TRUE`}`)
      : ids.length ? tx.$executeRaw(Prisma.sql`UPDATE admin_notifications SET read_at = ${read ? Prisma.sql`now()` : null} WHERE id = ANY(${ids}::uuid[])`) : Promise.resolve(0)));
    return { ok: true as const };
  }

  async remove(schema: string, ids: string[] | 'all') {
    await this.prisma.runInTenant(schema, (tx) => (ids === 'all'
      ? tx.$executeRaw(Prisma.sql`DELETE FROM admin_notifications`)
      : ids.length ? tx.$executeRaw(Prisma.sql`DELETE FROM admin_notifications WHERE id = ANY(${ids}::uuid[])`) : Promise.resolve(0)));
    return { ok: true as const };
  }
}

class IdsDto { @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) ids!: string[]; }

@ApiTags('notifications')
@Controller('notifications')
export class AdminNotificationsController {
  constructor(private readonly n: AdminNotificationsService, private readonly ctx: TenantContext) {}

  @Get() @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Notificações do painel (mais recentes primeiro)' })
  list(@Query('unread') unread?: string) { return this.n.list(this.ctx.requireTenantSchema(), unread === '1'); }

  @Post('read') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Marca como lidas' })
  read(@Body() d: IdsDto) { return this.n.read(this.ctx.requireTenantSchema(), d.ids, true); }

  @Post('unread') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Marca como não lidas' })
  unread(@Body() d: IdsDto) { return this.n.read(this.ctx.requireTenantSchema(), d.ids, false); }

  @Post('read-all') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Marca todas como lidas' })
  readAll() { return this.n.read(this.ctx.requireTenantSchema(), 'all', true); }

  @Post('delete') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Elimina as notificações indicadas' })
  removeMany(@Body() d: IdsDto) { return this.n.remove(this.ctx.requireTenantSchema(), d.ids); }

  @Delete('all') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Elimina todas' })
  removeAll() { return this.n.remove(this.ctx.requireTenantSchema(), 'all'); }

  @Delete(':id') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Elimina uma notificação' })
  remove(@Param('id') id: string) { return this.n.remove(this.ctx.requireTenantSchema(), [id]); }
}
