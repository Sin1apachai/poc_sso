FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src ./src
COPY --chown=node:node views ./views

COPY --chown=node:node public ./public

USER node

EXPOSE 4001

CMD ["npm", "start"]