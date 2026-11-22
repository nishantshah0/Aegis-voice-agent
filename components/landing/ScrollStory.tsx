"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const STICKY_MEDIA = "(min-width: 1024px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)";

export function ScrollStory({ children, visuals }: { children: ReactNode; visuals: ReactNode[] }) {
  const story = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const element = story.current;
    if (!element) return;

    const beats = Array.from(element.querySelectorAll<HTMLElement>("[data-story-beat]"));
    const markers = Array.from(element.querySelectorAll("[data-story-marker]"));
    const media = window.matchMedia(STICKY_MEDIA);
    let frame = 0;
    let activeIndex = -1;

    function sync() {
      cancelAnimationFrame(frame);

      frame = requestAnimationFrame(() => {
        const midpoint = window.innerHeight / 2;
        const beatTops = beats.map((beat) => beat.getBoundingClientRect().top);
        const index = Math.max(0, markers.findLastIndex((marker, position) => {
          if (media.matches) return beatTops[position] + beats[position].offsetHeight / 2 <= midpoint;
          const dot = marker.getBoundingClientRect();
          return dot.top + dot.height / 2 <= midpoint;
        }));

        // Every segment fills to the same viewport position, including between markers.
        beats.forEach((beat, position) => {
          beat.style.setProperty("--rail-fill", `${midpoint - beatTops[position]}px`);
          if (index !== activeIndex) {
            beat.setAttribute("data-story-position", position < index ? "passed" : position === index ? "current" : "ahead");
          }
        });

        if (index !== activeIndex) {
          activeIndex = index;
          setActive(index);
        }
      });
    }

    function onMediaChange() {
      element?.toggleAttribute("data-sticky-ready", media.matches);
      sync();
    }

    const anchor = document.getElementById(window.location.hash.slice(1));
    const anchorTop = anchor?.getBoundingClientRect().top;
    onMediaChange();
    // An initial fragment can land before the stacked layout switches to sticky.
    // Keep a visible target in view without jumping back to an offscreen fragment.
    if (media.matches && anchorTop !== undefined && anchorTop >= 0 && anchorTop < window.innerHeight) {
      anchor?.scrollIntoView();
    }
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    window.addEventListener("hashchange", sync);
    media.addEventListener("change", onMediaChange);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("hashchange", sync);
      media.removeEventListener("change", onMediaChange);
    };
  }, []);

  return (
    <div ref={story} className="landing-container landing-story">
      <div className="landing-steps">{children}</div>
      <div className="landing-sticky" aria-hidden="true">
        {visuals.map((visual, index) => (
          <div key={index} className="landing-slide" data-active={active === index}>
            {visual}
          </div>
        ))}
      </div>
    </div>
  );
}
