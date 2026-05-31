import { Global, Module } from '@nestjs/common';
import { TenantContext } from './tenant-context';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantUserRepository } from './tenant-user.repository';

@Global()
@Module({
  providers: [TenantContext, TenantProvisioningService, TenantUserRepository],
  exports: [TenantContext, TenantProvisioningService, TenantUserRepository],
})
export class TenancyModule {}
