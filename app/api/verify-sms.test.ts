import { describe, expect, it } from "vitest";
import { spokenCode, verifyConfigured } from "./_lib/verify-sms";

// A Twilio trial can only text through Verify. The phone line finds the 6-digit code the caller
// read back, however Twilio's speech to text wrote it, so Verify can check it.

describe("the code the caller read back", () => {
  it.each([
    ["745525.", "745525"],
    ["It's 7 4 5 5 2 5", "745525"],
    ["seven four five five two five", "745525"],
    ["the code is 745-525 and I was born in 1990", "745525"],
    ["oh one two three four five", "012345"],
  ])("%s → %s", (said, code) => {
    expect(spokenCode(said)?.code).toBe(code);
  });

  it("finds nothing when there aren't six digits together", () => {
    expect(spokenCode("March 14th, 1990")).toBeUndefined();
    expect(spokenCode("I don't have a code")).toBeUndefined();
  });

  it("says where the code sits, so only those words are swapped", () => {
    const found = spokenCode("Sure, 7 4 5 5 2 5, thanks")!;
    expect(found.text.slice(found.at, found.at + found.length).replace(/\D/g, "")).toBe("745525");
    expect(found.text.slice(0, found.at)).toBe("Sure, ");
  });

  it("is only on with a Verify service, the Twilio account and the patient's phone", () => {
    expect(verifyConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(verifyConfigured({ TWILIO_VERIFY_SERVICE_SID: "VA_test", TWILIO_ACCOUNT_SID: "AC_test", TWILIO_AUTH_TOKEN: "t", TEST_PATIENT_PHONE: "+15555550101" } as NodeJS.ProcessEnv)).toBe(true);
  });
});
