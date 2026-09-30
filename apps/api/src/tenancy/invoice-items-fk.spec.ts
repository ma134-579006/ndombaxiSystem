import { TenantProvisioningService } from './tenant-provisioning.service';

type Prisma = {
  $queryRawUnsafe: jest.Mock;
  $executeRawUnsafe: jest.Mock;
  $transaction: jest.Mock;
};

function make(rows: { confdeltype: string }[]): { svc: TenantProvisioningService; prisma: Prisma } {
  const prisma: Prisma = {
    $queryRawUnsafe: jest.fn().mockResolvedValue(rows),
    $executeRawUnsafe: jest.fn((sql: string) => Promise.resolve(sql)),
    $transaction: jest.fn().mockResolvedValue(undefined),
  };
  return { svc: new TenantProvisioningService(prisma as never), prisma };
}

describe('fixInvoiceItemsProductFk — eliminar produtos (regras fiscais vs ON DELETE SET NULL)', () => {
  it('troca SET NULL por NO ACTION (DROP + ADD na mesma transacção)', async () => {
    const { svc, prisma } = make([{ confdeltype: 'n' }]);
    await expect(svc.fixInvoiceItemsProductFk('tenant_abc12345')).resolves.toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const sqls = prisma.$executeRawUnsafe.mock.calls.map((c) => c[0] as string);
    expect(sqls[0]).toMatch(/DROP CONSTRAINT invoice_items_product_id_fkey/);
    expect(sqls[1]).toMatch(/ADD CONSTRAINT invoice_items_product_id_fkey FOREIGN KEY \(product_id\) REFERENCES "tenant_abc12345"\."products"\(id\)$/);
    expect(sqls[1]).not.toMatch(/ON DELETE/i); // NO ACTION por omissão
  });

  it('idempotente: já corrigido (NO ACTION) não faz nada', async () => {
    const { svc, prisma } = make([{ confdeltype: 'a' }]);
    await expect(svc.fixInvoiceItemsProductFk('tenant_abc12345')).resolves.toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('constraint ausente: não faz nada', async () => {
    const { svc, prisma } = make([]);
    await expect(svc.fixInvoiceItemsProductFk('tenant_abc12345')).resolves.toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('nunca lança (best-effort): erro do PostgreSQL devolve false', async () => {
    const { svc, prisma } = make([{ confdeltype: 'n' }]);
    prisma.$transaction.mockRejectedValue(new Error('permission denied'));
    await expect(svc.fixInvoiceItemsProductFk('tenant_abc12345')).resolves.toBe(false);
  });
});
