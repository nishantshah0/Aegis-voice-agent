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
**Agent:** Thank you, Sam, you're verified. I'm calling because your Concerta 36 mg is due for a refill. Your cost on your plan is $4.10. Would you like me to request that refill now? _(7980 ms, first sentence 5893 ms)_

**Caller:** Yes please. Also I've been sleeping badly for about two weeks, it's mild.
  - press `note_for_pharmacist` ok
  - press `request_refill` ok (rules 4)
**Agent:** I've noted the sleep trouble for the pharmacist. Your Concerta refill has been sent, and a pharmacist will check it first. It should be ready Thursday once it's approved. Would you like delivery, or would you rather pick it up? _(3066 ms, first sentence 2888 ms)_

**Caller:** No, that's it. Thanks.
**Agent:** Summing up: your Concerta refill is waiting for a pharmacist to approve it, it should be ready Thursday once it's approved, and your sleep note is with the pharmacist. Thanks, Sam, bye for now. _(3112 ms, first sentence 718 ms)_

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
**Agent:** Thank you, Sam, you're verified. I'm calling because your Concerta is due for a refill. It's 36 mg, and your cost on your plan is $4.10. Would you like me to request that refill? _(3986 ms, first sentence 2366 ms)_

**Caller:** Yes please.
**Agent:** Before I place it, is there any side effect you've noticed from your Concerta? If not, just say no. Before I put it in: since your last refill, have you noticed any side effects, or anything new? _(2637 ms, first sentence 1239 ms)_

**Caller:** No, nothing like that.
  - press `request_refill` ok (rules 4)
**Agent:** Thanks, Sam. Your Concerta refill is with the pharmacist now, and I'll let you know once it's approved. It should be ready Thursday once it's approved. Would you like delivery, or would you rather pick it up? _(1067 ms, first sentence 826 ms)_

**Caller:** That's all, thanks.
**Agent:** Your Concerta refill is with the pharmacist, and it should be ready Thursday once it's approved. Bye for now, Sam. _(3330 ms, first sentence 953 ms)_

