# Aegis brand

**Aegis** (the shield in Greek myth) is an AI phone line for pharmacies. The project started as Refill Guard; the product name is now Aegis.

Calm, precise, clinical but warm. The site leads dark, like the products we measure ourselves against. One accent on a warm white or near-black base, one typeface, lots of space. The product UI is the picture: no illustrations, gradients, glows, emoji or stock art.

**The line:** *The AI can be fooled. The pharmacy can't.*

## Logo

| File | Use |
|---|---|
| `public/brand/mark.svg` | The mark alone, on light backgrounds. Works down to 16 px. |
| `public/brand/mark-dark.svg` | The mark on near-black (the stage, the phone, dark slides). |
| `public/brand/logo.svg` | Mark plus wordmark, on light backgrounds. Text is outlined, so it renders the same everywhere (README, slides). |
| `public/brand/logo-dark.svg` | Mark plus wordmark, on near-black. |
| `public/brand/wordmark.svg` | The word alone, for tight spaces where the mark already appears. Set in Alfa Slab One (SIL Open Font License), a Clarendon-style slab, and outlined. |
| `public/brand/icon-512.png` | Square app icon (white mark on green), for slides and Devpost. |
| `public/brand/social-preview.png` | 1280×640 GitHub and link preview. |
| `app/icon.svg`, `app/favicon.ico`, `app/apple-icon.png` | Browser and home-screen icons (Next.js file conventions). |

**The mark** is our shield carrying a five-point sheriff's star with ball tips, with the two-tone capsule at its centre: the pharmacy (the capsule) under rules that are the law (the star), inside rules it can't get out of (the shield). The star is our nod to Hack Western, where Aegis was built; it is our own drawing, not Hack Western's logo or art. In code, use `<Mark />` or `<Logo />` from `components/ui`: they take their colours from the tokens, so they switch with the theme.

- Clear space around the logo: at least the mark's width on every side.
- Minimum size: mark 16 px, full logo 96 px wide.
- Never recolour, stretch, rotate, outline or add effects. Never put the green mark on a busy background.
- Write the name as **Aegis**: one word, capital A. Describe it as "an AI phone line for pharmacies". The repo and code still say `refill-guard`; that is fine and stays.

## Colour

Tokens live in `app/globals.css` as CSS variables (`--rg-*`) and Tailwind colours. Use the Tailwind names (`bg-canvas`, `text-ink-2`, `bg-accent`...), never raw hex in components.

| Token | Light | Dark (`.theme-dark`) | Use |
|---|---|---|---|
| `canvas` | `#F7F7F4` | `#0A0B0A` | Page background |
| `surface` | `#FFFFFF` | `#131513` | Cards |
| `sunken` | `#EFEFEA` | `#1B1E1B` | Wells, chips, agent bubbles |
| `line` / `line-strong` | `#E3E3DD` / `#CFCFC7` | `#252925` / `#343934` | Borders |
| `ink` | `#0C0F0E` | `#F3F3EF` | Text |
| `ink-2` | `#474D4A` | `#B4B9B5` | Secondary text |
| `ink-3` | `#686E6B` | `#8B918D` | Labels, metadata (still 4.5:1) |
| **`accent`** | **`#0A7A4B`** | **`#3DDC97`** | Refill green: primary buttons, the mark, "0 rules broken", focus rings |
| `quick` | `#8A5800` | `#F5C451` | Quick check lane |
| `review` | `#A3360F` | `#FF8A5C` | Review lane |
| `stop` | `#B42318` | `#FF6B5E` | Blocked lines, refusals, Deny |

Each of `accent`, `quick`, `review` and `stop` has a `-soft` tint for badge backgrounds. Every text pair above meets WCAG AA (4.5:1) on its background.

**One accent.** Green is the only colour used at size. Lane and state colours are for badges, dots and small text, never large fills.

**Dark everywhere.** The landing page, the stage (a projector), the patient's phone (a call screen) and the signed-in app (`/app`) are dark. The app uses `theme-dark theme-app` (quieter surfaces for all-day reading); Pharmacy pages keep the green accent, Safety pages add `theme-safety` for the blue. Other dark screens: wrap them in `theme-dark` (or `<PageShell theme="dark">`) and every token switches.

**In the app (Trail #72):** times are `<When iso>` (relative, full time on hover), loading is `Skeleton*`, empty states are one line plus the next step (`TableEmpty action=…`), charts are `Sparkline`, `StackedBar` and `Columns` from real data only, and demo levers live in the top bar's Demo menu, never on a page.

## Western touches (Hack Western 13)

A nod to where Aegis was built, kept small so it still reads as a health product.

- **Where:** the landing page, the brand art (logo, icons, social preview) and the README. The dashboard stays plain; its only touches are the badge icon for the Safety suite ("the law") and one empty state ("Nothing waiting. The herd's all set.").
- **Leather tan** (`tan`: `#8A5A2B` light, `#D4A373` dark, both AA): stitched dividers, the hoofprint trail, the "Built at Hack Western 13" tag. Never for buttons, numbers or status.
- **Drawings** in `components/landing/Western.tsx`, all our own: `Horseshoe`, `HorseHead` (line drawing), `StitchDivider` (a dashed seam with a horseshoe), `HoofTrail`, `BuiltAtHackWestern`.
- **Don't:** use Hack Western's logo, mascot or artwork, rope fonts, wanted-poster textures, or slab type for body text.

## Lanes

Always the same name, colour and order. Use `<LaneBadge lane=... />`.

| Lane | Colour | Means |
|---|---|---|
| Automatic | accent | Went through on its own |
| Quick check | quick | Policy-only, one tap from a pharmacist |
| Review | review | A pharmacist decides, with the reason attached |

## Type

**Inter** for everything you read, loaded once in `app/layout.tsx` (`--font-inter`, Tailwind `font-sans`). **Geist Mono** only for codes, ids, button names and record entries (`font-mono`). The wordmark is the one slab: it is an outlined SVG (`<Wordmark />`), so no slab font loads and body text stays clean.

| Style | Classes |
|---|---|
| Display (landing hero) | `text-6xl lg:text-[4.5rem] font-semibold tracking-[-0.045em] leading-[1.02]` |
| H1 (page title) | `text-3xl md:text-4xl font-semibold tracking-[-0.03em]` |
| H2 (section) | `text-3xl md:text-5xl font-semibold tracking-[-0.035em]` |
| H3 | `text-xl font-semibold tracking-[-0.02em]` |
| Body | `text-[15px] leading-relaxed text-ink-2` |
| Label (eyebrow) | `<Eyebrow>`: `text-xs uppercase tracking-[0.08em] text-ink-3` |
| Numbers | `tabular-nums`, tight tracking, `font-semibold` |

## Components

The shared kit is `components/ui/` (import from `@/components/ui`): `Logo`, `Mark`, `Button`, `ButtonLink`, `Card`, `Eyebrow`, `Badge`, `LaneBadge`, `RuleTag`, `StatTile`, `SiteHeader`, `PageShell`, `PageHeader`, `SectionHeader`, `Table` (+ `RowNav`), `TableEmpty`, `When`, `Skeleton`, `Sparkline`, `StackedBar`, `Columns`, `chipClass`, `inputClass`. Build new screens from these before writing new styles.

- Buttons are pills. One primary (green) per view. `approve` and `deny` variants for decisions.
- Cards: `rounded-card`, hairline `border-line`, `shadow-card`. No heavy shadows.
- Focus: every interactive element shows the green focus ring (`:focus-visible`, set globally). Never remove it.
- Touch targets at least 40 px high on the phone and console.

## Motion

Short and only to show what changed: 150 to 300 ms for UI, up to 550 ms for the gate. Use `rg-rise` (fade up on load), `rg-strike` (a blocked line draws its strike) and `rg-ring` (a live call). Everything respects `prefers-reduced-motion`.

## Words

Short and concrete. Say what the product does, with real numbers from `results/` only.

- Do: "0 rules broken across 77,648 hostile press sequences." "A pharmacist sees only the tricky calls."
- Don't: "Revolutionize pharmacy care with AI-powered...", "seamless", "cutting-edge", exclamation marks, emoji.
- Patients are made up (phone numbers 555-01xx). Never a real person.
