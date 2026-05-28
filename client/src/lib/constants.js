export const PHASE_ORDER = [
  "awaiting_start",
  "active_set",
  "ready_for_rest",
  "resting",
  "completed",
];

export const PHASE_LABEL = {
  awaiting_start: "awaiting_start",
  active_set: "active_set",
  ready_for_rest: "ready_for_rest",
  resting: "resting",
  completed: "completed",
};

export const COACH_EVENT_DOT = {
  started_rest_timer: "o",
  continued_contextual_banter: "a",
  redirected_after_timer: "b",
  adapted_for_discomfort: "p",
};

export const QUICK_CHIPS = [
  { warm: true, text: "I'm ready", turn: "I'm ready for a quick workout." },
  { text: "Done.", turn: "Done." },
  { text: "Done, 20 reps", turn: "Done, 20 reps." },
  { text: "Quick SpaceX update?", turn: "Yeah, give me a quick SpaceX launch update." },
  { text: "Done, but my knee feels weird", turn: "Done, but my knee feels weird." },
  { text: "Done. Let's wrap it up.", turn: "Done. Let's wrap it up." },
];

export const RING_CIRCUMFERENCE = 2 * Math.PI * 72;
