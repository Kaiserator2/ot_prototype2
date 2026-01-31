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
- **Routing:** Nach `asset_id` Tag
- **Format:** JSON

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

### Voraussetzungen

- Docker
- Docker Compose

### Starten

```bash
docker-compose up --build
```

### Stoppen

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
├── docker-compose.yml          # Container-Orchestrierung
├── telegraf.conf               # Telegraf + BACnet-Konfiguration
├── README.md
├── bacnet-simulator/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       └── index.ts            # Aufzug-Simulation
└── telegraf-bacnet/
    ├── Dockerfile              # Telegraf + Node.js
    ├── package.json
    └── bacnet_shim.js          # BACnet-Client für execd
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

```bash
# Queue anlegen und an Exchange binden
curl -u user:password -X PUT http://localhost:15672/api/queues/%2F/sensor_data \
  -H "content-type: application/json" \
  -d '{"durable":true}'

curl -u user:password -X POST http://localhost:15672/api/bindings/%2F/e/iot_metrics/q/sensor_data \
  -H "content-type: application/json" \
  -d '{"routing_key":"#"}'
```

## Troubleshooting

### Keine Daten in Telegraf

1. Prüfen ob Simulator läuft: `docker-compose logs bacnet-simulator`
2. Prüfen ob Port erreichbar: Container laufen mit `network_mode: host`
3. BACnet-Shim Logs: `docker-compose logs telegraf | grep "BACnet Shim"`

### RabbitMQ Connection Error

1. Warten bis RabbitMQ vollständig gestartet ist (~10s)
2. Credentials prüfen in `telegraf.conf` und `docker-compose.yml`

### Hohe CPU-Last

- `batchSize` in der Config erhöhen (Standard: 50)
- `interval` erhöhen (Standard: 10s)
