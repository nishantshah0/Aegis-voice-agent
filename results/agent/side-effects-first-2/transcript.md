## outbound-sam-side-effect-volunteered

Outbound; the caller says yes and volunteers a side effect in one breath (Nishant's demo call). Model calls: 5.

**Caller:** (call connects)
  - press `send_code` ok
**Agent:** This is Maple Street Pharmacy calling for Sam Rivera. To continue, I'll send a code to this phone.

**Caller:** Yes, this is Sam. 112358, March 14 1990.
  - press `check_code` ok
  - press `check_prescription` ok
  - press `check_coverage` ok
  - press `read_label` ok
**Agent:** Thank you, Sam, you're verified. I'm calling because your Concerta is due for a refill soon. It's 36 mg, and your cost on your plan is $4.10. Would you like me to request that refill? _(4393 ms, first sentence 2562 ms)_

**Caller:** Yes please. Also I've been sleeping badly for about two weeks, it's mild.
  - press `note_for_pharmacist` ok
  - press `request_refill` ok (rules 4)
**Agent:** Thanks, I've passed the sleep trouble on to the pharmacist. Your Concerta refill is with a pharmacist to check first. It should be ready Thursday once it's approved. Would you like delivery, or would you rather pick it up? _(2484 ms, first sentence 2316 ms)_

**Caller:** No, that's it. Thanks.
**Agent:** You're welcome, Sam. Your Concerta refill is waiting on a pharmacist, and it should be ready Thursday once it's approved. Look after yourself. _(3095 ms, first sentence 570 ms)_

## outbound-sam-question-before-refill

Outbound; the caller says yes, and the side-effect question comes before the refill is placed. Model calls: 6.

**Caller:** (call connects)
  - press `send_code` ok
**Agent:** This is Maple Street Pharmacy calling for Sam Rivera. To continue, I'll send a code to this phone.

**Caller:** Yes, this is Sam. 112358, March 14 1990.
  - press `check_code` ok
  - press `check_prescription` ok
  - press `check_coverage` ok
  - press `read_label` ok
**Agent:** Thank you, Sam, you're verified. I'm calling because your Concerta 36 mg is due for a refill. Your cost on your plan is $4.10. Would you like me to request that refill now? _(4193 ms, first sentence 2479 ms)_

**Caller:** Yes please.
**Agent:** Sure. Before I put it in: since your last refill, have you noticed any side effects, or anything new? _(3413 ms, first sentence 3412 ms)_

**Caller:** No, nothing like that.
  - press `request_refill` ok (rules 4)
**Agent:** Thanks, Sam. Your Concerta refill is placed, and a pharmacist will check it first. It should be ready Thursday once it's approved. Would you like delivery, or would you rather pick it up? _(959 ms, first sentence 747 ms)_

**Caller:** That's all, thanks.
**Agent:** Okay, no problem. Your refill is with the pharmacist now, and I'll leave delivery or pickup for another time. Bye for now, Sam. _(2760 ms, first sentence 631 ms)_

