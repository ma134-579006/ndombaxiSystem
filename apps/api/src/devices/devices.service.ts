import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { allocateDocumentNumber } from '../common/document-counter';

/**
 * POSTOS (dispositivos) da empresa — e a SÉRIE FISCAL exclusiva de cada um.
 *
 * Porque é que isto existe, em duas frases: cada documento fiscal leva o hash
 * do documento ANTERIOR da mesma série, por exigência da AGT. Isso torna cada
 * série estritamente sequencial e com **um só escritor** — e dois postos a
 * emitir na MESMA série sem rede constroem duas cadeias divergentes com a mesma
 * numeração.
 *
 * Esse é o único erro deste sistema que não tem correção depois de acontecer:
 * renumerar um dos lados muda o cabeçalho, muda o hash e invalida a cadeia toda
 * a partir daí — e os dois documentos já foram entregues a clientes. Não se
 * resolve o conflito; impede-se por construção, dando a cada posto a sua série.
 *
 * Compatibilidade: as empresas que já emitem na série 'A' continuam nela. Os
 * postos registados a partir de agora recebem 'A1', 'A2', … que nunca colidem
 * com a série existente nem entre si.
 */

/** Prefixo das séries por posto. 'A' fica reservada ao histórico. */
const SERIES_PREFIX = 'A';
/** Chave do contador atómico que distribui os números de série. */
const SERIES_COUNTER = 'DEVICE_SERIES';

export interface DeviceRow {
  id: string;
  device_key: string;
  name: string;
  platform: string;
  store_id: string | null;
  series: string;
  is_active: boolean;
  registered_at: Date;
  last_seen_at: Date | null;
}

export interface RegisterDeviceInput {
  deviceKey: string;
  name: string;
  platform: string;
  storeId?: string | null;
}

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Regista o posto e devolve-lhe a série. **Idempotente**: o mesmo aparelho a
   * registar-se outra vez (reinstalação, novo arranque, pedido repetido por
   * rede instável) recebe SEMPRE a mesma série — nunca uma nova. Se cada
   * arranque gerasse uma série, um posto acumulava dezenas de cadeias e o SAF-T
   * ficava impossível de ler.
   */
  async register(schema: string, input: RegisterDeviceInput): Promise<DeviceRow> {
    const key = (input.deviceKey ?? '').trim();
    if (key.length < 8) {
      throw new BadRequestException('Identificador do posto inválido.');
    }
    return this.prisma.runInTenant(schema, async (tx) => {
      const existing = await tx.$queryRaw<DeviceRow[]>(
        Prisma.sql`SELECT * FROM devices WHERE device_key = ${key} LIMIT 1`,
      );
      if (existing[0]) {
        // Já registado: atualiza o que é descritivo e devolve a MESMA série.
        const updated = await tx.$queryRaw<DeviceRow[]>(
          Prisma.sql`UPDATE devices
                        SET name = ${input.name || existing[0].name},
                            platform = ${input.platform || existing[0].platform},
                            store_id = ${input.storeId ?? existing[0].store_id}::uuid,
                            last_seen_at = now()
                      WHERE device_key = ${key}
                  RETURNING *`,
        );
        return updated[0] ?? existing[0];
      }

      // Série nova, alocada ATOMICAMENTE. Duas caixas a arrancar ao mesmo
      // tempo não podem receber a mesma — e o índice único em `series` é a
      // última barreira se alguma vez algo aqui falhar.
      const seq = await allocateDocumentNumber(tx, SERIES_COUNTER, 0);
      const series = `${SERIES_PREFIX}${seq}`;
      const rows = await tx.$queryRaw<DeviceRow[]>(
        Prisma.sql`INSERT INTO devices (device_key, name, platform, store_id, series, last_seen_at)
                   VALUES (${key}, ${input.name || 'Posto'}, ${input.platform || 'desconhecida'},
                           ${input.storeId ?? null}::uuid, ${series}, now())
                   RETURNING *`,
      );
      this.logger.log(`posto registado em ${schema}: ${input.name} → série ${series}`);
      return rows[0];
    });
  }

  /** Lista os postos da empresa (para o gestor ver e nomear). */
  async list(schema: string): Promise<DeviceRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<DeviceRow[]>(
        Prisma.sql`SELECT d.*, s.name AS store_name
                   FROM devices d
                   LEFT JOIN stores s ON s.id = d.store_id
                   ORDER BY d.registered_at`,
      ),
    );
  }

  /**
   * A série deste posto, ou `null` se não estiver registado.
   *
   * O `null` é deliberado e importante: as aplicações já instaladas ainda não
   * registam o posto, e recusar a venda deixaria lojas paradas. Sem registo
   * mantém-se o comportamento de sempre (série 'A'); com registo, a série do
   * posto passa a mandar.
   */
  async seriesFor(schema: string, deviceKey: string | null | undefined): Promise<string | null> {
    const key = (deviceKey ?? '').trim();
    if (!key) return null;
    try {
      const rows = await this.prisma.runInTenant(schema, (tx) =>
        tx.$queryRaw<{ series: string; is_active: boolean }[]>(
          Prisma.sql`SELECT series, is_active FROM devices WHERE device_key = ${key} LIMIT 1`,
        ),
      );
      const d = rows[0];
      if (!d || !d.is_active) return null;
      return d.series;
    } catch (e) {
      // Schema por migrar → comporta-se como antes. Nunca derrubar uma venda.
      this.logger.debug(`seriesFor falhou (${schema}): ${e instanceof Error ? e.message.split('\n')[0] : 'erro'}`);
      return null;
    }
  }

  /** Marca atividade do posto (diagnóstico: que caixas estão vivas). */
  async touch(schema: string, deviceKey: string | null | undefined): Promise<void> {
    const key = (deviceKey ?? '').trim();
    if (!key) return;
    try {
      await this.prisma.runInTenant(schema, (tx) =>
        tx.$executeRaw(Prisma.sql`UPDATE devices SET last_seen_at = now() WHERE device_key = ${key}`),
      );
    } catch { /* best-effort */ }
  }
}
