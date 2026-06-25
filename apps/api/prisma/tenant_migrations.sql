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
