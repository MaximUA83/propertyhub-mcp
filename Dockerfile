FROM node:20-alpine

WORKDIR /app
COPY package.json ./
RUN npm install

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3100
EXPOSE 3100

CMD ["node", "src/index.js"]
