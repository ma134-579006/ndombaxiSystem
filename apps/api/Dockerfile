# ============================================================
# Ndombaxi System — imagem da API (NestJS + Prisma).
# Build context = RAIZ do repositório (monorepo pnpm).
#   docker build -f apps/api/Dockerfile -t ndombaxi-api .
# A imagem inclui TODAS as dependências (nada a instalar no servidor).
# ============================================================
FROM node:20-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY . .
# Normaliza o entrypoint (Windows pode gravar CRLF / sem bit +x) para arrancar no Linux.
RUN sed -i 's/\r$//' apps/api/docker-entrypoint.sh && chmod +x apps/api/docker-entrypoint.sh
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nexus/types build \
 && pnpm --filter @nexus/agt-xml build \
 && pnpm --filter @nexus/api exec prisma generate \
 && pnpm --filter @nexus/api build

FROM node:20-slim AS run
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 3000
# Invoca via sh (não depende do bit de execução) — robusto em qualquer host.
ENTRYPOINT ["sh", "docker-entrypoint.sh"]
