# Verve In-Ear Workout Coach Demo Script

## Core Message

Most voice agents talk. Verve's in-ear workout coach keeps executing while you're moving:

- it tracks structured workout state
- it runs real tools in the background
- it adapts when the world changes
- it brings you back on task without needing a screen

## Recommended Video Length

Aim for `3:30` to `4:30`. Do not use all 5 minutes unless the pacing truly needs it.

## Demo Setup

- Open `http://localhost:3100`
- Keep these panels visible:
  - `Live Status`
  - `Structured Workout State`
  - `Tool and Timer Events`
  - `Final Summary Payload`
- Use live voice if it is clean on the recording machine.
- If live voice is unreliable, use the fallback buttons and manual text field without apologizing for it.

## 5-Minute Submission Script

### 1. Opening Framing

Say:

> Most voice agents talk. This one keeps executing while you're moving.
>
> This is Verve In-Ear Workout Coach, a realtime voice health agent for busy professionals. It guides a workout, logs structured state, runs a real rest timer in the background, and adapts when constraints change.

### 2. Start The Session

Action:

- Click `Connect Live Voice`

Say:

> I'm ready for a quick workout.

Expected agent behavior:

- Starts the workout
- Tells you to do `20 push-ups`

Narrate briefly while the UI is visible:

> The server owns the workout state, so the agent doesn't lose the active step.

### 3. Complete First Set

Action:

- Do a few visible push-ups, or mime the end of the set clearly on camera

Say:

> Done.

Expected agent behavior:

- Calls `log_set`
- Calls `start_rest_timer`
- Starts a `30-second` rest
- Offers one short OpenAI voice API line

Narrate:

> That wasn't just conversation. The set was logged into structured workout state, and the timer is a real tool call running outside the model.

### 4. Show The Real-World Constraint

While rest is active, say:

> Actually, I only have 3 minutes now.

Expected agent behavior:

- Calls `compress_remaining_workout`
- Skips the remaining rest
- Shortens the remaining workout
- Redirects you immediately into `20 squats`

Narrate:

> This is the important moment. The world changed mid-session, and the agent replanned the remaining workout instead of just chatting.

### 5. Show Safety Adaptation

Action:

- Do a few visible squats, or mime completion clearly

Say:

> Done with the squats, but my knee feels weird.

Expected agent behavior:

- Calls `log_set`
- Calls `update_plan`
- Swaps the next move to `plank`

Narrate:

> It logs the completed work first, then safely adapts the next step.

### 6. Finish

Say:

> Done with the plank.

Expected agent behavior:

- Completes the workout
- Speaks a concise summary
- Prints the final structured payload

Narrate over the final payload:

> The output is now structured product data: completed sets, plan adjustments, safety adaptations, and export targets for systems like Heavy, Strava, or Apple Health.

### 7. Close

Say:

> Verve isn't just building a voice chatbot. We're building an in-ear execution layer for health behaviors that works while you're actually in motion.

## Exact Demo Turns

Use these exact lines for maximum reliability:

1. `I'm ready for a quick workout.`
2. `Done.`
3. `Actually, I only have 3 minutes now.`
4. `Done with the squats, but my knee feels weird.`
5. `Done with the plank.`

## Live Stage Version

If you pass and need to do this live, shorten the framing and keep the same flow.

### Stage Script

Say:

> Most voice agents talk. This one keeps executing while you're moving.
>
> I'm ready for a quick workout.

Then run the same turn sequence:

1. `Done.`
2. `Actually, I only have 3 minutes now.`
3. `Done with the squats, but my knee feels weird.`
4. `Done with the plank.`

Stage narration should be minimal:

- `The timer is a real background tool call.`
- `Now the agent is replanning because time changed.`
- `Now it's adapting safely to discomfort.`
- `And this final packet is structured product data, not just a transcript.`

## Fallback Plan

If live voice is flaky during recording or on stage:

- Use the quick-action buttons for:
  - `Ready`
  - `Done`
  - `Only 3 minutes`
  - `Knee discomfort`
- Use the manual text field for `Done with the plank.`

Do not explain the fallback unless asked. The important thing is demonstrating:

- state ownership
- background timer tools
- replanning
- adaptation
- structured output

## What To Keep On Screen

Prioritize these visuals:

- `Live Status`
- `Structured Workout State`
- `Tool and Timer Events`
- `Final Summary Payload`

Do not spend much time on:

- raw transcript details
- markdown artifact view
- browser chrome

## One-Line Submission Description

Verve In-Ear Workout Coach is a realtime OpenAI voice agent that guides a workout, logs structured state, runs non-blocking timer tools, replans when time changes, adapts to discomfort, and returns the user to the task without needing a screen.
