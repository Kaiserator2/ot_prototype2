// eslint-disable-next-line @typescript-eslint/no-var-requires
const BACnet = require("node-bacnet");
const bacnetEnum = BACnet.enum;

// Configuration from environment
const DEVICE_ID = parseInt(process.env.BACNET_DEVICE_ID || "1234", 10);
const BACNET_PORT = parseInt(process.env.BACNET_PORT || "47808", 10);

// Elevator simulation data
interface SimulatedPoint {
  objectType: number;
  instance: number;
  name: string;
  value: number;
  unit: number;
}

// Simulate 1000 elevators with realistic sensor data
const NUM_ELEVATORS = 1000;
const FLOORS = 10;

interface ElevatorState {
  currentFloor: number;
  targetFloor: number;
  direction: number; // 0=stopped, 1=up, 2=down
  speed: number;
  position: number;
  doorOpen: boolean;
  loadWeight: number;
  motorTemp: number;
  tripCount: number;
}

const elevatorStates: ElevatorState[] = Array.from({ length: NUM_ELEVATORS }, (_, i) => ({
  currentFloor: Math.floor(Math.random() * FLOORS) + 1,
  targetFloor: Math.floor(Math.random() * FLOORS) + 1,
  direction: 0,
  speed: 0,
  position: 0,
  doorOpen: false,
  loadWeight: Math.random() * 500,
  motorTemp: 35 + Math.random() * 10,
  tripCount: Math.floor(Math.random() * 10000),
}));

// Build simulated points for all elevators
function buildSimulatedPoints(): SimulatedPoint[] {
  const points: SimulatedPoint[] = [];
  let instanceOffset = 0;

  for (let e = 0; e < NUM_ELEVATORS; e++) {
    const prefix = `Elevator_${(e + 1).toString().padStart(4, "0")}`;
    const state = elevatorStates[e];
    const base = instanceOffset;

    // Analog inputs (read-only sensors)
    points.push(
      { objectType: bacnetEnum.ObjectType.ANALOG_INPUT, instance: base + 0, name: `${prefix}.CurrentFloor`, value: state.currentFloor, unit: 95 },
      { objectType: bacnetEnum.ObjectType.ANALOG_INPUT, instance: base + 1, name: `${prefix}.TargetFloor`, value: state.targetFloor, unit: 95 },
      { objectType: bacnetEnum.ObjectType.ANALOG_INPUT, instance: base + 2, name: `${prefix}.Direction`, value: state.direction, unit: 95 },
      { objectType: bacnetEnum.ObjectType.ANALOG_INPUT, instance: base + 3, name: `${prefix}.Speed`, value: state.speed, unit: bacnetEnum.EngineeringUnits.METERS_PER_SECOND },
      { objectType: bacnetEnum.ObjectType.ANALOG_INPUT, instance: base + 4, name: `${prefix}.Position`, value: state.position, unit: bacnetEnum.EngineeringUnits.METERS },
      { objectType: bacnetEnum.ObjectType.ANALOG_INPUT, instance: base + 5, name: `${prefix}.LoadWeight`, value: state.loadWeight, unit: bacnetEnum.EngineeringUnits.KILOGRAMS },
      { objectType: bacnetEnum.ObjectType.ANALOG_INPUT, instance: base + 6, name: `${prefix}.MotorTemperature`, value: state.motorTemp, unit: bacnetEnum.EngineeringUnits.DEGREES_CELSIUS },
      { objectType: bacnetEnum.ObjectType.ANALOG_INPUT, instance: base + 7, name: `${prefix}.MotorCurrent`, value: 15 + Math.random() * 5, unit: bacnetEnum.EngineeringUnits.AMPERES },
      { objectType: bacnetEnum.ObjectType.ANALOG_INPUT, instance: base + 8, name: `${prefix}.CabinTemperature`, value: 22 + Math.random() * 3, unit: bacnetEnum.EngineeringUnits.DEGREES_CELSIUS },
      { objectType: bacnetEnum.ObjectType.ANALOG_INPUT, instance: base + 9, name: `${prefix}.TripCount`, value: state.tripCount, unit: 95 },
      { objectType: bacnetEnum.ObjectType.ANALOG_INPUT, instance: base + 10, name: `${prefix}.DoorCycles`, value: state.tripCount * 2, unit: 95 },
      { objectType: bacnetEnum.ObjectType.ANALOG_INPUT, instance: base + 11, name: `${prefix}.PassengerCount`, value: Math.floor(Math.random() * 8), unit: 95 }
    );

    // Binary inputs (status flags)
    points.push(
      { objectType: bacnetEnum.ObjectType.BINARY_INPUT, instance: base + 0, name: `${prefix}.DoorOpen`, value: state.doorOpen ? 1 : 0, unit: 95 },
      { objectType: bacnetEnum.ObjectType.BINARY_INPUT, instance: base + 1, name: `${prefix}.DoorObstructed`, value: 0, unit: 95 },
      { objectType: bacnetEnum.ObjectType.BINARY_INPUT, instance: base + 2, name: `${prefix}.EmergencyStop`, value: 0, unit: 95 },
      { objectType: bacnetEnum.ObjectType.BINARY_INPUT, instance: base + 3, name: `${prefix}.OverloadWarning`, value: state.loadWeight > 600 ? 1 : 0, unit: 95 },
      { objectType: bacnetEnum.ObjectType.BINARY_INPUT, instance: base + 4, name: `${prefix}.Overload`, value: state.loadWeight > 800 ? 1 : 0, unit: 95 },
      { objectType: bacnetEnum.ObjectType.BINARY_INPUT, instance: base + 5, name: `${prefix}.SafetyChainOK`, value: 1, unit: 95 },
      { objectType: bacnetEnum.ObjectType.BINARY_INPUT, instance: base + 6, name: `${prefix}.BrakeEngaged`, value: state.speed === 0 ? 1 : 0, unit: 95 },
      { objectType: bacnetEnum.ObjectType.BINARY_INPUT, instance: base + 7, name: `${prefix}.MaintenanceMode`, value: 0, unit: 95 },
      { objectType: bacnetEnum.ObjectType.BINARY_INPUT, instance: base + 8, name: `${prefix}.OutOfService`, value: 0, unit: 95 },
      { objectType: bacnetEnum.ObjectType.BINARY_INPUT, instance: base + 9, name: `${prefix}.CabinLightOn`, value: 1, unit: 95 },
      { objectType: bacnetEnum.ObjectType.BINARY_INPUT, instance: base + 10, name: `${prefix}.VentilationOn`, value: 1, unit: 95 }
    );

    instanceOffset += 20; // Reserve space for each elevator
  }

  return points;
}

const simulatedPoints: SimulatedPoint[] = buildSimulatedPoints();

// Create BACnet server
const server = new BACnet({ port: BACNET_PORT });

console.log(`BACnet Simulator starting...`);
console.log(`Device ID: ${DEVICE_ID}`);
console.log(`Port: ${BACNET_PORT}`);
console.log(`Simulated points: ${simulatedPoints.length}`);

// Handle Who-Is requests
server.on("whoIs", (msg: any) => {
  console.log(`Received Who-Is from ${msg.header.sender.address}`);

  // Check if our device ID is in range
  const lowLimit = msg.payload?.lowLimit ?? 0;
  const highLimit = msg.payload?.highLimit ?? 4194303;

  if (DEVICE_ID >= lowLimit && DEVICE_ID <= highLimit) {
    // Respond with I-Am
    server.iAmResponse(
      DEVICE_ID,
      bacnetEnum.Segmentation.NO_SEGMENTATION,
      480 // max APDU length
    );
    console.log(`Sent I-Am response for device ${DEVICE_ID}`);
  }
});

// Handle Read-Property requests
server.on("readProperty", (msg: any) => {
  // node-bacnet verwendet manchmal 'type' statt 'objectType'
  const objectType = msg.payload.objectId.type ?? msg.payload.objectId.objectType;
  const instance = msg.payload.objectId.instance;
  const propertyId = msg.payload.property.id;

  console.log(
    `ReadProperty: objectType=${objectType}, instance=${instance}, property=${propertyId}`
  );

  // Find the point
  const point = simulatedPoints.find(
    (p) => p.objectType === objectType && p.instance === instance
  );

  if (!point) {
    // Check if reading device object
    if (objectType === bacnetEnum.ObjectType.DEVICE && instance === DEVICE_ID) {
      handleDevicePropertyRead(msg, propertyId);
      return;
    }

    console.log(`Object not found: ${objectType}:${instance}`);
    return;
  }

  let value: any;

  switch (propertyId) {
    case bacnetEnum.PropertyIdentifier.PRESENT_VALUE:
      if (objectType === bacnetEnum.ObjectType.BINARY_INPUT) {
        value = { type: bacnetEnum.ApplicationTag.ENUMERATED, value: point.value };
      } else {
        value = { type: bacnetEnum.ApplicationTag.REAL, value: point.value };
      }
      break;

    case bacnetEnum.PropertyIdentifier.OBJECT_NAME:
      value = { type: bacnetEnum.ApplicationTag.CHARACTER_STRING, value: point.name };
      break;

    case bacnetEnum.PropertyIdentifier.OBJECT_TYPE:
      value = { type: bacnetEnum.ApplicationTag.ENUMERATED, value: point.objectType };
      break;

    case bacnetEnum.PropertyIdentifier.OBJECT_IDENTIFIER:
      value = {
        type: bacnetEnum.ApplicationTag.OBJECTIDENTIFIER,
        value: { type: point.objectType, instance: point.instance },
      };
      break;

    case bacnetEnum.PropertyIdentifier.UNITS:
      value = { type: bacnetEnum.ApplicationTag.ENUMERATED, value: point.unit };
      break;

    case bacnetEnum.PropertyIdentifier.DESCRIPTION:
      value = {
        type: bacnetEnum.ApplicationTag.CHARACTER_STRING,
        value: `Simulated ${point.name}`,
      };
      break;

    default:
      console.log(`Property ${propertyId} not implemented`);
      return;
  }

  server.readPropertyResponse(
    msg.header.sender.address,
    msg.invokeId,
    msg.payload.objectId,
    msg.payload.property,
    [value]
  );
});

function handleDevicePropertyRead(msg: any, propertyId: number) {
  let value: any;

  switch (propertyId) {
    case bacnetEnum.PropertyIdentifier.OBJECT_IDENTIFIER:
      value = {
        type: bacnetEnum.ApplicationTag.OBJECTIDENTIFIER,
        value: { type: bacnetEnum.ObjectType.DEVICE, instance: DEVICE_ID },
      };
      break;

    case bacnetEnum.PropertyIdentifier.OBJECT_NAME:
      value = {
        type: bacnetEnum.ApplicationTag.CHARACTER_STRING,
        value: `BACnet_Simulator_${DEVICE_ID}`,
      };
      break;

    case bacnetEnum.PropertyIdentifier.OBJECT_TYPE:
      value = {
        type: bacnetEnum.ApplicationTag.ENUMERATED,
        value: bacnetEnum.ObjectType.DEVICE,
      };
      break;

    case bacnetEnum.PropertyIdentifier.VENDOR_NAME:
      value = {
        type: bacnetEnum.ApplicationTag.CHARACTER_STRING,
        value: "OT Prototype",
      };
      break;

    case bacnetEnum.PropertyIdentifier.VENDOR_IDENTIFIER:
      value = { type: bacnetEnum.ApplicationTag.UNSIGNED_INTEGER, value: 999 };
      break;

    case bacnetEnum.PropertyIdentifier.MODEL_NAME:
      value = {
        type: bacnetEnum.ApplicationTag.CHARACTER_STRING,
        value: "Virtual BACnet Device",
      };
      break;

    case bacnetEnum.PropertyIdentifier.FIRMWARE_REVISION:
      value = { type: bacnetEnum.ApplicationTag.CHARACTER_STRING, value: "1.0.0" };
      break;

    case bacnetEnum.PropertyIdentifier.APPLICATION_SOFTWARE_VERSION:
      value = { type: bacnetEnum.ApplicationTag.CHARACTER_STRING, value: "1.0.0" };
      break;

    case bacnetEnum.PropertyIdentifier.PROTOCOL_VERSION:
      value = { type: bacnetEnum.ApplicationTag.UNSIGNED_INTEGER, value: 1 };
      break;

    case bacnetEnum.PropertyIdentifier.PROTOCOL_REVISION:
      value = { type: bacnetEnum.ApplicationTag.UNSIGNED_INTEGER, value: 14 };
      break;

    case bacnetEnum.PropertyIdentifier.SYSTEM_STATUS:
      value = {
        type: bacnetEnum.ApplicationTag.ENUMERATED,
        value: bacnetEnum.DeviceStatus.OPERATIONAL,
      };
      break;

    case bacnetEnum.PropertyIdentifier.OBJECT_LIST:
      // Return array of all objects including device
      const objects = [
        {
          type: bacnetEnum.ApplicationTag.OBJECTIDENTIFIER,
          value: { type: bacnetEnum.ObjectType.DEVICE, instance: DEVICE_ID },
        },
        ...simulatedPoints.map((p) => ({
          type: bacnetEnum.ApplicationTag.OBJECTIDENTIFIER,
          value: { type: p.objectType, instance: p.instance },
        })),
      ];
      server.readPropertyResponse(
        msg.header.sender.address,
        msg.invokeId,
        msg.payload.objectId,
        msg.payload.property,
        objects
      );
      return;

    default:
      console.log(`Device property ${propertyId} not implemented`);
      return;
  }

  server.readPropertyResponse(
    msg.header.sender.address,
    msg.invokeId,
    msg.payload.objectId,
    msg.payload.property,
    [value]
  );
}

// Handle Read-Property-Multiple requests
server.on("readPropertyMultiple", (msg: any) => {
  console.log(`ReadPropertyMultiple request received`);
  // Simplified handling - respond with available data
});

// Simulate elevator movement
function updateSimulatedValues() {
  for (let e = 0; e < NUM_ELEVATORS; e++) {
    const state = elevatorStates[e];
    const prefix = `Elevator_${(e + 1).toString().padStart(4, "0")}`;

    // Simulate elevator movement
    if (state.currentFloor !== state.targetFloor && !state.doorOpen) {
      // Moving
      state.direction = state.targetFloor > state.currentFloor ? 1 : 2;
      state.speed = 1.5 + Math.random() * 0.5;
      state.position += state.direction === 1 ? 0.5 : -0.5;

      // Check if reached floor
      if (Math.abs(state.position - state.targetFloor * 3) < 0.5) {
        state.currentFloor = state.targetFloor;
        state.direction = 0;
        state.speed = 0;
        state.doorOpen = true;
        state.tripCount++;
      }
    } else if (state.doorOpen) {
      // Door open - close after a cycle
      state.doorOpen = false;
      // Pick new random target
      state.targetFloor = Math.floor(Math.random() * FLOORS) + 1;
    } else {
      // Idle - pick new target occasionally
      if (Math.random() > 0.7) {
        state.targetFloor = Math.floor(Math.random() * FLOORS) + 1;
      }
    }

    // Update motor temp based on movement
    state.motorTemp = state.speed > 0 ? 40 + Math.random() * 15 : 35 + Math.random() * 5;

    // Update load weight occasionally
    if (state.doorOpen) {
      state.loadWeight = Math.random() * 600;
    }

    // Update point values
    const base = e * 20;
    simulatedPoints.find(p => p.name === `${prefix}.CurrentFloor`)!.value = state.currentFloor;
    simulatedPoints.find(p => p.name === `${prefix}.TargetFloor`)!.value = state.targetFloor;
    simulatedPoints.find(p => p.name === `${prefix}.Direction`)!.value = state.direction;
    simulatedPoints.find(p => p.name === `${prefix}.Speed`)!.value = state.speed;
    simulatedPoints.find(p => p.name === `${prefix}.Position`)!.value = state.position;
    simulatedPoints.find(p => p.name === `${prefix}.LoadWeight`)!.value = state.loadWeight;
    simulatedPoints.find(p => p.name === `${prefix}.MotorTemperature`)!.value = state.motorTemp;
    simulatedPoints.find(p => p.name === `${prefix}.DoorOpen`)!.value = state.doorOpen ? 1 : 0;
    simulatedPoints.find(p => p.name === `${prefix}.TripCount`)!.value = state.tripCount;
    simulatedPoints.find(p => p.name === `${prefix}.BrakeEngaged`)!.value = state.speed === 0 ? 1 : 0;
    simulatedPoints.find(p => p.name === `${prefix}.OverloadWarning`)!.value = state.loadWeight > 600 ? 1 : 0;
  }

  // Log summary only
  const moving = elevatorStates.filter(s => s.speed > 0).length;
  const doorsOpen = elevatorStates.filter(s => s.doorOpen).length;
  console.log(`[Update] ${NUM_ELEVATORS} elevators: ${moving} moving, ${doorsOpen} doors open`);
}

// Update values every 5 seconds
setInterval(updateSimulatedValues, 5000);

// Handle errors
server.on("error", (err: Error) => {
  console.error("BACnet error:", err.message);
});

console.log("BACnet Simulator is running. Press Ctrl+C to stop.");

// Keep the process running
process.on("SIGINT", () => {
  console.log("\nShutting down BACnet Simulator...");
  server.close();
  process.exit(0);
});
