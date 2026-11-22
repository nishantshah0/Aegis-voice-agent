import { first, nextFlow, type Flow } from "../phone/flow";

const choices: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3", four: "4" };

export function advance(sessionId: string, previous: Flow, text: string) {
  const said = text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .trim();
  const digits = /^[0-4]$/.test(said) ? said : Object.hasOwn(choices, said) ? choices[said] : "";
  if (/^(?:bye|goodbye|stop|finish|end (?:the )?call|hang up)$/.test(said)) {
    return { ...previous, phase: "end" as const, reply: "Thanks for trying the Aegis demo. Goodbye." };
  }
  const another =
    previous.phase === "appointment" &&
    /^(?:another time|a different time|another appointment)(?: please)?$/.test(said);
  return nextFlow(sessionId, previous, previous.phase === "pin" ? "" : another ? "3" : digits, text);
}

const options =
  "You can ask about the last fill, the seven-day price, a refill, or a pharmacist appointment.";

// Store the original reducer reply intact so its appointment consent check sees the exact offer.
// Adapt only fixed handset navigation for the browser display and its spoken playback.
export function browserReply(flow: Flow) {
  if (flow.reply === first.reply)
    return "Hi, this is Aegis Pharmacy. We're using a fictional patient record. Please say or type the six-digit demo code shown on your screen.";
  if (flow.phase === "pin")
    return "That code didn't match. Please say or type the six digits shown on your screen.";
  if (flow.phase === "confirm")
    return "Would you like to request a seven-day demo refill? Please say yes or no.";
  if (flow.phase === "appointment") {
    return flow.reply.replace(
      /^Say yes or press one to book, two to decline, or three for another time\. /,
      "",
    );
  }
  const menuAt = flow.reply.indexOf("For last fill, press one or say history.");
  if (menuAt < 0) return flow.reply;
  const answer = flow.reply.slice(0, menuAt).trim();
  return answer === "You're in the fictional record." ||
    answer === "This demo can help with the sample prescription."
    ? answer + " " + options
    : answer;
}
