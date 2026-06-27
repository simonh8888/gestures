const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const canvasCtx = canvas.getContext("2d");
const statusDiv = document.getElementById("status");
const activateButton = document.getElementById("activateCamera");
const stopButton = document.getElementById("stopCamera");
const sandbox = document.getElementById("sandbox");

let stream = null;
let sandboxReady = false;
let mediapipeReady = false;
let processingFrame = false;

const CLOSE_TAB_HOLD_MS = 5000;
const POST_RECORD_COOLDOWN_MS = 3000; // ignore matches after save while user releases pose
let twoHandsFirstSeen = null;
let gestureCooldownUntil = 0;

// --- Built-in (hardcoded) gestures -------------------------------------------
// These ship by default and don't need to be captured. Custom gestures fetched
// from the server are matched via matcher.js (matched in detectGestures below).
// Require ~0.7s of stable match before firing (~30fps). Short holds (4 frames)
// fire on transitional poses while moving into a gesture.
const GESTURE_HOLD_FRAMES = 20;
const debouncer = new Matcher.GestureDebouncer({ holdFrames: GESTURE_HOLD_FRAMES, cooldownMs: 600 });

// Custom gesture templates loaded from the server (normalized, ready to match).
let customTemplates = [];
async function loadCustomGestures() {
  const { source, templates, error } = await window.GestureStore.loadGestures();
  customTemplates = templates;
  console.log(`Loaded ${templates.length} custom gestures (${source})`, error || "");
}
loadCustomGestures();

window.refreshGestures = async () => {
  await loadCustomGestures();
  if (window.GestureUI) await window.GestureUI.refreshList();
};

window.isCameraReady = () => Boolean(stream && mediapipeReady);

window.startGestureCooldown = () => {
  gestureCooldownUntil = Date.now() + POST_RECORD_COOLDOWN_MS;
  debouncer.reset();
  twoHandsFirstSeen = null;
};

// Dev hook (fixtures / matcher.replay.js). Set localStorage.gesturesDev = "1" in
// the popup console to enable: copy(JSON.stringify(window.dumpLandmarks()))
let lastRawLandmarks = null;
if (localStorage.getItem("gesturesDev") === "1") {
  window.dumpLandmarks = () => lastRawLandmarks;
}

// MediaPipe Hands landmark indices.
const WRIST = 0;
const INDEX_MCP = 5; // index base knuckle
const INDEX_TIP = 8; // index fingertip

// 2D distance between two landmarks (z is too noisy to rely on).
function dist2d(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// A finger is "extended" if its tip is farther from the wrist than its middle
// (PIP) joint. When curled, the tip folds back toward the palm and ends up
// closer to the wrist. This holds regardless of which way the hand points.
function fingerExtended(landmarks, tipIdx, pipIdx) {
  const wrist = landmarks[WRIST];
  return dist2d(landmarks[tipIdx], wrist) > dist2d(landmarks[pipIdx], wrist);
}

// Hardcoded pointing detector. Only fires for a real pointing pose: index
// finger extended, the other three fingers curled. Then orientation (index tip
// above vs below its knuckle) decides up vs down.
// Returns "point_up" | "point_down" | null.
function detectPointing(landmarks) {
  const indexUp = fingerExtended(landmarks, INDEX_TIP, 6);
  const middleUp = fingerExtended(landmarks, 12, 10);
  const ringUp = fingerExtended(landmarks, 16, 14);
  const pinkyUp = fingerExtended(landmarks, 20, 18);

  // Must be index-only: index extended, others closed. (Thumb is ignored.)
  if (!indexUp || middleUp || ringUp || pinkyUp) return null;

  const mcp = landmarks[INDEX_MCP];
  const tip = landmarks[INDEX_TIP];
  const dx = tip.x - mcp.x;
  const dy = tip.y - mcp.y; // image y grows downward

  // Require the finger to be mostly vertical and clearly extended in y, so a
  // sideways or camera-facing point doesn't scroll.
  if (Math.abs(dy) < Math.abs(dx)) return null;
  if (Math.abs(dy) < 0.05) return null;

  return dy < 0 ? "point_up" : "point_down";
}

// Two hands count only if MediaPipe reports >=2 hands AND their wrists are
// clearly separated. This rejects the duplicate/overlapping detection MediaPipe
// sometimes produces for a single hand (which falsely triggered close-tab).
const TWO_HAND_MIN_SEPARATION = 0.15; // normalized image units
function hasTwoSeparateHands(multiHandLandmarks) {
  if (multiHandLandmarks.length < 2) return false;
  const a = multiHandLandmarks[0][WRIST];
  const b = multiHandLandmarks[1][WRIST];
  return dist2d(a, b) > TWO_HAND_MIN_SEPARATION;
}

// Run `fn(tab)` with the active *browser* tab (not the extension's own page).
function withActiveBrowserTab(fn) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs.find(t =>
      t.url &&
      !t.url.startsWith('chrome-extension://') &&
      !t.url.startsWith('chrome://') &&
      !t.url.startsWith('edge://')
    );
    if (tab) fn(tab);
    else statusDiv.textContent = "No browser tab found to control";
  });
}

// Switch the active tab by an offset (+1 next, -1 prev), wrapping around.
function switchTab(delta) {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    if (!tabs.length) return;
    const i = tabs.findIndex(t => t.active);
    const next = tabs[(i + delta + tabs.length) % tabs.length];
    chrome.tabs.update(next.id, { active: true });
  });
}

// Perform the action a gesture is labeled with. This is the action registry's
// dispatcher - it must stay in sync with the server's ACTIONS list.
function runAction(action) {
  switch (action) {
    case "scroll_up":
    case "scroll_down":
      // Handled by continuous scroll while the gesture is held.
      break;
    case "new_tab":   chrome.tabs.create({}); break;
    case "close_tab": withActiveBrowserTab(tab => chrome.tabs.remove(tab.id)); break;
    case "next_tab":  switchTab(1); break;
    case "prev_tab":  switchTab(-1); break;
    case "back":      runInActiveTab(() => history.back()); break;
    case "forward":   runInActiveTab(() => history.forward()); break;
    case "refresh":   withActiveBrowserTab(tab => chrome.tabs.reload(tab.id)); break;
    case "zoom_in":
      withActiveBrowserTab(tab => chrome.tabs.getZoom(tab.id, z => chrome.tabs.setZoom(tab.id, z + 0.1)));
      break;
    case "zoom_out":
      withActiveBrowserTab(tab => chrome.tabs.getZoom(tab.id, z => chrome.tabs.setZoom(tab.id, Math.max(0.3, z - 0.1))));
      break;
    default:
      console.warn("Unknown action:", action);
  }
}


// Helper to run code in the active tab
function findActiveBrowserTab(tabs) {
  return tabs.find(tab =>
    tab.url &&
    !tab.url.startsWith('chrome-extension://') &&
    !tab.url.startsWith('chrome://') &&
    !tab.url.startsWith('edge://') &&
    tab.active
  );
}

function runInActiveTab(code, args = []) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const browserTab = findActiveBrowserTab(tabs);
    if (browserTab) {
      chrome.scripting.executeScript({
        target: { tabId: browserTab.id },
        func: code,
        args,
      }).catch(err => {
        statusDiv.textContent = `Error: ${err.message}`;
      });
    } else {
      statusDiv.textContent = "No browser tab found to control";
    }
  });
}

// Continuous scroll while point up/down (or custom scroll gesture) is held.
const SCROLL_INTERVAL_MS = 16;
const SCROLL_PX_PER_TICK = 10;
const SCROLL_START_FRAMES = 6; // brief hold before scroll starts (~200ms)
let scrollTimer = null;
let scrollDeltaPx = 0;
let scrollMatchStreak = 0;

function isScrollAction(action) {
  return action === "scroll_up" || action === "scroll_down";
}

function scrollStepFor(action) {
  return action === "scroll_up" ? -SCROLL_PX_PER_TICK : SCROLL_PX_PER_TICK;
}

function stopContinuousScroll() {
  if (scrollTimer) {
    clearInterval(scrollTimer);
    scrollTimer = null;
  }
  scrollDeltaPx = 0;
  scrollMatchStreak = 0;
}

function startContinuousScroll(action) {
  const delta = scrollStepFor(action);
  if (scrollTimer && scrollDeltaPx === delta) return;
  stopContinuousScroll();
  scrollDeltaPx = delta;
  scrollTimer = setInterval(() => {
    runInActiveTab((d) => window.scrollBy({ top: d, behavior: "auto" }), [scrollDeltaPx]);
  }, SCROLL_INTERVAL_MS);
}

// Listen for messages from sandbox
window.addEventListener('message', (event) => {
  const { type, results, error } = event.data;

  if (type === 'SANDBOX_READY') {
    sandboxReady = true;
    console.log('Sandbox ready');
  }

  if (type === 'MEDIAPIPE_READY') {
    mediapipeReady = true;
    console.log('MediaPipe ready');
    statusDiv.textContent = "MediaPipe loaded. Starting camera...";
    startVideoProcessing();
  }

  if (type === 'MEDIAPIPE_ERROR') {
    statusDiv.textContent = `MediaPipe error: ${error}`;
    console.error('MediaPipe error:', error);
  }

  if (type === 'MEDIAPIPE_RESULTS') {
    processingFrame = false;
    drawResults(results);
  }
});

// Detect gestures and trigger tab actions
function detectGestures(multiHandLandmarks, multiHandedness) {
  if (window.GestureRecorder?.isActive()) {
    stopContinuousScroll();
    return;
  }

  const now = Date.now();

  if (now < gestureCooldownUntil) {
    debouncer.reset();
    twoHandsFirstSeen = null;
    stopContinuousScroll();
    const sec = Math.ceil((gestureCooldownUntil - now) / 1000);
    statusDiv.textContent = `Cooldown ${sec}s — release your hand`;
    return;
  }

  // Two separated hands -> must be held for 5 seconds before closing the tab.
  // (A single hand misread as two overlapping detections won't qualify.)
  if (hasTwoSeparateHands(multiHandLandmarks)) {
    stopContinuousScroll();
    if (twoHandsFirstSeen === null) twoHandsFirstSeen = now;
    const heldMs = now - twoHandsFirstSeen;
    const remaining = Math.ceil((CLOSE_TAB_HOLD_MS - heldMs) / 1000);
    if (heldMs >= CLOSE_TAB_HOLD_MS) {
      twoHandsFirstSeen = null;
      statusDiv.textContent = "Closing tab!";
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const browserTab = tabs.find(tab =>
          !tab.url.startsWith('chrome-extension://') &&
          !tab.url.startsWith('chrome://') &&
          !tab.url.startsWith('edge://')
        );
        if (browserTab) chrome.tabs.remove(browserTab.id);
      });
    } else {
      statusDiv.textContent = `Both hands held - closing in ${remaining}s`;
    }
    return;
  }

  // Reset the hold timer if we no longer see two separate hands.
  twoHandsFirstSeen = null;

  // One hand -> custom gestures (from server) first, then hardcoded built-ins.
  if (multiHandLandmarks.length >= 1) {
    const landmarks = multiHandLandmarks[0];
    const handedness = multiHandedness && multiHandedness[0]; // "Left"|"Right"|undefined
    lastRawLandmarks = landmarks; // dev hook: snapshot for window.dumpLandmarks()

    let match = null;
    // Custom gestures take priority - they're the user's explicit definitions.
    if (customTemplates.length) {
      const m = Matcher.matchGesture(landmarks, customTemplates, handedness);
      if (m) match = { name: m.name, action: m.action };
    }
    // Fall back to the built-in pointing gestures.
    if (!match) {
      const dir = detectPointing(landmarks);
      if (dir) match = { name: dir, action: dir === "point_up" ? "scroll_up" : "scroll_down" };
    }

    if (match && isScrollAction(match.action)) {
      scrollMatchStreak++;
      if (scrollMatchStreak >= SCROLL_START_FRAMES) {
        startContinuousScroll(match.action);
        statusDiv.textContent = `${match.name}: ${match.action}`;
      }
      debouncer.reset();
    } else {
      scrollMatchStreak = 0;
      stopContinuousScroll();
      const fired = debouncer.update(match, now);
      if (fired) {
        statusDiv.textContent = `${fired.name}: ${fired.action}`;
        runAction(fired.action);
      }
    }
  } else {
    debouncer.reset();
    stopContinuousScroll();
  }
}

// Draw hand landmarks
function drawResults(results) {
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    for (const landmarks of results.multiHandLandmarks) {
      // Draw landmarks
      canvasCtx.fillStyle = '#FF0000';
      for (const landmark of landmarks) {
        const x = landmark.x * canvas.width;
        const y = landmark.y * canvas.height;
        canvasCtx.beginPath();
        canvasCtx.arc(x, y, 5, 0, 2 * Math.PI);
        canvasCtx.fill();
      }

      // Draw connections
      const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4],
        [0, 5], [5, 6], [6, 7], [7, 8],
        [5, 9], [9, 10], [10, 11], [11, 12],
        [9, 13], [13, 14], [14, 15], [15, 16],
        [13, 17], [17, 18], [18, 19], [19, 20],
        [0, 17]
      ];

      canvasCtx.strokeStyle = '#00FF00';
      canvasCtx.lineWidth = 3;
      for (const [start, end] of connections) {
        const startPoint = landmarks[start];
        const endPoint = landmarks[end];
        canvasCtx.beginPath();
        canvasCtx.moveTo(startPoint.x * canvas.width, startPoint.y * canvas.height);
        canvasCtx.lineTo(endPoint.x * canvas.width, endPoint.y * canvas.height);
        canvasCtx.stroke();
      }
    }

    detectGestures(results.multiHandLandmarks, results.multiHandedness);

    if (window.GestureRecorder?.isActive() && results.multiHandLandmarks.length >= 1) {
      window.GestureRecorder.pushFrame(
        results.multiHandLandmarks[0],
        results.multiHandedness && results.multiHandedness[0]
      );
    }
  } else if (!window.GestureRecorder?.isActive()) {
    stopContinuousScroll();
    statusDiv.textContent = "No hands detected";
  }
}

// Process video frames
function processVideoFrame() {
  if (!stream || !mediapipeReady || processingFrame) {
    if (stream) requestAnimationFrame(processVideoFrame);
    return;
  }

  processingFrame = true;

  // Capture frame from video
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = video.videoWidth;
  tempCanvas.height = video.videoHeight;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(video, 0, 0);
  const imageData = tempCanvas.toDataURL('image/jpeg', 0.8);

  // Send to sandbox for processing
  sandbox.contentWindow.postMessage({
    type: 'PROCESS_FRAME',
    data: { imageData }
  }, '*');

  requestAnimationFrame(processVideoFrame);
}

function startVideoProcessing() {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  statusDiv.textContent = "Camera active. Show your hands!";
  processVideoFrame();
}

// Activate Camera button
activateButton.addEventListener("click", async () => {
  try {
    statusDiv.textContent = "Initializing...";

    // Get camera stream
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 }
      }
    });

    video.srcObject = stream;
    activateButton.style.display = "none";
    stopButton.classList.add("active");

    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });

    // Wait for sandbox and initialize MediaPipe
    if (!sandboxReady) {
      statusDiv.textContent = "Waiting for sandbox...";
      await new Promise(resolve => {
        const check = setInterval(() => {
          if (sandboxReady) {
            clearInterval(check);
            resolve();
          }
        }, 100);
      });
    }

    statusDiv.textContent = "Loading MediaPipe...";
    sandbox.contentWindow.postMessage({ type: 'INIT_MEDIAPIPE' }, '*');

  } catch (error) {
    statusDiv.textContent = `Error: ${error.name} - ${error.message}`;
    console.error("Camera access error:", error.name, error.message);
  }
});

// Stop Camera button
stopButton.addEventListener("click", () => {
  stopContinuousScroll();
  if (window.GestureRecorder?.isActive()) {
    window.GestureRecorder.cancel();
    document.getElementById("countdownOverlay").hidden = true;
  }
  if (sandbox && mediapipeReady) {
    sandbox.contentWindow.postMessage({ type: 'STOP' }, '*');
  }
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  video.srcObject = null;
  activateButton.style.display = "block";
  stopButton.classList.remove("active");
  statusDiv.textContent = "Camera stopped. Click to start again.";
  mediapipeReady = false;
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
});

window.GestureUI.init();
