# Тут Бензин — прод-образ (multi-stage, итог ~150 МБ)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
# NEXT_PUBLIC_* инлайнится на этапе сборки — пробрасываем номер Метрики
# и ключ Яндекс Карт (ключ не секрет: ограничен доменом в кабинете)
ARG NEXT_PUBLIC_YM_ID=
ENV NEXT_PUBLIC_YM_ID=$NEXT_PUBLIC_YM_ID
ARG NEXT_PUBLIC_YMAPS_KEY=
ENV NEXT_PUBLIC_YMAPS_KEY=$NEXT_PUBLIC_YMAPS_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
