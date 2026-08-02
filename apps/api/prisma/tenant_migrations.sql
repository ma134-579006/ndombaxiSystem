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

-- ── 2026-07-06 · QUEBRA/DESPERDÍCIO na ficha técnica ─────────────────────────
-- Numa cozinha real, 180 g de carne crua não rendem 180 g úteis (aparas,
-- encolhimento). waste_pct por ingrediente: consumo e custo passam a
-- qtd × (1 + quebra/100). Default 0 = comportamento atual intacto.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."product_recipes" ADD COLUMN IF NOT EXISTS waste_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

-- ── 2026-07-08 · COZINHA recebe ENCOMENDAS ONLINE + tempo estimado ──────────
-- A loja online passa a alimentar o KDS: o cozinheiro vê a encomenda, dá um
-- TEMPO ESTIMADO (prep_eta_min) e avança o estado de produção (kitchen_status:
-- NEW→PREPARING→READY). Aditivo; default NEW = ainda não tocado pela cozinha.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."web_orders" ADD COLUMN IF NOT EXISTS prep_eta_min   INT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."web_orders" ADD COLUMN IF NOT EXISTS kitchen_status TEXT NOT NULL DEFAULT 'NEW';
ALTER TABLE IF EXISTS "{{SCHEMA}}"."web_orders" ADD COLUMN IF NOT EXISTS kitchen_at     TIMESTAMPTZ;

-- ── 2026-07-08 · BALCÃO envia à cozinha + tempo estimado na comanda ──────────
-- Pedido de BALCÃO/TAKEAWAY = comanda com table_id NULL (o caixa "envia para a
-- cozinha", a cozinha dá um tempo e produz, e depois o caixa chama o pedido
-- pronto e vende). prep_eta_min = tempo dado pela cozinha (mesa e balcão).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."restaurant_orders" ADD COLUMN IF NOT EXISTS prep_eta_min INT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."restaurant_orders" ADD COLUMN IF NOT EXISTS kitchen_at   TIMESTAMPTZ;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-07-12 · HOSPITAL (HIS) — núcleo clínico enterprise
-- Pacientes (ficha médica completa), Profissionais de saúde, Receitas médicas
-- (com dispensa que baixa o stock da farmácia por lote — mesma engenharia das
-- fichas técnicas do restaurante), Sinais vitais, Leitos/Internação, Triagem
-- de emergência (Manchester) e Exames. Tudo ADITIVO; nada do núcleo comercial
-- é alterado. O prontuário (EHR) deriva destas tabelas — nunca se apaga.
-- ═══════════════════════════════════════════════════════════════════════════

-- Ficha médica do paciente (extensão da tabela existente)
ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_patients" ADD COLUMN IF NOT EXISTS process_number TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_patients" ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_patients" ADD COLUMN IF NOT EXISTS marital_status TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_patients" ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_patients" ADD COLUMN IF NOT EXISTS responsible_name TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_patients" ADD COLUMN IF NOT EXISTS responsible_phone TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_patients" ADD COLUMN IF NOT EXISTS insurer TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_patients" ADD COLUMN IF NOT EXISTS insurance_number TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_patients" ADD COLUMN IF NOT EXISTS insurance_plan TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_patients" ADD COLUMN IF NOT EXISTS chronic_conditions TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_patients" ADD COLUMN IF NOT EXISTS continuous_meds TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_patients" ADD COLUMN IF NOT EXISTS family_history TEXT;

-- Profissionais de saúde (médicos, enfermeiros, técnicos, receção, laboratório…)
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."clinic_professionals" (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'MEDICO',      -- MEDICO|ENFERMEIRO|TECNICO|RECECAO|LABORATORIO|FARMACIA|ADMIN|OUTRO
  license_number TEXT,                                -- carteira profissional / nº da ordem
  specialty      TEXT,
  subspecialty   TEXT,
  office         TEXT,                                -- consultório/sala
  schedule       TEXT,                                -- horário/dias (texto livre)
  on_call        BOOLEAN NOT NULL DEFAULT FALSE,      -- de plantão agora
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinic_prof_idx ON "{{SCHEMA}}"."clinic_professionals"(is_active, category, name);

-- Receitas médicas + itens (a dispensa baixa o stock da farmácia por lote FEFO)
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."clinic_prescriptions" (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number           TEXT NOT NULL,                     -- RX/2026/0001
  consultation_id  UUID REFERENCES "{{SCHEMA}}"."clinic_consultations"(id) ON DELETE SET NULL,
  patient_id       UUID REFERENCES "{{SCHEMA}}"."clinic_patients"(id) ON DELETE SET NULL,
  patient_name     TEXT,
  professional_id  UUID REFERENCES "{{SCHEMA}}"."clinic_professionals"(id) ON DELETE SET NULL,
  professional     TEXT,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'ISSUED',    -- ISSUED|DISPENSED|CANCELLED
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispensed_at     TIMESTAMPTZ,
  dispensed_by     UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS clinic_rx_idx ON "{{SCHEMA}}"."clinic_prescriptions"(status, issued_at DESC);
CREATE INDEX IF NOT EXISTS clinic_rx_patient_idx ON "{{SCHEMA}}"."clinic_prescriptions"(patient_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."clinic_prescription_items" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES "{{SCHEMA}}"."clinic_prescriptions"(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES "{{SCHEMA}}"."products"(id) ON DELETE SET NULL,  -- medicamento da farmácia
  medication      TEXT NOT NULL,
  dosage          TEXT,                               -- ex.: 500 mg
  posology        TEXT,                               -- ex.: 1 comp. de 8/8h
  route           TEXT,                               -- oral | IV | IM | tópica…
  duration        TEXT,                               -- ex.: 7 dias
  quantity        NUMERIC(14,3) NOT NULL DEFAULT 1,   -- a dispensar
  dispensed_qty   NUMERIC(14,3) NOT NULL DEFAULT 0,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS clinic_rx_items_idx ON "{{SCHEMA}}"."clinic_prescription_items"(prescription_id);

-- Sinais vitais (prontuário — nunca se apagam)
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."clinic_vitals" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL REFERENCES "{{SCHEMA}}"."clinic_patients"(id) ON DELETE CASCADE,
  consultation_id UUID REFERENCES "{{SCHEMA}}"."clinic_consultations"(id) ON DELETE SET NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  temperature_c   NUMERIC(4,1),
  systolic        INT,
  diastolic       INT,
  heart_rate      INT,
  resp_rate       INT,
  spo2            INT,
  weight_kg       NUMERIC(6,2),
  height_cm       NUMERIC(5,1),
  notes           TEXT,
  recorded_by     UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS clinic_vitals_idx ON "{{SCHEMA}}"."clinic_vitals"(patient_id, recorded_at DESC);

-- Leitos e internações
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."clinic_beds" (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL,                            -- ex.: ENF-01, UTI-02
  ward       TEXT NOT NULL DEFAULT 'ENFERMARIA',       -- ENFERMARIA|UTI|ISOLAMENTO|QUARTO
  room       TEXT,
  status     TEXT NOT NULL DEFAULT 'FREE',             -- FREE|OCCUPIED|CLEANING|MAINTENANCE|BLOCKED
  daily_rate NUMERIC(14,2) NOT NULL DEFAULT 0,         -- diária (c/ IVA)
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinic_beds_idx ON "{{SCHEMA}}"."clinic_beds"(is_active, ward, code);

CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."clinic_admissions" (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number        TEXT NOT NULL,                         -- INT/2026/0001
  patient_id    UUID REFERENCES "{{SCHEMA}}"."clinic_patients"(id) ON DELETE SET NULL,
  patient_name  TEXT,
  bed_id        UUID REFERENCES "{{SCHEMA}}"."clinic_beds"(id) ON DELETE SET NULL,
  bed_label     TEXT,
  professional  TEXT,                                  -- médico responsável
  reason        TEXT,                                  -- motivo/diagnóstico
  status        TEXT NOT NULL DEFAULT 'ADMITTED',      -- ADMITTED|DISCHARGED|TRANSFERRED|DECEASED
  daily_rate    NUMERIC(14,2) NOT NULL DEFAULT 0,      -- diária congelada na admissão
  total         NUMERIC(14,2) NOT NULL DEFAULT 0,      -- diárias + consumos
  invoice_id    UUID REFERENCES "{{SCHEMA}}"."invoices"(id) ON DELETE SET NULL,
  admitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  discharged_at TIMESTAMPTZ,
  notes         TEXT,
  created_by    UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS clinic_adm_idx ON "{{SCHEMA}}"."clinic_admissions"(status, admitted_at DESC);
CREATE INDEX IF NOT EXISTS clinic_adm_patient_idx ON "{{SCHEMA}}"."clinic_admissions"(patient_id, admitted_at DESC);

-- Emergência / triagem (classificação de risco de Manchester)
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."clinic_triage" (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID REFERENCES "{{SCHEMA}}"."clinic_patients"(id) ON DELETE SET NULL,
  patient_name TEXT NOT NULL,
  complaint    TEXT,                                   -- queixa principal
  risk         TEXT NOT NULL DEFAULT 'GREEN',          -- RED|ORANGE|YELLOW|GREEN|BLUE
  room         TEXT,
  professional TEXT,
  status       TEXT NOT NULL DEFAULT 'WAITING',        -- WAITING|IN_CARE|OBSERVATION|DISCHARGED|ADMITTED|DECEASED
  arrived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  attended_at  TIMESTAMPTZ,
  closed_at    TIMESTAMPTZ,
  notes        TEXT,
  created_by   UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS clinic_triage_idx ON "{{SCHEMA}}"."clinic_triage"(status, risk, arrived_at);

-- Exames (pedido → colheita → laboratório → resultado; integra no prontuário)
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."clinic_exams" (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID REFERENCES "{{SCHEMA}}"."clinic_patients"(id) ON DELETE SET NULL,
  patient_name TEXT,
  exam_type    TEXT NOT NULL,                          -- ex.: Hemograma, Raio-X tórax
  requested_by TEXT,
  status       TEXT NOT NULL DEFAULT 'REQUESTED',      -- REQUESTED|COLLECTED|IN_LAB|DONE|DELIVERED
  result_text  TEXT,
  fee          NUMERIC(14,2) NOT NULL DEFAULT 0,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at      TIMESTAMPTZ,
  created_by   UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS clinic_exams_idx ON "{{SCHEMA}}"."clinic_exams"(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS clinic_exams_patient_idx ON "{{SCHEMA}}"."clinic_exams"(patient_id, requested_at DESC);

-- 2026-07-12 · faturação de exames (liga ao motor fiscal AGT)
ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_exams" ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES "{{SCHEMA}}"."invoices"(id) ON DELETE SET NULL;

-- 2026-07-12 · faturação da receita dispensada (venda de farmácia no motor AGT)
ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_prescriptions" ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES "{{SCHEMA}}"."invoices"(id) ON DELETE SET NULL;

-- 2026-07-12 · HOSPITAL (HIS) Fase 4 — Convénios / Seguros de saúde
-- Registo de convénios com % de cobertura; ligação ao paciente; e "sinistros"
-- (claims) que registam a parte coberta pelo convénio quando se fatura ao
-- paciente apenas a coparticipação. Tudo ADITIVO; o motor fiscal só recebe o
-- valor final da linha (a coparticipação) — nada muda na emissão/hash/SAF-T.
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."clinic_insurers" (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  plan         TEXT,                                   -- plano/apólice (texto livre)
  coverage_pct NUMERIC(5,2) NOT NULL DEFAULT 80,       -- % que o convénio cobre
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinic_insurers_idx ON "{{SCHEMA}}"."clinic_insurers"(is_active, name);

ALTER TABLE IF EXISTS "{{SCHEMA}}"."clinic_patients" ADD COLUMN IF NOT EXISTS insurer_id UUID REFERENCES "{{SCHEMA}}"."clinic_insurers"(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."clinic_insurer_claims" (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id   UUID REFERENCES "{{SCHEMA}}"."clinic_insurers"(id) ON DELETE SET NULL,
  insurer_name TEXT,
  patient_id   UUID REFERENCES "{{SCHEMA}}"."clinic_patients"(id) ON DELETE SET NULL,
  patient_name TEXT,
  source_type  TEXT NOT NULL,                          -- EXAM | CONSULTATION | ADMISSION | PRESCRIPTION
  source_id    UUID,
  invoice_id   UUID REFERENCES "{{SCHEMA}}"."invoices"(id) ON DELETE SET NULL,  -- fatura da coparticipação do paciente
  gross_total  NUMERIC(14,2) NOT NULL DEFAULT 0,       -- valor total do ato (c/ IVA)
  covered      NUMERIC(14,2) NOT NULL DEFAULT 0,       -- parte do convénio (a receber)
  copay        NUMERIC(14,2) NOT NULL DEFAULT 0,       -- parte do paciente (faturada)
  status       TEXT NOT NULL DEFAULT 'PENDING',        -- PENDING | SUBMITTED | PAID | REJECTED
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID REFERENCES "{{SCHEMA}}"."users"(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS clinic_claims_idx ON "{{SCHEMA}}"."clinic_insurer_claims"(status, created_at DESC);
CREATE INDEX IF NOT EXISTS clinic_claims_insurer_idx ON "{{SCHEMA}}"."clinic_insurer_claims"(insurer_id, status);

-- 2026-07-13 · RESTAURANTE/PRODUCAO — tipo de produto PRODUCAO explicito
-- is_production: TRUE => o produto e FABRICADO (custo vem da ficha tecnica; sem
-- estoque/compra/fornecedor tradicionais). Aditivo; is_ingredient continua a ser
-- materia-prima. Um produto normal (comercial) tem ambos FALSE.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."products" ADD COLUMN IF NOT EXISTS is_production BOOLEAN NOT NULL DEFAULT FALSE;

-- 2026-07-13 · RESTAURANTE/PRODUCAO — prioridade dos pedidos (Central de Producao)
ALTER TABLE IF EXISTS "{{SCHEMA}}"."restaurant_orders" ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0;

-- 2026-07-20 · MECANICA (oficina auto) — rececao do veiculo, folha de obra,
-- aprovacao de orcamento, tempos e agenda. Tudo ADITIVO sobre service_orders.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS km_in             INT;             -- quilometragem na rececao
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS fuel_level        TEXT;            -- EMPTY|LOW|HALF|HIGH|FULL
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS vehicle_state     TEXT;            -- observacoes do estado (riscos, amolgadelas)
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS checklist         JSONB;           -- [{key,label,ok,note}]
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS photos            JSONB;           -- [{url,caption}] fotos da rececao
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS signature         TEXT;            -- assinatura do cliente (data URL)
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS est_minutes       INT;             -- tempo estimado (min)
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS actual_minutes    INT;             -- tempo realizado (min)
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS work_started_at   TIMESTAMPTZ;     -- inicio do trabalho (cronometro)
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS scheduled_at      TIMESTAMPTZ;     -- marcacao/agenda
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS received_at       TIMESTAMPTZ;     -- momento da rececao
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS quote_approved_at TIMESTAMPTZ;     -- aprovacao do orcamento
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS quote_approved_by TEXT;            -- quem aprovou (nome)
CREATE INDEX IF NOT EXISTS service_orders_scheduled_idx ON "{{SCHEMA}}"."service_orders"(scheduled_at) WHERE scheduled_at IS NOT NULL;

-- 2026-07-20 · ASSISTENCIA DE TELEMOVEIS (vertical SERVICES, equipamento DEVICE):
-- IMEI e codigo de desbloqueio capturados na rececao do aparelho. ADITIVO.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS imei        TEXT;   -- IMEI/nº de serie do aparelho
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS unlock_code TEXT;   -- codigo/padrao de desbloqueio (reparacao)

-- 2026-07-21 · PORTAL DO CLIENTE (rastreio do reparo): token publico por OS.
-- DEFAULT crypto-random (gen_random_uuid) por linha; backfill das OS existentes.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ADD COLUMN IF NOT EXISTS track_token TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."service_orders" ALTER COLUMN track_token SET DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
UPDATE "{{SCHEMA}}"."service_orders" SET track_token = substr(replace(gen_random_uuid()::text, '-', ''), 1, 16) WHERE track_token IS NULL;
CREATE INDEX IF NOT EXISTS service_orders_track_idx ON "{{SCHEMA}}"."service_orders"(track_token);

-- 2026-07-22 · OFFLINE-FIRST — livro de operações sincronizadas (idempotencia).
-- Cada mutação feita nas apps (Windows/Android/iOS) traz um op_id UUID gerado no
-- posto. Este livro e a razao pela qual reenviar NUNCA duplica: se o op_id ja ca
-- estiver, devolvemos o resultado guardado em vez de aplicar outra vez. Sem ele,
-- uma venda cujo ACK se perdeu na rede entraria duas vezes na contabilidade.
-- ADITIVO: nenhuma tabela existente e alterada.
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"."sync_operations" (
  op_id       UUID PRIMARY KEY,               -- chave de idempotencia (vem do cliente)
  entity      TEXT NOT NULL,                  -- sale | customer | ...
  op          TEXT NOT NULL,                  -- create | update | delete
  local_id    TEXT NOT NULL,                  -- id que o posto atribuiu
  server_id   TEXT,                           -- id real apos aplicar
  status      TEXT NOT NULL,                  -- applied | rejected
  result      JSONB,                          -- resposta guardada (devolvida no reenvio)
  device_id   TEXT,                           -- posto de origem (diagnostico)
  user_id     UUID,                           -- quem executou
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),  -- quando o servidor aplicou
  client_at   TIMESTAMPTZ                     -- quando o utilizador REALMENTE agiu
);
CREATE INDEX IF NOT EXISTS sync_ops_local_idx  ON "{{SCHEMA}}"."sync_operations"(entity, local_id);
CREATE INDEX IF NOT EXISTS sync_ops_recent_idx ON "{{SCHEMA}}"."sync_operations"(created_at DESC);

-- 2026-07-22 · OFFLINE-FIRST — idempotencia da venda garantida pela BASE DE DADOS.
-- client_op_id e o UUID que o posto gerou para a operacao. O indice UNICO faz com
-- que uma segunda tentativa de gravar a MESMA venda seja recusada pelo Postgres,
-- e nao por uma verificacao aplicacional que pode perder a corrida entre dois
-- pedidos simultaneos. E esta a diferenca entre "quase nunca duplica" e
-- "e impossivel duplicar". NULL para tudo o que foi emitido online (sem op).
ALTER TABLE IF EXISTS "{{SCHEMA}}"."invoices" ADD COLUMN IF NOT EXISTS client_op_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_client_op_uidx
  ON "{{SCHEMA}}"."invoices"(client_op_id) WHERE client_op_id IS NOT NULL;

-- 2026-08-02 · OFFLINE-FIRST — TURNOS DE CAIXA feitos sem rede.
-- Mesma doutrina da venda: a idempotencia e imposta pela BASE DE DADOS, nao por
-- codigo. Sem isto, um posto que reenviasse a abertura do turno (rede a oscilar)
-- criava DOIS turnos e o fecho deixava de bater certo com a gaveta.
-- Indice PARCIAL: so vale para linhas com op — tudo o que foi feito online fica
-- NULL e nao consome indice nem colide.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."cash_sessions"  ADD COLUMN IF NOT EXISTS client_op_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_client_op_uidx
  ON "{{SCHEMA}}"."cash_sessions"(client_op_id) WHERE client_op_id IS NOT NULL;

ALTER TABLE IF EXISTS "{{SCHEMA}}"."cash_movements" ADD COLUMN IF NOT EXISTS client_op_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_client_op_uidx
  ON "{{SCHEMA}}"."cash_movements"(client_op_id) WHERE client_op_id IS NOT NULL;

-- 2026-08-02 · LOGIN OFFLINE — credenciais provisionadas para os aparelhos.
-- O problema: o cofre offline das apps so conhecia quem tivesse escrito a senha
-- NAQUELE aparelho. Um segundo gestor, um operador novo, ou uma senha trocada
-- noutro sitio = "utilizador desconhecido" quando faltava a rede. A app ficava
-- inutilizavel exatamente no cenario para que foi feita.
-- A solucao: o servidor guarda um VERIFICADOR proprio (PBKDF2-SHA256), calculado
-- no unico momento em que tem o segredo em maos (login/reset/criacao), e os
-- aparelhos da empresa descarregam-no. NAO e o hash de autenticacao (Argon2id,
-- esse nunca sai do servidor) — e um derivado separado, so para verificar
-- localmente sem rede. offline_updated_at sobe a cada alteracao: e por ele que o
-- aparelho sabe que a copia que tem ficou velha e a substitui.
-- ADITIVO: nenhuma coluna existente e alterada.
ALTER TABLE IF EXISTS "{{SCHEMA}}"."users" ADD COLUMN IF NOT EXISTS offline_pw_salt      TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."users" ADD COLUMN IF NOT EXISTS offline_pw_verifier  TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."users" ADD COLUMN IF NOT EXISTS offline_pw_iters     INT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."users" ADD COLUMN IF NOT EXISTS offline_pin_salt     TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."users" ADD COLUMN IF NOT EXISTS offline_pin_verifier TEXT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."users" ADD COLUMN IF NOT EXISTS offline_pin_iters    INT;
ALTER TABLE IF EXISTS "{{SCHEMA}}"."users" ADD COLUMN IF NOT EXISTS offline_updated_at   TIMESTAMPTZ;
