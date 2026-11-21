import { describe, expect, it } from "vitest";
import { createEndpointer, type Timer } from "./endpointer";

/** A clock the test moves by hand. */
function fakeTimer() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const timer: Timer = {
    set: (fn, ms) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (id) => void timers.delete(id as number),
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...timers]) {
      if (t.at > now) continue;
      timers.delete(id);
      t.fn();
    }
  };
  return { timer, advance };
}

describe("1.5: end of turn after 600 ms of silence", () => {
  it("ends the turn 600 ms after the last new words", () => {
    const { timer, advance } = fakeTimer();
    const turns: string[] = [];
    const ep = createEndpointer((t) => turns.push(t), { timer });
    ep.heard("yes");
    advance(400);
    ep.heard("yes please");
    advance(500);
    expect(turns).toEqual([]);
    advance(100);
    expect(turns).toEqual(["yes please"]);
  });

  it("doesn't restart the clock when the guess hasn't changed", () => {
    const { timer, advance } = fakeTimer();
    const turns: string[] = [];
    const ep = createEndpointer((t) => turns.push(t), { timer });
    ep.heard("it's 112358");
    advance(300);
    ep.heard("it's 112358 ");
    advance(300);
    expect(turns).toEqual(["it's 112358"]);
  });

  it("finishes at once on flush (hold-to-talk let go), and drops words on reset", () => {
    const { timer, advance } = fakeTimer();
    const turns: string[] = [];
    const ep = createEndpointer((t) => turns.push(t), { timer });
    ep.heard("hello");
    ep.flush();
    expect(turns).toEqual(["hello"]);
    ep.heard("echo of the agent");
    ep.reset();
    advance(1000);
    expect(turns).toEqual(["hello"]);
    ep.flush();
    expect(turns).toEqual(["hello"]);
  });
});
