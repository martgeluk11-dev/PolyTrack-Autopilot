(() => {
  "use strict";
  if (window.__PTAP_WORKER_BRIDGE__) return;
  window.__PTAP_WORKER_BRIDGE__ = true;

  const UPDATE_RESULT = 10;
  const HEADER_BYTES = 4;
  const STATE_BYTES = 227;
  let observedWorkers = 0;
  let lastSentAt = 0;
  let geometrySent = false;

  function numericVertices(part) {
    const candidates = [
      part?.vertices,
      part?.vertices?.array,
      part?.geometry?.attributes?.position?.array,
      part?.geometry?.attributes?.position,
      part?.mesh?.geometry?.attributes?.position?.array
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const source = candidate.array || candidate;
      if (ArrayBuffer.isView(source) || Array.isArray(source)) {
        const values = Array.from(source, Number);
        if (values.length >= 9 && values.length % 9 === 0 && values.every(Number.isFinite)) return values;
      }
    }
    return null;
  }

  function captureTrackGeometry(data) {
    if (geometrySent || !Array.isArray(data?.trackParts) || !data.trackParts.length) return;
    const library = {};
    for (const part of data.trackParts) {
      if (!Number.isInteger(part?.id)) continue;
      const vertices = numericVertices(part);
      if (!vertices) continue;
      const center = part.detector?.center || part.detectorCenter;
      const size = part.detector?.size || part.detectorSize;
      library[part.id] = {
        vertices,
        detector: center?.length >= 3 && size?.length >= 3
          ? { center: Array.from(center, Number), size: Array.from(size, Number), type: Number(part.detector?.type ?? part.detectorType ?? 0) }
          : null
      };
    }
    if (!Object.keys(library).length) return;
    geometrySent = true;
    window.postMessage({
      type: "PTAP_PAGE_BRIDGE_TRACK_GEOMETRY",
      source: "polytrack-autopilot",
      library
    }, "*");
  }

  function asBuffer(value) {
    if (value instanceof ArrayBuffer) return value;
    if (ArrayBuffer.isView(value)) {
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }
    return null;
  }

  function readState(value) {
    const buffer = asBuffer(value);
    if (!buffer || buffer.byteLength < STATE_BYTES) return null;
    const view = new DataView(buffer);
    let offset = HEADER_BYTES;

    const carId = view.getUint32(0, true);
    const frames = view.getUint8(offset) |
      (view.getUint8(offset + 1) << 8) |
      (view.getUint8(offset + 2) << 16);
    offset += 3;

    const speedKmh = view.getFloat32(offset, true); offset += 4;
    const flags = view.getUint8(offset++);
    if (flags & 0x02) offset += 3;

    const nextCheckpointIndex = view.getUint16(offset, true); offset += 2;
    const position = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true)
    ];
    offset += 12;
    const quaternion = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
      view.getFloat32(offset + 12, true)
    ];

    if (![speedKmh, ...position, ...quaternion].every(Number.isFinite)) return null;
    return {
      carId, frames, speedKmh, flags, hasStarted: Boolean(flags & 1),
      hasCheckpoint: Boolean(flags & 4), nextCheckpointIndex, position, quaternion
    };
  }

  function observeMessage(event) {
    const data = event?.data;
    if (!data) return;
    if (data.messageType === 0 && Array.isArray(data.trackParts)) {
      captureTrackGeometry(data);
      return;
    }
    if (data.messageType !== UPDATE_RESULT || !Array.isArray(data.carStateBuffers)) return;

    const states = data.carStateBuffers.map(readState).filter(Boolean);
    if (!states.length) return;

    // In a normal solo run the player's car is car 0. Prefer it over a ghost
    // or secondary simulation car, while retaining a fallback for other builds.
    const state = states.find(item => item.carId === 0) || states[0];
    const now = performance.now();
    if (now - lastSentAt < 8) return;
    lastSentAt = now;

    window.postMessage({
      type: "PTAP_PAGE_BRIDGE_TELEMETRY",
      source: "polytrack-autopilot",
      state,
      workerCount: observedWorkers
    }, "*");
  }

  const NativeWorker = window.Worker;
  if (typeof NativeWorker === "function") {
    function PTAPWorker(...args) {
      const worker = new NativeWorker(...args);
      observedWorkers++;
      worker.addEventListener("message", observeMessage);
      return worker;
    }
    PTAPWorker.prototype = NativeWorker.prototype;
    Object.setPrototypeOf(PTAPWorker, NativeWorker);
    window.Worker = PTAPWorker;
  }

  window.postMessage({
    type: "PTAP_PAGE_BRIDGE_READY",
    source: "polytrack-autopilot"
  }, "*");
})();