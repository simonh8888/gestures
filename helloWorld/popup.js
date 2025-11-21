const video = document.getElementById("video");
const statusDiv = document.getElementById("status");
const activateButton = document.getElementById("activateCamera");
const stopButton = document.getElementById("stopCamera");

let stream = null;

// Helper to run code in the active tab
function runInActiveTab(code) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: code
      });
    }
  });
}

// Activate Camera button
activateButton.addEventListener("click", async () => {
  try {
    statusDiv.textContent = "Requesting camera access...";

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 400 },
        height: { ideal: 300 }
      }
    });

    video.srcObject = stream;
    video.classList.add("active");
    activateButton.style.display = "none";
    stopButton.classList.add("active");
    statusDiv.textContent = "Camera active. Ready for gestures.";

  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    console.error("Camera access error:", error);
  }
});

// Stop Camera button
stopButton.addEventListener("click", () => {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  video.srcObject = null;
  video.classList.remove("active");
  activateButton.style.display = "block";
  stopButton.classList.remove("active");
  statusDiv.textContent = "Camera stopped. Click to start again.";
});

// Scroll Up
document.getElementById("scrollUp").addEventListener("click", () => {
  runInActiveTab(() => window.scrollBy(0, -500));
});

// Scroll Down
document.getElementById("scrollDown").addEventListener("click", () => {
  runInActiveTab(() => window.scrollBy(0, 500));
});
