import { Badge, LaneBadge, RuleTag } from "@/components/ui";

// The hero picture is the product itself: the patient's call screen in front of the
// pharmacist's Review lane. Lines are the real ones from lib/agent and lib/guard; the
// patient and drug are the demo seed (made-up data).
const S4_REPLACEMENT = "A pharmacist will check it first, and I'll confirm once it's approved.";

function Bubble({ who, children }: { who: "agent" | "caller"; children: React.ReactNode }) {
  return who === "caller" ? (
    <li className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-ink-inverse">{children}</li>
  ) : (
    <li className="max-w-[85%] self-start rounded-2xl rounded-bl-md bg-sunken px-3.5 py-2 text-ink">{children}</li>
  );
}

function CallCard() {
  return (
    <div className="theme-dark w-[19rem] overflow-hidden rounded-[2rem] border border-line bg-canvas text-ink shadow-[0_30px_80px_-30px_rgb(0_0_0/0.55)]">
      <div className="flex items-center justify-between px-5 pt-5">
        <div>
          <p className="text-[13px] font-semibold">Maple Street Pharmacy</p>
          <p className="font-mono text-[11px] text-ink-3">On a call · 0:42</p>
        </div>
        <span className="size-2 rounded-full bg-accent rg-ring" aria-hidden />
      </div>
      <ol className="flex flex-col gap-2 px-4 py-4 text-[13px] leading-snug">
        <Bubble who="agent">Hi, this is Maple Street Pharmacy calling for Sam.</Bubble>
        <Bubble who="caller">Yes, I&apos;m almost out of my Concerta.</Bubble>
        <li className="self-start px-1 text-[12px]">
          <span className="rg-strike text-ink-3">Your Concerta refill is approved.</span>
          <span className="mt-1 flex items-center gap-1.5 font-medium text-stop">
            <span aria-hidden className="size-1.5 rounded-full bg-stop" />
            Stopped by S4 · promise not in the record
          </span>
        </li>
        <Bubble who="agent">{S4_REPLACEMENT}</Bubble>
      </ol>
    </div>
  );
}

function ReviewCard() {
  return (
    <div className="w-[26rem] max-w-full rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold tracking-[-0.01em]">Waiting for a pharmacist</p>
        <span className="font-mono text-[11px] text-ink-3">Today</span>
      </div>
      <div className="mt-3 flex gap-1.5">
        <LaneBadge lane="automatic" />
        <LaneBadge lane="quick_check" />
        <LaneBadge lane="review" />
      </div>
      <div className="mt-4 rounded-xl border border-line p-3.5">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <LaneBadge lane="review" />
          <span className="font-semibold">Refill</span>
          <span>Concerta 36 mg</span>
          <span className="text-ink-3">for S.R.</span>
        </div>
        <div className="mt-3 flex items-start gap-2 text-[12.5px] text-ink-2">
          <RuleTag>Rule 4</RuleTag>
          <span>Controlled drugs need a pharmacist.</span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[12.5px] text-ink-2">
          <Badge tone="quick">Side effect</Badge>
          <span>&ldquo;Sleeping badly&rdquo;</span>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <span className="inline-flex h-8 items-center rounded-full bg-accent px-3.5 text-[12.5px] font-medium text-ink-inverse">Approve</span>
          <span className="inline-flex h-8 items-center rounded-full border border-line-strong px-3.5 text-[12.5px] font-medium text-stop">Deny</span>
        </div>
      </div>
    </div>
  );
}

export function ProductPreview() {
  return (
    <div className="relative mx-auto flex w-full max-w-[34rem] flex-col items-center gap-5 sm:block sm:h-[32rem]" aria-label="The patient's call screen and the pharmacist's Review lane" role="img">
      <div className="sm:absolute sm:right-0 sm:top-0 rg-rise rg-rise-2">
        <ReviewCard />
      </div>
      <div className="sm:absolute sm:bottom-0 sm:left-0 rg-rise rg-rise-3">
        <CallCard />
      </div>
    </div>
  );
}
