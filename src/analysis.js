(() => {
  "use strict";

  const KEY_GROUPS = {
    throttle: ["w", "ArrowUp"],
    brake: ["s", "ArrowDown"],
    left: ["a", "ArrowLeft"],
    right: ["d", "ArrowRight"],
    nitro: ["Shift", " "]
  };

  function normalizeKey(key) {
    if (key === " ") return "Space";
    return key;
  }

  function analyze(events, requestedDuration = 0, segmentCount = 8) {
    const ordered = [...events]
      .filter(e => Number.isFinite(e.t) && (e.type === "keydown" || e.type === "keyup"))
      .sort((a, b) => a.t - b.t);
    const lastTime = ordered.length ? ordered[ordered.length - 1].t : 0;
    const duration = Math.max(0, requestedDuration, lastTime);
    const pressed = new Set();
    const totals = { throttle: 0, brake: 0, left: 0, right: 0, nitro: 0 };
    const segments = Array.from({ length: Math.max(1, segmentCount) }, (_, i) => ({
      index: i + 1, throttleMs: 0, brakeMs: 0, leftMs: 0, rightMs: 0, nitroMs: 0
    }));
    let cursor = 0;
    let transitions = 0;
    let brakingWhileTurning = 0;
    let throttleWhileTurning = 0;

    const active = group => KEY_GROUPS[group].some(k => pressed.has(k));
    const addInterval = (from, to) => {
      if (to <= from) return;
      const dt = to - from;
      for (const group of Object.keys(totals)) {
        if (!active(group)) continue;
        totals[group] += dt;
        const first = Math.min(segments.length - 1, Math.floor(from / Math.max(1, duration) * segments.length));
        const last = Math.min(segments.length - 1, Math.floor(Math.max(from, to - 0.001) / Math.max(1, duration) * segments.length));
        for (let i = first; i <= last; i++) {
          const start = duration * i / segments.length;
          const end = duration * (i + 1) / segments.length;
          const overlap = Math.max(0, Math.min(to, end) - Math.max(from, start));
          const key = group + "Ms";
          segments[i][key] += overlap;
        }
      }
      const turning = active("left") || active("right");
      if (turning && active("brake")) brakingWhileTurning += dt;
      if (turning && active("throttle")) throttleWhileTurning += dt;
    };

    for (const event of ordered) {
      const t = Math.max(cursor, Math.min(duration, event.t));
      addInterval(cursor, t);
      const key = normalizeKey(event.key);
      if (event.type === "keydown") {
        if (!pressed.has(key)) { pressed.add(key); transitions++; }
      } else if (pressed.delete(key)) {
        transitions++;
      }
      cursor = t;
    }
    addInterval(cursor, duration);

    const pct = value => duration ? Math.round(value / duration * 1000) / 10 : 0;
    return {
      durationMs: duration,
      eventCount: ordered.length,
      transitions,
      totalsMs: totals,
      percentages: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, pct(v)])),
      brakingWhileTurningMs: Math.round(brakingWhileTurning),
      throttleWhileTurningMs: Math.round(throttleWhileTurning),
      segments: segments.map(s => ({
        ...s,
        throttlePct: duration ? Math.round(s.throttleMs / (duration / segments.length) * 100) : 0
      }))
    };
  }

  function compare(a, b) {
    if (!a || !b) return null;
    return {
      durationDeltaMs: b.durationMs - a.durationMs,
      throttleDeltaMs: b.totalsMs.throttle - a.totalsMs.throttle,
      brakeDeltaMs: b.totalsMs.brake - a.totalsMs.brake,
      transitionsDelta: b.transitions - a.transitions
    };
  }

  window.PTAPAnalysis = Object.freeze({ analyze, compare });
})();