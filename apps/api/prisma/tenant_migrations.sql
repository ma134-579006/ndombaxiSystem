-- ════════════════════════════════════════════════════════════
-- Migrações idempotentes de schema de TENANT.
-- Alinham tenants criados antes de novas colunas existirem.
-- Tabelas novas em falta são criadas ao reaplicar o template
-- (CREATE TABLE IF NOT EXISTS); aqui ficam as COLUNAS adicionadas
-- a tabelas que já existiam. Tudo IF NOT EXISTS → seguro de repetir.
-- ════════════════════════════════════════════════════════════
ALTER TABLE IF EXISTS "{{SCHEMA}}"."products"      ADD COLUMN IF NOT EXISTS cost_price NUMERIC(14,2) NOT NULL DEFAULT 0;
-- Perfil completo do cliente (loja online) — para não repetir dados no checkout
-- e sincronizar com o caixa/gestor.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."customers" ADD COLUMN IF NOT EXISTS province     TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."customers" ADD COLUMN IF NOT EXISTS municipality TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."customers" ADD COLUMN IF NOT EXISTS neighborhood TEXT;
-- Stock por LOJA (elimina armazém): o warehouse_id passa a guardar o id da LOJA.
-- Remove as FKs antigas que apontavam para warehouses (o repoint dos dados é feito
-- pelo script de migração; novas linhas usam o id da loja).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."stock_items"     DROP CONSTRAINT IF EXISTS stock_items_warehouse_id_fkey;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."stock_movements" DROP CONSTRAINT IF EXISTS stock_movements_warehouse_id_fkey;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."stock_counts"    DROP CONSTRAINT IF EXISTS stock_counts_warehouse_id_fkey;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."product_batches" DROP CONSTRAINT IF EXISTS product_batches_warehouse_id_fkey;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."products"      ADD COLUMN IF NOT EXISTS brand TEXT;
-- Stock híbrido: produtos JÁ EXISTENTES tornam-se "stock central partilhado" (TRUE)
-- para preservarem exactamente o comportamento atual (o caixa lê o stock_qty global
-- em todas as lojas). Produtos NOVOS são criados por loja (FALSE) pelo createProduct.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."products"      ADD COLUMN IF NOT EXISTS shared_stock BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."users"         ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."employees"     ADD COLUMN IF NOT EXISTS bonus NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."employees"     ADD COLUMN IF NOT EXISTS absence_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0;
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
-- Dizeres livres do recibo/relatório (rodapé configurável pela empresa).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."site_settings"  ADD COLUMN IF NOT EXISTS receipt_message TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."site_settings"  ADD COLUMN IF NOT EXISTS default_iva_code TEXT NOT NULL DEFAULT 'NOR';
-- Setup obrigatório concluído? Empresas existentes = TRUE (não afeta); novos registos põem FALSE.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."site_settings"  ADD COLUMN IF NOT EXISTS setup_completed BOOLEAN NOT NULL DEFAULT TRUE;

-- Câmaras de vigilância (config + gravação por instantâneos)
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."cameras" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  stream_url TEXT NOT NULL,
  snapshot_url TEXT,
  kind TEXT NOT NULL DEFAULT 'AUTO',
  notes TEXT,
  record BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Ligação por NUVEM/P2P (DVR XMEye/Danale e afins): guarda o SN do equipamento
-- e os links das apps para gerar o «Guia» de 3 QR (iOS/Android/SN).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."cameras" ADD COLUMN IF NOT EXISTS conn_type   TEXT NOT NULL DEFAULT 'STREAM';
ALTER TABLE IF EXISTS "{{SCHEMA}}"."cameras" ADD COLUMN IF NOT EXISTS device_sn   TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."cameras" ADD COLUMN IF NOT EXISTS app_ios     TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."cameras" ADD COLUMN IF NOT EXISTS app_android TEXT;
-- streams de nuvem não têm URL HTTP → permite stream_url vazio para conn_type='P2P'
ALTER TABLE IF EXISTS "{{SCHEMA}}"."cameras" ALTER COLUMN stream_url DROP NOT NULL;

-- Rascunho do carrinho por operador (persiste no servidor → segue o utilizador
-- para QUALQUER dispositivo onde se ligar; sobrevive a queda de energia).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."users" ADD COLUMN IF NOT EXISTS cart_draft JSONB;

-- Chat de equipa (gerente ↔ caixa): marca a última leitura por utilizador para o
-- indicador de mensagens não-lidas (badge estilo rede social).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."users" ADD COLUMN IF NOT EXISTS chat_read_at TIMESTAMPTZ;
-- Chat 1:1 (DM): destinatário, soft-delete e presença (online/offline).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."staff_messages" ADD COLUMN IF NOT EXISTS recipient_id UUID;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."staff_messages" ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."users" ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
-- Chat com clientes da loja: presença e leitura (staff/cliente).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."customers" ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."customers" ADD COLUMN IF NOT EXISTS staff_read_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."customers" ADD COLUMN IF NOT EXISTS customer_read_at TIMESTAMPTZ;

-- Pagamento por referência Multicaixa nas encomendas online: guarda a entidade
-- EMIS e a referência gerada → permite reconhecer o pagamento (callback EMIS) e
-- aprovar a encomenda automaticamente.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."web_orders" ADD COLUMN IF NOT EXISTS payment_entity    TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."web_orders" ADD COLUMN IF NOT EXISTS payment_reference TEXT;
CREATE INDEX IF NOT EXISTS web_orders_reference_idx ON "{{SCHEMA}}"."web_orders"(payment_reference);

-- Liga um utilizador (login) ao seu registo de funcionário em RH, para que o
-- consumo próprio seja descontado no salário certo.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."employees" ADD COLUMN IF NOT EXISTS user_id UUID;

-- Consumo próprio dos funcionários (descontado no salário em RH).
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."employee_consumptions" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  employee_id     UUID REFERENCES "{{SCHEMA}}"."employees"(id) ON DELETE SET NULL,
  staff_name      TEXT NOT NULL,
  product_id      UUID REFERENCES "{{SCHEMA}}"."products"(id) ON DELETE SET NULL,
  product_code    TEXT NOT NULL,
  description     TEXT NOT NULL,
  quantity        NUMERIC(14,3) NOT NULL,
  unit_price      NUMERIC(14,2) NOT NULL,   -- preço c/ IVA no momento (AOA)
  total           NUMERIC(14,2) NOT NULL,   -- quantity * unit_price
  reason          TEXT NOT NULL DEFAULT 'SELF_CONSUMPTION',
  status          TEXT NOT NULL DEFAULT 'PENDING', -- PENDING (por descontar) / DEDUCTED (já na folha)
  payroll_item_id UUID,                     -- ligado quando processado na folha
  store_id        UUID REFERENCES "{{SCHEMA}}"."stores"(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emp_consumption_user_idx   ON "{{SCHEMA}}"."employee_consumptions"(user_id);
CREATE INDEX IF NOT EXISTS emp_consumption_status_idx ON "{{SCHEMA}}"."employee_consumptions"(status);

-- Localização GPS do cliente por encomenda (entrega): capturada no checkout
-- (consentimento obrigatório) e atualizada em tempo real enquanto a encomenda
-- está ativa, para o gestor/gerente/supervisor ver a posição exata na entrega.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."web_orders" ADD COLUMN IF NOT EXISTS geo_lat        NUMERIC(10,7);
ALTER TABLE IF EXISTS "{{SCHEMA}}"."web_orders" ADD COLUMN IF NOT EXISTS geo_lng        NUMERIC(10,7);
ALTER TABLE IF EXISTS "{{SCHEMA}}"."web_orders" ADD COLUMN IF NOT EXISTS geo_accuracy   NUMERIC(8,2);
ALTER TABLE IF EXISTS "{{SCHEMA}}"."web_orders" ADD COLUMN IF NOT EXISTS geo_updated_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."web_orders" ADD COLUMN IF NOT EXISTS geo_consent    BOOLEAN NOT NULL DEFAULT FALSE;

-- Segredo do callback EMIS do GESTOR (encomendas) — separado do contrato EMIS da
-- plataforma (planos). Configurado pelo gestor em Loja → Pagamentos (referência).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."payment_methods" ADD COLUMN IF NOT EXISTS callback_secret TEXT;

-- Adiantamento salarial: o funcionário pede um adiantamento (1..salário); o
-- gestor aprova/rejeita; ao processar a folha do mês do pagamento, o valor
-- aprovado é descontado (other_deductions) e fica DEDUCTED no mês exato.
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."salary_advances" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  employee_id     UUID REFERENCES "{{SCHEMA}}"."employees"(id) ON DELETE SET NULL,
  staff_name      TEXT NOT NULL,
  amount          NUMERIC(14,2) NOT NULL,
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING', -- PENDING/APPROVED/REJECTED/DEDUCTED
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by     UUID,
  reviewer_name   TEXT,
  reviewed_at     TIMESTAMPTZ,
  review_note     TEXT,
  payroll_item_id UUID,
  period_year     INT,
  period_month    INT,
  store_id        UUID REFERENCES "{{SCHEMA}}"."stores"(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS salary_advance_user_idx   ON "{{SCHEMA}}"."salary_advances"(user_id);
CREATE INDEX IF NOT EXISTS salary_advance_status_idx ON "{{SCHEMA}}"."salary_advances"(status);

-- Levantamento do adiantamento APROVADO pela caixa: quando o fecho reconcilia o
-- numerário, os adiantamentos aprovados e ainda não levantados são contabilizados
-- como saída legítima da gaveta (não dão quebra) e ficam marcados como levantados.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."salary_advances" ADD COLUMN IF NOT EXISTS disbursed_at         TIMESTAMPTZ;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."salary_advances" ADD COLUMN IF NOT EXISTS disbursed_session_id UUID;

-- "Documento" retroativo (POS): emite-se a fatura/recibo HOJE (mantém a cadeia
-- fiscal/hash AGT), mas regista-se a DATA DA OPERAÇÃO/COMPRA original (ex.: dia
-- sem luz) para constar no documento. invoice_date continua a ser a data fiscal.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."invoices" ADD COLUMN IF NOT EXISTS operation_date DATE;

-- Origem de ordens de serviço e reservas: distingue pedidos vindos da LOJA ONLINE
-- (ONLINE) dos criados no balcão (MANUAL). Permite ao gestor ver/aprovar o que
-- chega pela montra pública (vertical Serviços e Hotelaria).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders"     ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE IF EXISTS "{{SCHEMA}}"."hotel_reservations" ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MANUAL';

-- Nota de crédito → fatura de origem. Permite gravar a NC como documento real
-- (entra no SAF-T e nos relatórios) e descontar devoluções parciais nos lucros.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."invoices" ADD COLUMN IF NOT EXISTS source_invoice_id UUID REFERENCES "{{SCHEMA}}"."invoices"(id) ON DELETE SET NULL;

-- Hotelaria profissional: categoria/andar do quarto + estados (limpeza, manutenção,
-- bloqueado). As tabelas hotel_housekeeping/hotel_maintenance são criadas ao
-- reaplicar o template (CREATE TABLE IF NOT EXISTS).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."hotel_rooms" ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."hotel_rooms" ADD COLUMN IF NOT EXISTS floor    TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."hotel_rooms" ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Assistência Técnica/Oficina: equipamentos por cliente + garantia na OS. A
-- tabela service_equipments é criada ao reaplicar o template.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS equipment_id   UUID;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS warranty_days  INT NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS warranty_until DATE;

-- Farmácia: princípio ativo + se exige receita médica (controlo de venda).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."products" ADD COLUMN IF NOT EXISTS active_ingredient     TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."products" ADD COLUMN IF NOT EXISTS requires_prescription BOOLEAN NOT NULL DEFAULT FALSE;

-- Ingredientes/matéria-prima (restauração): produtos marcados como ingrediente NÃO
-- aparecem no caixa nem na loja — servem só para a ficha técnica dos pratos. Default
-- FALSE → produtos existentes continuam vendíveis (sem alteração de comportamento).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."products" ADD COLUMN IF NOT EXISTS is_ingredient BOOLEAN NOT NULL DEFAULT FALSE;

-- IMUTABILIDADE LEGAL (DP 71/25): bloqueia tecnicamente a eliminação de documentos
-- fiscais (a anulação é por estado 'A' + nota de crédito). DO INSTEAD NOTHING = o
-- DELETE não tem efeito (a linha sobrevive). Idempotente (CREATE OR REPLACE RULE).
CREATE OR REPLACE RULE fiscal_no_delete_invoices AS ON DELETE TO "{{SCHEMA}}"."invoices" DO INSTEAD NOTHING;
CREATE OR REPLACE RULE fiscal_no_delete_invoice_items AS ON DELETE TO "{{SCHEMA}}"."invoice_items" DO INSTEAD NOTHING;

-- Estados do documento (DP 71/25): ciclo de vida separado do `status` fiscal ('N'/'A').
-- ISSUED (emitido/por pagar) | PAID (pago — fatura-recibo) | PARTIALLY_PAID | ANNULLED.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."invoices" ADD COLUMN IF NOT EXISTS doc_state       TEXT NOT NULL DEFAULT 'ISSUED';
ALTER TABLE IF EXISTS "{{SCHEMA}}"."invoices" ADD COLUMN IF NOT EXISTS communicated_at TIMESTAMPTZ;

-- Backup & Restauro + Migração (dados de gestão nunca se perdem).
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."backups" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL DEFAULT 'MANUAL',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  created_by_name TEXT,
  size_bytes      INT NOT NULL DEFAULT 0,
  tables_meta     JSONB NOT NULL DEFAULT '{}',
  content_b64     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS backups_created_idx ON "{{SCHEMA}}"."backups"(created_at DESC);
ALTER TABLE IF EXISTS "{{SCHEMA}}"."customers" ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."suppliers" ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."site_settings" ADD COLUMN IF NOT EXISTS backup_auto_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."site_settings" ADD COLUMN IF NOT EXISTS backup_frequency    TEXT NOT NULL DEFAULT 'DAILY';
ALTER TABLE IF EXISTS "{{SCHEMA}}"."site_settings" ADD COLUMN IF NOT EXISTS backup_last_at      TIMESTAMPTZ;

-- Defesa em profundidade (DP 71/25): campos FISCAIS de um documento emitido não
-- podem ser reescritos por UPDATE — só o ciclo de vida (status, doc_state,
-- communicated_at) muda. Fica NO FIM do ficheiro: as colunas referenciadas
-- (operation_date, signature, source_invoice_id, …) já foram adicionadas acima
-- em tenants antigos. Idempotente (CREATE OR REPLACE RULE).
CREATE OR REPLACE RULE fiscal_no_update_invoices AS ON UPDATE TO "{{SCHEMA}}"."invoices"
  WHERE NEW.number            IS DISTINCT FROM OLD.number
     OR NEW.doc_type          IS DISTINCT FROM OLD.doc_type
     OR NEW.series            IS DISTINCT FROM OLD.series
     OR NEW.year              IS DISTINCT FROM OLD.year
     OR NEW.sequence          IS DISTINCT FROM OLD.sequence
     OR NEW.invoice_date      IS DISTINCT FROM OLD.invoice_date
     OR NEW.operation_date    IS DISTINCT FROM OLD.operation_date
     OR NEW.system_entry_date IS DISTINCT FROM OLD.system_entry_date
     OR NEW.customer_tax_id   IS DISTINCT FROM OLD.customer_tax_id
     OR NEW.net_total         IS DISTINCT FROM OLD.net_total
     OR NEW.iva_total         IS DISTINCT FROM OLD.iva_total
     OR NEW.gross_total       IS DISTINCT FROM OLD.gross_total
     OR NEW.signable_string   IS DISTINCT FROM OLD.signable_string
     OR NEW.previous_hash     IS DISTINCT FROM OLD.previous_hash
     OR NEW.hash              IS DISTINCT FROM OLD.hash
     OR NEW.signature         IS DISTINCT FROM OLD.signature
     OR NEW.source_invoice_id IS DISTINCT FROM OLD.source_invoice_id
  DO INSTEAD NOTHING;
CREATE OR REPLACE RULE fiscal_no_update_invoice_items AS ON UPDATE TO "{{SCHEMA}}"."invoice_items" DO INSTEAD NOTHING;

-- Reserva de pagamento da encomenda (anti-corrida na emissão da fatura).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."web_orders" ADD COLUMN IF NOT EXISTS payment_claimed_at TIMESTAMPTZ;

-- ════════════════════════════════════════════════════════════
-- Inventário empresarial (Curva ABC, reposição, localização,
-- transferências com aprovação, valorização, antifraude)
-- ════════════════════════════════════════════════════════════

-- Localização física do produto na loja (ex.: "Corredor 3 · Prateleira B").
ALTER TABLE IF EXISTS "{{SCHEMA}}"."stock_items" ADD COLUMN IF NOT EXISTS location TEXT;

-- Transferências entre lojas COM APROVAÇÃO (workflow: gestor pede → administrador
-- aprova → loja destino RECECIONA; só na receção o stock se move de facto).
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."stock_transfer_requests" (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES "{{SCHEMA}}"."products"(id) ON DELETE CASCADE,
  from_store_id     UUID NOT NULL REFERENCES "{{SCHEMA}}"."stores"(id) ON DELETE CASCADE,
  to_store_id       UUID NOT NULL REFERENCES "{{SCHEMA}}"."stores"(id) ON DELETE CASCADE,
  quantity          NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  note              TEXT,
  status            TEXT NOT NULL DEFAULT 'PENDING', -- PENDING/APPROVED/REJECTED/RECEIVED/CANCELLED
  requested_by      UUID,
  requested_by_name TEXT,
  approved_by       UUID,
  approved_by_name  TEXT,
  approved_at       TIMESTAMPTZ,
  received_by       UUID,
  received_by_name  TEXT,
  received_at       TIMESTAMPTZ,
  reject_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_transfer_requests_status_idx ON "{{SCHEMA}}"."stock_transfer_requests"(status);

-- Módulo LOJA ONLINE (ativar/desativar por empresa). Default TRUE = preserva o
-- comportamento atual (lojas existentes continuam online). Quando FALSE, o
-- portal público fica indisponível e o painel esconde os menus da loja.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."site_settings" ADD COLUMN IF NOT EXISTS online_store_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Folha salarial ENTERPRISE: discriminar cada desconto (transparência/auditoria).
-- Os 3 já eram calculados em separado mas ficavam fundidos em other_deductions;
-- agora persistem cada um na sua coluna. NÃO altera totais (total_deductions/net
-- continuam iguais) — só passa a haver rasto por tipo de desconto.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."payroll_items" ADD COLUMN IF NOT EXISTS self_consumption   NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."payroll_items" ADD COLUMN IF NOT EXISTS advance_deduction  NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."payroll_items" ADD COLUMN IF NOT EXISTS absence_deduction  NUMERIC(14,2) NOT NULL DEFAULT 0;

-- ── 2026-07-06 · UNIDADE DE MEDIDA nos produtos/ingredientes ─────────────────
-- Uma hamburgaria compra carne ao kg e consome 0,180 kg por burger; queijo à
-- fatia; molho ao ml. Sem campo próprio, os utilizadores punham "(kg)" no NOME.
-- Coluna informativa (exibida em receitas/stock/POS); sem conversões automáticas.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."products" ADD COLUMN IF NOT EXISTS unit TEXT;
