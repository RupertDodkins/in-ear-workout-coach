# In-Ear Workout Coach

Same-day OpenAI Voice Hack Night demo.

## What it does

- Connects a browser mic/speaker session to OpenAI Realtime over WebRTC.
- Opens a server-side sideband WebSocket to the same Realtime call for tools, state, and timer control.
- Keeps authoritative workout state on the server and mirrors it to `workout_session.json` and `workout_session.md`.
- Supports fallback text turns and canned quick-action buttons if live mic input is flaky.
- Handles one deterministic real-world replan: compressing the remaining workout when Rupert suddenly has less time.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY`.
3. Install dependencies:

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Open [http://localhost:3100](http://localhost:3100).
If port `3100` is already taken on your machine, set `PORT` in `.env`.

## Production-style run

```bash
npm run build
npm start
```

## Demo path

1. Click `Connect Live Voice`.
2. Say: `I'm ready for a quick workout.`
3. Complete the first set and say `Done`.
4. During rest, either talk normally or use the `Voice API?` quick-action fallback.
5. While resting, say `Actually, I only have 3 minutes now` to trigger the time-compression replan.
6. The coach skips the rest, shortens the remaining plan, and redirects back to work.
7. Use `Done, but my knee feels weird` on squats to trigger the plank fallback.

## Fallback path

- Use the text input or quick-action buttons if mic recognition is unreliable.
- The same server-side state machine and tool flow are used for fallback turns.

## Smoke test

```bash
npm run smoke
```

This runs the workout/timer/adaptation loop three times without hitting OpenAI.
