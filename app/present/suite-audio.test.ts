import { expect, it } from "vitest";
import { suiteAudioQueue, suiteClips } from "./suite-audio";

it("streams the first call and holds other voices in call order even if those calls finish first", () => {
  const played: string[] = [];
  const queue = suiteAudioQueue(["one", "two", "three"], clip => played.push(clip.ticket!));
  queue.add("two", [{ ticket: "second caller" }]);
  queue.add("one", [{ ticket: "first caller" }]);
  queue.add("two", [{ ticket: "second pharmacy" }]);
  queue.finish("two");
  queue.add("three", [{ ticket: "third caller" }]);
  expect(played).toEqual(["first caller"]);
  queue.add("one", [{ ticket: "first pharmacy" }]);
  queue.finish("one");
  expect(played).toEqual(["first caller", "first pharmacy", "second caller", "second pharmacy", "third caller"]);
});

it("identifies the speaking party and skips redacted lines", () => {
  expect(suiteClips("Copay", { type: "line", speaker: "caller", text: "Hello", ticket: "signed" })).toEqual([{ticket: "signed", caption: "Copay · Caller"}]);
  expect(suiteClips("Copay", { type: "line", speaker: "pharmacy", text: "[Verification details omitted]" })).toEqual([{skip: true, caption: "Copay · Pharmacy"}]);
});
