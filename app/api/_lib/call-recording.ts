import type { RecordEntry } from "@/lib/contract";

// Stored in the staff-only record so the association survives restarts and is cleared with the record on demo reset.
export function recordedConversation(entries: RecordEntry[]): string | undefined {
  for (const entry of entries) {
    if (entry.kind !== "safety" || entry.actor !== "system") continue;
    const check = (entry.input as { check?: unknown } | undefined)?.check;
    if (check !== "voice_conversation") continue;
    const id = (entry.output as { internal?: { conversationId?: unknown } } | undefined)?.internal?.conversationId;
    if (typeof id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(id)) return id;
  }
}
