-- NEXUS ERP — Template de schema por tenant (Fase 1: Fundação)
-- O provisioning service substitui {{SCHEMA}} pelo nome do schema do tenant
-- (ex: tenant_a1b2c3d4) e executa este DDL ao criar a empresa.
-- Fases seguintes adicionam: products, sales, invoices, inventory,
-- customers, employees, reports, etc.

CREATE SCHEMA IF NOT EXISTS "{{SCHEMA}}";

-- ── Lojas da empresa ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."stores" (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  address     TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stores_code_unique UNIQUE (code)
);

-- ── Utilizadores da empresa (níveis 1..6 do RBAC) ────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."users" (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,            -- Argon2id
  name           TEXT NOT NULL,
  role           TEXT NOT NULL,            -- COMPANY_ADMIN..ATTENDANT
  pin_hash       TEXT,                     -- PIN 6 dígitos p/ POS (Argon2id)
  store_id       UUID REFERENCES "{{SCHEMA}}"."stores"(id) ON DELETE SET NULL,
  two_fa_secret  TEXT,
  two_fa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  failed_logins  INT NOT NULL DEFAULT 0,
  locked_until   TIMESTAMPTZ,
  last_login_at  TIMESTAMPTZ,
  must_reset_pw  BOOLEAN NOT NULL DEFAULT TRUE,  -- credenciais temporárias
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0, -- % de comissão sobre vendas
  theme          TEXT NOT NULL DEFAULT '',  -- preferência de tema (por utilizador)
  photo_url      TEXT,                      -- foto/avatar do utilizador (data-URI ou URL)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS users_role_idx ON "{{SCHEMA}}"."users"(role);
CREATE INDEX IF NOT EXISTS users_store_idx ON "{{SCHEMA}}"."users"(store_id);

-- ════════════════════════════════════════════════════════════
-- Fase 2 — POS + facturação fiscal AGT (§4, §7)
-- ════════════════════════════════════════════════════════════

-- ── Categorias de produto ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."product_categories" (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  parent_id   UUID REFERENCES "{{SCHEMA}}"."product_categories"(id) ON DELETE SET NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Produtos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."products" (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL,
  barcode      TEXT,
  name         TEXT NOT NULL,
  description  TEXT,
  category_id  UUID REFERENCES "{{SCHEMA}}"."product_categories"(id) ON DELETE SET NULL,
  brand        TEXT,                          -- marca do produto (para relatórios "por marca")
  iva_code     TEXT NOT NULL DEFAULT 'NOR',  -- NOR/RED/ISE/OUT (§7.1)
  exemption_reason TEXT,                       -- motivo de isenção (obrigatório p/ ISE/OUT)
  exemption_code   TEXT,                       -- código AGT do motivo (opcional)
  unit_price   NUMERIC(14,2) NOT NULL,        -- preço NET de venda (sem IVA), AOA
  cost_price   NUMERIC(14,2) NOT NULL DEFAULT 0, -- custo unitário (p/ lucro), AOA
  stock_qty    NUMERIC(14,3) NOT NULL DEFAULT 0,
  -- TRUE = stock central partilhado (1 pool = stock_qty, vendível por qualquer loja);
  -- FALSE = stock por loja (cada loja vê/baixa o seu próprio saldo em stock_items).
  shared_stock BOOLEAN NOT NULL DEFAULT FALSE,
  image_url    TEXT,                          -- imagem principal (loja online)
  gallery      JSONB NOT NULL DEFAULT '[]',   -- imagens adicionais [url, ...]
  show_online  BOOLEAN NOT NULL DEFAULT TRUE, -- aparece na montra/loja online
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT products_code_unique UNIQUE (code)
);

-- ── Clientes ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."customers" (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_id      TEXT,                          -- NIF (NULL = consumidor final)
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  address     TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Séries fiscais (numeração sequencial + cadeia de hash) ───
-- Garante numeração "FT A/2025/0001" sem saltos e o encadeamento
-- de hash por série (§7). Allocação atómica via UPDATE ... RETURNING.
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."fiscal_series" (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type       TEXT NOT NULL,              -- FT/FS/NC/ND/RC/GR/ORC
  series         TEXT NOT NULL,              -- ex: "A"
  year           INT  NOT NULL,
  last_sequence  INT  NOT NULL DEFAULT 0,
  last_hash      TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_series_unique UNIQUE (doc_type, series, year)
);

-- ── Contadores de documentos NÃO fiscais (PO, encomendas web) ─
-- Numeração sequencial atómica por (kind, year) sem race conditions:
-- INSERT ... ON CONFLICT DO UPDATE ... RETURNING incrementa e devolve numa
-- única operação atómica (substitui o frágil COUNT(*)+1).
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."document_counters" (
  kind           TEXT NOT NULL,              -- ex: 'PO', 'WEB'
  year           INT  NOT NULL,
  last_sequence  INT  NOT NULL DEFAULT 0,
  CONSTRAINT document_counters_pk PRIMARY KEY (kind, year)
);

-- ── Documentos fiscais (facturas) ────────────────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."invoices" (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number            TEXT NOT NULL,           -- "FT A/2025/0001"
  doc_type          TEXT NOT NULL,
  series            TEXT NOT NULL,
  year              INT  NOT NULL,
  sequence          INT  NOT NULL,
  invoice_date      DATE NOT NULL,
  system_entry_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  store_id          UUID REFERENCES "{{SCHEMA}}"."stores"(id) ON DELETE SET NULL,
  cashier_id        UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  customer_id       UUID REFERENCES "{{SCHEMA}}"."customers"(id) ON DELETE SET NULL,
  customer_tax_id   TEXT,
  net_total         NUMERIC(14,2) NOT NULL,
  iva_total         NUMERIC(14,2) NOT NULL,
  gross_total       NUMERIC(14,2) NOT NULL,
  signable_string   TEXT NOT NULL,           -- string assinada (§7)
  previous_hash     TEXT NOT NULL,
  hash              TEXT NOT NULL,
  signature         TEXT,                    -- assinatura RSA-2048 base64 (Fase 9)
  signature_key_version INT,                  -- versão da chave de assinatura usada
  status            TEXT NOT NULL DEFAULT 'N', -- N=normal, A=anulado
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoices_number_unique UNIQUE (number)
);

CREATE INDEX IF NOT EXISTS invoices_date_idx ON "{{SCHEMA}}"."invoices"(invoice_date);
CREATE INDEX IF NOT EXISTS invoices_series_idx ON "{{SCHEMA}}"."invoices"(doc_type, series, year, sequence);

-- ── Chaves de assinatura digital RSA-2048 (§7, requisito AGT) ─
-- Cada empresa assina os documentos com a sua chave privada. A chave privada
-- é guardada cifrada (AES-256-GCM via CONFIG_ENCRYPTION_KEY); a pública pode
-- ser exportada para verificação. Versão incremental permite rotação de chaves
-- mantendo a verificação dos documentos antigos.
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."fiscal_signing_keys" (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_version       INT  NOT NULL,
  algorithm         TEXT NOT NULL DEFAULT 'RSA-SHA256',
  public_key        TEXT NOT NULL,            -- PEM SPKI
  private_key_enc   TEXT NOT NULL,            -- PEM PKCS8 cifrado (v1:…)
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_signing_keys_version_unique UNIQUE (key_version)
);
-- Apenas uma chave activa de cada vez.
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_signing_keys_active_idx
  ON "{{SCHEMA}}"."fiscal_signing_keys"(is_active) WHERE is_active = TRUE;

-- ── Linhas dos documentos ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."invoice_items" (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       UUID NOT NULL REFERENCES "{{SCHEMA}}"."invoices"(id) ON DELETE CASCADE,
  line_number      INT  NOT NULL,
  product_id       UUID REFERENCES "{{SCHEMA}}"."products"(id) ON DELETE SET NULL,
  product_code     TEXT NOT NULL,
  description      TEXT NOT NULL,
  quantity         NUMERIC(14,3) NOT NULL,
  unit_price       NUMERIC(14,2) NOT NULL,
  iva_code         TEXT NOT NULL,
  iva_rate         NUMERIC(5,2) NOT NULL,
  discount_rate    NUMERIC(5,4) NOT NULL DEFAULT 0,
  net_amount       NUMERIC(14,2) NOT NULL,
  iva_amount       NUMERIC(14,2) NOT NULL,
  gross_amount     NUMERIC(14,2) NOT NULL,
  unit_cost        NUMERIC(14,2) NOT NULL DEFAULT 0, -- custo no momento da venda (lucro)
  exemption_reason TEXT,
  exemption_code   TEXT
);

CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON "{{SCHEMA}}"."invoice_items"(invoice_id);

-- ════════════════════════════════════════════════════════════
-- Fase 3 — ERP base: fornecedores, armazéns, stock, compras (§5)
-- ════════════════════════════════════════════════════════════

-- ── Fornecedores ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."suppliers" (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  nif         TEXT,
  email       TEXT,
  phone       TEXT,
  address     TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_code_unique UNIQUE (code)
);

-- ── Armazéns ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."warehouses" (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  store_id    UUID REFERENCES "{{SCHEMA}}"."stores"(id) ON DELETE SET NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warehouses_code_unique UNIQUE (code)
);

-- ── Saldos de stock por (produto, armazém) ───────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."stock_items" (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID NOT NULL REFERENCES "{{SCHEMA}}"."products"(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES "{{SCHEMA}}"."stores"(id) ON DELETE CASCADE,
  quantity     NUMERIC(14,3) NOT NULL DEFAULT 0,
  min_qty      NUMERIC(14,3) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_items_unique UNIQUE (product_id, warehouse_id)
);

-- ── Livro de movimentos de stock (append-only) ───────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."stock_movements" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES "{{SCHEMA}}"."products"(id) ON DELETE CASCADE,
  warehouse_id  UUID NOT NULL REFERENCES "{{SCHEMA}}"."stores"(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,            -- IN/OUT/ADJUST/TRANSFER
  quantity      NUMERIC(14,3) NOT NULL,   -- sinal: +entrada / -saída
  unit_cost     NUMERIC(14,2),
  balance_after NUMERIC(14,3) NOT NULL,
  reference     TEXT,                     -- ex: "PO FT.../venda"
  reference_id  UUID,
  created_by    UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON "{{SCHEMA}}"."stock_movements"(product_id, warehouse_id);

-- ── Encomendas de compra ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."purchase_orders" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number        TEXT NOT NULL,
  supplier_id   UUID NOT NULL REFERENCES "{{SCHEMA}}"."suppliers"(id) ON DELETE RESTRICT,
  warehouse_id  UUID NOT NULL REFERENCES "{{SCHEMA}}"."stores"(id) ON DELETE RESTRICT,
  status        TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT/CONFIRMED/RECEIVED/CANCELLED
  order_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  net_total     NUMERIC(14,2) NOT NULL DEFAULT 0,
  iva_total     NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_total   NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes         TEXT,
  created_by    UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT purchase_orders_number_unique UNIQUE (number)
);

CREATE INDEX IF NOT EXISTS purchase_orders_supplier_idx ON "{{SCHEMA}}"."purchase_orders"(supplier_id);
CREATE INDEX IF NOT EXISTS purchase_orders_status_idx ON "{{SCHEMA}}"."purchase_orders"(status);

-- ── Linhas das encomendas de compra ──────────────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."purchase_order_items" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id         UUID NOT NULL REFERENCES "{{SCHEMA}}"."purchase_orders"(id) ON DELETE CASCADE,
  line_number   INT  NOT NULL,
  product_id    UUID REFERENCES "{{SCHEMA}}"."products"(id) ON DELETE SET NULL,
  product_code  TEXT NOT NULL,
  description   TEXT NOT NULL,
  quantity      NUMERIC(14,3) NOT NULL,
  unit_cost     NUMERIC(14,2) NOT NULL,
  iva_code      TEXT NOT NULL,
  iva_rate      NUMERIC(5,2) NOT NULL,
  net_amount    NUMERIC(14,2) NOT NULL,
  iva_amount    NUMERIC(14,2) NOT NULL,
  gross_amount  NUMERIC(14,2) NOT NULL,
  received_qty  NUMERIC(14,3) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS purchase_order_items_po_idx ON "{{SCHEMA}}"."purchase_order_items"(po_id);

-- ════════════════════════════════════════════════════════════
-- Fase 4 — E-Commerce: encomendas online (§6)
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."web_orders" (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number     TEXT NOT NULL,
  customer_id      UUID REFERENCES "{{SCHEMA}}"."customers"(id) ON DELETE SET NULL,
  customer_name    TEXT NOT NULL,
  customer_email   TEXT,
  customer_phone   TEXT,
  customer_tax_id  TEXT,
  shipping_address TEXT,
  -- Localização do cliente (Angola): província / município / bairro
  province         TEXT,
  municipality     TEXT,
  neighborhood     TEXT,
  payment_method   TEXT,                            -- BANK_TRANSFER/REFERENCE/MULTICAIXA_EXPRESS/CASH
  status           TEXT NOT NULL DEFAULT 'PENDING', -- PENDING/PAID/SHIPPED/DELIVERED/CANCELLED
  net_total        NUMERIC(14,2) NOT NULL,
  iva_total        NUMERIC(14,2) NOT NULL,
  gross_total      NUMERIC(14,2) NOT NULL,
  invoice_id       UUID REFERENCES "{{SCHEMA}}"."invoices"(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT web_orders_number_unique UNIQUE (order_number)
);

CREATE INDEX IF NOT EXISTS web_orders_status_idx ON "{{SCHEMA}}"."web_orders"(status);

CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."web_order_items" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES "{{SCHEMA}}"."web_orders"(id) ON DELETE CASCADE,
  line_number   INT  NOT NULL,
  product_id    UUID REFERENCES "{{SCHEMA}}"."products"(id) ON DELETE SET NULL,
  product_code  TEXT NOT NULL,
  description   TEXT NOT NULL,
  quantity      NUMERIC(14,3) NOT NULL,
  unit_price    NUMERIC(14,2) NOT NULL,
  iva_code      TEXT NOT NULL,
  iva_rate      NUMERIC(5,2) NOT NULL,
  net_amount    NUMERIC(14,2) NOT NULL,
  iva_amount    NUMERIC(14,2) NOT NULL,
  gross_amount  NUMERIC(14,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS web_order_items_order_idx ON "{{SCHEMA}}"."web_order_items"(order_id);

-- ════════════════════════════════════════════════════════════
-- Fase 6 — Recursos Humanos & Processamento Salarial (§ RH)
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."employees" (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_number  TEXT NOT NULL,
  full_name        TEXT NOT NULL,
  tax_id           TEXT,                       -- NIF
  inss_number      TEXT,                       -- nº de Segurança Social
  position         TEXT,                       -- função/cargo
  department       TEXT,
  store_id         UUID REFERENCES "{{SCHEMA}}"."stores"(id) ON DELETE SET NULL,
  hire_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  termination_date DATE,
  base_salary      NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable_allowances NUMERIC(14,2) NOT NULL DEFAULT 0,  -- subsídios sujeitos
  exempt_allowances  NUMERIC(14,2) NOT NULL DEFAULT 0,  -- subsídios isentos
  bonus            NUMERIC(14,2) NOT NULL DEFAULT 0,    -- bónus (sujeito a INSS/IRT)
  absence_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0, -- % de desconto por faltas
  iban             TEXT,
  photo_url        TEXT,                                -- foto do funcionário (data-URI/URL)
  status           TEXT NOT NULL DEFAULT 'ACTIVE',      -- ACTIVE/SUSPENDED/TERMINATED
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT employees_number_unique UNIQUE (employee_number)
);

CREATE INDEX IF NOT EXISTS employees_status_idx ON "{{SCHEMA}}"."employees"(status);

CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."payroll_runs" (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year          INT  NOT NULL,
  period_month         INT  NOT NULL,          -- 1..12
  status               TEXT NOT NULL DEFAULT 'PROCESSED', -- PROCESSED/PAID/CANCELLED
  employee_count       INT  NOT NULL DEFAULT 0,
  gross_total          NUMERIC(16,2) NOT NULL DEFAULT 0,
  inss_employee_total  NUMERIC(16,2) NOT NULL DEFAULT 0,
  inss_employer_total  NUMERIC(16,2) NOT NULL DEFAULT 0,
  irt_total            NUMERIC(16,2) NOT NULL DEFAULT 0,
  net_total            NUMERIC(16,2) NOT NULL DEFAULT 0,
  employer_cost_total  NUMERIC(16,2) NOT NULL DEFAULT 0,
  processed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at              TIMESTAMPTZ,
  CONSTRAINT payroll_runs_period_unique UNIQUE (period_year, period_month)
);

CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."payroll_items" (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             UUID NOT NULL REFERENCES "{{SCHEMA}}"."payroll_runs"(id) ON DELETE CASCADE,
  employee_id        UUID NOT NULL REFERENCES "{{SCHEMA}}"."employees"(id) ON DELETE CASCADE,
  employee_number    TEXT NOT NULL,
  employee_name      TEXT NOT NULL,
  base_salary        NUMERIC(14,2) NOT NULL,
  taxable_allowances NUMERIC(14,2) NOT NULL DEFAULT 0,
  exempt_allowances  NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_salary       NUMERIC(14,2) NOT NULL,
  inss_base          NUMERIC(14,2) NOT NULL,
  inss_employee      NUMERIC(14,2) NOT NULL,
  inss_employer      NUMERIC(14,2) NOT NULL,
  irt_base           NUMERIC(14,2) NOT NULL,
  irt                NUMERIC(14,2) NOT NULL,
  other_deductions   NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_deductions   NUMERIC(14,2) NOT NULL,
  net_salary         NUMERIC(14,2) NOT NULL,
  employer_cost      NUMERIC(14,2) NOT NULL,
  CONSTRAINT payroll_items_run_employee_unique UNIQUE (run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS payroll_items_run_idx ON "{{SCHEMA}}"."payroll_items"(run_id);

-- ════════════════════════════════════════════════════════════
-- Fase 8 — White-label / Page Builder (§8) + Pagamentos da loja
-- ════════════════════════════════════════════════════════════

-- Definições visuais/branding da montra (linha única por tenant).
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."site_settings" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name      TEXT,
  tagline         TEXT,
  logo_url        TEXT,
  favicon_url     TEXT,
  primary_color   TEXT NOT NULL DEFAULT '#0F62FE',
  secondary_color TEXT NOT NULL DEFAULT '#1E1E1E',
  contact_email   TEXT,
  contact_phone   TEXT,
  address         TEXT,
  social          JSONB,                        -- { facebook, instagram, whatsapp, ... }
  custom_css      TEXT,
  receipt_message TEXT,                        -- dizeres livres no rodapé do recibo/relatório
  default_iva_code TEXT NOT NULL DEFAULT 'NOR', -- IVA aplicado quando o produto escolhe 'Automático'
  setup_completed BOOLEAN NOT NULL DEFAULT TRUE, -- false até a empresa concluir o setup obrigatório (logo/nome/código/NIF)
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Páginas construídas no editor (blocos JSON renderizados pelo frontend).
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."site_pages" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  blocks        JSONB NOT NULL DEFAULT '[]',    -- [{ type, props }]
  is_published  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT site_pages_slug_unique UNIQUE (slug)
);

-- Métodos de pagamento configurados pelo gestor/admin da loja.
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."payment_methods" (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             TEXT NOT NULL,               -- BANK_TRANSFER/REFERENCE/MULTICAIXA_EXPRESS/CASH
  label            TEXT NOT NULL,
  instructions     TEXT,
  bank_name        TEXT,
  iban             TEXT,
  account_holder   TEXT,
  reference_entity TEXT,
  reference_number TEXT,
  express_phone    TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_methods_active_idx ON "{{SCHEMA}}"."payment_methods"(is_active);

-- Comprovativos de pagamento enviados pelo cliente; o gestor revê e aprova.
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."payment_proofs" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES "{{SCHEMA}}"."web_orders"(id) ON DELETE CASCADE,
  method_type   TEXT NOT NULL,
  amount        NUMERIC(14,2),
  reference     TEXT,                           -- nº de operação/referência indicado pelo cliente
  file_name     TEXT,
  file_mime     TEXT,
  file_url      TEXT,                           -- URL externa OU
  file_data     TEXT,                           -- conteúdo base64 (comprovativo)
  status        TEXT NOT NULL DEFAULT 'PENDING',-- PENDING/APPROVED/REJECTED
  note          TEXT,                           -- nota do gestor na revisão
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by   UUID,
  reviewed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS payment_proofs_order_idx ON "{{SCHEMA}}"."payment_proofs"(order_id);
CREATE INDEX IF NOT EXISTS payment_proofs_status_idx ON "{{SCHEMA}}"."payment_proofs"(status);

-- Conversa em tempo real entre o cliente e o gestor da loja, por encomenda.
-- Quando nenhum membro da equipa está online, o OpenManus responde (sender_type=ASSISTANT).
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."order_messages" (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES "{{SCHEMA}}"."web_orders"(id) ON DELETE CASCADE,
  sender_type  TEXT NOT NULL,                 -- CUSTOMER / STAFF / ASSISTANT
  sender_id    UUID,                          -- users.id quando STAFF
  sender_name  TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_messages_order_idx ON "{{SCHEMA}}"."order_messages"(order_id, created_at);

-- ════════════════════════════════════════════════════════════
-- CAIXA (turnos), AUDITORIA do tenant e INVENTÁRIO (enterprise)
-- ════════════════════════════════════════════════════════════

-- ── Turnos de caixa (abertura/fecho por funcionário) ─────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."cash_sessions" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID REFERENCES "{{SCHEMA}}"."stores"(id) ON DELETE SET NULL,
  register_code   TEXT,                       -- identificação do posto/caixa
  opened_by       UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  opened_by_name  TEXT,
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_float   NUMERIC(14,2) NOT NULL DEFAULT 0,  -- fundo de troco inicial
  -- fecho:
  closed_by       UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  closed_by_name  TEXT,
  closed_at       TIMESTAMPTZ,
  counted_cash    NUMERIC(14,2),              -- dinheiro físico contado
  expected_cash   NUMERIC(14,2),              -- esperado = fundo + entradas - saídas
  difference      NUMERIC(14,2),              -- counted - expected (>0 sobra, <0 quebra)
  status          TEXT NOT NULL DEFAULT 'OPEN', -- OPEN/CLOSED
  notes           TEXT,
  -- totais agregados ao fechar (cache p/ o recibo de fecho):
  total_sales     NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cash_in   NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_cash_out  NUMERIC(14,2) NOT NULL DEFAULT 0,
  sales_count     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_sessions_status_idx ON "{{SCHEMA}}"."cash_sessions"(status);
CREATE INDEX IF NOT EXISTS cash_sessions_opened_by_idx ON "{{SCHEMA}}"."cash_sessions"(opened_by);

-- ── Movimentos de dinheiro do turno (livro append-only) ──────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."cash_movements" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES "{{SCHEMA}}"."cash_sessions"(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,             -- SALE/CASH_IN(reforço)/CASH_OUT(sangria)/REFUND/CHANGE
  amount        NUMERIC(14,2) NOT NULL,    -- sempre positivo; o type define o sinal
  payment_type  TEXT,                      -- CASH/CARD/TRANSFER/REFERENCE/EXPRESS
  tendered      NUMERIC(14,2),             -- dinheiro entregue pelo cliente (venda)
  change_given  NUMERIC(14,2),             -- troco devolvido
  reference     TEXT,                      -- ex.: nº da factura
  reference_id  UUID,                      -- invoice id
  created_by    UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_movements_session_idx ON "{{SCHEMA}}"."cash_movements"(session_id, created_at);

-- ── Despesas operacionais (renda, salários, energia…) ────────
-- Base do LUCRO LÍQUIDO real: lucro bruto − despesas operacionais.
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."expenses" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category        TEXT NOT NULL,             -- RENDA/SALARIOS/ENERGIA/AGUA/FORNECEDORES/TRANSPORTE/MARKETING/MANUTENCAO/IMPOSTOS/COMUNICACOES/SEGURANCA/OUTROS
  description     TEXT,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  supplier        TEXT,                      -- fornecedor / beneficiário
  payment_method  TEXT,                      -- CASH/TRANSFER/REFERENCE/CARD
  document_ref    TEXT,                      -- nº de factura/recibo do fornecedor
  expense_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by      UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON "{{SCHEMA}}"."expenses"(expense_date);
CREATE INDEX IF NOT EXISTS expenses_cat_idx  ON "{{SCHEMA}}"."expenses"(category);

-- ── Contas a receber (venda a crédito / fiado) ───────────────
-- Quando uma venda no POS é paga "a crédito", cria-se uma conta a receber
-- ligada à factura e ao cliente. Os pagamentos parciais geram recibos (RC).
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."receivables" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID REFERENCES "{{SCHEMA}}"."customers"(id) ON DELETE SET NULL,
  customer_name   TEXT,
  invoice_id      UUID REFERENCES "{{SCHEMA}}"."invoices"(id) ON DELETE SET NULL,
  invoice_number  TEXT,
  original_amount NUMERIC(14,2) NOT NULL CHECK (original_amount >= 0),
  paid_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  due_date        DATE,
  status          TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN | PARTIAL | PAID
  notes           TEXT,
  created_by      UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receivables_status_idx ON "{{SCHEMA}}"."receivables"(status);
CREATE INDEX IF NOT EXISTS receivables_cust_idx   ON "{{SCHEMA}}"."receivables"(customer_id);
CREATE INDEX IF NOT EXISTS receivables_due_idx    ON "{{SCHEMA}}"."receivables"(due_date);

CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."receivable_payments" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_id   UUID NOT NULL REFERENCES "{{SCHEMA}}"."receivables"(id) ON DELETE CASCADE,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method          TEXT,                          -- CASH/TRANSFER/REFERENCE/CARD/EXPRESS
  receipt_number  TEXT,                          -- nº de recibo RC/ANO/0001
  notes           TEXT,
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  created_by_name TEXT
);
CREATE INDEX IF NOT EXISTS receivable_payments_idx ON "{{SCHEMA}}"."receivable_payments"(receivable_id, paid_at);

-- ── Contas a pagar (fornecedores) ────────────────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."payables" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id     UUID REFERENCES "{{SCHEMA}}"."suppliers"(id) ON DELETE SET NULL,
  supplier_name   TEXT,
  reference       TEXT,                          -- nº da ordem de compra / factura do fornecedor
  original_amount NUMERIC(14,2) NOT NULL CHECK (original_amount >= 0),
  paid_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  due_date        DATE,
  status          TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN | PARTIAL | PAID | CANCELLED
  notes           TEXT,
  created_by      UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payables_status_idx ON "{{SCHEMA}}"."payables"(status);
CREATE INDEX IF NOT EXISTS payables_sup_idx    ON "{{SCHEMA}}"."payables"(supplier_id);
CREATE INDEX IF NOT EXISTS payables_due_idx     ON "{{SCHEMA}}"."payables"(due_date);

CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."payable_payments" (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payable_id       UUID NOT NULL REFERENCES "{{SCHEMA}}"."payables"(id) ON DELETE CASCADE,
  amount           NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method           TEXT,                          -- CASH/TRANSFER/REFERENCE/CARD/EXPRESS
  reference_number TEXT,                          -- nosso comprovativo PG/ANO/0001
  notes            TEXT,
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  created_by_name  TEXT
);
CREATE INDEX IF NOT EXISTS payable_payments_idx ON "{{SCHEMA}}"."payable_payments"(payable_id, paid_at);

-- ── Conciliação bancária (extrato importado) ─────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."bank_transactions" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_date  DATE NOT NULL,
  description     TEXT,
  amount          NUMERIC(14,2) NOT NULL,        -- positivo=crédito, negativo=débito
  matched         BOOLEAN NOT NULL DEFAULT FALSE,
  matched_type    TEXT,                          -- SALE/RECEIVABLE/EXPENSE/PAYABLE/MANUAL
  matched_ref     TEXT,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  created_by_name TEXT
);
CREATE INDEX IF NOT EXISTS bank_tx_date_idx ON "{{SCHEMA}}"."bank_transactions"(statement_date);
CREATE INDEX IF NOT EXISTS bank_tx_matched_idx ON "{{SCHEMA}}"."bank_transactions"(matched);

-- ── Férias / ausências (RH) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."leave_requests" (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID REFERENCES "{{SCHEMA}}"."employees"(id) ON DELETE CASCADE,
  employee_name    TEXT,
  type             TEXT NOT NULL,                 -- FERIAS/FALTA/LICENCA/OUTRO
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  days             INT NOT NULL DEFAULT 0,
  reason           TEXT,
  status           TEXT NOT NULL DEFAULT 'PENDING', -- PENDING/APPROVED/REJECTED
  reviewed_by      UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  reviewed_by_name TEXT,
  reviewed_at      TIMESTAMPTZ,
  created_by       UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leave_status_idx ON "{{SCHEMA}}"."leave_requests"(status);
CREATE INDEX IF NOT EXISTS leave_emp_idx ON "{{SCHEMA}}"."leave_requests"(employee_id);

-- ── Auditoria do tenant (append-only + hash encadeado) ───────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."cameras" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  stream_url TEXT,                     -- HLS (.m3u8), MJPEG ou MP4 por HTTP(S); NULL p/ nuvem/P2P
  snapshot_url TEXT,                   -- URL de fotograma JPEG (para gravacao por instantaneos)
  kind TEXT NOT NULL DEFAULT 'AUTO',   -- AUTO | HLS | MJPEG | MP4
  conn_type TEXT NOT NULL DEFAULT 'STREAM', -- STREAM (HTTP) | P2P (nuvem, app + QR)
  device_sn TEXT,                      -- SN do DVR/NVR para apps de nuvem (XMEye/Danale...)
  app_ios TEXT,                        -- link da app iOS (QR de instalacao)
  app_android TEXT,                    -- link da app Android (QR de instalacao)
  notes TEXT,
  record BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."tenant_audit_log" (
  seq         BIGSERIAL PRIMARY KEY,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    UUID,
  actor_name  TEXT,
  action      TEXT NOT NULL,             -- ex.: SALE_EMITTED, SALE_CANCELLED, STOCK_IN, STOCK_ADJUST, SHIFT_OPEN, SHIFT_CLOSE
  entity      TEXT,
  entity_id   TEXT,
  details     JSONB,
  ip          TEXT,
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tenant_audit_action_idx ON "{{SCHEMA}}"."tenant_audit_log"(action);
CREATE INDEX IF NOT EXISTS tenant_audit_ts_idx ON "{{SCHEMA}}"."tenant_audit_log"(timestamp DESC);

-- ── Contagens de inventário (inventário profissional) ────────
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."stock_counts" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id  UUID NOT NULL REFERENCES "{{SCHEMA}}"."stores"(id) ON DELETE CASCADE,
  reference     TEXT,                      -- ex.: "INV/2026/0001"
  status        TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT/COUNTING/CLOSED
  notes         TEXT,
  created_by    UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."stock_count_items" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id      UUID NOT NULL REFERENCES "{{SCHEMA}}"."stock_counts"(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES "{{SCHEMA}}"."products"(id) ON DELETE CASCADE,
  product_code  TEXT NOT NULL,
  description   TEXT NOT NULL,
  system_qty    NUMERIC(14,3) NOT NULL,    -- saldo do sistema no momento
  counted_qty   NUMERIC(14,3),             -- contagem física
  difference    NUMERIC(14,3),             -- counted - system
  CONSTRAINT stock_count_items_unique UNIQUE (count_id, product_id)
);
CREATE INDEX IF NOT EXISTS stock_count_items_count_idx ON "{{SCHEMA}}"."stock_count_items"(count_id);

-- ════════════════════════════════════════════════════════════
-- PROMOÇÕES & FIDELIZAÇÃO (retalho enterprise)
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."promotions" (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,             -- PERCENT/AMOUNT/BUY_X_PAY_Y/QTY_TIERED
  scope        TEXT NOT NULL DEFAULT 'ALL', -- PRODUCT/CATEGORY/ALL
  target_id    UUID,
  percent      NUMERIC(5,2),
  amount       NUMERIC(14,2),
  buy_qty      INT,
  pay_qty      INT,
  min_qty      INT,
  tier_percent NUMERIC(5,2),
  priority     INT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  weekdays     INT[],                     -- 0=Dom..6=Sáb
  start_time   TEXT,                      -- "HH:MM"
  end_time     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promotions_active_idx ON "{{SCHEMA}}"."promotions"(is_active);

-- Cartões de fidelização (ligados opcionalmente a um cliente).
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."loyalty_cards" (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_code    TEXT NOT NULL,
  customer_id  UUID REFERENCES "{{SCHEMA}}"."customers"(id) ON DELETE SET NULL,
  holder_name  TEXT,
  phone        TEXT,
  points       INT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT loyalty_cards_code_unique UNIQUE (card_code)
);
CREATE INDEX IF NOT EXISTS loyalty_cards_customer_idx ON "{{SCHEMA}}"."loyalty_cards"(customer_id);

-- Livro de pontos (append-only).
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."loyalty_movements" (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id    UUID NOT NULL REFERENCES "{{SCHEMA}}"."loyalty_cards"(id) ON DELETE CASCADE,
  points     INT NOT NULL,                -- +ganho / -resgate
  reason     TEXT,                        -- "EARN"/"REDEEM"
  reference  TEXT,                        -- nº da factura
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_movements_card_idx ON "{{SCHEMA}}"."loyalty_movements"(card_id);

-- ════════════════════════════════════════════════════════════
-- LOTES & VALIDADE (FEFO — First Expired First Out, p/ alimentos)
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."product_batches" (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID NOT NULL REFERENCES "{{SCHEMA}}"."products"(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES "{{SCHEMA}}"."stores"(id) ON DELETE SET NULL,
  batch_code   TEXT,
  quantity     NUMERIC(14,3) NOT NULL DEFAULT 0,
  expiry_date  DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_batches_expiry_idx ON "{{SCHEMA}}"."product_batches"(expiry_date);
CREATE INDEX IF NOT EXISTS product_batches_product_idx ON "{{SCHEMA}}"."product_batches"(product_id);
