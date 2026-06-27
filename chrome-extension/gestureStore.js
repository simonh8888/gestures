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

  async function apiFetch(path, options = {}) {
    const base = await getApiBase();
    const res = await fetch(`${base}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      body = null;
    }
    if (!res.ok) {
      const msg = (body && body.error) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return body;
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
      fingerRatios: window.Matcher.computeFingerRatios(points),
    };
  }

  // Fetch gestures from the server; on any failure fall back to the last cached
  // set so the extension still works offline / when the server is down.
  async function loadGestures() {
    const { gestures, source, error } = await listGestures();
    return {
      source,
      error,
      templates: gestures.map(toTemplate).filter(Boolean),
    };
  }

  async function listGestures() {
    const base = await getApiBase();
    try {
      const res = await fetch(`${base}/gestures`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const docs = await res.json();
      chrome.storage.local.set({ [CACHE_KEY]: docs });
      return { source: "server", gestures: docs };
    } catch (err) {
      const cached = await readCache();
      return {
        source: cached.length ? "cache" : "none",
        gestures: cached,
        error: err.message,
      };
    }
  }

  async function fetchActions() {
    return apiFetch("/actions");
  }

  async function createGesture(doc) {
    const created = await apiFetch("/gestures", {
      method: "POST",
      body: JSON.stringify(doc),
    });
    await listGestures();
    return created;
  }

  async function updateGesture(name, doc) {
    const updated = await apiFetch(`/gestures/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(doc),
    });
    await listGestures();
    return updated;
  }

  async function deleteGesture(name) {
    await apiFetch(`/gestures/${encodeURIComponent(name)}`, { method: "DELETE" });
    await listGestures();
  }

  window.GestureStore = {
    loadGestures,
    listGestures,
    fetchActions,
    createGesture,
    updateGesture,
    deleteGesture,
    getApiBase,
  };
})();
