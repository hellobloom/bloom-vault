FROM node:10

EXPOSE 3001
RUN mkdir /app
WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .
RUN chmod u+x bin/start.sh
RUN chmod u+x bin/debug.sh
RUN npm run build
CMD bin/start.sh