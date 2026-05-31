# NEXUS ERP — Plataforma Enterprise (Angola)

Monorepo da plataforma SaaS multi-tenant **NEXUS ERP** (POS · ERP · E-Commerce · OpenManus AI · Super Admin), implementada segundo o documento técnico v3.0.

> **Estado actual: Fase 1 — Fundação** (backend). Restantes fases no roadmap (§13).

## Estrutura do monorepo

```
apps/
  api/      NestJS — Core API  ← implementado (Fase 1)
  web/      Next.js — ERP/Admin   (Fase 3+)
  pos/      React PWA — Caixa      (Fase 2)
  store/    Next.js — E-Commerce   (Fase 4)
  mobile/   React Native           (Fase 9)
packages/
  types/    Tipos TypeScript partilhados  ← implementado
  ui/ agt-xml/ openmanus/                 (fases futuras)
infra/
  docker/   docker-compose (Postgres 16 + Redis 7 + RabbitMQ)
  k8s/ terraform/                         (Fase 12)
```

## O que a Fase 1 entrega

- **Multi-tenant schema-per-tenant** (§3.1): cada empresa = um schema PostgreSQL isolado.
- **Auth Zero Trust** (§9.1): JWT (15m) + refresh com rotação (7d), Argon2id, 2FA TOTP, bloqueio progressivo.
- **RBAC** (§3.2): 7 níveis (Super Admin → Atendente) com guard hierárquico.
- **Onboarding** (§3.3): registo de empresa, validação NIF (stub AGT), provisioning automático do schema + loja + admin.
- **Super Admin** (§2.2): listar/aprovar/rejeitar/suspender/migrar plano/excluir empresas.
- **Auditoria imutável** (§9.3): log append-only com hash encadeado verificável.

## Pré-requisitos

- Node ≥ 20, pnpm ≥ 9
- Docker (para Postgres/Redis/RabbitMQ)

## Setup local

```powershell
# 1. Instalar dependências
pnpm install

# 2. Subir a infra (Postgres + Redis + RabbitMQ)
pnpm infra:up

# 3. Configurar ambiente da API
copy apps\api\.env.example apps\api\.env
#   → editar JWT_ACCESS_SECRET / JWT_REFRESH_SECRET (mín. 32 chars)

# 4. Migrations + seed (planos + super admin)
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 5. Arrancar a API
pnpm api:dev
```

API em `http://localhost:3001/api/v1` · Swagger em `/api/v1/docs`.

## Testes

```powershell
pnpm api:test
```

## Fluxo de demonstração

1. `POST /api/v1/auth/super-admin/login` → token do Super Admin (credenciais do `.env`).
2. `POST /api/v1/onboarding/register` → cria empresa (PENDING) + devolve senha temporária.
3. `POST /api/v1/super-admin/tenants/:id/approve` (Bearer do super admin) → ACTIVE.
4. `POST /api/v1/auth/login` com `companyCode` + email/senha temporária → tokens do tenant.
