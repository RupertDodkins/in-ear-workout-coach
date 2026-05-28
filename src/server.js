import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { RealtimeWorkoutSessionManager } from "./session-manager.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const clientDir = path.join(rootDir, "client");
const clientDistDir = path.join(clientDir, "dist");
const jsonPath = path.join(rootDir, "workout_session.json");
const markdownPath = path.join(rootDir, "workout_session.md");
const landingPath = path.join(rootDir, "landing.html");

const port = Number(process.env.PORT || 3100);
const isDev = process.env.NODE_ENV !== "production";

const restSeconds = Number(process.env.REST_SECONDS || 30);
const manager = new RealtimeWorkoutSessionManager({
  apiKey: process.env.OPENAI_API_KEY || "",
  model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2",
  voice: process.env.OPENAI_VOICE || "marin",
  restSeconds,
  jsonPath,
  markdownPath,
  vadType: process.env.VAD_TYPE || "server_vad",
  vadThreshold: Number(process.env.VAD_THRESHOLD || 0.99),
  vadSilenceMs: Number(process.env.VAD_SILENCE_MS || 1500),
  vadPrefixMs: Number(process.env.VAD_PREFIX_MS || 400)
});

const app = express();
app.use(express.json());

function renderMissingClientHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Client Build Missing</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #15110f;
        color: #f8f3ef;
      }
      main {
        width: min(680px, calc(100vw - 32px));
        padding: 28px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
        box-shadow: 0 20px 80px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
      }
      p {
        margin: 0 0 14px;
        line-height: 1.5;
        color: rgba(248, 243, 239, 0.84);
      }
      pre {
        margin: 16px 0 0;
        padding: 14px 16px;
        border-radius: 14px;
        overflow-x: auto;
        background: rgba(0, 0, 0, 0.32);
        color: #ffd9bf;
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Client app not available at <code>/</code></h1>
      <p>The API server is running, but the React client bundle was not found.</p>
      <p><code>npm run probe</code> only verifies the Realtime tool loop. It does not launch the browser UI.</p>
      <p>Use one of these local run paths:</p>
      <pre><code>npm run dev

# or, for a production-style local run
npm run build
npm start</code></pre>
    </main>
  </body>
</html>`;
}

// --- API + artifact routes (registered before UI so they always win) ---

app.get("/share", (_req, res) => {
  res.sendFile(landingPath);
});

app.get("/workout_session.json", (_req, res) => {
  res.sendFile(jsonPath);
});

app.get("/workout_session.md", (_req, res) => {
  res.sendFile(markdownPath);
});

app.get("/api/state", (_req, res) => {
  res.json(manager.getState());
});

app.post("/api/client-event", (req, res) => {
  try {
    const type = String(req.body?.type || "").trim();
    const message = String(req.body?.message || "").trim();
    const data = req.body?.data ?? null;

    if (!type || !message) {
      res.status(400).json({ ok: false, error: "Missing type or message." });
      return;
    }

    manager.logClientEvent(type, message, data);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
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
  try { await manager.reset(); res.json({ ok: true }); }
  catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

app.post("/api/pause", async (_req, res) => {
  try { await manager.pauseVoice(); res.json({ ok: true }); }
  catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

app.post("/api/resume", async (_req, res) => {
  try { await manager.resumeVoice(); res.json({ ok: true }); }
  catch (error) { res.status(500).json({ ok: false, error: error.message }); }
});

app.post("/api/end", async (_req, res) => {
  try { await manager.endSession(); res.json({ ok: true }); }
  catch (error) { res.status(500).json({ ok: false, error: error.message }); }
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
    model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2",
    mode: isDev ? "dev" : "production"
  });
});

// --- UI: Vite middleware in dev (HMR, same port), static + SPA fallback in prod ---

if (isDev) {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    configFile: path.join(rootDir, "vite.config.js"),
    root: clientDir,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
  console.log("Vite middleware attached — HMR enabled");
} else if (existsSync(clientDistDir)) {
  app.use(express.static(clientDistDir));
  app.get(/^\/(?!api\/|session$|workout_session\.).*/, (_req, res) => {
    res.sendFile(path.join(clientDistDir, "index.html"));
  });
} else {
  console.warn(
    "[server] client/dist not found and NODE_ENV=production — run `npm run build` first."
  );
  app.get(/^\/(?!api\/|session$|workout_session\.).*/, (_req, res) => {
    res.status(503).type("html").send(renderMissingClientHtml());
  });
}

app.listen(port, () => {
  console.log(
    `In-Ear Workout Coach listening on http://localhost:${port} (${isDev ? "dev" : "production"})`
  );
});
