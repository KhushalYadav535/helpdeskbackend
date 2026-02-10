FROM node:22-alpine AS builder

WORKDIR /app
ENV NODE_ENV=development

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./tsconfig.json
COPY src ./src

RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5000

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 5000

CMD ["node", "dist/server.js"]
