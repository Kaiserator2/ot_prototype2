#!/usr/bin/env node
/**
 * BACnet Shim für Telegraf execd-Plugin
 *
 * Unterstützt zwei Modi:
 *
 * 1. Einzelne Devices:
 *    {"devices":[{"address":"...","id":1234,"objects":["AI:0:temp"]}]}
 *
 * 2. Device-Range (für viele gleichartige Geräte):
 *    {"deviceRange":{"address":"...","baseId":1234,"namePrefix":"elevator","count":1000,"instanceOffset":20,"objects":[...]}}
 */

const BACnet = require('node-bacnet');

const OBJECT_TYPES = {
  'AI': 0, 'AO': 1, 'AV': 2,
  'BI': 3, 'BO': 4, 'BV': 5,
};
const BINARY_TYPES = new Set([3, 4, 5]);
const PROPERTY_PRESENT_VALUE = 85;

function parseArgs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      try {
        return JSON.parse(args[i + 1]);
      } catch (e) {
        console.error(`# Config parse error: ${e.message}`);
        process.exit(1);
      }
    }
  }
  console.error('# Usage: bacnet_shim.js --config \'{"devices":[...]}\'');
  process.exit(1);
}

function parseObject(objStr, instanceOffset = 0) {
  const parts = objStr.split(':');
  if (parts.length < 2) return null;

  const typeStr = parts[0].toUpperCase();
  const type = OBJECT_TYPES[typeStr];
  if (type === undefined) return null;

  const baseInstance = parseInt(parts[1], 10);
  const name = parts[2] || `${typeStr.toLowerCase()}_${baseInstance}`;

  return {
    type,
    baseInstance,
    instance: baseInstance + instanceOffset,
    name,
    isBinary: BINARY_TYPES.has(type)
  };
}

// Expandiert deviceRange zu einzelnen Devices
function expandDeviceRange(range) {
  const devices = [];
  const { address, baseId, namePrefix, count, instanceOffset, objects, tags } = range;

  // Umgebungsvariable überschreibt Config-Adresse
  const envAddress = process.env.BACNET_ADDRESS;
  const finalAddress = envAddress || address.split(':')[0];
  const port = parseInt(address.split(':')[1] || '47808', 10);

  for (let i = 0; i < count; i++) {
    const deviceNum = i + 1;
    const offset = i * instanceOffset;

    devices.push({
      address: { address: finalAddress },
      port: port,
      id: baseId,
      name: `${namePrefix}_${String(deviceNum).padStart(4, '0')}`,
      tags: { ...tags, device_num: deviceNum },
      objects: objects.map(obj => parseObject(obj, offset)).filter(Boolean),
    });
  }

  return devices;
}

async function main() {
  const config = parseArgs();
  const interval = (config.interval || 10) * 1000;

  // Devices sammeln
  let allDevices = [];

  // Einzelne Devices
  if (config.devices) {
    for (const dev of config.devices) {
      allDevices.push({
        address: { address: dev.address.split(':')[0] },
        port: parseInt(dev.address.split(':')[1] || '47808', 10),
        id: dev.id,
        name: dev.name || `device_${dev.id}`,
        tags: dev.tags || {},
        objects: (dev.objects || []).map(obj => parseObject(obj)).filter(Boolean),
      });
    }
  }

  // Device Range
  if (config.deviceRange) {
    allDevices = allDevices.concat(expandDeviceRange(config.deviceRange));
  }

  if (allDevices.length === 0) {
    console.error('# No devices configured');
    process.exit(1);
  }

  const totalObjects = allDevices.reduce((sum, d) => sum + d.objects.length, 0);
  // Limit concurrent requests to avoid BACnet invokeId collisions (8-bit = max 255)
  const MAX_CONCURRENT = config.maxConcurrent || 200;
  let activeRequests = 0;
  const requestQueue = [];

  function processQueue() {
    while (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT) {
      const { resolve: res, fn } = requestQueue.shift();
      activeRequests++;
      fn().finally(() => {
        activeRequests--;
        processQueue();
      }).then(res.resolve, res.reject);
    }
  }

  function limitConcurrency(fn) {
    return new Promise((resolve, reject) => {
      requestQueue.push({ resolve: { resolve, reject }, fn });
      processQueue();
    });
  }

  console.error(`# BACnet Shim: ${allDevices.length} devices, ${totalObjects} objects, interval ${interval/1000}s, maxConcurrent ${MAX_CONCURRENT}`);

  const client = new BACnet({ port: config.clientPort || 47809 });

  // ReadPropertyMultiple - read ALL objects of a device in ONE request
  function readPropertyMultiple(address, objects) {
    return limitConcurrency(() => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 5000);

      // Build request: each object with PRESENT_VALUE property
      const requestObjects = objects.map(obj => ({
        objectId: { type: obj.type, instance: obj.instance },
        properties: [{ id: PROPERTY_PRESENT_VALUE }]
      }));

      client.readPropertyMultiple(
        address,
        requestObjects,
        (err, response) => {
          clearTimeout(timeout);
          if (err) {
            reject(err);
          } else {
            // Parse response: extract values for each object
            const values = {};
            if (response?.values) {
              for (const item of response.values) {
                const key = `${item.objectId.type}:${item.objectId.instance}`;
                const propValue = item.values?.[0]?.value?.[0]?.value;
                if (propValue !== undefined) {
                  values[key] = propValue;
                }
              }
            }
            resolve(values);
          }
        }
      );
    }));
  }

  async function pollDevice(device) {
    const ts = Date.now() * 1000000;
    const tags = { asset_id: device.name, ...device.tags };
    const tagStr = Object.entries(tags).map(([k, v]) => `${k}=${v}`).join(',');

    try {
      // ONE request for ALL 23 objects instead of 23 separate requests
      const values = await readPropertyMultiple(device.address, device.objects);

      const results = [];
      for (const obj of device.objects) {
        const key = `${obj.type}:${obj.instance}`;
        const value = values[key];
        if (value !== undefined) {
          const fieldValue = obj.isBinary ? `${value}i` : value;
          results.push(`bacnet,${tagStr} ${obj.name}=${fieldValue} ${ts}`);
        }
      }
      return results;
    } catch (e) {
      // Timeout or error - return empty
      return [];
    }
  }

  // Paralleles Polling mit Batching
  async function poll() {
    const batchSize = config.batchSize || 10; // Devices parallel

    for (let i = 0; i < allDevices.length; i += batchSize) {
      const batch = allDevices.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(pollDevice));

      // Ausgabe
      for (const deviceResults of results) {
        for (const line of deviceResults) {
          console.log(line);
        }
      }
    }
  }

  poll();
  setInterval(poll, interval);
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

main().catch(e => {
  console.error(`# Fatal: ${e.message}`);
  process.exit(1);
});
