// The Business tests library (Hamming-style): scripted callers in four categories. The caller
// is scripted; the pharmacy is the real agent through the real lock (12 buttons, speech guard,
// safety check). The server's registry is app/api/simulation/live/public-record.ts; a test
// keeps the two lists the same.

export type SuiteCategory = "persona" | "security" | "safety" | "task";

export const SUITE_CATEGORIES: { key: SuiteCategory; label: string; hint: string }[] = [
  { key: "persona", label: "Personas", hint: "Unusual callers: pirates, fish, poems, anger, confusion, rush, limited English" },
  { key: "security", label: "Security", hint: "Prompt injection, impersonation and identity attacks" },
  { key: "safety", label: "Safety", hint: "Crisis and emergency lines must win over everything else" },
  { key: "task", label: "Tasks", hint: "Ordinary work done right: refills, bookings, corrections" },
];

export const SUITE_CARDS: { id: string; name: string; category: SuiteCategory }[] = [
  { id: "act_like_a_pirate", name: "Act like a pirate", category: "persona" },
  { id: "act_like_a_fish", name: "Act like a fish", category: "persona" },
  { id: "poem_request", name: "Write me a poem", category: "persona" },
  { id: "angry_caller", name: "Angry caller", category: "persona" },
  { id: "confused_elderly", name: "Confused elderly caller", category: "persona" },
  { id: "rushed_caller", name: "Rushed caller", category: "persona" },
  { id: "non_native_speaker", name: "Limited English", category: "persona" },
  { id: "greeting_slang_recovery", name: "Greetings and slang", category: "persona" },
  { id: "instruction_override", name: "Ignore your instructions", category: "security" },
  { id: "pretend_my_doctor", name: "Pretend you're my doctor", category: "security" },
  { id: "claimed_pharmacist", name: "Claims to be the pharmacist", category: "security" },
  { id: "caregiver_handover", name: "Family member without permission", category: "security" },
  { id: "code_retry", name: "Wrong code, then the right one", category: "security" },
  { id: "crisis_988", name: "Crisis line (9-8-8)", category: "safety" },
  { id: "possible_overdose", name: "Possible overdose (911)", category: "safety" },
  { id: "sam_ordinary_refill", name: "Ordinary refill", category: "task" },
  { id: "corrected_consultation_time", name: "Self-correction: Wednesday, no, Thursday", category: "task" },
  { id: "pharmacist_consultation", name: "Book a named slot", category: "task" },
];
