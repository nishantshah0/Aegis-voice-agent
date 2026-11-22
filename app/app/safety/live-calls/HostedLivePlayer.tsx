"use client";

import { LiveTestPlayer } from "@/app/simulation/SimulationCallPlayer";

export function HostedLivePlayer() {
  // Only one audio player is mounted on this page.
  return <LiveTestPlayer preferred="family_callback" focus={() => {}} />;
}
