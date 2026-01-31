FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY consumer.js ./

# Log-Verzeichnis erstellen
RUN mkdir -p /var/log/consumer

CMD ["npm", "start"]
