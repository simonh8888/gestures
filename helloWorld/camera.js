const video = document.getElementById("video");
const statusDiv = document.getElementById("status");
const stopButton = document.getElementById("stopCamera");

let stream = null;

// Initialize camera on page load
async function initCamera() {
  try {
    statusDiv.textContent = "Requesting camera access...";

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 }
      }
    });

    video.srcObject = stream;
    statusDiv.textContent = "Camera active. Ready for hand gesture recognition.";

    // TODO: Add hand gesture recognition logic here
    // You can integrate MediaPipe Hands or TensorFlow.js here

  } catch (error) {
    statusDiv.textContent = `Error: ${error.message}`;
    console.error("Camera access error:", error);

    if (error.name === "NotAllowedError") {
      statusDiv.textContent = "Camera permission denied. Please allow camera access and refresh the page.";
    } else if (error.name === "NotFoundError") {
      statusDiv.textContent = "No camera found on this device.";
    }
  }
}

// Stop camera and close window
stopButton.addEventListener("click", () => {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
  window.close();
});

// Start camera when page loads
initCamera();
