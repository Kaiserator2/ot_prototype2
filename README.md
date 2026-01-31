# OT Protocol Translator Prototype

Ein Prototyp zur Erfassung von BACnet-Daten aus OT-Geräten (Operational Technology) und Weiterleitung an eine Message Queue.

## Überblick

Dieses System simuliert 10.000 Aufzüge mit je 23 Sensoren und demonstriert die Erfassung von BACnet-Daten über Telegraf mit Weiterleitung an RabbitMQ.

```
┌─────────────────────┐     BACnet/UDP      ┌─────────────────────┐
│  BACnet Simulator   │◄───────────────────►│  Telegraf + Shim    │
│  (10.000 Aufzüge)   │     Port 47808      │  (Node.js BACnet)   │
└─────────────────────┘                     └──────────┬──────────┘
                                                       │ AMQP
                                                       ▼
                                            ┌─────────────────────┐
                                            │     RabbitMQ        │
                                            │  Exchange: iot_metrics
                                            │  Queue: sensor_data │
                                            └──────────┬──────────┘
                                                       │ AMQP
                                                       ▼
                                            ┌─────────────────────┐
                                            │     Consumer        │
                                            │  (Logging + Stats)  │
                                            └─────────────────────┘
```

## Durchsatz und Performance

Das System wurde für hohen Durchsatz optimiert:

| Metrik | Wert |
|--------|------|
| Simulierte Aufzüge | 10.000 |
| Sensoren pro Aufzug | 23 |
| Datenpunkte gesamt | 230.000 |
| **Durchsatz** | **~2.000+ msg/s** (Spitze: ~2.500 msg/s) |
| BACnet Requests pro Zyklus | 10.000 (via ReadPropertyMultiple) |
| CPU Simulator | < 1% |
| CPU Telegraf | < 1% |

### Optimierungen

| Optimierung | Beschreibung | Auswirkung |
|-------------|--------------|------------|
| **ReadPropertyMultiple** | Alle 23 Properties in 1 BACnet-Request statt 23 einzelne | 23x weniger Netzwerk-Requests |
| **O(1) Lookup** | Map statt Array.find() für Objekt-Suche | CPU von 100% auf <1% |
| **Concurrency Limiter** | Max. 200 parallele BACnet-Requests | Verhindert invokeId-Kollisionen |
| **Batch Processing** | 1000 Devices pro Batch parallel | Optimale Parallelisierung |

### Skalierung

Für noch höheren Durchsatz:
- **COV Subscriptions** - Push statt Polling (nur Änderungen)
- **Mehrere BACnet-Clients** - Load-Balancing über mehrere UDP-Ports
- **Industrielle Gateways** - Niagara, Tridium für Produktionsumgebungen

## Komponenten

### 1. BACnet Simulator (`bacnet-simulator/`)

Node.js-Anwendung, die 10.000 virtuelle Aufzüge simuliert:

| Sensor-Typ | Anzahl/Aufzug | Beispiele |
|------------|---------------|-----------|
| Analog Inputs | 12 | current_floor, speed, motor_temperature, load_weight |
| Binary Inputs | 11 | door_open, emergency_stop, safety_chain_ok |

- **Technologie:** Node.js + node-bacnet
- **Port:** 47808/UDP
- **Device ID:** 1234
- **Update-Intervall:** 5 Sekunden
- **Unterstützte Services:** ReadProperty, ReadPropertyMultiple

### 2. Telegraf + BACnet Shim (`telegraf-bacnet/`)

Custom Telegraf-Image mit Node.js-basiertem BACnet-Client:

- **Input:** BACnet via `execd`-Plugin + Node.js Shim
- **Output:** RabbitMQ (AMQP) + stdout (Debug)
- **Polling-Intervall:** 10 Sekunden
- **Datenpunkte:** 230.000 pro Zyklus
- **Protokoll:** ReadPropertyMultiple (RPM) für optimierten Durchsatz

### 3. RabbitMQ

Message Broker für die Weiterleitung der Sensordaten:

- **Exchange:** `iot_metrics` (topic)
- **Queue:** `sensor_data` (durable, automatisch erstellt)
- **Routing:** Nach `asset_id` Tag
- **Format:** JSON

### 4. Consumer (`consumer/`)

Node.js-Anwendung, die Messages aus der Queue konsumiert und loggt:

- **Queue:** `sensor_data` (gebunden an Exchange mit `#` Routing Key)
- **Logfile:** `/var/log/consumer/messages.log`
- **Performance-Stats:** Alle 5 Sekunden (konfigurierbar)

**Beispiel-Output:**
```
[STATS] 2026-01-31T21:23:53.399Z | Rate: 2447.0 msg/s | Interval: 12235 msgs | Total: 398112 msgs
```

## Konfiguration

Die gesamte BACnet-Konfiguration befindet sich in `telegraf.conf`:

```toml
[[inputs.execd]]
  command = ["node", "/opt/bacnet-shim/bacnet_shim.js", "--config", '<JSON>']
```

### Config-Format

```json
{
  "interval": 10,
  "batchSize": 1000,
  "maxConcurrent": 200,
  "deviceRange": {
    "address": "127.0.0.1:47808",
    "baseId": 1234,
    "namePrefix": "elevator",
    "count": 10000,
    "instanceOffset": 20,
    "tags": { "site": "test_labor" },
    "objects": [
      "AI:0:current_floor",
      "BI:0:door_open"
    ]
  }
}
```

### Config-Parameter

| Parameter | Default | Beschreibung |
|-----------|---------|--------------|
| `interval` | 10 | Polling-Intervall in Sekunden |
| `batchSize` | 1000 | Devices pro Batch (parallel) |
| `maxConcurrent` | 200 | Max. gleichzeitige BACnet-Requests |

### Object-Format

```
TYPE:INSTANCE:NAME
```

| TYPE | Beschreibung |
|------|--------------|
| AI | Analog Input |
| AO | Analog Output |
| AV | Analog Value |
| BI | Binary Input |
| BO | Binary Output |
| BV | Binary Value |

### Einzelne Devices (Alternative)

```json
{
  "devices": [
    {
      "address": "192.168.1.100:47808",
      "id": 1234,
      "name": "hvac_unit_01",
      "objects": ["AI:0:temperature", "AI:1:humidity"]
    }
  ]
}
```

## Quick Start

### Lokal

**Voraussetzungen:**
- Docker
- Docker Compose

**Starten:**
```bash
docker-compose up --build
```

**Stoppen:**
```bash
docker-compose down
```

## Testen

### 1. Consumer-Status und Performance

```bash
docker-compose logs -f consumer
```

Erwartete Ausgabe:
```
[STATS] 2026-01-31T21:23:53.399Z | Rate: 2447.0 msg/s | Interval: 12235 msgs | Total: 398112 msgs
```

### 2. Telegraf Logs

```bash
docker-compose logs -f telegraf
```

Erwartete Ausgabe:
```json
{"fields":{"current_floor":5},"name":"bacnet","tags":{"asset_id":"elevator_0001","site":"test_labor"},...}
```

### 3. RabbitMQ Management UI

- **URL:** http://localhost:15672
- **User:** user
- **Password:** password

### 4. Simulator-Status

```bash
docker-compose logs -f bacnet-simulator
```

Erwartete Ausgabe:
```
[Update] 10000 elevators: 9500 moving, 200 doors open
```

### 5. Ressourcen-Verbrauch

```bash
docker stats
```

## Projektstruktur

```
ot_prototype2/
├── docker-compose.yml          # Container-Orchestrierung
├── telegraf.conf               # Telegraf + BACnet-Konfiguration
├── README.md
├── bacnet-simulator/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       └── index.ts            # Aufzug-Simulation + RPM Support
├── telegraf-bacnet/
│   ├── Dockerfile              # Telegraf + Node.js
│   ├── package.json
│   └── bacnet_shim.js          # BACnet-Client mit RPM
└── consumer/
    ├── Dockerfile
    ├── package.json
    └── consumer.js             # Queue-Consumer mit Stats
```

## Erweiterung

### Weitere BACnet-Geräte hinzufügen

In `telegraf.conf` das `devices`-Array erweitern:

```json
{
  "devices": [
    { "address": "192.168.1.100:47808", "id": 100, "name": "chiller_01", ... },
    { "address": "192.168.1.101:47808", "id": 101, "name": "ahu_01", ... }
  ],
  "deviceRange": { ... }
}
```

### Native Telegraf-Inputs kombinieren

```toml
# BACnet (via Shim)
[[inputs.execd]]
  command = ["node", "/opt/bacnet-shim/bacnet_shim.js", "--config", "..."]

# Modbus (nativ)
[[inputs.modbus]]
  name = "plc_01"
  slave_id = 1
  controller = "tcp://192.168.1.200:502"

# OPC-UA (nativ)
[[inputs.opcua]]
  endpoint = "opc.tcp://192.168.1.201:4840"
```

### Consumer anpassen

Umgebungsvariablen in `docker-compose.yml`:

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `RABBITMQ_HOST` | `rabbitmq` | RabbitMQ Hostname |
| `RABBITMQ_USER` | `user` | RabbitMQ Benutzername |
| `RABBITMQ_PASS` | `password` | RabbitMQ Passwort |
| `LOG_FILE` | `/var/log/consumer/messages.log` | Pfad zum Logfile |
| `STATS_INTERVAL` | `5000` | Statistik-Intervall in ms |

## Troubleshooting

### Keine Daten in Telegraf

1. Prüfen ob Simulator läuft: `docker-compose logs bacnet-simulator`
2. Prüfen ob Netzwerk korrekt: `docker network ls` (ot-network muss existieren)
3. BACnet-Shim Logs: `docker-compose logs telegraf | grep "BACnet Shim"`

### RabbitMQ Connection Error

1. Warten bis RabbitMQ vollständig gestartet ist (~10s)
2. Credentials prüfen in `telegraf.conf` und `docker-compose.yml`

### Niedriger Durchsatz

1. `batchSize` erhöhen (Standard: 1000)
2. `maxConcurrent` erhöhen (Standard: 200, max. empfohlen: 250 wegen BACnet invokeId Limit)
3. Ressourcen prüfen mit `docker stats`
