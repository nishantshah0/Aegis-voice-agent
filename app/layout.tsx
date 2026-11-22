import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Instrument_Serif, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

// Type: a light editorial serif for headlines, a grotesk for reading, a mono for labels.
//   Instrument Serif: a light editorial serif for every headline, and in italic for asides.
//   Schibsted Grotesk: a newspaper grotesk for reading text.
//   IBM Plex Mono: the machine's voice: buttons, codes, record entries, the AI's lines.
const serif = Instrument_Serif({ variable: "--font-instrument", subsets: ["latin"], weight: "400", style: ["normal", "italic"], display: "swap" });
const sans = Schibsted_Grotesk({ variable: "--font-sans-body", subsets: ["latin"], display: "swap" });
const mono = IBM_Plex_Mono({ variable: "--font-mono-body", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

/** The server's public address, if APP_BASE_URL holds a valid URL; never throws. */
function baseUrl(): URL {
  // APP_BASE_URL may list several origins (comma-separated, for Auth0); links use the first.
  const raw = process.env.APP_BASE_URL?.split(",")[0]?.trim();
  // Without a usable APP_BASE_URL (a local build), say localhost out loud rather than leave it unset (build warning).
  return new URL(raw && URL.canParse(raw) ? raw : "http://localhost:3000");
}

export const metadata: Metadata = {
  // Absolute link-preview URLs on the hosted server (APP_BASE_URL is already set for Auth0).
  metadataBase: baseUrl(),
  // Pages set their own full title ("Stage · Aegis"), so there is no template.
  title: "Aegis · The AI can be fooled. The pharmacy can't.",
  description:
    "An AI phone line for pharmacies. It calls patients before their medication runs out, handles refills, and sends only the tricky calls to a pharmacist. Every action goes through rules in code.",
  applicationName: "Aegis",
  openGraph: {
    title: "Aegis",
    description: "The AI can be fooled. The pharmacy can't.",
    images: [{ url: "/brand/social-preview.png", width: 1280, height: 640, alt: "Aegis" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f4ea",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: browser extensions add attributes to <html> (e.g. data-wda-bridge)
    // before React loads; this only silences attribute differences on this one tag.
    <html lang="en" suppressHydrationWarning className={`${serif.variable} ${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
