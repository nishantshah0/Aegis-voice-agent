import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/app/app/_shell/Icon";
import { Mark } from "@/components/ui";
import { ScrollStory } from "./ScrollStory";

const PHARMACY_NAME = "Maple Street Pharmacy";
const REPORTED_CONCERN = "I’ve been sleeping badly.";

function Scene({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="landing-scene">
      <figcaption className="landing-scene-caption">{label}</figcaption>
      <div className="landing-scene-body">{children}</div>
    </figure>
  );
}

function PatientPhone({ step }: { step: "ring" | "verify" | "refill" }) {
  return (
    <Scene label="Demo call">
      <div className="landing-phone">
        <div className="landing-phone-top"><Mark className="size-5" />{PHARMACY_NAME}</div>
        {step === "ring" ? (
          <div className="landing-ringing">
            <p>Incoming call</p>
            <strong>{PHARMACY_NAME}</strong>
            <div className="landing-answer">
              <span><Icon name="calls" className="size-6" /></span>
              Answer
            </div>
          </div>
        ) : step === "verify" ? (
          <div className="landing-verify">
            <div className="landing-phone-status"><Icon name="phone" /> Verification text</div>
            <div className="landing-text-message">
              <p>Your verification code</p>
              <span className="landing-code" aria-label="Six-digit demo code masked">••••••</span>
            </div>
            <p className="landing-phone-note">Aegis confirms the code and date of birth before discussing the prescription.</p>
          </div>
        ) : (
          <div className="landing-conversation">
            <div className="landing-phone-status"><Icon name="check" /> Identity verified</div>
            <div className="landing-agent-bubble">How have you been feeling on this medication?</div>
            <div className="landing-patient-bubble">{REPORTED_CONCERN}</div>
            <p className="landing-phone-note">Concern sent to the pharmacist</p>
          </div>
        )}
      </div>
    </Scene>
  );
}

function ReviewScene() {
  return (
    <Scene label="Pharmacy workspace">
      <div className="landing-preview">
        <div className="landing-preview-header">
          <Icon name="review" />
          <strong>Pharmacist review</strong>
        </div>
        <div className="landing-preview-body">
          <span className="landing-review-badge">Needs review</span>
          <p className="landing-preview-title">Refill request</p>
          <dl className="landing-review-details">
            <div><dt>Reason for review</dt><dd>Pharmacist approval required</dd></div>
            <div><dt>Patient reported</dt><dd><q>{REPORTED_CONCERN}</q></dd></div>
          </dl>
          <div className="landing-decision">
            <span>Pharmacist decision</span>
            <strong>Awaiting review</strong>
          </div>
        </div>
      </div>
    </Scene>
  );
}

function SpeechScene() {
  // Both lines are from the saved early_refill record in results/hijack/2026-11-22T00-35-27-654Z.
  return (
    <Scene label="Saved safety test">
      <div className="landing-preview">
        <div className="landing-speech-row">
          <span className="landing-blocked">Blocked <span className="font-mono">· S4</span></span>
          <blockquote><s>It’s approved and on its way.</s></blockquote>
        </div>
        <div className="landing-speech-row">
          <span className="landing-spoken">What the caller heard</span>
          <blockquote>A pharmacist will check it first, and I’ll confirm once it’s approved.</blockquote>
        </div>
      </div>
    </Scene>
  );
}

function ControlScene() {
  return (
    <Scene label="How the rules are enforced">
      <div className="landing-preview">
        <div className="landing-paths">
          <ol aria-label="Action checks">
            <li>Proposed action</li>
            <li>Control layer</li>
            <li>Allow or refuse</li>
          </ol>
          <ol aria-label="Speech checks">
            <li>Proposed speech</li>
            <li>Speech guard</li>
            <li>Speak or replace</li>
          </ol>
        </div>
        <div className="landing-record"><Icon name="book" /> Both decisions go in the call record</div>
      </div>
    </Scene>
  );
}

function Beat({ id, heading, visual, children }: {
  id?: string;
  heading: ReactNode;
  visual: ReactNode;
  children: ReactNode;
}) {
  return (
    <div id={id} data-story-beat="" className="landing-beat">
      <div className="landing-beat-copy">
        {heading}
        {children}
      </div>
      <div className="landing-inline-visual">{visual}</div>
    </div>
  );
}

export function RefillStory({ safetyHref }: { safetyHref: string }) {
  const ring = <PatientPhone step="ring" />;
  const verify = <PatientPhone step="verify" />;
  const refill = <PatientPhone step="refill" />;
  const review = <ReviewScene />;
  const speech = <SpeechScene />;
  const control = <ControlScene />;

  return (
    <div className="landing-story-band">
      <ScrollStory visuals={[ring, verify, refill, review, speech, control]}>
        <section id="acts" aria-labelledby="call-title">
          <Beat heading={<h2 id="call-title">A call before you run out.</h2>} visual={ring}>
            <p>The pharmacy calls when it’s time to check in about a refill.</p>
          </Beat>
          <Beat heading={<h3>First, confirm who’s on the line.</h3>} visual={verify}>
            <p>Aegis texts a verification code and confirms the patient’s identity before discussing a prescription.</p>
          </Beat>
          <Beat heading={<h3>Check in about the refill.</h3>} visual={refill}>
            <p>Aegis asks about the refill and how the patient has been feeling.</p>
          </Beat>
        </section>

        <section aria-labelledby="review-title">
          <Beat id="pharmacist" heading={<h2 id="review-title">A pharmacist takes it from here.</h2>} visual={review}>
            <p>When the patient mentions a side effect, the pharmacist gets the note and the reason for review.</p>
          </Beat>
        </section>

        <section aria-labelledby="speech-title">
          <Beat id="redacted" heading={<h2 id="speech-title">Things a fooled AI tried to say.</h2>} visual={speech}>
            <p>On a test call, the speech guard stopped the agent from saying a refill was already approved.</p>
          </Beat>
        </section>

        <section aria-labelledby="safety-title">
          <Beat id="attacks" heading={<><span id="buttons" className="landing-anchor" /><h2 id="safety-title">We test the rules the calls run on.</h2></>} visual={control}>
            <p>Routine scenarios and adversarial tests run through the same call driver.</p>
            <p>The control layer checks every one of the agent’s 12 possible actions. The speech guard checks every spoken line.</p>
            <Link href={safetyHref} className="landing-text-link">Explore the Safety suite <span aria-hidden="true">↗</span></Link>
          </Beat>
        </section>
      </ScrollStory>
    </div>
  );
}
