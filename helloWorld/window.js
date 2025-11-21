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

// Helper to run code in the active tab
function runInActiveTab(code) {
  chrome.tabs.query({ active: true }, (tabs) => {
    const browserTab = tabs.find(tab =>
      !tab.url.startsWith('chrome-extension://') &&
      !tab.url.startsWith('chrome://') &&
      tab.active
    );

    if (browserTab) {
      chrome.scripting.executeScript({
        target: { tabId: browserTab.id },
        func: code
      }).catch(err => {
        statusDiv.textContent = `Error: ${err.message}`;
      });
    } else {
      statusDiv.textContent = "No browser tab found to control";
    }
  });
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

    statusDiv.textContent = `Hand detected: ${results.multiHandLandmarks.length} hand(s)`;
  } else {
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
    statusDiv.textContent = `Error: ${error.message}`;
    console.error("Camera access error:", error);
  }
});

// Stop Camera button
stopButton.addEventListener("click", () => {
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

// Scroll Up
document.getElementById("scrollUp").addEventListener("click", () => {
  runInActiveTab(() => window.scrollBy(0, -500));
});

// Scroll Down
document.getElementById("scrollDown").addEventListener("click", () => {
  runInActiveTab(() => window.scrollBy(0, 500));
});
