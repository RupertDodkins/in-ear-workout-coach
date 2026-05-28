export const PHASE_LABEL = {
  awaiting_start: "Awaiting start",
  active_set: "Active set",
  ready_for_rest: "Ready for rest",
  resting: "Resting",
  completed: "Completed",
};

export const COACH_EVENT_DOT = {
  started_rest_timer: "o",
  continued_contextual_banter: "a",
  redirected_after_timer: "b",
  adapted_for_discomfort: "p",
  compressed_for_time: "b",
  shortened_rest_for_time: "o",
};

export const QUICK_CHIPS = [
  { warm: true, text: "I'm ready", turn: "I'm ready for a quick workout." },
  { text: "Done.", turn: "Done." },
  { text: "Done, 20 reps", turn: "Done, 20 reps." },
  { text: "Voice API?", turn: "Yeah, give me a quick OpenAI voice API update." },
  { warm: true, text: "Only 3 minutes", turn: "Actually, I only have 3 minutes now." },
  { text: "Done, but my knee feels weird", turn: "Done, but my knee feels weird." },
  { text: "Done. Let's wrap it up.", turn: "Done. Let's wrap it up." },
];

export const RING_CIRCUMFERENCE = 2 * Math.PI * 72;
