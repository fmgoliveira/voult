FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++ && npm i -g pnpm@12.16.1
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @voult/server...
RUN pnpm --filter @voult/server... build
# better-sqlite3 is the only external (native) dependency of the bundle.
RUN SQLITE_VERSION=$(node -p "require('./apps/server/package.json').dependencies['better-sqlite3'].replace(/^[^0-9]*/, '')") \
 && mkdir /out && cd /out && npm init -y >/dev/null && npm i --omit=dev better-sqlite3@$SQLITE_VERSION

FROM node:22-alpine
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist/main.js ./main.js
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
VOLUME /data
EXPOSE 8787
CMD ["node", "main.js"]
