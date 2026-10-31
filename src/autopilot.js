(() => {
  "use strict";

  // Closed-loop steering controller. It deliberately accepts measured game
  // state instead of guessing car position from the rendered canvas.
  const KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
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
    const target = readVector(state?.next_checkpoint_position || state?.target);
    const q = state?.quaternion;
    if (!position || !target || !q || ![q.x, q.y, q.z, q.w].every(Number.isFinite)) {
      return { valid: false, reason: "Car position, orientation or next checkpoint is missing." };
    }
    if (![position.x, position.y, position.z, target.x, target.y, target.z].every(Number.isFinite)) {
      return { valid: false, reason: "Telemetry contains invalid coordinates." };
    }

    const forward = normalize(rotateByQuaternion(FORWARD_LOCAL, q));
    const toTarget = normalize({
      x: target.x - position.x,
      y: target.y - position.y,
      z: target.z - position.z
    });
    if (!forward || !toTarget) return { valid: false, reason: "Cannot calculate target direction." };

    // Ignore vertical displacement for steering; pitch is handled by the game.
    const f = normalize({ x: forward.x, y: 0, z: forward.z });
    const t = normalize({ x: toTarget.x, y: 0, z: toTarget.z });
    if (!f || !t) return { valid: false, reason: "No usable horizontal direction." };

    const dot = clamp(f.x * t.x + f.z * t.z, -1, 1);
    const crossY = f.z * t.x - f.x * t.z;
    const angle = Math.atan2(crossY, dot);
    const speed = Number(state.speed_kmh ?? state.speedKmh ?? 0);
    if (!Number.isFinite(speed) || speed < 0) return { valid: false, reason: "Invalid vehicle speed." };

    const dt = Number(state.deltaSeconds || 1 / 60);
    const derivative = previous.angle == null ? 0 : (angle - previous.angle) / clamp(dt, 1 / 240, 0.1);
    const steering = clamp(angle * 1.65 + derivative * 0.035, -1, 1);

    // Conservative checkpoint approach speed. This is an initial baseline,
    // not a track-trained racing-line optimizer.
    const turnSeverity = Math.abs(angle);
    const targetSpeed = clamp(175 - turnSeverity * 205, 42, 175);
    const brake = speed > targetSpeed + 7 || (turnSeverity > 1.05 && speed > 55);
    const throttle = !brake && speed < targetSpeed + 5;

    return {
      valid: true,
      angle,
      steering,
      speedKmh: speed,
      targetSpeedKmh: targetSpeed,
      distance: length({ x: target.x - position.x, y: target.y - position.y, z: target.z - position.z }),
      inputs: {
        ArrowLeft: steering < -0.13,
        ArrowRight: steering > 0.13,
        ArrowUp: throttle,
        ArrowDown: brake
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
        key, code: key, bubbles: true, cancelable: true, composed: true
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
      previous = { angle: result.angle };
      for (const key of KEYS) {
        const shouldHold = Boolean(result.inputs[key]);
        if (shouldHold !== held.has(key)) send(key, shouldHold);
      }
      latest = result;
      return result;
    }

    return Object.freeze({
      start() { enabled = true; previous = {}; lastTick = 0; return true; },
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