import { connection } from "next/server";
import { AUTH_ROUTES } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";
import { Badge, Card, Eyebrow, LaneBadge, RuleTag, cn } from "@/components/ui";
import { getStore } from "@/app/api/_lib/runtime";
import { CallNow } from "./CallNow";
import { upcoming, type UpcomingRow } from "./upcoming";

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "short", timeZone: "UTC" });
const short = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });

function DaysLeft({ left }: { left: number }) {
  if (left < 0) return <Badge tone="stop">{-left} days late</Badge>;
  if (left === 0) return <Badge tone="review">runs out today</Badge>;
  return <span className="tabular-nums">{left} days</span>;
}

function Preview({ row }: { row: UpcomingRow }) {
  if (row.preview.kind === "refused") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge tone="stop" dot>
          Refused
        </Badge>
        {row.preview.ruleIds.map((id) => (
          <RuleTag key={id}>{id}</RuleTag>
        ))}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <LaneBadge lane={row.preview.lane} />
      {row.preview.ruleIds.map((id) => (
        <RuleTag key={id}>{id}</RuleTag>
      ))}
    </span>
  );
}

// 2.9a. Signed out: a sign-in prompt only, no patient detail (as on Today, Trail #10).
export async function Upcoming() {
  await connection(); // Live data: never prerender.
  const approver = await getApprover();
  if (!approver) {
    return (
      <Card className="mt-6 text-sm text-ink-2">
        <a href={AUTH_ROUTES.login} className="font-medium text-accent underline">
          Sign in
        </a>{" "}
        as a pharmacist or reviewer to see upcoming refills.
      </Card>
    );
  }
  const canCall = approver.role === "pharmacist" || process.env.DEMO_CONTROLS === "on";
  const { rows, days } = await upcoming(getStore());
  const most = Math.max(1, ...days.map((d) => d.count));

  return (
    <>
      <Card className="mt-6" data-testid="upcoming-strip">
        <Eyebrow>Run-outs in the next 14 days</Eyebrow>
        <ol className="mt-3 grid grid-cols-7 gap-1.5 md:grid-cols-14">
          {days.map((d, i) => (
            <li key={d.date} className="flex flex-col items-center gap-1" title={`${d.count} on ${d.date}`}>
              <div className="flex h-12 w-full items-end rounded-md bg-sunken">
                <div className={cn("w-full rounded-md", d.count ? "bg-accent" : "")} style={{ height: `${(d.count / most) * 100}%` }} />
              </div>
              <span className={cn("text-[11px] tabular-nums", i === 0 ? "font-medium text-ink" : "text-ink-3")}>{i === 0 ? "Today" : weekday(d.date)}</span>
              <span className="text-[11px] tabular-nums text-ink-3">{d.count}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="mt-6 overflow-x-auto" padded={false}>
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-ink-3">No refills due in the next 14 days.</p>
        ) : (
          <table className="w-full text-sm" data-testid="upcoming-table">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="px-4 py-3 font-medium">Patient</th>
                <th className="px-4 py-3 font-medium">Medication</th>
                <th className="px-4 py-3 font-medium">Runs out</th>
                <th className="px-4 py-3 font-medium">Would land in</th>
                <th className="px-4 py-3 font-medium">Last call</th>
                <th className="px-4 py-3 font-medium">Next reminder</th>
                {canCall && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rxId} className="border-b border-line last:border-0 align-middle">
                  <td className="px-4 py-3 font-medium">{row.initials}</td>
                  <td className="px-4 py-3">
                    {row.drug} {row.controlled && <Badge tone="review">controlled</Badge>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <DaysLeft left={row.daysLeft} /> <span className="text-ink-3">· {short(row.runOut)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Preview row={row} />
                  </td>
                  <td className="px-4 py-3 text-ink-2">{row.lastCall ? `${row.lastCall.direction}, ${row.lastCall.state.replace(/_/g, " ")}` : "none"}</td>
                  <td className="px-4 py-3 text-ink-2">{/^\d{4}-/.test(row.nextReminder) ? short(row.nextReminder) : row.nextReminder}</td>
                  {canCall && (
                    <td className="px-4 py-3 text-right">
                      <CallNow patientId={row.patientId} rxId={row.rxId} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-3 text-xs text-ink-3">
        &ldquo;Would land in&rdquo; runs today&apos;s rule cards as a preview: nothing is pressed or recorded.
        {canCall && " Call now goes through rule 7, like the daily check."}
      </p>
    </>
  );
}
