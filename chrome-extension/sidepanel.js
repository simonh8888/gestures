const video        = document.getElementById('video');
const serverDot    = document.getElementById('server-dot');
const serverStatus = document.getElementById('server-status');
const overlay      = document.getElementById('gesture-overlay');

let gestureTimer = null;

// Camera preview — display only, no ML processing
navigator.mediaDevices
  .getUserMedia({ video: { facingMode: 'user', width: 320 }, audio: false })
  .then((stream) => { video.srcObject = stream; })
  .catch(() => { /* camera unavailable — panel still works for status */ });

// Listen for messages from background.js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'connection') {
    const connected = message.connected;
    serverDot.className   = `dot ${connected ? 'connected' : 'disconnected'}`;
    serverStatus.textContent = connected ? 'Server connected' : 'Server disconnected';
  }

  if (message.type === 'gesture') {
    overlay.textContent = message.action.replace(/_/g, ' ');
    overlay.classList.add('visible');
    clearTimeout(gestureTimer);
    gestureTimer = setTimeout(() => overlay.classList.remove('visible'), 1000);
  }
});
