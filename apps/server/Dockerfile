FROM node:22-alpine AS build
RUN npm i -g pnpm@12.16.1
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @voult/server...
RUN pnpm --filter @voult/server... build
RUN pnpm --filter @voult/server deploy --prod /out

FROM node:22-alpine
WORKDIR /app
COPY --from=build /out .
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
VOLUME /data
EXPOSE 8787
CMD ["node", "dist/main.js"]
