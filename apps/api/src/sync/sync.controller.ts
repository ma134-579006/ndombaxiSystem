import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { PullDto, PushDto } from './dto/sync.dto';
import { PushService } from './push.service';
import { SyncService } from './sync.service';

/**
 * Ponte de sincronização das aplicações Windows, Android e iOS.
 *
 * Só dois endpoints, ambos POST — inclusive o `pull`, porque o cursor e a lista
 * de entidades não cabem confortavelmente numa query string e não queremos
 * estado de sincronização a ficar registado em logs de proxies.
 */
@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly pushSvc: PushService,
    private readonly ctx: TenantContext,
  ) {}

  @Post('pull')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Traz apenas o que mudou desde o cursor (delta sync)' })
  pull(@Body() dto: PullDto, @CurrentUser() user: JwtPayload) {
    const isManager = user.role !== Role.CASHIER;
    return this.sync.pull(
      this.ctx.requireTenantSchema(),
      { since: dto.since ?? null, entities: dto.entities ?? [], limit: dto.limit ?? 500 },
      isManager,
    );
  }

  @Post('push')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Sobe as operações feitas offline (idempotente por opId)' })
  push(@Body() dto: PushDto, @CurrentUser() user: JwtPayload) {
    return this.pushSvc
      .push(this.ctx.requireTenantSchema(), dto.ops, user)
      .then((results) => ({ results, serverTime: new Date().toISOString() }));
  }
}
