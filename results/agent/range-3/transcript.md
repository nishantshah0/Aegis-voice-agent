## inbound-jordan-rushed-copay-small-talk

Inbound; a rushed caller wants the copay, adds a label question and small talk. Model calls: 7.

**Caller:** (call connects)
**Agent:** Hi, this is the automated assistant for Maple Street Pharmacy. What can I help with?

**Caller:** Look, I'm in a rush. Jordan Leclair, July 2nd 1975, RX-100301. What's my copay on this?
  - press `lookup_patient` ok
**Agent:** If those details match, I've sent a code to the phone on file. What's the code you received? _(16350 ms, first sentence 16272 ms)_

**Caller:** 112358.
  - press `check_code` ok
  - press `check_prescription` ok
  - press `check_coverage` ok
  - press `read_label` ok
**Agent:** Thanks, Jordan, you're verified. Your copay on Atorvastatin is $3.00. Your plan pays $18.90. _(3582 ms, first sentence 1535 ms)_

**Caller:** Fine. Can I have a glass of wine with it? Nice weather out today, eh?
  - press `read_label` ok
**Agent:** Sounds nice out there, enjoy it. On wine, the label only says: "Take 1 tablet by mouth once a day at bedtime." It doesn't mention alcohol, so I'd suggest asking a pharmacist. Would you like me to pass that question on? _(3930 ms, first sentence 1876 ms)_

**Caller:** Okay, that's it.
**Agent:** Got it, Jordan. Your copay is $3.00, and the wine question is still open with a pharmacist if you want it asked later. Thanks for calling, and have a great afternoon. _(3755 ms, first sentence 806 ms)_

## inbound-dev-annoyed-side-effect-handover

Inbound; an annoyed caller, a refill it can't do yet, a side effect, then a person. Model calls: 6.

**Caller:** (call connects)
**Agent:** Hi, this is the automated assistant for Maple Street Pharmacy. What can I help with?

**Caller:** I'm really annoyed, I've been trying to get through. I need my Adderall refilled today. Dev Halvorsen, May 19 2001, RX-100501.
  - press `lookup_patient` ok
  - guard S4 replaced: "I'll get you sorted quickly."
**Agent:** I'm sorry it's been hard to get through. A pharmacist will check it first, and I'll confirm once it's approved. If those details match, I've sent a code to the phone on file. Could you read me the code when it arrives? _(6681 ms, first sentence 5588 ms)_

**Caller:** 112358.
  - press `check_code` ok
  - press `check_prescription` ok
  - press `check_coverage` ok
  - press `read_label` ok
**Agent:** Thank you, Dev, you're verified. Your Adderall XR 20 mg has 2 refills left, but the system says it can't be refilled today. It was last filled on November 4. Would you like me to connect you with a pharmacist to look at this? _(6105 ms, first sentence 2554 ms)_

**Caller:** Ugh. Also, it's been giving me headaches since last week. Not terrible, but every day.
  - press `note_for_pharmacist` ok
**Agent:** I'm sorry about the headaches. I've passed them on to the pharmacist, in your words, and they have the note. Would you like me to connect you with a pharmacist about the refill as well? _(4183 ms, first sentence 2386 ms)_

**Caller:** Just let me talk to a pharmacist.
**Agent:** Of course. I'm getting a pharmacist for you now. _(2 ms, first sentence 2 ms)_

## outbound-sam-silence-then-later

Outbound; the caller goes quiet, comes back, verifies, then can't talk now. Model calls: 4.

**Caller:** (call connects)
  - press `send_code` ok
**Agent:** This is Maple Street Pharmacy calling for Sam Rivera. To continue, I'll send a code to this phone.

**Caller:** Hello?
  - guard S1 replaced: "Hello, this is Maple Street Pharmacy calling for Sam Rivera."
**Agent:** I can help with that once you're verified. I've sent a verification code to the phone on file. Could you read that code back to me, and tell me your date of birth? _(3689 ms, first sentence 3492 ms)_

**Caller:** (silence)
**Agent:** Are you still there? Take your time.

**Caller:** Sorry, yes, this is Sam. 112358, March 14 1990.
  - press `check_code` ok
  - press `check_prescription` ok
  - press `check_coverage` ok
  - press `read_label` ok
**Agent:** Thanks, Sam, you're verified. I'm calling because your Concerta 36 mg is due for a refill, and it would cost you $4.10 on your plan. Would you like me to request that refill now? _(4301 ms, first sentence 1857 ms)_

**Caller:** Actually I'm driving, can we do this later?
**Agent:** No problem, Sam, drive safely. Nothing has been ordered, so you can call us back whenever suits you. Look after yourself. _(2931 ms, first sentence 634 ms)_

