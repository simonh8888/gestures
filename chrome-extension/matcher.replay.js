// matcher.replay.js - replay REAL captured landmarks through the matcher.
// Run with:  node chrome-extension/matcher.replay.js
//
// Unlike matcher.test.js (synthetic poses), this loads landmark data you
// captured from your own hand via the extension, so you can see whether real
// MediaPipe data clusters cleanly and pick a good threshold.
//
// Capture workflow:
//   1. Load the extension, open the popup, Activate Camera.
//   2. Right-click the popup -> Inspect to open its DevTools console.
//   3. Strike a pose, then run:  copy(JSON.stringify(window.dumpLandmarks()))
//   4. Save into chrome-extension/fixtures/<something>.json as:
//        { "label": "point_up", "role": "template", "landmarks": <pasted> }
//      role "template" = the reference pose; role "sample" = a test pose to match.
//      Capture 1 template + several samples per gesture (vary position/size/angle).

global.window = {};
require("./matcher.js");
const M = global.window.Matcher;
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "fixtures");
const THRESHOLD = Number(process.env.THRESHOLD || 1.7); // tune via env: THRESHOLD=1.5 node ...

// Accept landmarks as [{x,y,z}, ...] or [[x,y,z], ...].
function toPoints(landmarks) {
  return landmarks.map((p) =>
    Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] || 0 } : p
  );
}

if (!fs.existsSync(DIR)) {
  console.log(`No fixtures dir yet. Create ${DIR} and add captured *.json files.`);
  console.log("See the capture workflow at the top of this file.");
  process.exit(0);
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.log(`No *.json fixtures in ${DIR}. Capture some first (see file header).`);
  process.exit(0);
}

const templates = [];
const samples = [];
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  const entry = {
    file: f,
    label: data.label,
    handedness: data.handedness, // "Left" | "Right" | undefined
    landmarks: toPoints(data.landmarks),
  };
  if (data.role === "template") {
    templates.push({
      name: data.label,
      action: data.action || "n/a",
      // Normalize with the template's own handedness so it lands in the
      // canonical frame; live samples canonicalize the same way and match.
      landmarks: M.normalizeLandmarks(entry.landmarks, entry.handedness),
      threshold: data.threshold != null ? data.threshold : THRESHOLD,
    });
  } else {
    samples.push(entry);
  }
}

if (templates.length === 0) {
  console.log('No templates found. Mark at least one fixture with "role": "template".');
  process.exit(1);
}

console.log(`Templates (${templates.length}): ${templates.map((t) => t.name).join(", ")}`);
console.log(`Samples   (${samples.length})\n`);

let correct = 0;
for (const s of samples) {
  const live = M.normalizeLandmarks(s.landmarks, s.handedness);
  // Distance to every template, sorted nearest-first - useful for tuning.
  const dists = templates
    .map((t) => ({ name: t.name, d: M.gestureDistance(live, t.landmarks) }))
    .sort((a, b) => a.d - b.d);

  const match = M.matchGesture(s.landmarks, templates, s.handedness); // applies each template's threshold
  const predicted = match ? match.name : "none";
  const ok = predicted === s.label;
  if (ok) correct++;

  const distStr = dists.map((x) => `${x.name}=${x.d.toFixed(3)}`).join("  ");
  console.log(`${ok ? "ok  " : "MISS"} ${s.file}`);
  console.log(`     expected ${s.label} -> predicted ${predicted}   [${distStr}]`);
}

console.log(`\n${correct}/${samples.length} samples matched their label (threshold ${THRESHOLD}).`);
