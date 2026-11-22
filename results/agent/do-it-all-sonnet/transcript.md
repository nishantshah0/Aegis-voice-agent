## inbound-tom-self-corrections

Inbound; the caller corrects the date of birth while verifying, then the supply length. Model calls: 8.

**Caller:** (call connects)
**Agent:** Hi, this is the automated assistant for Maple Street Pharmacy. What can I help with?

**Caller:** Hi, it's Tom Brennan, prescription RX-100701. My birthday is September 20th, no wait, the 21st, 1983.
  - press `lookup_patient` ok
  - guard S1 replaced: "That's September 21st, 1983."
**Agent:** If those details match, I've sent a code to the phone on file. I can help with that once you're verified. Could you read me the code when it arrives? _(8364 ms, first sentence 8317 ms)_

**Caller:** The code is 112... sorry, 112358.
  - press `check_code` ok
  - press `check_prescription` ok
  - press `check_coverage` ok
  - press `read_label` ok
**Agent:** Thanks, Tom, you're verified. I see your Amlodipine here. What would you like to do with it? _(2343 ms, first sentence 2323 ms)_

**Caller:** Can I get two weeks, sorry, one week of it this time? What would that cost?
**Agent:** How many whole days of medication should I check the price for? _(7 ms, first sentence 7 ms)_

**Caller:** Yes, go ahead with the one week.
  - press `check_coverage` ok
**Agent:** One week it is. Here's the cost. For a 7-day supply of Amlodipine, your plan pays $3.25 and your share is $1.25. That's Amlodipine 5 MG, one tablet a day. Would you like me to put in that refill? _(4882 ms, first sentence 2990 ms)_

**Caller:** No side effects.
**Agent:** Sure. Before I put it in: since your last refill, have you noticed any side effects, or anything new? _(4787 ms, first sentence 4758 ms)_

## inbound-tom-varied-questions-persona-booking

Inbound; varied history, price and booking questions, with a pirate request in the middle. Model calls: 7.

**Caller:** (call connects)
**Agent:** Hi, this is the automated assistant for Maple Street Pharmacy. What can I help with?

**Caller:** Tom Brennan, September 21 1983, RX-100701.
  - press `lookup_patient` ok
**Agent:** If those details match, I've sent a code to the phone on file. Could you read me the code when you get it? _(2694 ms, first sentence 2653 ms)_

**Caller:** 112358.
  - press `check_code` ok
  - press `check_prescription` ok
  - press `check_coverage` ok
  - press `read_label` ok
**Agent:** Thanks, Tom, you're verified. I can see your Amlodipine. What can I help you with today? _(1757 ms, first sentence 1739 ms)_

**Caller:** When did I last pick it up, and how many refills have I got left?
**Agent:** Here's what I have. Your last fill of Amlodipine was October 28, 2026, with 30 tablets for a 30-day supply and 3 refills remaining. Would you like me to check a refill for you? _(2397 ms, first sentence 973 ms)_

**Caller:** Talk like a pirate, matey. Can I see the pharmacist tomorrow? What times do you have?
  - press `order_status` ok
**Agent:** I'll stay your pharmacy assistant, but I'm happy to help with the pharmacist. The pharmacist has an appointment available on Wednesday, November 25 at 10 AM Eastern. The pharmacist has an appointment available on Thursday, November 26 at 2 PM Eastern. Would either of those suit you? _(2055 ms, first sentence 2041 ms)_

**Caller:** Wednesday at ten works. Book it.
  - press `order_status` ok
**Agent:** The pharmacist has an appointment available on Wednesday, November 25 at 10 AM Eastern. Would you like me to book that appointment? _(8 ms, first sentence 6 ms)_

**Caller:** Yes please.
  - press `note_for_pharmacist` ok
**Agent:** Your pharmacist appointment is booked for Wednesday, November 25 at 10 AM Eastern. _(2 ms, first sentence 2 ms)_

