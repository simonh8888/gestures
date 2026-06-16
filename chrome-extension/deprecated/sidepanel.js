const serverDot     = document.getElementById('server-dot');
const serverStatus  = document.getElementById('server-status');
const trackerDot    = document.getElementById('tracker-dot');
const trackerStatus = document.getElementById('tracker-status');
const gestureLabel  = document.getElementById('gesture-label');
const gestureHint   = document.getElementById('gesture-hint');

let gestureTimer = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'connection') {
    const connected = message.connected;
    serverDot.className      = `dot ${connected ? 'connected' : 'disconnected'}`;
    serverStatus.textContent = connected ? 'Server connected' : 'Server disconnected';
  }

  if (message.type === 'tracker') {
    const active = message.active;
    trackerDot.className      = `dot ${active ? 'connected' : 'disconnected'}`;
    trackerStatus.textContent = active ? 'Tracker active' : 'Tracker not connected';
  }

  if (message.type === 'gesture') {
    const label = message.action.replace(/_/g, ' ');
    gestureLabel.textContent = label;
    gestureLabel.classList.remove('hidden');
    gestureHint.textContent = 'Gesture detected';

    clearTimeout(gestureTimer);
    gestureTimer = setTimeout(() => {
      gestureLabel.classList.add('hidden');
      gestureHint.textContent = 'No gesture detected';
    }, 1500);
  }
});
