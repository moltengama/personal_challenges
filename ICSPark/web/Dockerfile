# ─── Etapa 1: build de React + generación de la fuga .git ───
FROM node:20-alpine AS builder
RUN apk add --no-cache git
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build \
 && sh seed/build-git-leak.sh

# ─── Etapa 2: runtime ligero (solo deps de producción) ───
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=builder /app/server/public ./server/public

USER node
EXPOSE 8081 8082 8083 8084
CMD ["node", "server/index.js"]
