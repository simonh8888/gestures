// recorder.js - hands-free gesture capture (Phase 3)
//
// Countdown (3-2-1) then average raw landmarks over ~0.5s. Exposed on
// window.GestureRecorder. window.js feeds frames via pushFrame while capturing.

(function () {
  "use strict";

  const COUNTDOWN_SEC = 3;
  const CAPTURE_MS = 500;

  let phase = "idle"; // idle | countdown | capturing
  let countdownTimer = null;
  let captureTimer = null;
  let callbacks = {};
  let samples = [];

  function clearTimers() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (captureTimer) {
      clearTimeout(captureTimer);
      captureTimer = null;
    }
  }

  function isActive() {
    return phase !== "idle";
  }

  function cancel() {
    clearTimers();
    phase = "idle";
    samples = [];
    callbacks = {};
  }

  function pushFrame(landmarks, handedness) {
    if (phase !== "capturing" || !landmarks || landmarks.length < 21) return;
    samples.push({
      landmarks,
      handedness: handedness === "Left" || handedness === "Right" ? handedness : null,
    });
  }

  function averageLandmarks(frames) {
    const n = frames.length;
    const out = [];
    for (let i = 0; i < 21; i++) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const frame of frames) {
        const p = frame[i];
        x += p.x;
        y += p.y;
        z += p.z || 0;
      }
      out.push([x / n, y / n, z / n]);
    }
    return out;
  }

  function majorityHandedness(labels) {
    const counts = { Left: 0, Right: 0 };
    for (const label of labels) {
      if (label === "Left" || label === "Right") counts[label]++;
    }
    return counts.Left >= counts.Right ? "Left" : "Right";
  }

  function finishCapture() {
    captureTimer = null;
    phase = "idle";
    const cbs = callbacks;
    callbacks = {};

    if (samples.length === 0) {
      cbs.onError?.("No hand detected during capture — hold one hand in frame.");
      samples = [];
      return;
    }

    const landmarks = averageLandmarks(samples.map((s) => s.landmarks));
    const handedness = majorityHandedness(samples.map((s) => s.handedness));
    samples = [];
    cbs.onComplete?.({ landmarks, handedness });
  }

  function startCountdown(cbs) {
    if (phase !== "idle") return false;
    callbacks = cbs || {};
    samples = [];
    phase = "countdown";
    let remaining = COUNTDOWN_SEC;
    cbs.onTick?.(remaining);

    countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        cbs.onTick?.(remaining);
        return;
      }
      clearInterval(countdownTimer);
      countdownTimer = null;
      phase = "capturing";
      cbs.onCaptureStart?.();
      captureTimer = setTimeout(finishCapture, CAPTURE_MS);
    }, 1000);

    return true;
  }

  window.GestureRecorder = {
    isActive,
    getPhase: () => phase,
    pushFrame,
    startCountdown,
    cancel,
  };
})();
