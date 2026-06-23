// gestureStore.js - loads custom gesture templates from the server, caches them
// offline, and converts them into matcher templates.
//
// Distribution-minded: the API base URL is NOT hardcoded - it reads from
// chrome.storage.local ("apiBase") with a localhost default. That's the
// frontend equivalent of the server's MONGO_URI env var: point the extension at
// a hosted backend later by setting that value, no code change.
//
// Exposed on window.GestureStore. Depends on window.Matcher (matcher.js).

(function () {
  "use strict";

  const DEFAULT_API_BASE = "http://localhost:8000";
  const API_BASE_KEY = "apiBase";
  const CACHE_KEY = "cachedGestures"; // raw server docs (so we can re-normalize)

  function getApiBase() {
    return new Promise((resolve) => {
      chrome.storage.local.get(API_BASE_KEY, (d) =>
        resolve(d[API_BASE_KEY] || DEFAULT_API_BASE)
      );
    });
  }

  function readCache() {
    return new Promise((resolve) => {
      chrome.storage.local.get(CACHE_KEY, (d) => resolve(d[CACHE_KEY] || []));
    });
  }

  // Convert a server gesture doc (RAW landmarks [[x,y,z]] + handedness) into a
  // matcher template (normalized 63-vector). Normalizing on load - rather than
  // storing normalized vectors - keeps stored data valid if normalize() changes.
  function toTemplate(g) {
    if (!Array.isArray(g.landmarks)) return null;
    const points = g.landmarks.map((p) => ({ x: p[0], y: p[1], z: p[2] || 0 }));
    const norm = window.Matcher.normalizeLandmarks(points, g.handedness);
    if (!norm) return null;
    return {
      name: g.name,
      action: g.action,
      landmarks: Array.from(norm),
      threshold: g.threshold,
    };
  }

  // Fetch gestures from the server; on any failure fall back to the last cached
  // set so the extension still works offline / when the server is down.
  async function loadGestures() {
    const base = await getApiBase();
    try {
      const res = await fetch(`${base}/gestures`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const docs = await res.json();
      chrome.storage.local.set({ [CACHE_KEY]: docs }); // cache raw docs
      return { source: "server", templates: docs.map(toTemplate).filter(Boolean) };
    } catch (err) {
      const cached = await readCache();
      return {
        source: cached.length ? "cache" : "none",
        templates: cached.map(toTemplate).filter(Boolean),
        error: err.message,
      };
    }
  }

  window.GestureStore = { loadGestures, getApiBase };
})();
