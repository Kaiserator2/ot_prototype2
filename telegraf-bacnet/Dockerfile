FROM telegraf:latest

# Node.js installieren
RUN apt-get update && apt-get install -y \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# BACnet Shim einrichten
WORKDIR /opt/bacnet-shim
COPY package.json ./
RUN npm install --production
COPY bacnet_shim.js ./

WORKDIR /
