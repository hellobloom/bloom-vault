FROM node:10

EXPOSE 3001
RUN mkdir /app
WORKDIR /app

COPY bin bin
RUN chmod +x bin/*

COPY package*.json ./
RUN npm install

COPY migrations migrations
COPY .sequelizerc database.js tsconfig.json index.ts ./
COPY src src
RUN npm run build
CMD bin/start.sh