// Trail #70: which assistant is answering a presenter call, and who it's calling for.
export type Assistant = "agent" | "fallback" | "menu";
export type DemoPatient = { name: string; dob: string };

const LABEL: Record<Assistant, string> = {
  agent: "AI agent (Claude), every word and action through the lock",
  fallback: "Scripted menu (fallback: the AI agent was unavailable)",
  menu: "Scripted menu",
};

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });

export function AssistantLine({ assistant, patient }: { assistant?: Assistant; patient?: DemoPatient }) {
  if (!assistant) return null;
  return (
    <>
      <p className="presenter-assistant">
        Assistant: <b>{LABEL[assistant]}</b>
      </p>
      {patient && (
        <p className="presenter-patient">
          Playing <b>{patient.name}</b>, a fictional patient. Born <b>{day(patient.dob)}</b>.
        </p>
      )}
    </>
  );
}
