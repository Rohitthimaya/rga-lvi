FROM node:20-alpine AS build

WORKDIR /app

# Install workspace deps (root + server workspace)
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
RUN npm ci

# Build server
COPY server ./server
RUN npm run build --workspace server

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server

WORKDIR /app/server
EXPOSE 8080

CMD ["node", "dist/index.js"]

