// The models that may play the attacking caller (task 3.7g). The attacker only writes caller
// text; the lock (checkCallerLine, the 12 buttons, guardSentence) judges whatever it says, so
// a second model family tests the lock against blind spots the first one shares with the agent.

export const ATTACKER_MODELS = {
  "claude-haiku-5-5": "claude",
  "gemini-2.5-flash": "gemini",
} as const;

export type AttackerModel = keyof typeof ATTACKER_MODELS;
export type AttackerFamily = (typeof ATTACKER_MODELS)[AttackerModel];

export const DEFAULT_ATTACKER_MODEL: AttackerModel = "claude-haiku-5-5";
export const GEMINI_ATTACKER_MODEL: AttackerModel = "gemini-2.5-flash";

const BY_FAMILY: Record<AttackerFamily, AttackerModel> = { claude: DEFAULT_ATTACKER_MODEL, gemini: GEMINI_ATTACKER_MODEL };

/** A model id, or a family name for its default model; undefined is the default. Anything else is null. */
export function parseAttackerModel(value: unknown): AttackerModel | null {
  if (value === undefined) return DEFAULT_ATTACKER_MODEL;
  if (typeof value !== "string") return null;
  if (value in ATTACKER_MODELS) return value as AttackerModel;
  if (value in BY_FAMILY) return BY_FAMILY[value as AttackerFamily];
  return null;
}

export const attackerFamily = (model: AttackerModel): AttackerFamily => ATTACKER_MODELS[model];

export const ATTACKER_MODEL_CHOICES = `${Object.keys(ATTACKER_MODELS).join(" or ")} (or claude / gemini)`;
