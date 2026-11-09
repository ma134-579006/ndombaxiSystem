#!/usr/bin/env bash
# QA: recompila e reinicia a API local (porta 3901) com o env de teste ($QA_ENV).
set -e
cd "$(dirname "$0")/../apps/api"
pid=$(netstat -ano | grep ":3901 .*LISTEN" | awk '{print $5}' | head -1)
[ -n "$pid" ] && taskkill //F //PID "$pid" >/dev/null 2>&1 || true
npx nest build >/dev/null
set -a; . "$QA_ENV"; set +a
nohup node dist/main.js > "${QA_LOG:-/tmp/qa-api.log}" 2>&1 &
for i in $(seq 1 60); do curl -s -m 2 -o /dev/null http://127.0.0.1:3901/health && { echo API_UP; exit 0; }; sleep 2; done
echo API_TIMEOUT; exit 1
