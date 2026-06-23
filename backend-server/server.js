const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Config from the environment so the same image runs locally, in Docker, and in
// k8s without code changes. `localhost` defaults keep `node server.js` working
// out of the box; containers inject MONGO_URI (Mongo is a separate host there)
// and PORT via env vars / ConfigMap / Secret.
const PORT = process.env.PORT || 8000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/gestures';

const app = express();
app.use(express.json());
app.use(cors());

mongoose.connect(MONGO_URI)
  .then(() => { console.log('Connected to MongoDB'); seedDefaults(); })
  .catch(err => console.error('MongoDB connection error:', err));

// The actions a gesture may trigger. This is the "registry": users assign a
// gesture one of these from a menu - they don't author actions (an action is
// code that runs in the extension's runAction dispatcher). Grow this list (and
// the dispatcher) to add new verbs. The schema validates `action` against it.
const ACTIONS = [
  'scroll_up', 'scroll_down',
  'new_tab', 'close_tab', 'next_tab', 'prev_tab',
  'back', 'forward', 'refresh',
  'zoom_in', 'zoom_out',
];

// A gesture stores RAW landmarks (not normalized) + the hand that made them, so
// normalization (incl. handedness mirroring) can be re-applied on load even if
// the matching algorithm changes later. See PLAN.md "Data model".
const gestureSchema = new mongoose.Schema({
  // owner: placeholder for multi-user. Defaults to "local" (single-user) now; when
  // auth lands it becomes the user's id and queries get scoped by it. Designing it
  // in now avoids a later migration of every document + every query (see PLAN.md).
  owner:      { type: String, required: true, default: 'local' },
  name:       { type: String, required: true },
  type:       { type: String, enum: ['static', 'motion'], default: 'static' },
  action:     { type: String, required: true, enum: ACTIONS },
  landmarks:  { type: [[Number]], required: true },     // static: 21 x [x, y, z] (raw)
  frames:     { type: [[[Number]]], default: null },    // motion: sequence of frames (reserved)
  handedness: { type: String, enum: ['Left', 'Right'], required: true },
  threshold:  { type: Number, default: 1.7 },           // per-gesture match tolerance
});
// Name is unique PER OWNER, not globally - so two users can each have "ok sign".
gestureSchema.index({ owner: 1, name: 1 }, { unique: true });
const Gesture = mongoose.model('Gesture', gestureSchema);

// Insert default gestures the first time the DB is empty (idempotent: does
// nothing if any gestures already exist). Defaults live in seeds/ under git so
// a fresh clone/DB starts with working, proven gestures.
async function seedDefaults() {
  try {
    if (await Gesture.estimatedDocumentCount() > 0) return;
    const seedPath = path.join(__dirname, 'seeds', 'defaultGestures.json');
    const defaults = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    await Gesture.insertMany(defaults);
    console.log(`Seeded ${defaults.length} default gestures`);
  } catch (err) {
    console.error('Seeding error:', err.message);
  }
}

// Health check - a cheap endpoint for container/k8s readiness & liveness probes.
app.get('/health', (req, res) => {
  const dbUp = mongoose.connection.readyState === 1; // 1 = connected
  res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'db_down' });
});

// REST endpoints for gesture management
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

app.put('/gestures/:name', async (req, res) => {
  try {
    const updated = await Gesture.findOneAndUpdate(
      { name: req.params.name },
      req.body,
      { new: true, runValidators: true } // return the updated doc; enforce schema/enum
    );
    if (!updated) return res.status(404).json({ error: 'gesture not found' });
    res.json(updated);
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

// Expose the action registry so the extension's recording UI can populate its
// dropdown from the server (single source of truth for valid actions).
app.get('/actions', (req, res) => res.json(ACTIONS));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
