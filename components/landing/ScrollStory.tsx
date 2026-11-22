"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function ScrollStory({ children }: { children: ReactNode }) {
  const story = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = story.current;
    if (!element) return;

    const beats = Array.from(element.querySelectorAll<HTMLElement>("[data-story-beat]"));
    let frame = 0;
    let activeIndex = -1;

    const sync = () => {
      if (frame) return;

      frame = requestAnimationFrame(() => {
        frame = 0;
        const midpoint = window.innerHeight / 2;
        const beatTops = beats.map((beat) => beat.getBoundingClientRect().top);
        const index = Math.max(0, beatTops.findLastIndex((top) => top <= midpoint));

        // Every segment fills to the same viewport position, including between markers.
        beats.forEach((beat, position) => {
          beat.style.setProperty("--rail-fill", `${midpoint - beatTops[position]}px`);
          if (index !== activeIndex) {
            beat.setAttribute("data-story-position", position < index ? "passed" : position === index ? "current" : "ahead");
          }
        });

        activeIndex = index;
      });
    };

    sync();
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    window.addEventListener("hashchange", sync);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);

  return (
    <div ref={story} className="landing-container landing-story">
      <div className="landing-steps">{children}</div>
    </div>
  );
}
