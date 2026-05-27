import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { RealtimeWorkoutSessionManager } from "./session-manager.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const jsonPath = path.join(rootDir, "workout_session.json");
const markdownPath = path.join(rootDir, "workout_session.md");

const port = Number(process.env.PORT || 3100);
const restSeconds = Number(process.env.REST_SECONDS || 30);
const manager = new RealtimeWorkoutSessionManager({
  apiKey: process.env.OPENAI_API_KEY || "",
  model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2",
  voice: process.env.OPENAI_VOICE || "marin",
  restSeconds,
  jsonPath,
  markdownPath,
  vadType: process.env.VAD_TYPE || "server_vad",
  vadThreshold: Number(process.env.VAD_THRESHOLD || 0.65),
  vadSilenceMs: Number(process.env.VAD_SILENCE_MS || 450),
  vadPrefixMs: Number(process.env.VAD_PREFIX_MS || 250)
});

const app = express();
app.use(express.json());
app.use(express.static(publicDir));

app.get("/workout_session.json", (_req, res) => {
  res.sendFile(jsonPath);
});

app.get("/workout_session.md", (_req, res) => {
  res.sendFile(markdownPath);
});

app.get("/api/state", (_req, res) => {
  res.json(manager.getState());
});

app.post(
  "/session",
  express.text({ type: ["application/sdp", "text/plain"] }),
  async (req, res) => {
    try {
      if (typeof req.body !== "string" || req.body.trim() === "") {
        res.status(400).send("Expected SDP offer body.");
        return;
      }

      const { answerSdp } = await manager.createWebRtcSession(req.body);
      res.type("application/sdp").send(answerSdp);
    } catch (error) {
      res.status(500).send(error.message);
    }
  }
);

app.post("/api/reset", async (_req, res) => {
  try {
    await manager.reset();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/fallback-turn", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    if (!text) {
      res.status(400).json({ ok: false, error: "Missing text turn." });
      return;
    }

    await manager.sendFallbackTextTurn(text);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    port,
    has_openai_key: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2"
  });
});

app.listen(port, () => {
  console.log(`Verve In-Ear Workout Coach listening on http://localhost:${port}`);
});
