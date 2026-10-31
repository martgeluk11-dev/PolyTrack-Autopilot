(() => {
  "use strict";

  // Each frame gets its own panel. The top-level game frame is preferred by
  // the user; duplicate panels are avoided within each document.
  if (window.__PT_AUTOPILOT_LOADED__) return;
  window.__PT_AUTOPILOT_LOADED__ = true;

  const KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", " "];
  const state = {
    recording: false,
    replaying: false,
    startedAt: 0,
    events: [],
    replayTimers: [],
    heldKeys: new Set(),
    lastSavedAt: null
  };

  const isGameLike = () => {
    const canvases = [...document.querySelectorAll("canvas")];
    return canvases.some(c => {
      const r = c.getBoundingClientRect();
      return r.width > 250 && r.height > 150;
    }) || /polytrack/i.test(document.title + " " + location.href);
  };

  function findGameTarget() {
    const canvases = [...document.querySelectorAll("canvas")];
    const canvas = canvases.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (br.width * br.height) - (ar.width * ar.height);
    })[0];
    return canvas || document.activeElement || document.body;
  }

  function sendKey(type, key) {
    const target = findGameTarget();
    const codeMap = {
      ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
      ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
      " ": "Space", w: "KeyW", a: "KeyA", s: "KeyS", d: "KeyD"
    };
    const event = new KeyboardEvent(type, {
      key, code: codeMap[key] || key,
      bubbles: true, cancelable: true,
      composed: true,
      view: window
    });
    try { target.dispatchEvent(event); } catch {}
    try { document.dispatchEvent(new KeyboardEvent(type, {
      key, code: codeMap[key] || key, bubbles: true, cancelable: true
    })); } catch {}
    if (type === "keydown") state.heldKeys.add(key);
    else state.heldKeys.delete(key);
  }

  function releaseAll() {
    for (const key of [...state.heldKeys]) sendKey("keyup", key);
    state.heldKeys.clear();
  }

  function setStatus(message, kind = "") {
    const el = document.querySelector("#ptap-status");
    if (!el) return;
    el.textContent = message;
    el.dataset.kind = kind;
  }

  function saveRecording() {
    const payload = {
      version: 1,
      createdAt: new Date().toISOString(),
      durationMs: state.events.length ? state.events[state.events.length - 1].t : 0,
      events: state.events
    };
    try {
      const request = indexedDB.open("pt-autopilot", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("recordings")) db.createObjectStore("recordings");
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("recordings", "readwrite");
        tx.objectStore("recordings").put(payload, "latest");
        tx.oncomplete = () => {
          state.lastSavedAt = payload.createdAt;
          setStatus(`Saved ${state.events.length} input events`, "good");
          db.close();
        };
        tx.onerror = () => setStatus("Could not save recording", "bad");
      };
      request.onerror = () => setStatus("Storage unavailable", "bad");
    } catch {
      setStatus("Storage unavailable", "bad");
    }
  }

  function loadRecording() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("pt-autopilot", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("recordings")) {
          request.result.createObjectStore("recordings");
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("recordings", "readonly");
        const get = tx.objectStore("recordings").get("latest");
        get.onsuccess = () => { resolve(get.result || null); db.close(); };
        get.onerror = () => { reject(get.error); db.close(); };
      };
      request.onerror = () => reject(request.error);
    });
  }

  function startRecording() {
    stopReplay();
    state.events = [];
    state.recording = true;
    state.startedAt = performance.now();
    setStatus("Recording — drive your lap now", "live");
    updateButtons();
  }

  function stopRecording() {
    if (!state.recording) return;
    state.recording = false;
    saveRecording();
    updateButtons();
  }

  function stopReplay() {
    state.replaying = false;
    for (const id of state.replayTimers) clearTimeout(id);
    state.replayTimers = [];
    releaseAll();
    updateButtons();
  }

  async function startReplay() {
    if (state.recording) stopRecording();
    stopReplay();
    let recording;
    try { recording = await loadRecording(); }
    catch { setStatus("Could not load recording", "bad"); return; }
    if (!recording?.events?.length) {
      setStatus("No saved lap yet — record one first", "bad");
      return;
    }

    state.replaying = true;
    const started = performance.now();
    setStatus(`Replaying ${recording.events.length} events…`, "live");
    updateButtons();

    for (const event of recording.events) {
      const id = setTimeout(() => {
        if (!state.replaying) return;
        sendKey(event.type, event.key);
        if (event === recording.events[recording.events.length - 1]) {
          const finishId = setTimeout(() => {
            stopReplay();
            setStatus("Replay finished (timing-based)", "good");
          }, 40);
          state.replayTimers.push(finishId);
        }
      }, Math.max(0, event.t - (performance.now() - started)));
      state.replayTimers.push(id);
    }
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
      return { index: i, width: c.width, height: c.height,
        displayWidth: Math.round(r.width), displayHeight: Math.round(r.height),
        visible: r.width > 0 && r.height > 0 };
    });
    return {
      extension: "PolyTrack Autopilot 0.1.0",
      href: location.href,
      title: document.title,
      frame: window === window.top ? "top" : "embedded",
      userAgent: navigator.userAgent,
      canvases,
      iframeCount: document.querySelectorAll("iframe").length,
      gameLike: isGameLike(),
      note: "No vehicle telemetry or track geometry is assumed by this diagnostic."
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
        <div id="ptap-status" data-kind="neutral">Game detected · experimental tools</div>
        <div class="ptap-actions">
          <button id="ptap-record" type="button">Record lap</button>
          <button id="ptap-replay" type="button">Replay lap</button>
          <button id="ptap-stop" type="button">Stop bot</button>
        </div>
        <button id="ptap-diagnostics" class="ptap-secondary" type="button">Copy diagnostics</button>
        <p class="ptap-note">Replay is timing-based, not an optimized or adaptive racing bot.</p>
      </div>`;
    document.documentElement.appendChild(panel);

    panel.querySelector("#ptap-record").addEventListener("click", () => {
      state.recording ? stopRecording() : startRecording();
    });
    panel.querySelector("#ptap-replay").addEventListener("click", startReplay);
    panel.querySelector("#ptap-stop").addEventListener("click", () => {
      stopReplay();
      if (state.recording) stopRecording();
      setStatus("Stopped — all keys released", "good");
    });
    panel.querySelector("#ptap-diagnostics").addEventListener("click", async () => {
      const text = JSON.stringify(diagnostics(), null, 2);
      try {
        await navigator.clipboard.writeText(text);
        setStatus("Diagnostics copied", "good");
      } catch {
        setStatus(text.slice(0, 110), "bad");
      }
    });
    panel.querySelector("#ptap-min").addEventListener("click", () => {
      panel.classList.toggle("ptap-collapsed");
    });
  }

  window.addEventListener("keydown", event => {
    if (!state.recording || event.repeat || !KEYS.includes(event.key)) return;
    state.events.push({ t: Math.round(performance.now() - state.startedAt), type: "keydown", key: event.key });
  }, true);

  window.addEventListener("keyup", event => {
    if (!state.recording || !KEYS.includes(event.key)) return;
    state.events.push({ t: Math.round(performance.now() - state.startedAt), type: "keyup", key: event.key });
  }, true);

  window.addEventListener("blur", () => {
    if (state.replaying) stopReplay();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.replaying) stopReplay();
  });

  mountPanel();
  const observer = new MutationObserver(() => {
    if (!document.querySelector("#ptap-panel")) mountPanel();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();