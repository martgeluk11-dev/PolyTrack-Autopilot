(() => {
  "use strict";
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const REVERSE = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) REVERSE[ALPHABET.charCodeAt(i)] = i;
  const ENVIRONMENTS = ["Summer", "Winter", "Desert"];
  const AXES = ["YPositive", "YNegative", "XPositive", "XNegative", "ZPositive", "ZNegative"];
  const CHECKPOINT_IDS = new Set([52, 65, 75, 77]);
  const START_IDS = new Set([5, 91, 92, 93]);
  const MAX_PARTS = 100000;

  function readPacked(text) {
    let totalBits = 0;
    for (const char of text) {
      const code = char.charCodeAt(0);
      if (code >= REVERSE.length || REVERSE[code] < 0) throw new Error("Trackcode bevat ongeldige tekens.");
      totalBits += (REVERSE[code] & 30) === 30 ? 5 : 6;
    }
    const bytes = new Uint8Array(Math.ceil(totalBits / 8));
    let bit = 0;
    for (const char of text) {
      const value = REVERSE[char.charCodeAt(0)];
      const width = (value & 30) === 30 ? 5 : 6;
      for (let j = 0; j < width; j++, bit++) {
        if ((value >> j) & 1) bytes[bit >> 3] |= 1 << (bit & 7);
      }
    }
    return bytes;
  }

  async function inflate(bytes, stage = "trackcode") {
    if (typeof DecompressionStream !== "function") {
      throw new Error("Deze browser ondersteunt trackcode-decompressie niet. Update Chrome of Edge.");
    }
    const formats = ["deflate", "deflate-raw", "gzip"];
    const failures = [];
    for (const format of formats) {
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (error) {
        failures.push(format + ": " + (error?.message || "decompressie mislukt"));
      }
    }
    throw new Error("De " + stage + " kon niet worden gedecomprimeerd. De code is mogelijk beschadigd of gebruikt een onbekend compressieformaat. (" + failures.join("; ") + ")");
  }

  function uintLE(bytes, offset, length) {
    if (offset < 0 || length < 0 || offset + length > bytes.length) throw new Error("Trackcode is onvolledig of beschadigd.");
    let value = 0;
    for (let i = 0; i < length; i++) value += bytes[offset + i] * 2 ** (8 * i);
    return value;
  }

  function int32LE(bytes, offset) {
    if (offset + 4 > bytes.length) throw new Error("Trackcode is onvolledig of beschadigd.");
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true);
  }

  function parseRaw(bytes, offset = 0) {
    let cursor = offset;
    if (bytes.length - cursor < 15) throw new Error("Track bevat geen geldige blokdata.");
    const environmentId = bytes[cursor++];
    const sunAngleRepresentation = bytes[cursor++];
    const minX = int32LE(bytes, cursor); cursor += 4;
    const minY = int32LE(bytes, cursor); cursor += 4;
    const minZ = int32LE(bytes, cursor); cursor += 4;
    const sizeByte = bytes[cursor++];
    const sizeX = sizeByte & 3;
    const sizeY = (sizeByte >> 2) & 3;
    const sizeZ = (sizeByte >> 4) & 3;
    if ([sizeX, sizeY, sizeZ].some(n => n < 1 || n > 4)) throw new Error("Onbekende coordinate-compressie in deze trackcode.");

    const parts = [];
    while (cursor < bytes.length) {
      if (cursor + 5 > bytes.length) throw new Error("Onvolledige blokgroep in trackcode.");
      const id = bytes[cursor++];
      const count = uintLE(bytes, cursor, 4); cursor += 4;
      if (count > MAX_PARTS || parts.length + count > MAX_PARTS) throw new Error("Track bevat meer blokken dan veilig verwerkt kunnen worden.");
      for (let i = 0; i < count; i++) {
        const x = uintLE(bytes, cursor, sizeX) + minX; cursor += sizeX;
        const y = uintLE(bytes, cursor, sizeY) + minY; cursor += sizeY;
        const z = uintLE(bytes, cursor, sizeZ) + minZ; cursor += sizeZ;
        if (cursor + 2 > bytes.length) throw new Error("Onvolledige blokdata in trackcode.");
        const packedRotation = bytes[cursor++];
        const color = bytes[cursor++];
        const rotation = packedRotation & 3;
        const rotationAxis = (packedRotation >> 2) & 7;
        const part = { id, x, y, z, rotation, rotationAxis, rotationAxisName: AXES[rotationAxis] || "Unknown", color };
        if (CHECKPOINT_IDS.has(id)) { part.checkpointOrder = uintLE(bytes, cursor, 2); cursor += 2; }
        if (START_IDS.has(id)) { part.startOrder = uintLE(bytes, cursor, 4); cursor += 4; }
        parts.push(part);
      }
    }
    return {
      environmentId, environmentName: ENVIRONMENTS[environmentId] || "Unknown",
      sunAngleRepresentation, sunAngleDegrees: sunAngleRepresentation * 2, parts
    };
  }

  async function decode(input) {
    let code = String(input || "")
      .replace(/^\\uFEFF/, "")
      .replace(/[\\u200B-\\u200D\\u2060]/g, "")
      .trim()
      .replace(/^\x60{3}[^\\n]*\\n?|\\n?\x60{3}$/g, "")
      .replace(/^[\\"'“”‘’]|[\\"'“”‘’]$/g, "")
      .replace(/\\s+/g, "");
    if (/%[0-9A-Fa-f]{2}/.test(code)) {
      try { code = decodeURIComponent(code); } catch {}
      code = code.replace(/\\s+/g, "");
    }
    if (!code) throw new Error("Plak eerst een PolyTrack-trackcode.");
    if (code.startsWith("http://") || code.startsWith("https://")) {
      throw new Error("Dit is een link, geen trackcode. Open de track en kopieer de volledige PolyTrack-code.");
    }
    if (!code.startsWith("PolyTrack2") && !/^[A-Za-z0-9]+$/.test(code)) {
      throw new Error("Dit lijkt geen geldige PolyTrack-code. Kopieer de volledige code, inclusief de PolyTrack2-prefix als die erbij staat.");
    }
    if (code.startsWith("PolyTrack2")) {
      const stageOne = await inflate(readPacked(code.slice(10)), "Eerste exportlaag");
      const payload = await inflate(readPacked(new TextDecoder().decode(stageOne)), "Tweede exportlaag");
      let cursor = 0;
      if (payload.length < 2) throw new Error("Exportcode bevat geen metadata.");
      const nameLength = payload[cursor++];
      if (cursor + nameLength + 1 > payload.length) throw new Error("Ongeldige tracknaam in exportcode.");
      const name = new TextDecoder().decode(payload.subarray(cursor, cursor + nameLength)); cursor += nameLength;
      const authorLength = payload[cursor++];
      if (cursor + authorLength + 1 > payload.length) throw new Error("Ongeldige auteur in exportcode.");
      const author = authorLength ? new TextDecoder().decode(payload.subarray(cursor, cursor + authorLength)) : null;
      cursor += authorLength;
      const modifiedFlag = payload[cursor++];
      let lastModified = null;
      if (modifiedFlag === 1) {
        const seconds = uintLE(payload, cursor, 4); cursor += 4;
        lastModified = new Date(seconds * 1000).toISOString();
      } else if (modifiedFlag !== 0) throw new Error("Onbekende metadata-versie in exportcode.");
      return {
        kind: "export", sourceFormat: "PolyTrack2-export",
        metadata: { name, author, lastModified },
        track: parseRaw(payload, cursor)
      };
    }
    const stageOne = await inflate(readPacked(code), "Eerste save-laag");
    const raw = await inflate(readPacked(new TextDecoder().decode(stageOne)), "Tweede save-laag");
    return { kind: "save", sourceFormat: "PolyTrack-save", metadata: null, track: parseRaw(raw) };
  }

  function summarize(decoded) {
    const parts = decoded.track.parts;
    const counts = new Map();
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    const checkpoints = [];
    for (const p of parts) {
      counts.set(p.id, (counts.get(p.id) || 0) + 1);
      for (const axis of ["x", "y", "z"]) {
        min[axis] = Math.min(min[axis], p[axis]);
        max[axis] = Math.max(max[axis], p[axis]);
      }
      if (p.checkpointOrder != null) checkpoints.push(p.checkpointOrder);
    }
    if (!parts.length) for (const axis of ["x", "y", "z"]) min[axis] = max[axis] = 0;
    return {
      totalParts: parts.length, uniquePartTypes: counts.size,
      partCounts: [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([id, count]) => ({ id, count })),
      bounds: { min, max }, checkpointCount: checkpoints.length,
      checkpointOrders: checkpoints.sort((a, b) => a - b)
    };
  }
  window.PTAPTrackDecoder = Object.freeze({ decode, summarize });
})();