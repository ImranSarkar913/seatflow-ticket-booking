FROM node:24-alpine AS build
ENV SCARF_ANALYTICS=false
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
FROM node:24-alpine
ENV NODE_ENV=development SCARF_ANALYTICS=false
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node migrations ./migrations
USER node
EXPOSE 5000
CMD ["node", "dist/main.js"]
