-- ════════════════════════════════════════════════════════════
-- Migrações idempotentes de schema de TENANT.
-- Alinham tenants criados antes de novas colunas existirem.
-- Tabelas novas em falta são criadas ao reaplicar o template
-- (CREATE TABLE IF NOT EXISTS); aqui ficam as COLUNAS adicionadas
-- a tabelas que já existiam. Tudo IF NOT EXISTS → seguro de repetir.
-- ════════════════════════════════════════════════════════════
ALTER TABLE IF EXISTS "{{SCHEMA}}"."products"      ADD COLUMN IF NOT EXISTS cost_price NUMERIC(14,2) NOT NULL DEFAULT 0;
-- Stock por LOJA (elimina armazém): o warehouse_id passa a guardar o id da LOJA.
-- Remove as FKs antigas que apontavam para warehouses (o repoint dos dados é feito
-- pelo script de migração; novas linhas usam o id da loja).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."stock_items"     DROP CONSTRAINT IF EXISTS stock_items_warehouse_id_fkey;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."stock_movements" DROP CONSTRAINT IF EXISTS stock_movements_warehouse_id_fkey;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."stock_counts"    DROP CONSTRAINT IF EXISTS stock_counts_warehouse_id_fkey;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."product_batches" DROP CONSTRAINT IF EXISTS product_batches_warehouse_id_fkey;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."products"      ADD COLUMN IF NOT EXISTS exemption_reason TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."products"      ADD COLUMN IF NOT EXISTS exemption_code TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."invoice_items" ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."invoice_items" ADD COLUMN IF NOT EXISTS exemption_reason TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."invoice_items" ADD COLUMN IF NOT EXISTS exemption_code TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."invoices"      ADD COLUMN IF NOT EXISTS signature TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."invoices"      ADD COLUMN IF NOT EXISTS signature_key_version INT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."users"         ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."users"         ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS "{{SCHEMA}}"."employees"     ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."employees"     ADD COLUMN IF NOT EXISTS taxable_allowances NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."employees"     ADD COLUMN IF NOT EXISTS exempt_allowances NUMERIC(14,2) NOT NULL DEFAULT 0;
