const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // serves index.html from /public folder

// ── Rate limit tracker (per IP, free tier safe) ─────────────────────────────
const ipLogs = new Map();
const MAX_RPM = 12; // under Gemini free tier of 15 RPM

function checkRateLimit(ip) {
  const now = Date.now();
  const log = (ipLogs.get(ip) || []).filter(t => now - t < 60000);
  if (log.length >= MAX_RPM) {
    const wait = Math.ceil((60000 - (now - log[0])) / 1000);
    return { blocked: true, wait };
  }
  log.push(now);
  ipLogs.set(ip, log);
  return { blocked: false };
}

// ── Gemini proxy endpoint ────────────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const limit = checkRateLimit(ip);

  if (limit.blocked) {
    return res.status(429).json({ error: `Rate limit hit. Wait ${limit.wait}s.` });
  }

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt provided.' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server API key not configured.' });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const systemInstruction =
    "You are nafiul204ai, an expert game developer. " +
    "Generate a fully complete, self-contained single-file HTML/CSS/JS game. " +
    "Make it dark/cyberpunk themed with canvas or DOM controls (keyboard + mouse). " +
    "Include: a live score, lives/health, game over screen, and a Restart button. " +
    "No external image URLs or audio. Return ONLY the raw HTML inside ```html ... ``` tags.";

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err?.error?.message || `HTTP ${response.status}` });
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.json({ raw: rawText });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ nafiul204ai running on http://localhost:${PORT}`))