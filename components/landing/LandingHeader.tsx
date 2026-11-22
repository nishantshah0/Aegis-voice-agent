"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function LandingHeader({ children }: { children: ReactNode }) {
  const header = useRef<HTMLElement>(null);
  const [overHero, setOverHero] = useState<boolean | null>(null);

  useEffect(() => {
    const bar = header.current;
    const hero = document.getElementById("landing-hero");
    if (!bar || !hero) return;

    let observer: IntersectionObserver | undefined;
    const resize = new ResizeObserver(() => {
      observer?.disconnect();
      const height = bar.getBoundingClientRect().height;
      setOverHero(hero.getBoundingClientRect().bottom > height);
      observer = new IntersectionObserver(
        ([entry]) => setOverHero(entry.intersectionRect.height > 0),
        { rootMargin: `-${height}px 0px 0px`, threshold: Number.EPSILON },
      );
      observer.observe(hero);
    });
    resize.observe(bar);

    return () => {
      resize.disconnect();
      observer?.disconnect();
    };
  }, []);

  return (
    <header
      ref={header}
      className="landing-header"
      data-over-hero={overHero ?? true}
      data-scroll-ready={overHero === null ? undefined : ""}
    >
      {children}
    </header>
  );
}
