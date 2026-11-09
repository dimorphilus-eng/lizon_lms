FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN npm run build -w @lizon/shared \
  && npm run db:generate -w @lizon/api \
  && npm run build -w @lizon/api \
  && chmod +x apps/api/docker-entrypoint.sh
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 4000
CMD ["./docker-entrypoint.sh"]
