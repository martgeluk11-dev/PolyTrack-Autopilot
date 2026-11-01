(() => {
  "use strict";

  // Closed-loop steering controller. It deliberately accepts measured game
  // state instead of guessing car position from the rendered canvas.
  const KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  const KEY_CODES = { " ": "Space", Shift: "Shift", Control: "ControlLeft", Alt: "AltLeft", Enter: "Enter", Tab: "Tab" };
  const keyCode = key => KEY_CODES[key] || (/^[a-z]$/i.test(key) ? "Key" + key.toUpperCase() : key);
  const FORWARD_LOCAL = { x: 0, y: 0, z: -1 };

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const length = v => Math.hypot(v.x, v.y, v.z);
  const normalize = v => {
    const size = length(v);
    return size > 1e-7 ? { x: v.x / size, y: v.y / size, z: v.z / size } : null;
  };

  function rotateByQuaternion(v, q) {
    const { x, y, z, w } = q;
    const ix = w * v.x + y * v.z - z * v.y;
    const iy = w * v.y + z * v.x - x * v.z;
    const iz = w * v.z + x * v.y - y * v.x;
    const iw = -x * v.x - y * v.y - z * v.z;
    return {
      x: ix * w + iw * -x + iy * -z - iz * -y,
      y: iy * w + iw * -y + iz * -x - ix * -z,
      z: iz * w + iw * -z + ix * -y - iy * -x
    };
  }

  function readVector(value) {
    if (Array.isArray(value) && value.length >= 3) {
      return { x: Number(value[0]), y: Number(value[1]), z: Number(value[2]) };
    }
    if (value && typeof value === "object") {
      return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
    }
    return null;
  }

  function calculate(state, previous = {}) {
    const position = readVector(state?.position);
    const q = state?.quaternion;
    if (!position || !q || ![q.x, q.y, q.z, q.w].every(Number.isFinite)) {
      return { valid: false, reason: "Car position or orientation is missing." };
    }
    if (![position.x, position.y, position.z].every(Number.isFinite)) {
      return { valid: false, reason: "Telemetry contains invalid coordinates." };
    }

    const route = Array.isArray(state.route) ? state.route : null;
    if (!route || route.length < 5) {
      return { valid: false, reason: "A complete 3D racing route has not been generated yet." };
    }

    const points = route;
    const from = Number.isInteger(previous.routeIndex) ? Math.max(0, previous.routeIndex - 4) : 0;
    const to = Number.isInteger(previous.routeIndex)
      ? Math.min(points.length - 1, previous.routeIndex + 110)
      : Math.min(points.length - 1, 80);
    let nearestIndex = -1, nearestDistance = Infinity;
    for (let i = from; i <= to; i++) {
      const p = points[i];
      const d = Math.hypot(p[0]-position.x, p[1]-position.y, p[2]-position.z);
      if (d < nearestDistance) { nearestDistance = d; nearestIndex = i; }
    }
    if (nearestIndex < 0 || nearestDistance > 35) {
      return { valid: false, reason: "Car is too far from the planned road surface." };
    }

    const speed = Number(state.speed_kmh ?? state.speedKmh ?? 0);
    if (!Number.isFinite(speed) || speed < 0) return { valid: false, reason: "Invalid vehicle speed." };
    const dt = clamp(Number(state.deltaSeconds || 1 / 60), 1 / 240, 0.1);
    const priorPosition = readVector(previous.position);
    const routePoint = points[nearestIndex];
    const normal = normalize({ x: routePoint[3] || 0, y: routePoint[4] || 1, z: routePoint[5] || 0 }) || { x: 0, y: 1, z: 0 };
    const verticalSpeed = priorPosition ? ((position.x-priorPosition.x)*normal.x + (position.y-priorPosition.y)*normal.y + (position.z-priorPosition.z)*normal.z) / dt : 0;
    const surfaceHeight = (position.x-routePoint[0])*normal.x +
      (position.y-routePoint[1])*normal.y + (position.z-routePoint[2])*normal.z;
    let groundClearance = Number.isFinite(previous.groundClearance) ? previous.groundClearance : Math.max(0, surfaceHeight);
    const wasAirborne = Boolean(previous.airborne);
    const airborne = wasAirborne
      ? surfaceHeight > groundClearance + 0.95 || verticalSpeed > 2.2
      : surfaceHeight > groundClearance + 1.65 && (verticalSpeed > 0.8 || surfaceHeight > groundClearance + 2.5);
    const landed = wasAirborne && !airborne;
    if (!airborne && Math.abs(verticalSpeed) < 1.8) {
      groundClearance += clamp(surfaceHeight - groundClearance, -0.08, 0.08) * 0.08;
    }
    const priorQ = previous.quaternion;
    let rotationRate = 0;
    if (priorQ && [priorQ.x, priorQ.y, priorQ.z, priorQ.w].every(Number.isFinite)) {
      const qDot = Math.abs(q.x*priorQ.x + q.y*priorQ.y + q.z*priorQ.z + q.w*priorQ.w);
      rotationRate = 2 * Math.acos(clamp(qDot, -1, 1)) / dt;
    }
    const airBrakeKey = typeof state.airBrakeKey === "string" ? state.airBrakeKey : "";
    const airBrake = Boolean(airBrakeKey && airborne && rotationRate > 1.25);
    const lookDistance = clamp(speed / 3.6 * (airborne ? 0.38 : 0.55), 6, airborne ? 16 : 28);
    let targetIndex = nearestIndex, travelled = 0;
    while (targetIndex < points.length - 1 && travelled < lookDistance) {
      const a = points[targetIndex], b = points[targetIndex + 1];
      travelled += Math.hypot(b[0]-a[0], b[1]-a[1], b[2]-a[2]);
      targetIndex++;
    }
    const targetPoint = points[targetIndex];
    const forward = normalize(rotateByQuaternion(FORWARD_LOCAL, q));
    const toTarget = normalize({
      x: targetPoint[0]-position.x,
      y: targetPoint[1]-position.y,
      z: targetPoint[2]-position.z
    });
    if (!forward || !toTarget) return { valid: false, reason: "Cannot calculate racing-line direction." };

    const f = normalize({ x: forward.x, y: 0, z: forward.z });
    const t = normalize({ x: toTarget.x, y: 0, z: toTarget.z });
    if (!f || !t) return { valid: false, reason: "No usable horizontal direction." };
    const dotProduct = clamp(f.x*t.x + f.z*t.z, -1, 1);
    const crossY = f.x*t.z - f.z*t.x;
    const angle = Math.atan2(crossY, dotProduct);
    const derivative = previous.angle == null ? 0 : (angle-previous.angle)/dt;
    const steering = clamp(angle*1.8 + derivative*0.025, -1, 1);

    // Estimate local curvature from the generated 3D path and cap speed by
    // lateral grip. Braking is planned ahead using the distance to each cap.
    let targetSpeed = 230;
    let distanceAhead = 0;
    const maxIndex = Math.min(points.length - 2, nearestIndex + 24);
    for (let i = Math.max(1, nearestIndex); i <= maxIndex; i++) {
      const a = points[i-1], b = points[i], c = points[i+1];
      const ab = Math.hypot(b[0]-a[0], b[2]-a[2]);
      const bc = Math.hypot(c[0]-b[0], c[2]-b[2]);
      const ac = Math.hypot(c[0]-a[0], c[2]-a[2]);
      const area2 = Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]));
      const curvature = ab*bc*ac > 1e-5 ? 2*area2/(ab*bc*ac) : 0;
      const cornerCap = curvature > 1e-4 ? Math.sqrt(12.0/curvature)*3.6 : 230;
      const remaining = Math.max(0, distanceAhead);
      const brakingCap = Math.sqrt(Math.max(0, (cornerCap/3.6)**2 + 2*7.5*remaining))*3.6;
      targetSpeed = Math.min(targetSpeed, brakingCap);
      distanceAhead += Math.hypot(points[i+1][0]-points[i][0],points[i+1][1]-points[i][1],points[i+1][2]-points[i][2]);
    }
    targetSpeed = clamp(targetSpeed, 35, 230);
    const brake = speed > targetSpeed + 8;
    const throttle = !brake && speed < targetSpeed + 4;
    const flightSteering = airborne ? clamp(steering, -0.28, 0.28) : steering;
    const flightThrottle = airborne ? false : throttle;
    const flightBrake = airborne ? false : brake;

    return {
      valid: true, angle, steering: flightSteering, speedKmh: speed, targetSpeedKmh: targetSpeed,
      distance: nearestDistance, routeIndex: nearestIndex,
      airborne, landed, surfaceHeight, verticalSpeed, rotationRate, airBrakeKey, groundClearance,
      inputs: {
        ArrowLeft: flightSteering < -0.12,
        ArrowRight: flightSteering > 0.12,
        ArrowUp: flightThrottle,
        ArrowDown: flightBrake,
        ...(airBrakeKey ? { [airBrakeKey]: airBrake } : {})
      }
    };
  }

  function makeController() {
    let enabled = false;
    let previous = {};
    let held = new Set();
    let latest = null;
    let lastTick = 0;

    function send(key, down) {
      const type = down ? "keydown" : "keyup";
      const event = new KeyboardEvent(type, {
        key, code: keyCode(key), bubbles: true, cancelable: true, composed: true
      });
      const canvas = [...document.querySelectorAll("canvas")]
        .map(el => ({ el, r: el.getBoundingClientRect() }))
        .filter(x => x.r.width > 200 && x.r.height > 120)
        .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0]?.el;
      const target = canvas || document.activeElement || document.body;
      try { target.focus?.({ preventScroll: true }); } catch {}
      target.dispatchEvent(event);
      if (down) held.add(key); else held.delete(key);
    }

    function release() {
      for (const key of [...held]) send(key, false);
      held.clear();
    }

    function update(carState) {
      if (!enabled) return { active: false, reason: "Autopilot is stopped." };
      const now = performance.now();
      const result = calculate(carState, previous);
      if (!result.valid) {
        release();
        latest = result;
        return result;
      }
      if (now - lastTick < 12) return latest || result;
      lastTick = now;
      previous = {
        angle: result.angle, routeIndex: result.routeIndex,
        position: carState.position, quaternion: carState.quaternion,
        airborne: result.airborne,
        groundClearance: result.groundClearance
      };
      const controls = new Set([...KEYS, ...held, ...(result.airBrakeKey ? [result.airBrakeKey] : [])]);
      for (const key of controls) {
        const shouldHold = Boolean(result.inputs[key]);
        if (shouldHold !== held.has(key)) send(key, shouldHold);
      }
      latest = result;
      return result;
    }

    return Object.freeze({
      start() { enabled = true; previous = {}; held.clear(); lastTick = 0; return true; },
      stop() { enabled = false; release(); previous = {}; },
      update,
      status() { return { enabled, latest, held: [...held] }; }
    });
  }

  const controller = makeController();
  window.PTAPAutopilot = Object.freeze({
    calculate,
    start: () => controller.start(),
    stop: () => controller.stop(),
    update: state => controller.update(state),
    status: () => controller.status(),
    version: "0.1.0"
  });
})();