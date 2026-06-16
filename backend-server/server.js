const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const mongoose = require('mongoose');
const cors = require('cors');
const { parse } = require('url');

const app = express();
app.use(express.json());
app.use(cors());

mongoose.connect('mongodb://localhost:27017/gestures')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Each gesture stores its 21-landmark template alongside the action it triggers
const gestureSchema = new mongoose.Schema({
  name:      { type: String, required: true, unique: true },
  landmarks: { type: [[Number]], required: true }, // 21 x [x, y, z]
  action:    { type: String, required: true },      // e.g. "scroll_down", "close_tab"
});
const Gesture = mongoose.model('Gesture', gestureSchema);

const server = http.createServer(app);

const trackingWss  = new WebSocketServer({ noServer: true });
const extensionWss = new WebSocketServer({ noServer: true });

// Route WebSocket upgrade requests to the correct server by path
server.on('upgrade', (request, socket, head) => {
  const { pathname } = parse(request.url);

  if (pathname === '/ws/tracking') {
    trackingWss.handleUpgrade(request, socket, head, (ws) => {
      trackingWss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/extension') {
    extensionWss.handleUpgrade(request, socket, head, (ws) => {
      extensionWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Single reference to the active extension socket
let extensionSocket = null;

extensionWss.on('connection', (ws) => {
  console.log('[extension] connected');
  extensionSocket = ws;

  ws.on('close', () => {
    console.log('[extension] disconnected');
    extensionSocket = null;
  });

  ws.on('error', (err) => console.error('[extension] error:', err));
});

// Placeholder gesture matching — replaced by MongoDB lookup in Phase 4
// Coordinates are normalised (0–1) relative to frame size; lower y = higher on screen
function matchGesture(landmarks) {
  if (!landmarks || landmarks.length < 21) return null;

  const wrist      = landmarks[0];
  const indexMCP   = landmarks[5];
  const indexTip   = landmarks[8];
  const middleTip  = landmarks[12];
  const ringTip    = landmarks[16];
  const pinkyTip   = landmarks[20];

  const fingerUp = (tip, base) => tip[1] < base[1];

  const indexExtended  = fingerUp(indexTip,  indexMCP);
  const middleExtended = fingerUp(middleTip, indexMCP);
  const ringExtended   = fingerUp(ringTip,   indexMCP);
  const pinkyExtended  = fingerUp(pinkyTip,  indexMCP);

  // All four fingers extended → scroll down
  if (indexExtended && middleExtended && ringExtended && pinkyExtended) {
    return 'scroll_down';
  }

  // Index finger only → scroll up
  if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return 'scroll_up';
  }

  return null;
}

function broadcastToExtension(payload) {
  if (extensionSocket && extensionSocket.readyState === extensionSocket.OPEN) {
    extensionSocket.send(JSON.stringify(payload));
    console.log('[tracking → extension]', payload);
  }
}

trackingWss.on('connection', (ws) => {
  console.log('[tracking] CV script connected');
  broadcastToExtension({ tracker: true });

  ws.on('message', (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      console.error('[tracking] invalid JSON, ignoring');
      return;
    }

    const { hand, landmarks } = payload;
    console.log(`[tracking] ${hand} hand — ${landmarks?.length} landmarks`);

    const action = matchGesture(landmarks);
    if (action) broadcastToExtension({ action });
  });

  ws.on('close', () => {
    console.log('[tracking] CV script disconnected');
    broadcastToExtension({ tracker: false });
  });
  ws.on('error', (err) => console.error('[tracking] error:', err));
});

// REST endpoints for Phase 4 gesture management
app.get('/gestures', async (req, res) => {
  try {
    res.json(await Gesture.find());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/gestures', async (req, res) => {
  try {
    const gesture = await Gesture.create(req.body);
    res.status(201).json(gesture);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/gestures/:name', async (req, res) => {
  try {
    await Gesture.deleteOne({ name: req.params.name });
    res.json({ message: 'deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

server.listen(8000, () => console.log('Server running on http://localhost:8000'));
