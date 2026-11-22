"use client";

import { useEffect, useState } from "react";

const VIDEO = "/brand/hero-flowers-dithered-4x4.mp4";
const POSTER = "/brand/hero-flowers-poster.webp";

export function HeroBackground() {
  const [motionAllowed, setMotionAllowed] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setMotionAllowed(!preference.matches);

    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  return (
    <div className="landing-hero-media" aria-hidden="true">
      {motionAllowed && (
        <video src={VIDEO} poster={POSTER} autoPlay muted loop playsInline preload="none" />
      )}
    </div>
  );
}
