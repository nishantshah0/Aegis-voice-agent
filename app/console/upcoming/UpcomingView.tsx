import { connection } from "next/server";
import { AUTH_ROUTES } from "@/lib/auth/auth0";
import { getApprover } from "@/lib/auth/session";
import { Badge, Card, Eyebrow, LaneBadge, RuleTag, Table, TableEmpty, Td, Th, THead, TimelineStrip, Tr } from "@/components/ui";
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

  return (
    <>
      <Card className="mt-6" data-testid="upcoming-strip">
        <Eyebrow>Run-outs in the next 14 days</Eyebrow>
        <TimelineStrip
          className="mt-3"
          days={days.map((d, i) => ({ label: i === 0 ? "Today" : weekday(d.date), count: d.count, title: `${d.count} on ${d.date}` }))}
        />
      </Card>

      <div className="mt-6">
        {rows.length === 0 ? (
          <TableEmpty>No refills due in the next 14 days.</TableEmpty>
        ) : (
          <Table data-testid="upcoming-table">
            <THead>
              <tr>
                <Th>Patient</Th>
                <Th>Medication</Th>
                <Th>Runs out</Th>
                <Th>Would land in</Th>
                <Th>Last call</Th>
                <Th>Next reminder</Th>
                {canCall && <Th />}
              </tr>
            </THead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.rxId}>
                  <Td className="font-medium text-ink">{row.initials}</Td>
                  <Td>
                    {row.drug} {row.controlled && <Badge tone="review">controlled</Badge>}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <DaysLeft left={row.daysLeft} /> <span className="text-ink-3">· {short(row.runOut)}</span>
                  </Td>
                  <Td>
                    <Preview row={row} />
                  </Td>
                  <Td>{row.lastCall ? `${row.lastCall.direction}, ${row.lastCall.state.replace(/_/g, " ")}` : "none"}</Td>
                  <Td>{/^\d{4}-/.test(row.nextReminder) ? short(row.nextReminder) : row.nextReminder}</Td>
                  {canCall && (
                    <Td className="text-right">
                      <CallNow patientId={row.patientId} rxId={row.rxId} />
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-3">
        &ldquo;Would land in&rdquo; runs today&apos;s rule cards as a preview: nothing is pressed or recorded.
        {canCall && " Call now goes through rule 7, like the daily check."}
      </p>
    </>
  );
}
