# STACK (auditado)
- Monorepo pnpm (`pnpm-workspace.yaml`). Apps: `api` (NestJS + Prisma), `web` (admin + landing + login; Vite/React 18), `store` (loja online), `pos` (caixa), `desktop` (Electron), `mobile`, `mobile-shell` (Capacitor), `local-server`.
- Packages: `types`, `agt-xml`, `replication`, `update-core`, `shop-link`, `offline-core`, `tokens` (`@nexus/tokens`), `ui` (`@nexus/ui`).
- Deploy: API no Render (keep-alive em `.github/workflows/keep-alive.yml`); admin/loja/caixa no Cloudflare Pages (auto-deploy no push; lockfile congelado → novos pacotes workspace têm de estar em `pnpm-lock.yaml`).
- Temas: tokens `--nx-*` (`packages/tokens/tokens.css`, escuro via `[data-nx-mode="dark"]`); temas legados por `data-theme` em `apps/web/src/theme.css` (padrão `claro`).
