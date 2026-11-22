// Client-visible labels only. Caller scripts and seed records stay on the server.
export const demoScenarios = [
  { id: "greeting_slang_recovery", name: "Greetings and slang" },
  { id: "sam_ordinary_refill", name: "Ordinary refill" },
  { id: "corrected_consultation_time", name: "Corrected appointment time" },
  { id: "family_callback", name: "Family member callback and privacy" },
  { id: "copay", name: "Insurance copay inquiry" },
  { id: "one_week_supply", name: "Seven-day refill and price" },
] as const;

export type DemoScenarioId = typeof demoScenarios[number]["id"];
