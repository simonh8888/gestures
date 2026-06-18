# Gesture Control — Implementation Plan

> Living document. Update the status boxes as work lands.

## Goal

Perform hand gestures to control the browser. The browser extension does the
camera + tracking, a server stores user-defined gestures, and the extension
recognizes those stored gestures and performs the action each is labeled with.

## Architecture (Path C — Hybrid)

```
Browser extension (chrome-extension/)
  camera → MediaPipe (sandbox.html) → normalize landmarks
         → match against cached gesture templates → chrome.tabs action
                              ↑ fetch on startup / refresh
Server (backend-server/)  Node + Express + MongoDB
  stores gesture templates: { name, type, action, landmarks, frames, handedness, threshold }
  REST: GET/POST/PUT/DELETE /gestures

python-tracker/  — NOT in the live pipeline.
  Optional tool for capturing gesture templates to seed the DB.
```

**Why this path:** keeps the working in-browser camera/tracking (avoids the
WSL/side-panel webcam problems), still uses a real Express + MongoDB backend
for storage. Matching runs in the browser.

## Data model (MongoDB) — supports static now, motion later

```js
{
  name:       "peace sign",
  type:       "static",          // "static" | "motion"  (discriminator)
  action:     "scroll_up",       // scroll_up | scroll_down | close_tab | ...
  landmarks:  [[x,y,z], ...],    // 21 normalized points (static gestures)
  frames:     null,              // [[...21...], ...] sequence (motion, reserved)
  handedness: "Any",             // "Left" | "Right" | "Any"
  threshold:  0.15               // per-gesture match tolerance
}
```

## Key decisions

- Transport: extension → server via `fetch` to `http://localhost:8000`
  (manifest `host_permissions` already cover localhost).
- Offline resilience: cache last-known gestures in `chrome.storage.local` so the
  extension still works when the server is down.
- The current hardcoded gestures (1 hand top/bottom → scroll; 2 hands held 5s →
  close tab) become the **seed defaults** loaded into MongoDB on first run.
- Matching lives in `window.js` (it already receives the landmarks).

## Matching engine (the core technical work)

1. **Normalize** each frame: recenter on the wrist (landmark 0), scale by hand
   size (e.g. wrist → middle-finger MCP), so a gesture matches regardless of
   position/size on screen. (Rotation-normalize optional.)
2. **Compare** normalized live frame to each template — Euclidean distance over
   the 63-dim vector; pick the closest under its `threshold`.
3. **Debounce**: require the same match for N consecutive frames + a cooldown,
   so one held pose fires the action once, not ~30×/sec.

## Phases & status

### Phase 1 — Matching engine  ✅ done
- [x] Landmark normalization helper (`matcher.js` - recenter on wrist, scale by hand size, no rotation)
- [x] Distance / nearest-template matcher with threshold (`matchGesture`)
- [x] Debounce (consecutive-frame hold + cooldown - `GestureDebouncer`)
- [x] Wire debounce into `window.js` `detectGestures`

**Built-in gestures are hardcoded** (not captured): `detectPointing()` in
`window.js` checks the index-finger orientation - tip above the MCP knuckle =>
point_up => scroll_up; below => point_down => scroll_down. Two hands held 5s =>
close_tab. These ship by default and need no setup.

`matcher.js` (normalize + distance + match) is **built and ready but reserved for
user-defined custom gestures** in Phase 3. Only `GestureDebouncer` is wired into
the live path today. Capture/storage UI was removed - it returns in Phase 3 with
proper design.

**Validation (real-hand fixtures, `chrome-extension/fixtures/`):** replayed 4
gestures (ok, phone, pinky_up + a deliberately-similar phone/pinky pair) plus
negatives through `matcher.replay.js`. Findings:
- Tolerance: same-gesture captures cluster at distance ~0.5-0.9.
- Discrimination: different gestures sit 1.9-3.5 apart; negatives 3.75+.
  Clean separation - the matcher never confused the similar pair.
- **Handedness bug found & fixed.** Left and right hands mirror each other, so a
  left-hand template did NOT match the right hand (distance 2x-9x worse) and even
  *misclassified* it (right-hand ok read as pinky). Verified genuine via chirality
  sign-flip + mirror-symmetry checks (not a capture error).
  **Fix:** `normalizeLandmarks(landmarks, handedness)` mirrors x for left hands,
  canonicalizing both hands to one frame -> one template covers both. After the
  fix all 10 samples (incl. 3 right-hand) match at threshold ~1.7.
- **Default threshold: ~1.7** (clears mirrored off-hand matches ~1.0-1.6, stays
  below negatives at 3.75). Per-gesture `threshold` field allows tighter tuning.

**Tests:** `matcher.test.js` (14 synthetic unit checks incl. mirror-normalization),
`matcher.replay.js` (real captured fixtures). Both green.

**Phase 3 plumbing TODO (deferred):** the sandbox currently drops MediaPipe's
`multiHandedness` - it must forward it so the live matcher can canonicalize.
The `window.dumpLandmarks()` dev hook in `window.js` should be stripped or gated
before any production build.

### Phase 2 — Server as gesture store  ⬜ not started
- [ ] Extend Mongo schema: `type`, `frames`, `handedness`, `threshold`
- [ ] Add `PUT /gestures/:name` for edits (GET/POST/DELETE already exist)
- [ ] Seed default gestures on first run
- [ ] Extension fetches `GET /gestures` on startup, caches to `chrome.storage.local`
- [ ] Matcher uses fetched templates instead of hardcoded rules

### Phase 3 — Recording UI  ⬜ not started
- [ ] "Record gesture" — capture current normalized pose
- [ ] Name + assign action, `POST /gestures`
- [ ] List / delete / edit saved gestures

**Hands-free capture (decided):** the recording flow must not require a click
*while posing* — your hand is in the pose, so it can't be on the mouse. Use a
**countdown capture**:
1. Pick gesture + action, click "Record" once (hand still free).
2. A 3-2-1 countdown runs on screen.
3. On zero, snapshot whatever pose is held — hand was free to get into position
   during the count.

Capture should **average landmarks over ~0.5s** (not a single frame) for a
stabler template, less sensitive to per-frame jitter.

Future refinement (optional, not required for Phase 3): **auto-capture on hold**
— detect the hand held still for ~2s and capture automatically, fully touch-free.
Needs a stability metric; deferred. (Voice/keyboard triggers considered and
rejected: keyboard still needs the free hand; voice adds mic permission + flakiness.)

### Phase 4 — Motion gestures  ⬜ later
- [ ] Record short frame sequence (`frames`)
- [ ] Temporal matching (e.g. DTW)
- [ ] UI toggle for static vs motion when recording

## Current state (2026-06-16)

- ✅ Self-contained extension works: in-browser camera + MediaPipe + hardcoded
  gestures + tab control. Committed (`8c81cc6`).
- ✅ Project reorganized into `chrome-extension/`, `backend-server/`, `python-tracker/`.
- ⚠️ `backend-server/server.js` + `python-tracker/tracker.py` exist but are
  decoupled from the live extension (built during the earlier server-pipeline
  approach, before the pivot to Path C).
- ❌ No matching engine, no gesture storage wiring, no recording UI yet.
