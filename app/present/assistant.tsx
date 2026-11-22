// Trail #70: which assistant is answering a presenter call, and who it's calling for.
export type Assistant = "agent" | "fallback" | "menu";
export type DemoPatient = { name: string; dob: string; rxNumber?: string };

const LABEL: Record<Assistant, string> = {
  agent: "AI agent (Claude), every word and action through the lock",
  fallback: "Scripted menu (fallback: the AI agent was unavailable)",
  menu: "Scripted menu",
};

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });

export function AssistantLine({ assistant, patient, notice }: { assistant?: Assistant; patient?: DemoPatient; notice?: string }) {
  if (!assistant) return null;
  return (
    <>
      <p className="presenter-assistant">
        Assistant: <b>{LABEL[assistant]}</b>
      </p>
      {notice && <p className="presenter-notice">{notice}</p>}
      {patient && (
        <p className="presenter-patient">
          Playing <b>{patient.name}</b>, a fictional patient. Born <b>{day(patient.dob)}</b>
          {patient.rxNumber && (
            <>
              , prescription number <b>{patient.rxNumber}</b>. Tell the pharmacy your name, date of birth and prescription number, then read back the code when it appears
            </>
          )}
          .
        </p>
      )}
    </>
  );
}
