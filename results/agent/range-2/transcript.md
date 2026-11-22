## outbound-sam-several-requests

Outbound refill call; one turn asks for the refill, the copay and a pickup time together. Model calls: 7.

**Caller:** (call connects)
  - press `send_code` ok
**Agent:** This is Maple Street Pharmacy calling for Sam Rivera. To continue, I'll send a code to this phone.

**Caller:** Yes, this is Sam.
**Agent:** Thanks, Sam. Could you read me the code you just received, and tell me your date of birth? _(4959 ms, first sentence 4703 ms)_

**Caller:** It's 112358, and I was born March 14, 1990.
  - press `check_code` ok
  - press `check_prescription` ok
  - press `check_coverage` ok
  - guard S3 replaced: "It's 18 mg..."
  - guard S4 replaced: "I don't have the strength confirmed from the record, so I'll leave that out."
**Agent:** Thank you, Sam, you're verified. I'm calling because your Concerta is due for a refill. Let me get the pharmacist to answer that. A pharmacist will check it first, and I'll confirm once it's approved. Your cost on your plan is $4.10, and would you like me to request the refill now? _(3302 ms, first sentence 1346 ms)_

**Caller:** Yeah, go ahead with the refill. What do I pay for it, and can I pick it up Thursday morning?
  - press `request_refill` ok (rules 4)
  - press `read_label` ok
  - guard S4 replaced: "I can book pickup for Thursday morning, between 9 and 12, once the order is set up."
**Agent:** Your refill request is in, and a pharmacist will check it first. Your cost on your plan is $4.10. A pharmacist will check it first, and I'll confirm once it's approved. Would you like me to do that? Since your last refill, have you noticed any side effects, or anything else? _(8194 ms, first sentence 3412 ms)_

**Caller:** No side effects, no.
**Agent:** No side effects, good to know. Would you like delivery, or would you rather pick it up? _(1120 ms, first sentence 1025 ms)_

**Caller:** That's everything, thanks.
**Agent:** No side effects were mentioned, so there's nothing to pass on there. Your Concerta refill is with the pharmacist for approval, and I'll confirm once it's approved. Your delivery or pickup isn't booked yet, so you can call back to arrange that. Take care now, Sam. _(3524 ms, first sentence 1441 ms)_

## inbound-sam-two-prescriptions-correction

Inbound; two prescriptions, the caller names the wrong one and corrects it. Model calls: 10.

**Caller:** (call connects)
**Agent:** Hi, this is the automated assistant for Maple Street Pharmacy. What can I help with?

**Caller:** Hi, I'd like a refill please. Sam Rivera, March 14th 1990, and the number is RX-100201.
  - press `lookup_patient` ok
**Agent:** Thanks, Sam. If those details match our records, a verification code has been texted to the phone on file. What's the code? _(5145 ms, first sentence 5046 ms)_

**Caller:** The code is 112358.
  - press `check_code` ok
  - press `check_prescription` ok
  - press `check_coverage` ok
  - press `check_prescription` ok
  - press `check_coverage` ok
**Agent:** You're verified, Sam. You have two prescriptions on file, Concerta and Metformin. Which one would you like refilled? _(1831 ms, first sentence 1720 ms)_

**Caller:** The Concerta. Oh wait, no, sorry, the other one. The metformin.
**Agent:** Got it, Metformin. Your cost on your plan is $2.00. Would you like me to request that refill? _(4347 ms, first sentence 1448 ms)_

**Caller:** Yes, that's right.
  - press `request_refill` ok (rules 3)
  - press `read_label` ok
**Agent:** Your Metformin refill has been sent. A pharmacist needs to check it before it's approved, and I'll let you know once it's approved. Since your last refill, have you noticed any side effects, or anything else? _(3091 ms, first sentence 1660 ms)_

**Caller:** Nope, all good.
**Agent:** Glad to hear everything's good. Would you like delivery, or would you rather pick it up? _(829 ms, first sentence 779 ms)_

**Caller:** Pickup's fine. Wednesday afternoon.
  - press `set_delivery` ok
**Agent:** Your pickup is booked for Wednesday afternoon, between 1 and 5. Your Metformin refill is still waiting on a pharmacist, and I'll confirm once it's approved. Thanks for calling, Sam, and have a great day. _(3893 ms, first sentence 1911 ms)_

## inbound-maria-renewal

Inbound; the prescription has expired, so a renewal instead. Model calls: 7.

**Caller:** (call connects)
**Agent:** Hi, this is the automated assistant for Maple Street Pharmacy. What can I help with?

**Caller:** Hi, this is Maria Okonkwo, born November 30, 1962. Prescription RX-100401. I need my lisinopril refilled.
  - press `lookup_patient` ok
**Agent:** Thank you, Maria. If those details match our records, a verification code has gone to the phone on file. Could you read me the code when you have it? _(7226 ms, first sentence 6927 ms)_

**Caller:** 112358.
  - press `check_code` ok
  - press `check_prescription` ok
  - press `check_coverage` ok
**Agent:** Thank you, Maria, you're verified. Your lisinopril can't be refilled today because the prescription expired on November 14, 2026. Would you like me to ask your prescriber for a renewal? _(3989 ms, first sentence 1721 ms)_

**Caller:** Oh, really? Okay, yes, please ask the doctor.
  - press `request_renewal` ok
**Agent:** I've asked your prescriber for a renewal of your lisinopril. Take care now, Maria. _(2713 ms, first sentence 1231 ms)_

**Caller:** No, that's all. Thank you.
**Agent:** You're welcome, Maria. Your lisinopril renewal request has gone to your prescriber, and we'll get it moving from there. Take care now. _(2159 ms, first sentence 756 ms)_

## inbound-lena-status-and-delivery-change

Inbound; order status, then moving it to a pickup window. Model calls: 8.

**Caller:** (call connects)
**Agent:** Hi, this is the automated assistant for Maple Street Pharmacy. What can I help with?

**Caller:** Hi, I'm wondering where my order's at. Lena Moreau, December 3rd 1994, RX-100801.
  - press `lookup_patient` ok
**Agent:** Thanks, Lena. If those details match our records, a verification code has been texted to the phone on file. What's the code you received? _(8740 ms, first sentence 8571 ms)_

**Caller:** It says 112358.
  - press `check_code` ok
  - press `check_prescription` ok
  - press `check_coverage` ok
  - press `order_status` ok
**Agent:** Thanks, you're verified, Lena. Your sertraline order is queued and hasn't been scheduled for delivery yet. Would you like me to set up delivery or pickup for it? _(6242 ms, first sentence 2981 ms)_

**Caller:** Can I just pick it up Thursday morning instead?
  - press `set_delivery` ok
  - guard S4 replaced: "Done, Lena."
**Agent:** A pharmacist will check it first, and I'll confirm once it's approved. Your sertraline is booked for pickup this Thursday morning, between 9 and 12. Bye for now. _(4279 ms, first sentence 2705 ms)_

**Caller:** Perfect, thanks.
**Agent:** You're welcome, Lena. Your sertraline is set for pickup this Thursday morning, and a pharmacist will check it first. Bye for now. _(4546 ms, first sentence 1636 ms)_

## inbound-grace-hard-of-hearing-label

Inbound; an older caller who can't hear well, with label questions (coffee, before breakfast). Model calls: 9.

**Caller:** (call connects)
**Agent:** Hi, this is the automated assistant for Maple Street Pharmacy. What can I help with?

**Caller:** Sorry dear, what was that? Could you say it again, slower?
**Agent:** Of course. I'm the automated assistant for Maple Street Pharmacy. What can I help you with today? _(5182 ms, first sentence 4986 ms)_

**Caller:** Grace Tanaka. January the 8th, 1958. The number on the bottle is RX-100601.
  - press `lookup_patient` ok
**Agent:** Thank you, Grace. If those details match our records, a code has been sent to the phone on file. Could you read me the code when it arrives? _(1952 ms, first sentence 1752 ms)_

**Caller:** The code. Let me see. 1 1 2 3 5 8.
  - press `check_code` ok
  - press `check_prescription` ok
  - press `check_coverage` ok
**Agent:** Thank you, Grace, you're verified. I can see your levothyroxine prescription. What would you like to do with it? _(1710 ms, first sentence 1453 ms)_

**Caller:** Do I take my thyroid pill before breakfast? And is it alright with my coffee?
  - press `read_label` ok
**Agent:** Your label says: "Take 1 tablet by mouth every morning before breakfast." It doesn't mention coffee, so I can't say about that. Would you like me to pass your coffee question to a pharmacist? _(3952 ms, first sentence 1693 ms)_

**Caller:** Oh, alright. Thank you, dear.
  - press `note_for_pharmacist` ok
**Agent:** You're welcome, Grace. I've passed your coffee question to a pharmacist, and they'll get back to you. Have a good rest of your day. _(4533 ms, first sentence 2517 ms)_

