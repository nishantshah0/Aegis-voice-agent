"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const STICKY_MEDIA = "(min-width: 1024px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)";

export function ScrollStory({ children, visuals }: { children: ReactNode; visuals: ReactNode[] }) {
  const story = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const element = story.current;
    if (!element) return;

    const beats = Array.from(element.querySelectorAll("[data-story-beat]"));
    const media = window.matchMedia(STICKY_MEDIA);
    let frame = 0;

    function sync() {
      cancelAnimationFrame(frame);
      if (!media.matches) return;

      frame = requestAnimationFrame(() => {
        const midpoint = window.innerHeight / 2;
        const index = beats.findLastIndex((beat) => beat.getBoundingClientRect().top <= midpoint);
        setActive(Math.max(0, index));
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
