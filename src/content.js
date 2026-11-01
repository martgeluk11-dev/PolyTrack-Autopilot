(() => {
  "use strict";
  if (window.__PT_AUTOPILOT_LOADED__) return;
  window.__PT_AUTOPILOT_LOADED__ = true;

  const KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", " ", "Shift"]);
  const state = {
    recording: false,
    replaying: false,
    startedAt: 0,
    events: [],
    recordedHeld: new Set(),
    replayTimers: [],
    replayHeld: new Set()
  };

  const elapsed = () => Math.max(0, Math.round(performance.now() - state.startedAt));
  const isGameLike = () => {
    const canvases = [...document.querySelectorAll("canvas")];
    return canvases.some(c => {
      const r = c.getBoundingClientRect();
      return r.width > 250 && r.height > 150;
    }) || /polytrack/i.test(document.title + " " + location.href);
  };

  function findGameTarget() {
    return [...document.querySelectorAll("canvas")]
      .map(canvas => ({ canvas, rect: canvas.getBoundingClientRect() }))
      .filter(x => x.rect.width > 200 && x.rect.height > 120)
      .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0]?.canvas
      || document.activeElement
      || document.body;
  }

  function keyCode(key) {
    return ({
      ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
      ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
      " ": "Space", Shift: "Shift",
      w: "KeyW", a: "KeyA", s: "KeyS", d: "KeyD"
    })[key] || key;
  }

  function dispatchKey(type, key) {
    const target = findGameTarget();
    try { target.focus?.({ preventScroll: true }); } catch {}
    const event = new KeyboardEvent(type, {
      key, code: keyCode(key), bubbles: true, cancelable: true,
      composed: true, view: window
    });
    target.dispatchEvent(event);
    if (type === "keydown") state.replayHeld.add(key);
    else state.replayHeld.delete(key);
  }

  function releaseReplayKeys() {
    for (const key of [...state.replayHeld]) dispatchKey("keyup", key);
    state.replayHeld.clear();
  }

  function setStatus(message, kind = "") {
    const el = document.querySelector("#ptap-status");
    if (el) { el.textContent = message; el.dataset.kind = kind; }
  }

  function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const centiseconds = Math.floor((ms % 1000) / 10);
    return seconds + "." + String(centiseconds).padStart(2, "0") + "s";
  }

  function renderAnalysis(events, duration) {
    const el = document.querySelector("#ptap-analysis");
    if (!el) return;
    if (!window.PTAPAnalysis) {
      el.textContent = "Analysis module unavailable";
      return;
    }
    const report = window.PTAPAnalysis.analyze(events, duration, 8);
    const p = report.percentages;
    el.innerHTML = `
      <div class="ptap-metric"><span>Recorded duration</span><b>${formatTime(report.durationMs)}</b></div>
      <div class="ptap-metric"><span>Throttle</span><b>${p.throttle}%</b></div>
      <div class="ptap-metric"><span>Brake</span><b>${p.brake}%</b></div>
      <div class="ptap-metric"><span>Left / right</span><b>${p.left}% / ${p.right}%</b></div>
      <div class="ptap-metric"><span>Input changes</span><b>${report.transitions}</b></div>
      <div class="ptap-metric"><span>Brake + steering overlap</span><b>${formatTime(report.brakingWhileTurningMs)}</b></div>
      <div class="ptap-bars-label">Throttle activity across the run</div>
      <div class="ptap-bars">${report.segments.map(segment => `<span title="Segment ${segment.index}: ${segment.throttlePct}% throttle"><i style="height:${segment.throttlePct}%"></i></span>`).join("")}</div>`;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("pt-autopilot", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("recordings")) {
          request.result.createObjectStore("recordings");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveRecording() {
    const payload = {
      version: 1,
      id: "run-" + Date.now(),
      createdAt: new Date().toISOString(),
      durationMs: elapsed(),
      events: state.events
    };
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("recordings", "readwrite");
        const store = tx.objectStore("recordings");
        store.put(payload, "latest");
        store.put(payload, payload.id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      renderAnalysis(payload.events, payload.durationMs);
      setStatus("Saved " + payload.events.length + " input events", "good");
    } catch {
      setStatus("Could not save recording", "bad");
    }
  }

  async function loadRecording() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("recordings", "readonly");
      const get = tx.objectStore("recordings").get("latest");
      get.onsuccess = () => { const value = get.result || null; db.close(); resolve(value); };
      get.onerror = () => { db.close(); reject(get.error); };
    });
  }

  function finishRecording() {
    if (!state.recording) return;
    const t = elapsed();
    for (const key of [...state.recordedHeld]) {
      state.events.push({ t, type: "keyup", key });
    }
    state.recordedHeld.clear();
    state.recording = false;
    saveRecording();
    updateButtons();
  }

  function startRecording() {
    stopReplay();
    if (window.PTAPAutopilot?.status().enabled) window.PTAPAutopilot.stop();
    const autopilotButton = document.querySelector("#ptap-autopilot");
    if (autopilotButton) autopilotButton.textContent = "Start autopilot";
    state.events = [];
    state.recordedHeld.clear();
    state.startedAt = performance.now();
    state.recording = true;
    setStatus("Recording — drive a practice lap", "live");
    updateButtons();
  }

  function stopReplay() {
    state.replaying = false;
    for (const id of state.replayTimers) clearTimeout(id);
    state.replayTimers = [];
    releaseReplayKeys();
    updateButtons();
  }

  async function startReplay() {
    if (window.PTAPAutopilot?.status().enabled) window.PTAPAutopilot.stop();
    const autopilotButton = document.querySelector("#ptap-autopilot");
    if (autopilotButton) autopilotButton.textContent = "Start autopilot";
    if (state.recording) finishRecording();
    stopReplay();
    let recording;
    try { recording = await loadRecording(); }
    catch { setStatus("Could not load saved run", "bad"); return; }
    if (!recording?.events?.length) {
      setStatus("No saved run — record a practice lap first", "bad");
      return;
    }
    state.replaying = true;
    const started = performance.now();
    setStatus("Replaying saved inputs…", "live");
    updateButtons();

    recording.events.forEach((event, index) => {
      const timer = setTimeout(() => {
        if (!state.replaying) return;
        dispatchKey(event.type, event.key);
        if (index === recording.events.length - 1) {
          const finish = setTimeout(() => {
            stopReplay();
            setStatus("Replay finished · timing-based", "good");
          }, 30);
          state.replayTimers.push(finish);
        }
      }, Math.max(0, event.t - (performance.now() - started)));
      state.replayTimers.push(timer);
    });
  }

  async function analyzeTrackCode() {
    const input = document.querySelector("#ptap-track-code");
    const output = document.querySelector("#ptap-track-result");
    const button = document.querySelector("#ptap-decode-track");
    if (!input || !output || !window.PTAPTrackDecoder) {
      setStatus("Track decoder unavailable", "bad");
      return;
    }
    button.disabled = true;
    button.textContent = "Analyzing…";
    output.textContent = "Trackcode decoderen…";
    try {
      const decoded = await window.PTAPTrackDecoder.decode(input.value);
      const report = window.PTAPTrackDecoder.summarize(decoded);
      const meta = decoded.metadata;
      const bounds = report.bounds;
      const blockRows = report.partCounts.slice(0, 14).map(item =>
        '<div class="ptap-metric"><span>Block ID ' + item.id + '</span><b>' + item.count + '</b></div>'
      ).join("");
      output.innerHTML = `
        <div class="ptap-track-success">TRACK DECODED · ${decoded.sourceFormat}</div>
        ${meta?.name ? `<div class="ptap-metric"><span>Track</span><b>${escapeHtml(meta.name)}</b></div>` : ""}
        ${meta?.author ? `<div class="ptap-metric"><span>Author</span><b>${escapeHtml(meta.author)}</b></div>` : ""}
        <div class="ptap-metric"><span>Environment</span><b>${decoded.track.environmentName}</b></div>
        <div class="ptap-metric"><span>Total blocks</span><b>${report.totalParts.toLocaleString()}</b></div>
        <div class="ptap-metric"><span>Unique block IDs</span><b>${report.uniquePartTypes}</b></div>
        <div class="ptap-metric"><span>Checkpoints</span><b>${report.checkpointCount}</b></div>
        <div class="ptap-metric"><span>X range</span><b>${bounds.min.x} → ${bounds.max.x}</b></div>
        <div class="ptap-metric"><span>Y range</span><b>${bounds.min.y} → ${bounds.max.y}</b></div>
        <div class="ptap-metric"><span>Z range</span><b>${bounds.min.z} → ${bounds.max.z}</b></div>
        <div class="ptap-track-list-title">BLOCK ID DISTRIBUTION</div>
        ${blockRows}
        ${report.partCounts.length > 14 ? `<div class="ptap-muted">+${report.partCounts.length - 14} more block IDs</div>` : ""}
        <button id="ptap-copy-track-json" class="ptap-secondary" type="button">Copy decoded track JSON</button>
        <div class="ptap-muted">Geometry data decoded. Block shapes and driveable surfaces still need mapping before a racing line can be calculated.</div>`;
      output.querySelector("#ptap-copy-track-json").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(decoded, null, 2));
          setStatus("Decoded track JSON copied", "good");
        } catch { setStatus("Clipboard unavailable", "bad"); }
      });
      window.__PTAP_LAST_DECODED_TRACK__ = decoded;
      setStatus("Track decoded · " + report.totalParts + " blocks found", "good");
    } catch (error) {
      const message = error?.message || "Trackcode could not be decoded.";
      output.textContent = message;
      setStatus(message.length > 64 ? "Decode failed · see details below" : message, "bad");
    } finally {
      button.disabled = false;
      button.textContent = "Analyze trackcode";
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function updateButtons() {
    const record = document.querySelector("#ptap-record");
    const replay = document.querySelector("#ptap-replay");
    if (!record || !replay) return;
    record.textContent = state.recording ? "Stop recording" : "Record lap";
    replay.disabled = state.recording || state.replaying;
  }

  function diagnostics() {
    const canvases = [...document.querySelectorAll("canvas")].map((c, i) => {
      const r = c.getBoundingClientRect();
      return {
        index: i, width: c.width, height: c.height,
        displayWidth: Math.round(r.width), displayHeight: Math.round(r.height),
        visible: r.width > 0 && r.height > 0
      };
    });
    return {
      extension: "PolyTrack Autopilot 0.5.0",
      autopilotController: Boolean(window.PTAPAutopilot),
      pageBridgeReady: Boolean(window.__PTAP_PAGE_BRIDGE_READY__),
      latestTelemetry: window.__PTAP_LAST_GAME_STATE__ || null,
      telemetryBridge: "Reads 227-byte PolyTrack simulation worker state buffers",
      pageOrigin: location.origin,
      pageTitle: document.title,
      frame: window === window.top ? "top" : "embedded",
      userAgent: navigator.userAgent,
      canvases,
      iframeCount: document.querySelectorAll("iframe").length,
      gameLike: isGameLike(),
      analysisAvailable: Boolean(window.PTAPAnalysis),
      note: "This report contains page and canvas metadata only; no cookies or account data."
    };
  }

  function mountPanel() {
    if (!isGameLike() || document.querySelector("#ptap-panel")) return;
    const panel = document.createElement("section");
    panel.id = "ptap-panel";
    panel.innerHTML = `
      <div class="ptap-head">
        <strong>POLYTRACK <span>AUTOPILOT</span></strong>
        <button id="ptap-min" type="button" aria-label="Minimize">−</button>
      </div>
      <div class="ptap-body">
        <div id="ptap-status" data-kind="neutral">Game detected · practice tools</div>
        <div class="ptap-actions">
          <button id="ptap-record" type="button">Record lap</button>
          <button id="ptap-replay" type="button">Replay lap</button>
          <button id="ptap-autopilot" class="ptap-secondary" type="button">Start autopilot</button>
          <button id="ptap-stop" type="button">Stop</button>
        </div>
        <div class="ptap-analysis-wrap">
          <div class="ptap-section-title">TRACK ANALYZER · NO TEST LAP</div>
          <textarea id="ptap-track-code" rows="3" spellcheck="false" placeholder="Paste een PolyTrack2 trackcode..."></textarea>
          <button id="ptap-decode-track" class="ptap-secondary" type="button">Analyze trackcode</button>
          <div id="ptap-track-result">Nog geen track geanalyseerd.</div>
        </div>
        <div class="ptap-analysis-wrap">
          <div class="ptap-section-title">LAST RUN · INPUT ANALYSIS</div>
          <div id="ptap-analysis">Record a practice lap to see its input breakdown.</div>
        </div>
        <button id="ptap-diagnostics" class="ptap-secondary" type="button">Copy diagnostics</button>
        <p class="ptap-note">Autopilot is experimental · requires a decoded track · local practice only.</p>
      </div>`;
    document.documentElement.appendChild(panel);

    panel.querySelector("#ptap-record").addEventListener("click", () => {
      state.recording ? finishRecording() : startRecording();
    });
    panel.querySelector("#ptap-replay").addEventListener("click", startReplay);
    panel.querySelector("#ptap-autopilot").addEventListener("click", () => {
      const status = window.PTAPAutopilot?.status();
      if (status?.enabled) {
        window.PTAPAutopilot.stop();
        window.__PTAP_AUTOPILOT_ARMED__ = false;
        window.__PTAP_PLANNED_ROUTE__ = null;
        setStatus("Autopilot stopped · controls released", "good");
        panel.querySelector("#ptap-autopilot").textContent = "Start autopilot";
        return;
      }
      if (!window.PTAPAutopilot) { setStatus("Autopilot module unavailable", "bad"); return; }
      if (!window.__PTAP_LAST_DECODED_TRACK__?.track?.parts?.length) {
        setStatus("Analyze your PolyTrack trackcode first", "bad");
        return;
      }
      // A recorded/test lap is not required. Arm before starting the race;
      // the controller will begin using live car telemetry as soon as the
      // game publishes it.
      stopReplay();
      if (state.recording) finishRecording();
      window.__PTAP_PLANNED_ROUTE__ = null;
      window.__PTAP_ROUTE_BUILDING__ = false;
      window.__PTAP_ROUTE_ATTEMPTED__ = false;
      window.__PTAP_AUTOPILOT_ARMED__ = true;
      window.PTAPAutopilot.start();
      panel.querySelector("#ptap-autopilot").textContent = "Stop autopilot";
      setStatus(
        window.__PTAP_TRACK_GEOMETRY__
          ? "Autopilot armed · building route from 3D track geometry"
          : "Autopilot armed · waiting for game track geometry (no test lap needed)",
        "live"
      );
      if (window.__PTAP_LAST_GAME_STATE__) buildPlannedRoute(window.__PTAP_LAST_GAME_STATE__);
    });
    panel.querySelector("#ptap-decode-track").addEventListener("click", analyzeTrackCode);
    panel.querySelector("#ptap-stop").addEventListener("click", () => {
      stopReplay();
      if (window.PTAPAutopilot?.status().enabled) window.PTAPAutopilot.stop();
      window.__PTAP_AUTOPILOT_ARMED__ = false;
      window.__PTAP_PLANNED_ROUTE__ = null;
      const autopilotButton = document.querySelector("#ptap-autopilot");
      if (autopilotButton) autopilotButton.textContent = "Start autopilot";
      if (state.recording) finishRecording();
      setStatus("Stopped · held keys released", "good");
    });
    panel.querySelector("#ptap-diagnostics").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(diagnostics(), null, 2));
        setStatus("Diagnostics copied", "good");
      } catch { setStatus("Clipboard unavailable on this page", "bad"); }
    });
    panel.querySelector("#ptap-min").addEventListener("click", () => {
      panel.classList.toggle("ptap-collapsed");
    });
    updateButtons();
    loadRecording().then(run => {
      if (run?.events) renderAnalysis(run.events, run.durationMs);
    }).catch(() => {});
  }

  function buildPlannedRoute(carState) {
    if (window.__PTAP_ROUTE_BUILDING__ || window.__PTAP_PLANNED_ROUTE__ || window.__PTAP_ROUTE_ATTEMPTED__) return;
    const decoded = window.__PTAP_LAST_DECODED_TRACK__;
    const geometry = window.__PTAP_TRACK_GEOMETRY__;
    if (!decoded?.track?.parts?.length || !geometry || !window.PTAPTrackPlanner) return;
    window.__PTAP_ROUTE_BUILDING__ = true;
    window.__PTAP_ROUTE_ATTEMPTED__ = true;
    setStatus("Building 3D road surface and route…", "live");
    setTimeout(() => {
      try {
        const result = window.PTAPTrackPlanner.build(decoded, geometry, carState.position);
        if (!result.ok) {
          setStatus("Route planner: " + result.reason, "bad");
          window.__PTAP_ROUTE_BUILDING__ = false;
          return;
        }
        window.__PTAP_PLANNED_ROUTE__ = result.route;
        window.__PTAP_ROUTE_STATS__ = result.stats;
        setStatus("3D route ready · " + result.stats.routePoints + " points · " + result.stats.routeLengthM + " m", "good");
      } catch (error) {
        setStatus("Route planner error · " + (error?.message || "unknown error"), "bad");
      } finally {
        window.__PTAP_ROUTE_BUILDING__ = false;
      }
    }, 30);
  }

  function resolveCheckpointTarget(track, state) {
    const parts = track?.track?.parts;
    if (!Array.isArray(parts) || !parts.length) return null;
    const checkpointIndex = Number(state.nextCheckpointIndex);
    if (!Number.isInteger(checkpointIndex) || checkpointIndex < 0) return null;

    // PolySim's prepared-track implementation uses block origin * 5 metres.
    // The track decoder has already added the track's minimum XYZ offsets.
    const checkpoint = parts.find(part => part.checkpointOrder === checkpointIndex);
    if (checkpoint) return [checkpoint.x * 5, checkpoint.y * 5, checkpoint.z * 5];

    const checkpointOrders = parts.map(part => part.checkpointOrder).filter(Number.isInteger);
    const maxCheckpoint = checkpointOrders.length ? Math.max(...checkpointOrders) : 0;
    if (checkpointOrders.length && checkpointIndex <= maxCheckpoint) return null;

    // After the final checkpoint, target the nearest finish-line block.
    const finishIds = new Set([74, 6, 78, 76]);
    const finishParts = parts.filter(part => finishIds.has(part.id));
    if (!finishParts.length) return null;
    const p = state.position;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const part of finishParts) {
      const dx = part.x * 5 - p[0];
      const dy = part.y * 5 - p[1];
      const dz = part.z * 5 - p[2];
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = part;
      }
    }
    return nearest ? [nearest.x * 5, nearest.y * 5, nearest.z * 5] : null;
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== "polytrack-autopilot") return;
    if (event.data.type === "PTAP_PAGE_BRIDGE_READY") {
      window.__PTAP_PAGE_BRIDGE_READY__ = true;
      return;
    }
    if (event.data.type === "PTAP_PAGE_BRIDGE_TRACK_GEOMETRY") {
      window.__PTAP_TRACK_GEOMETRY__ = event.data.library || null;
      if (window.__PTAP_AUTOPILOT_ARMED__ && window.__PTAP_LAST_DECODED_TRACK__ && window.__PTAP_LAST_GAME_STATE__) {
        buildPlannedRoute(window.__PTAP_LAST_GAME_STATE__);
      }
      return;
    }
    if (event.data.type !== "PTAP_PAGE_BRIDGE_TELEMETRY") return;

    const raw = event.data.state;
    if (!raw) return;
    window.__PTAP_PAGE_BRIDGE_READY__ = true;
    const previous = window.__PTAP_LAST_GAME_STATE__;
    const state = {
      carId: raw.carId,
      frames: raw.frames,
      speed_kmh: raw.speedKmh,
      next_checkpoint_index: raw.nextCheckpointIndex,
      position: raw.position,
      quaternion: { x: raw.quaternion[0], y: raw.quaternion[1], z: raw.quaternion[2], w: raw.quaternion[3] },
      hasStarted: raw.hasStarted
    };
    if (previous && previous.carId === state.carId && state.frames > previous.frames) {
      state.deltaSeconds = Math.min(0.1, (state.frames - previous.frames) / 1000);
    }
    window.__PTAP_LAST_GAME_STATE__ = state;

    if (!window.PTAPAutopilot?.status().enabled) {
      const speed = Math.round(state.speed_kmh);
      setStatus("Live telemetry · " + speed + " km/h · checkpoint " + raw.nextCheckpointIndex, "good");
      return;
    }

    if (!window.__PTAP_PLANNED_ROUTE__) {
      buildPlannedRoute(state);
      return;
    }

    state.route = window.__PTAP_PLANNED_ROUTE__;
    const result = window.PTAPAutopilot.update(state);
    if (result?.valid) {
      const direction = Math.round(result.angle * 180 / Math.PI);
      setStatus("Autopilot · " + result.speedKmh.toFixed(0) + " km/h · target " + result.targetSpeedKmh.toFixed(0) + " · " + direction + "°", "live");
    } else if (result?.reason) setStatus("Autopilot paused · " + result.reason, "bad");
  });

  window.addEventListener("keydown", event => {
    if (event.target?.closest?.("#ptap-panel")) return;
    if (event.isTrusted && window.PTAPAutopilot?.status().enabled) {
      window.PTAPAutopilot.stop();
      window.__PTAP_AUTOPILOT_ARMED__ = false;
      window.__PTAP_PLANNED_ROUTE__ = null;
      const button = document.querySelector("#ptap-autopilot");
      if (button) button.textContent = "Start autopilot";
      setStatus("Autopilot stopped · manual input detected", "good");
    }
    if (!state.recording || event.repeat || !KEYS.has(event.key)) return;
    if (state.recordedHeld.has(event.key)) return;
    state.recordedHeld.add(event.key);
    state.events.push({ t: elapsed(), type: "keydown", key: event.key });
  }, true);

  window.addEventListener("keyup", event => {
    if (!state.recording || !KEYS.has(event.key)) return;
    if (event.target?.closest?.("#ptap-panel")) return;
    if (!state.recordedHeld.delete(event.key)) return;
    state.events.push({ t: elapsed(), type: "keyup", key: event.key });
  }, true);

  function releaseRecordedKeys() {
    if (!state.recording || !state.recordedHeld.size) return;
    const t = elapsed();
    for (const key of [...state.recordedHeld]) state.events.push({ t, type: "keyup", key });
    state.recordedHeld.clear();
  }

  window.addEventListener("blur", () => {
    if (state.replaying) stopReplay();
    if (window.PTAPAutopilot?.status().enabled) {
      window.PTAPAutopilot.stop();
      const button = document.querySelector("#ptap-autopilot");
      if (button) button.textContent = "Start autopilot";
    }
    // Do not stop recording when the user clicks the extension panel.
    releaseRecordedKeys();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.replaying) stopReplay();
    if (document.hidden && window.PTAPAutopilot?.status().enabled) {
      window.PTAPAutopilot.stop();
      const button = document.querySelector("#ptap-autopilot");
      if (button) button.textContent = "Start autopilot";
    }
    if (document.hidden) releaseRecordedKeys();
  });

  mountPanel();
  const observer = new MutationObserver(() => {
    if (!document.querySelector("#ptap-panel")) mountPanel();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();