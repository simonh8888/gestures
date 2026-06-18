// matcher.js - gesture matching engine (Phase 1)
//
// Turns MediaPipe's 21 raw hand landmarks into a recognized, named gesture.
// MediaPipe only tells us WHERE the hand is; this file decides WHAT pose it is
// by comparing the live hand against stored templates.
//
// Pipeline:  normalizeLandmarks -> matchGesture -> GestureDebouncer
//
// Self-contained (no imports) so it can be loaded before window.js in the
// extension AND reused by the future recording UI. Exposed on window.Matcher.

(function () {
  "use strict";

  // Landmark indices we anchor normalization on (MediaPipe Hands topology).
  const WRIST = 0;
  const MIDDLE_MCP = 9; // base knuckle of the middle finger

  // ---------------------------------------------------------------------------
  // 1. Normalization
  //
  // Makes a pose comparable regardless of WHERE the hand is on screen or HOW
  // BIG it appears (near/far from camera):
  //   - recenter on the wrist   -> translation-invariant
  //   - scale by hand size      -> distance/zoom-invariant
  // We deliberately do NOT rotation-normalize: orientation is what
  // distinguishes "point up" from "point down" (same shape, flipped).
  //
  // Input:  array of 21 {x, y, z} points (MediaPipe format).
  //         handedness - optional "Left" | "Right" (from MediaPipe). Left and
  //         right hands are mirror images, so the SAME gesture made with the
  //         other hand produces a flipped vector and won't match. We canonicalize
  //         to a single chirality by mirroring x for left hands, so one template
  //         covers both hands. Omit handedness to skip mirroring (back-compat).
  // Output: flat Float64Array of 63 numbers [x0,y0,z0, x1,y1,z1, ...].
  // ---------------------------------------------------------------------------
  function normalizeLandmarks(landmarks, handedness) {
    if (!landmarks || landmarks.length < 21) return null;

    const wrist = landmarks[WRIST];
    const mid = landmarks[MIDDLE_MCP];

    // Hand size = wrist -> middle-finger base knuckle distance. Stable across
    // most poses since these two points don't move much relative to each other.
    const dx = mid.x - wrist.x;
    const dy = mid.y - wrist.y;
    const dz = (mid.z || 0) - (wrist.z || 0);
    let scale = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (scale < 1e-6) scale = 1e-6; // guard against divide-by-zero

    // Mirror left hands about the wrist's vertical axis (negate recentered x).
    // This maps both hands into one canonical "right-handed" frame.
    const flip = handedness === "Left" ? -1 : 1;

    const out = new Float64Array(63);
    for (let i = 0; i < 21; i++) {
      const lm = landmarks[i];
      out[i * 3] = (flip * (lm.x - wrist.x)) / scale;
      out[i * 3 + 1] = (lm.y - wrist.y) / scale;
      out[i * 3 + 2] = ((lm.z || 0) - (wrist.z || 0)) / scale;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // 2. Distance - Euclidean over the 63-dim normalized vectors.
  // ---------------------------------------------------------------------------
  function gestureDistance(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      sum += d * d;
    }
    return Math.sqrt(sum);
  }

  // ---------------------------------------------------------------------------
  // 3. Match - find the nearest template under its own threshold.
  //
  // templates: [{ name, action, landmarks: <63-num array>, threshold }]
  //   (template.landmarks must already be normalized with its own handedness.)
  // handedness: optional "Left" | "Right" for the live hand, so it canonicalizes
  //   to the same frame as the stored templates.
  // Returns { name, action, distance } or null if nothing qualifies.
  // ---------------------------------------------------------------------------
  function matchGesture(rawLandmarks, templates, handedness) {
    const live = normalizeLandmarks(rawLandmarks, handedness);
    if (!live) return null;

    let best = null;
    for (const t of templates) {
      const dist = gestureDistance(live, t.landmarks);
      const tol = t.threshold != null ? t.threshold : 1.7;
      if (dist <= tol && (best === null || dist < best.distance)) {
        best = { name: t.name, action: t.action, distance: dist };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // 4. Debounce
  //
  // MediaPipe fires ~30x/sec, so a held pose would trigger its action dozens of
  // times. This requires the SAME gesture for N consecutive frames before
  // firing once, then enforces a cooldown before it can fire again.
  // ---------------------------------------------------------------------------
  class GestureDebouncer {
    constructor({ holdFrames = 4, cooldownMs = 600 } = {}) {
      this.holdFrames = holdFrames;
      this.cooldownMs = cooldownMs;
      this.candidate = null; // name currently building up consecutive frames
      this.count = 0;
      this.lastFiredAt = 0;
    }

    // Feed each frame's match (a {name, action} object or null).
    // Returns the match if it should FIRE this frame, else null.
    update(match, now) {
      const name = match ? match.name : null;

      // Track consecutive-frame streak for the current candidate.
      if (name && name === this.candidate) {
        this.count++;
      } else {
        this.candidate = name;
        this.count = name ? 1 : 0;
      }

      if (!name) return null;
      if (this.count < this.holdFrames) return null;
      if (now - this.lastFiredAt < this.cooldownMs) return null;

      this.lastFiredAt = now;
      this.count = 0; // reset so the pose must be re-held to fire again
      return match;
    }

    reset() {
      this.candidate = null;
      this.count = 0;
    }
  }

  window.Matcher = {
    normalizeLandmarks,
    gestureDistance,
    matchGesture,
    GestureDebouncer,
    WRIST,
    MIDDLE_MCP,
  };
})();
