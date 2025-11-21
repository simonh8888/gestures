const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const app = express();

// Middleware
app.use(express.json()); // Allows us to read JSON data
app.use(cors());         // Allows your HTML file to talk to this server

// 1. Connect to MongoDB (it will create a DB named 'robotics' if it doesn't exist)
mongoose.connect('mongodb://localhost:27017/robotics')
  .then(() => console.log('Connected to MongoDB!'))
  .catch(err => console.error('Could not connect:', err));

// 2. Define the Schema (The shape of your data)
const poseSchema = new mongoose.Schema({
    name: String,
    x: Number,
    y: Number,
    z: Number
});
const Pose = mongoose.model('Pose', poseSchema); // This creates the "poses" collection

// 3. The Save Route
app.post('/save-pose', async (req, res) => {
    try {
        const newPose = new Pose(req.body);
        await newPose.save();
        console.log('Saved:', req.body);
        res.json({ message: "Success!" });
    } catch (error) {
        res.status(500).json({ error: "Failed to save" });
    }
});

// Serve the HTML file when you visit the home page
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Start Server
app.listen(3000, () => console.log('Server running on port 3000'));