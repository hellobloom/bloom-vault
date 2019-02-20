FROM node:10

EXPOSE 3001
RUN mkdir /app
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY database.ts tsconfig.json index.ts migrations.ts ./
COPY typings typings
COPY src src
RUN npm run build

COPY bin bin
RUN chmod +x bin/*

CMD bin/start.sh