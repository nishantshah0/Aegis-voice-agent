import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

// One typeface for the product (Inter); a mono only for codes, ids and figures in the record.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** The server's public address, if APP_BASE_URL holds a valid URL; never throws. */
function baseUrl(): URL | undefined {
  const raw = process.env.APP_BASE_URL?.trim();
  return raw && URL.canParse(raw) ? new URL(raw) : undefined;
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
  themeColor: "#0a0b0a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
