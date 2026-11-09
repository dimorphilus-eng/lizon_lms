#!/bin/sh
set -e
npx prisma migrate deploy
if [ "$SEED_ON_BOOT" = "true" ]; then
  npx tsx src/seed.ts
fi
exec node dist/main.js
