/**
 * Guardas FISCAIS na base de dados de cada empresa (defesa em profundidade,
 * DP 71/25 — imutabilidade dos documentos emitidos e do trilho de auditoria).
 *
 * As regras `DO INSTEAD NOTHING` de `tenant_migrations.sql` já tornam sem efeito
 * DELETE e UPDATE de campos fiscais, mas NÃO cobriam:
 *   • repor uma fatura anulada (`status` 'A' → 'N') ou "des-anular" o ciclo de vida;
 *   • estados inventados (`status` fora de N/A);
 *   • `TRUNCATE` de faturas/linhas (as regras não o apanham);
 *   • alterar/apagar o trilho de auditoria (`tenant_audit_log`).
 * Estes gatilhos dão ERRO (não silenciam), para que a tentativa falhe às claras.
 *
 * Ficam aqui (e não no .sql) porque o parser de `tenant_migrations.sql` não
 * aceita blocos `$$`. Cada entrada é UM statement completo e idempotente.
 */
export function fiscalGuardStatements(schema: string): string[] {
  const s = `"${schema}"`;
  return [
    `CREATE OR REPLACE FUNCTION ${s}.fiscal_guard_invoice_update() RETURNS trigger LANGUAGE plpgsql AS $g$
BEGIN
  IF NEW.status NOT IN ('N', 'A') THEN
    RAISE EXCEPTION 'FISCAL: estado % inválido para %', NEW.status, OLD.number USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'A' AND NEW.status <> 'A' THEN
    RAISE EXCEPTION 'FISCAL: % está anulado e não pode voltar a normal', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.doc_state = 'ANNULLED' AND NEW.doc_state <> 'ANNULLED' THEN
    RAISE EXCEPTION 'FISCAL: % está anulado (ciclo de vida)', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'A' AND NEW.doc_state <> 'ANNULLED' THEN
    RAISE EXCEPTION 'FISCAL: % anulado sem ciclo ANNULLED', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $g$`,
    `DROP TRIGGER IF EXISTS fiscal_guard_invoice_update ON ${s}."invoices"`,
    `CREATE TRIGGER fiscal_guard_invoice_update BEFORE UPDATE ON ${s}."invoices" FOR EACH ROW EXECUTE FUNCTION ${s}.fiscal_guard_invoice_update()`,

    `CREATE OR REPLACE FUNCTION ${s}.fiscal_guard_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $g$
BEGIN
  RAISE EXCEPTION 'FISCAL: % não pode ser esvaziada (documentos fiscais e auditoria são permanentes)', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $g$`,
    `DROP TRIGGER IF EXISTS fiscal_guard_truncate ON ${s}."invoices"`,
    `CREATE TRIGGER fiscal_guard_truncate BEFORE TRUNCATE ON ${s}."invoices" FOR EACH STATEMENT EXECUTE FUNCTION ${s}.fiscal_guard_no_truncate()`,
    `DROP TRIGGER IF EXISTS fiscal_guard_truncate ON ${s}."invoice_items"`,
    `CREATE TRIGGER fiscal_guard_truncate BEFORE TRUNCATE ON ${s}."invoice_items" FOR EACH STATEMENT EXECUTE FUNCTION ${s}.fiscal_guard_no_truncate()`,
    `DROP TRIGGER IF EXISTS fiscal_guard_truncate ON ${s}."tenant_audit_log"`,
    `CREATE TRIGGER fiscal_guard_truncate BEFORE TRUNCATE ON ${s}."tenant_audit_log" FOR EACH STATEMENT EXECUTE FUNCTION ${s}.fiscal_guard_no_truncate()`,

    // Trilho de auditoria: só se acrescenta. A única alteração permitida é a
    // re-selagem da cadeia (prev_hash/hash), com o conteúdo intacto.
    `CREATE OR REPLACE FUNCTION ${s}.fiscal_guard_audit() RETURNS trigger LANGUAGE plpgsql AS $g$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AUDITORIA: registos de auditoria não se apagam' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.seq IS DISTINCT FROM OLD.seq OR NEW."timestamp" IS DISTINCT FROM OLD."timestamp"
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.actor_name IS DISTINCT FROM OLD.actor_name
     OR NEW.action IS DISTINCT FROM OLD.action OR NEW.entity IS DISTINCT FROM OLD.entity
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id OR NEW.details::text IS DISTINCT FROM OLD.details::text
     OR NEW.ip IS DISTINCT FROM OLD.ip THEN
    RAISE EXCEPTION 'AUDITORIA: o conteúdo de um registo de auditoria não se altera' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $g$`,
    `DROP TRIGGER IF EXISTS fiscal_guard_audit ON ${s}."tenant_audit_log"`,
    `CREATE TRIGGER fiscal_guard_audit BEFORE UPDATE OR DELETE ON ${s}."tenant_audit_log" FOR EACH ROW EXECUTE FUNCTION ${s}.fiscal_guard_audit()`,

    // Numeração: um (tipo, série, ano, sequência) só existe uma vez (além do
    // UNIQUE(number) em texto). Se houver duplicados antigos, falha e é registado.
    `CREATE UNIQUE INDEX IF NOT EXISTS invoices_series_seq_unique ON ${s}."invoices"(doc_type, series, year, sequence)`,
  ];
}
