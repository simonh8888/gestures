// matcher.test.js - fixtures-based test for the gesture matching engine.
// Run with:  node chrome-extension/matcher.test.js
//
// No browser and no hands required: we feed synthetic 21-point landmark sets
// straight into the matcher and assert on the math. This is exactly how custom
// gestures get tested without re-posing for the camera each time.

// matcher.js does `window.Matcher = {...}`. Shim a window for Node, load it.
global.window = {};
require("./matcher.js");
const M = global.window.Matcher;

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

// --- helpers ----------------------------------------------------------------

// Build a plausible 21-point hand. `dir` = +1 finger tips point up (smaller y),
// -1 they point down. `curlIndex` curls the index finger (for a non-pointing pose).
function makeHand({ ox = 0.5, oy = 0.5, scale = 1, dir = 1, curlIndex = false } = {}) {
  const P = (x, y, z = 0) => ({ x: ox + x * scale, y: oy - dir * y * scale, z });
  return [
    P(0, 0),                         // 0 wrist
    P(-0.15, 0.05), P(-0.22, 0.12), P(-0.28, 0.18), P(-0.33, 0.24), // 1-4 thumb
    // 5-8 index: extended (tip far from wrist) unless curled (tip folds back)
    P(0.0, 0.18),
    P(0.0, 0.34),
    curlIndex ? P(0.0, 0.30) : P(0.0, 0.50),
    curlIndex ? P(0.0, 0.20) : P(0.0, 0.66),
    // 9-12 middle (curled: tip near mcp)
    P(0.08, 0.18), P(0.08, 0.30), P(0.08, 0.24), P(0.08, 0.16),
    // 13-16 ring (curled)
    P(0.15, 0.17), P(0.15, 0.28), P(0.15, 0.22), P(0.15, 0.15),
    // 17-20 pinky (curled)
    P(0.21, 0.15), P(0.21, 0.24), P(0.21, 0.19), P(0.21, 0.13),
  ];
}

// --- 1. Normalization is translation- and scale-invariant -------------------
// The whole point of normalize: the SAME pose at a different spot / size on
// screen must produce (nearly) the same vector, so it still matches.
{
  const base = makeHand({ ox: 0.5, oy: 0.5, scale: 1.0 });
  const moved = makeHand({ ox: 0.2, oy: 0.7, scale: 1.0 }); // translated
  const zoomed = makeHand({ ox: 0.5, oy: 0.5, scale: 1.8 }); // scaled

  const d_moved = M.gestureDistance(M.normalizeLandmarks(base), M.normalizeLandmarks(moved));
  const d_zoom = M.gestureDistance(M.normalizeLandmarks(base), M.normalizeLandmarks(zoomed));

  console.log("Normalization invariance:");
  check(`translated pose ~ identical (dist ${d_moved.toFixed(4)} < 0.01)`, d_moved < 0.01);
  check(`scaled pose ~ identical (dist ${d_zoom.toFixed(4)} < 0.01)`, d_zoom < 0.01);
}

// --- 2. Discrimination: different poses are far apart ------------------------
{
  const pointUp = M.normalizeLandmarks(makeHand({ dir: 1 }));
  const pointDown = M.normalizeLandmarks(makeHand({ dir: -1 }));      // same shape, flipped
  const openIndexCurled = M.normalizeLandmarks(makeHand({ curlIndex: true })); // different shape

  const d_updown = M.gestureDistance(pointUp, pointDown);
  const d_shape = M.gestureDistance(pointUp, openIndexCurled);

  console.log("Discrimination:");
  check(`point_up vs point_down are far apart (dist ${d_updown.toFixed(3)} > 0.5)`, d_updown > 0.5);
  check(`point_up vs curled-index are far apart (dist ${d_shape.toFixed(3)} > 0.3)`, d_shape > 0.3);
}

// --- 2b. Handedness: mirror-normalization makes both hands match -----------
// Left and right hands are mirror images. A right hand and its image-mirror
// (a "left" hand) of the SAME gesture must normalize to the same vector once
// each is canonicalized with its own handedness.
{
  const right = makeHand({ ox: 0.5, oy: 0.5 });
  // Image-mirror about the x=ox axis -> the opposite hand making the same pose.
  const left = right.map((p) => ({ x: 2 * 0.5 - p.x, y: p.y, z: p.z }));

  const nRight = M.normalizeLandmarks(right, "Right");
  const nLeft = M.normalizeLandmarks(left, "Left");
  const dCanon = M.gestureDistance(nRight, nLeft);

  // Without handedness, the same two hands look different (mirror not undone).
  const dNaive = M.gestureDistance(
    M.normalizeLandmarks(right),
    M.normalizeLandmarks(left)
  );

  console.log("Handedness (mirror-normalization):");
  check(`canonicalized L/R match (dist ${dCanon.toFixed(4)} < 0.01)`, dCanon < 0.01);
  check(`without handedness they differ (dist ${dNaive.toFixed(3)} > 0.5)`, dNaive > 0.5);
}

// --- 3. matchGesture picks the right template under threshold ---------------
{
  const templates = [
    { name: "point_up", action: "scroll_up", landmarks: M.normalizeLandmarks(makeHand({ dir: 1 })), threshold: 0.3 },
    { name: "point_down", action: "scroll_down", landmarks: M.normalizeLandmarks(makeHand({ dir: -1 })), threshold: 0.3 },
  ];

  // A noisy point-up hand (jitter) should still match point_up.
  const noisyUp = makeHand({ dir: 1, ox: 0.55, oy: 0.48, scale: 1.1 });
  const m1 = M.matchGesture(noisyUp, templates);

  // A clear point-down hand should match point_down.
  const m2 = M.matchGesture(makeHand({ dir: -1 }), templates);

  // A curled-index pose matches nothing (over threshold).
  const m3 = M.matchGesture(makeHand({ curlIndex: true }), templates);

  console.log("matchGesture:");
  check(`noisy point-up -> point_up`, m1 && m1.name === "point_up");
  check(`point-down -> point_down`, m2 && m2.name === "point_down");
  check(`curled-index -> no match (null)`, m3 === null);
}

// --- 4. Debouncer: holds N frames, fires once, respects cooldown ------------
{
  const db = new M.GestureDebouncer({ holdFrames: 4, cooldownMs: 600 });
  const match = { name: "point_up", action: "scroll_up" };
  let t = 1000;

  const f1 = db.update(match, t++); // frame 1
  const f2 = db.update(match, t++); // frame 2
  const f3 = db.update(match, t++); // frame 3
  const f4 = db.update(match, t++); // frame 4 -> should fire
  const f5 = db.update(match, t++); // frame 5 -> cooldown, no fire

  console.log("Debouncer:");
  check("no fire before 4 held frames", !f1 && !f2 && !f3);
  check("fires on the 4th held frame", !!f4 && f4.name === "point_up");
  check("does not re-fire during cooldown", !f5);

  // After cooldown + re-holding, it can fire again.
  let t2 = 2000; // > 600ms later
  const db2 = new M.GestureDebouncer({ holdFrames: 2, cooldownMs: 100 });
  db2.update(match, t2++); const again = db2.update(match, t2++);
  check("fires again after re-hold past cooldown", !!again);

  // A null (no gesture) resets the streak.
  const db3 = new M.GestureDebouncer({ holdFrames: 2 });
  db3.update(match, 1); db3.update(null, 2); const broken = db3.update(match, 3);
  check("gap resets the hold streak", !broken);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
