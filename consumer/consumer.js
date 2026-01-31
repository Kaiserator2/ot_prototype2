const amqp = require('amqplib');
const fs = require('fs');
const path = require('path');

const RABBITMQ_URL = `amqp://${process.env.RABBITMQ_USER || 'user'}:${process.env.RABBITMQ_PASS || 'password'}@${process.env.RABBITMQ_HOST || 'rabbitmq'}:5672`;
const EXCHANGE_NAME = 'iot_metrics';
const QUEUE_NAME = 'sensor_data';
const ROUTING_KEY = '#'; // Alle Nachrichten
const LOG_FILE = process.env.LOG_FILE || '/var/log/consumer/messages.log';
const STATS_INTERVAL = parseInt(process.env.STATS_INTERVAL || '5000'); // Statistik alle 5 Sekunden

// Sicherstellen dass Log-Verzeichnis existiert
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Performance-Metriken
const stats = {
  totalMessages: 0,
  messagesInInterval: 0,
  intervalStart: Date.now(),
  latencies: [],
  minLatency: Infinity,
  maxLatency: 0,
  totalLatency: 0,
  latencyCount: 0
};

function calculateLatency(msgTimestamp) {
  // Telegraf sendet Nanosekunden-Timestamps
  const msgTimeMs = msgTimestamp / 1_000_000;
  const now = Date.now();
  return now - msgTimeMs;
}

function printStats() {
  const now = Date.now();
  const intervalSeconds = (now - stats.intervalStart) / 1000;
  const messagesPerSecond = stats.messagesInInterval / intervalSeconds;

  let latencyInfo = '';
  if (stats.latencyCount > 0) {
    const avgLatency = stats.totalLatency / stats.latencyCount;
    latencyInfo = ` | Latency: avg=${avgLatency.toFixed(1)}ms min=${stats.minLatency.toFixed(1)}ms max=${stats.maxLatency.toFixed(1)}ms`;
  }

  console.log(
    `[STATS] ${new Date().toISOString()} | ` +
    `Rate: ${messagesPerSecond.toFixed(1)} msg/s | ` +
    `Interval: ${stats.messagesInInterval} msgs | ` +
    `Total: ${stats.totalMessages} msgs` +
    latencyInfo
  );

  // Reset für nächstes Interval
  stats.messagesInInterval = 0;
  stats.intervalStart = now;
  stats.minLatency = Infinity;
  stats.maxLatency = 0;
  stats.totalLatency = 0;
  stats.latencyCount = 0;
}

function logMessage(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, logEntry);
}

async function connect() {
  let retries = 10;

  while (retries > 0) {
    try {
      console.log(`Connecting to RabbitMQ at ${RABBITMQ_URL}...`);
      const connection = await amqp.connect(RABBITMQ_URL);
      console.log('Connected to RabbitMQ');
      return connection;
    } catch (err) {
      retries--;
      console.log(`Connection failed, ${retries} retries left. Waiting 5s...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  throw new Error('Could not connect to RabbitMQ');
}

async function main() {
  const connection = await connect();
  const channel = await connection.createChannel();

  // Exchange sollte bereits existieren (von Telegraf erstellt)
  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

  // Queue erstellen und an Exchange binden
  await channel.assertQueue(QUEUE_NAME, { durable: true });
  await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, ROUTING_KEY);

  console.log(`Queue '${QUEUE_NAME}' bound to exchange '${EXCHANGE_NAME}' with routing key '${ROUTING_KEY}'`);
  console.log(`Logging messages to: ${LOG_FILE}`);
  console.log(`Stats interval: ${STATS_INTERVAL}ms`);
  console.log('Waiting for messages...');

  // Statistik-Timer starten
  const statsTimer = setInterval(printStats, STATS_INTERVAL);

  channel.consume(QUEUE_NAME, (msg) => {
    if (msg) {
      const content = msg.content.toString();
      const routingKey = msg.fields.routingKey;

      // Latenz berechnen falls Timestamp vorhanden
      try {
        const parsed = JSON.parse(content);
        if (parsed.timestamp) {
          const latency = calculateLatency(parsed.timestamp);
          if (latency > 0 && latency < 60000) { // Ignoriere unrealistische Werte
            stats.totalLatency += latency;
            stats.latencyCount++;
            stats.minLatency = Math.min(stats.minLatency, latency);
            stats.maxLatency = Math.max(stats.maxLatency, latency);
          }
        }
      } catch (e) {
        // JSON parse error - ignorieren
      }

      logMessage(`[${routingKey}] ${content}`);

      stats.totalMessages++;
      stats.messagesInInterval++;

      channel.ack(msg);
    }
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    clearInterval(statsTimer);
    printStats(); // Finale Statistik
    await channel.close();
    await connection.close();
    console.log(`Total messages processed: ${stats.totalMessages}`);
    process.exit(0);
  });
}

main().catch(console.error);
