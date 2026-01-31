# OT Protocol Translator Prototype

Ein Prototyp zur Erfassung von BACnet-Daten aus OT-Geräten (Operational Technology) und Weiterleitung an eine Message Queue.

## Überblick

Dieses System simuliert 1000 Aufzüge mit je 23 Sensoren und demonstriert die Erfassung von BACnet-Daten über Telegraf mit Weiterleitung an RabbitMQ.

```
┌─────────────────────┐     BACnet/UDP      ┌─────────────────────┐
│  BACnet Simulator   │◄───────────────────►│  Telegraf + Shim    │
│  (1000 Aufzüge)     │     Port 47808      │  (Node.js BACnet)   │
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

## Komponenten

### 1. BACnet Simulator (`bacnet-simulator/`)

Node.js-Anwendung, die 1000 virtuelle Aufzüge simuliert:

| Sensor-Typ | Anzahl/Aufzug | Beispiele |
|------------|---------------|-----------|
| Analog Inputs | 12 | current_floor, speed, motor_temperature, load_weight |
| Binary Inputs | 11 | door_open, emergency_stop, safety_chain_ok |

- **Technologie:** Node.js + node-bacnet
- **Port:** 47808/UDP
- **Device ID:** 1234
- **Update-Intervall:** 5 Sekunden

### 2. Telegraf + BACnet Shim (`telegraf-bacnet/`)

Custom Telegraf-Image mit Node.js-basiertem BACnet-Client:

- **Input:** BACnet via `execd`-Plugin + Node.js Shim
- **Output:** RabbitMQ (AMQP) + stdout (Debug)
- **Polling-Intervall:** 10 Sekunden
- **Datenpunkte:** 23.000 pro Zyklus

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

**Gemessene Metriken:**
| Metrik | Beschreibung |
|--------|--------------|
| Rate (msg/s) | Durchsatz pro Sekunde |
| Interval | Messages im letzten Intervall |
| Total | Gesamtzahl verarbeiteter Messages |
| Latency | End-to-End-Zeit (avg/min/max in ms) |

**Beispiel-Output:**
```
[STATS] 2026-01-31T14:30:05.123Z | Rate: 2300.5 msg/s | Interval: 11502 msgs | Total: 45008 msgs | Latency: avg=12.3ms min=5.1ms max=89.2ms
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
  "batchSize": 50,
  "deviceRange": {
    "address": "127.0.0.1:47808",
    "baseId": 1234,
    "namePrefix": "elevator",
    "count": 1000,
    "instanceOffset": 20,
    "tags": { "site": "test_labor" },
    "objects": [
      "AI:0:current_floor",
      "BI:0:door_open"
    ]
  }
}
```

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

### Option 1: GitHub Codespaces (non-functional)

1. Repository in GitHub öffnen
2. **Code** → **Codespaces** → **Create codespace on main**
3. Warten bis der Container gestartet ist
4. Die Services starten automatisch

**Ports:**
- RabbitMQ Management: Wird automatisch weitergeleitet (Port 15672)
- Klick auf "Open in Browser" in der Ports-Ansicht

### Option 2: Lokal

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

### 1. Logs beobachten

```bash
docker-compose logs -f telegraf
```

Erwartete Ausgabe:
```json
{"fields":{"current_floor":5},"name":"bacnet","tags":{"asset_id":"elevator_0001","site":"test_labor"},...}
{"fields":{"speed":1.82},"name":"bacnet","tags":{"asset_id":"elevator_0001",...},...}
```

### 2. RabbitMQ Management UI

- **URL:** http://localhost:15672
- **User:** user
- **Password:** password

Prüfen:
- Exchange `iot_metrics` existiert
- Messages werden empfangen (publish_in Rate > 0)

### 3. Exchange-Status via API

```bash
curl -s -u user:password http://localhost:15672/api/exchanges/%2F/iot_metrics | jq .
```

### 4. Simulator-Status

```bash
docker-compose logs -f bacnet-simulator
```

Erwartete Ausgabe:
```
[Update] 1000 elevators: 950 moving, 20 doors open
```

### 5. Consumer-Status und Performance

```bash
# Consumer Logs mit Performance-Stats
docker-compose logs -f consumer

# Logfile im Container ansehen
docker-compose exec consumer tail -f /var/log/consumer/messages.log

# Letzte 100 Zeilen des Logfiles
docker-compose exec consumer tail -100 /var/log/consumer/messages.log
```

Erwartete Ausgabe:
```
[STATS] 2026-01-31T14:30:05.123Z | Rate: 2300.5 msg/s | Interval: 11502 msgs | Total: 45008 msgs | Latency: avg=12.3ms min=5.1ms max=89.2ms
```

**Stats-Intervall anpassen:**

In `docker-compose.yml` unter `consumer/environment`:
```yaml
STATS_INTERVAL: "10000"  # 10 Sekunden
```

## Metriken

| Metrik | Wert |
|--------|------|
| Simulierte Aufzüge | 1.000 |
| Sensoren pro Aufzug | 23 |
| Datenpunkte gesamt | 23.000 |
| Polling-Intervall | 10s |
| Messages pro Minute | ~138.000 |

## Projektstruktur

```
ot_prototype2/
├── .devcontainer/
│   └── devcontainer.json       # GitHub Codespaces Konfiguration
├── docker-compose.yml          # Container-Orchestrierung
├── telegraf.conf               # Telegraf + BACnet-Konfiguration
├── README.md
├── bacnet-simulator/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       └── index.ts            # Aufzug-Simulation
├── telegraf-bacnet/
│   ├── Dockerfile              # Telegraf + Node.js
│   ├── package.json
│   └── bacnet_shim.js          # BACnet-Client für execd
└── consumer/
    ├── Dockerfile              # Node.js Consumer
    ├── package.json
    └── consumer.js             # Queue-Consumer mit Logging + Stats
```

## GitHub Codespaces

Das Projekt ist vollständig Codespaces-kompatibel.

### Architektur in Codespaces

Da `network_mode: host` in Codespaces nicht funktioniert, kommunizieren alle Services über ein Docker Bridge-Netzwerk:

```
┌──────────────────────────────────────────────────────────────────┐
│                    Docker Network: ot-network                    │
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │
│  │  bacnet-    │    │  telegraf   │    │  rabbitmq   │          │
│  │  simulator  │◄──►│  + shim     │───►│             │          │
│  └─────────────┘    └─────────────┘    └──────┬──────┘          │
│                                               │                  │
│                                               ▼                  │
│                                        ┌─────────────┐          │
│                                        │  consumer   │          │
│                                        │  + logging  │          │
│                                        └─────────────┘          │
│                                               │ Port 15672      │
└───────────────────────────────────────────────┼──────────────────┘
                                                ▼
                                    ┌─────────────────────┐
                                    │  Codespaces Port    │
                                    │  Forwarding         │
                                    └─────────────────────┘
```

### Konfiguration für Codespaces (non-functional)

Die Adressen werden über Umgebungsvariablen gesetzt:

| Variable | Default | Beschreibung |
|----------|---------|--------------|
| `BACNET_ADDRESS` | `bacnet-simulator` | Hostname des BACnet-Geräts |
| `RABBITMQ_HOST` | `rabbitmq` | Hostname des Message Brokers |

Diese sind in `docker-compose.yml` definiert und werden automatisch an Telegraf übergeben.

### Dateien für Codespaces (non-functional)

| Datei | Zweck |
|-------|-------|
| `.devcontainer/devcontainer.json` | Codespaces-Konfiguration, Port-Forwarding |
| `docker-compose.yml` | Service-Definitionen mit `ot-network` |

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
  holding_registers = [
    { address = 0, name = "temperature", type = "FLOAT32" }
  ]

# OPC-UA (nativ)
[[inputs.opcua]]
  endpoint = "opc.tcp://192.168.1.201:4840"
  nodes = [
    { name = "pressure", namespace = "2", identifier_type = "s", identifier = "Pressure" }
  ]
```

### Queue für Persistenz

Die Queue `sensor_data` wird automatisch vom Consumer erstellt und an die Exchange gebunden.

**Manuelle Queue-Erstellung (optional):**
```bash
# Queue anlegen und an Exchange binden
curl -u user:password -X PUT http://localhost:15672/api/queues/%2F/sensor_data \
  -H "content-type: application/json" \
  -d '{"durable":true}'

curl -u user:password -X POST http://localhost:15672/api/bindings/%2F/e/iot_metrics/q/sensor_data \
  -H "content-type: application/json" \
  -d '{"routing_key":"#"}'
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

## Beobachten
docker-compose logs --tail=100 consumer

## Troubleshooting

### Keine Daten in Telegraf

1. Prüfen ob Simulator läuft: `docker-compose logs bacnet-simulator`
2. Prüfen ob Netzwerk korrekt: `docker network ls` (ot-network muss existieren)
3. BACnet-Shim Logs: `docker-compose logs telegraf | grep "BACnet Shim"`

### RabbitMQ Connection Error

1. Warten bis RabbitMQ vollständig gestartet ist (~10s)
2. Credentials prüfen in `telegraf.conf` und `docker-compose.yml`
3. In Codespaces: Port 15672 muss weitergeleitet sein

### Hohe CPU-Last
Konfiguration für den bacnet shim:
- `batchSize` in der Config erhöhen (Standard: 50)
- `interval` erhöhen (Standard: 10s)

### Codespaces-spezifisch

- **Services starten nicht:** Terminal öffnen und `docker-compose up -d` ausführen
- **Port nicht erreichbar:** In der Ports-Ansicht prüfen ob Port 15672 "Public" ist
- **Langsame Performance:** Codespaces hat limitierte Ressourcen, ggf. `count` in Config reduzieren
