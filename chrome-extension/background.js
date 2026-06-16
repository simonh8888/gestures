const SERVER_URL = 'ws://localhost:8000/ws/extension';
const RECONNECT_DELAY_MS = 3000;

let socket = null;

// Open the side panel when the extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// MV3 service workers are terminated after ~30s of inactivity.
// A periodic alarm wakes the worker and re-establishes the connection if it dropped.
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') connect();
});

function notifyPanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  socket = new WebSocket(SERVER_URL);

  socket.addEventListener('open', () => {
    console.log('[extension] Connected to server');
    notifyPanel({ type: 'connection', connected: true });
  });

  socket.addEventListener('message', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      console.error('[extension] Invalid JSON:', event.data);
      return;
    }
    notifyPanel({ type: 'gesture', action: payload.action });
    handleAction(payload.action);
  });

  socket.addEventListener('close', () => {
    console.log('[extension] Disconnected. Reconnecting in', RECONNECT_DELAY_MS, 'ms...');
    socket = null;
    notifyPanel({ type: 'connection', connected: false });
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  socket.addEventListener('error', () => {
    socket = null;
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs.find(
    (t) => !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://')
  );
}

async function handleAction(action) {
  console.log('[extension] Action received:', action);

  const tab = await getActiveTab();
  if (!tab) {
    console.warn('[extension] No actionable tab found');
    return;
  }

  switch (action) {
    case 'scroll_up':
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.scrollBy({ top: -300, behavior: 'smooth' }),
      });
      break;

    case 'scroll_down':
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.scrollBy({ top: 300, behavior: 'smooth' }),
      });
      break;

    case 'close_tab':
      await chrome.tabs.remove(tab.id);
      break;

    default:
      console.warn('[extension] Unknown action:', action);
  }
}

connect();
