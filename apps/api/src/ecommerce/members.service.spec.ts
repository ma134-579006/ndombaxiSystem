import { BadRequestException } from '@nestjs/common';
import { MembersService } from './members.service';

/** PrismaService falso: runInTenant executa o callback com um tx cujo $queryRaw devolve o estado. */
function svc(status: string | null) {
  const tx = { $queryRaw: jest.fn().mockResolvedValue(status ? [{ s: status }] : []), $executeRaw: jest.fn().mockResolvedValue(1) };
  const prisma = { runInTenant: (_s: string, fn: (t: typeof tx) => unknown) => fn(tx) };
  return { service: new MembersService(prisma as never), tx };
}

describe('associados da loja online', () => {
  it('cliente desconhecido ou sem pedido fica NONE', async () => {
    expect((await svc(null).service.statusOf('t', 'a@b.c')).status).toBe('NONE');
  });
  it('só APPROVED passa a porta do catálogo reservado', async () => {
    await expect(svc('APPROVED').service.assertApproved('t', 'a@b.c')).resolves.toBeUndefined();
    for (const s of ['NONE', 'PENDING', 'REJECTED']) {
      await expect(svc(s).service.assertApproved('t', 'a@b.c')).rejects.toBeInstanceOf(BadRequestException);
    }
  });
  it('decidir sem pedido existente falha', async () => {
    const { service, tx } = svc('PENDING');
    tx.$executeRaw.mockResolvedValue(0);
    await expect(service.decide('t', '00000000-0000-0000-0000-000000000000', true)).rejects.toThrow('não encontrado');
  });
});
