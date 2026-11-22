# Aegis brand

**Aegis** (the shield in Greek myth) is an AI phone line for pharmacies. The project started as Refill Guard; the product name is now Aegis.

Calm, precise, clinical but warm. One warm green palette on cream, natural tones only: a soft garden glow drifts behind every page, headlines are a light editorial serif, and nothing is neon or loud. The product UI is the picture: no stock art or emoji.

**The line:** *The AI can be fooled. The pharmacy can't.*

## Logo

| File | Use |
|---|---|
| `public/brand/mark.svg` | The mark alone, on light backgrounds. Works down to 16 px. |
| `public/brand/mark-dark.svg` | The mark on a dark green background (dark slides). |
| `public/brand/logo.svg` | Mark plus wordmark, on light backgrounds. Text is outlined, so it renders the same everywhere (README, slides). |
| `public/brand/logo-dark.svg` | Mark plus wordmark, on dark green. |
| `public/brand/wordmark.svg` | The word alone, for tight spaces where the mark already appears. Set in Instrument Serif (SIL Open Font License), the headline face, and outlined. |
| `public/brand/icon-512.png` | Square app icon (the mark on a transparent background), for slides and Devpost. |
| `public/brand/social-preview.png` | 1280×640 GitHub and link preview. |
| `app/icon.svg`, `app/favicon.ico`, `app/apple-icon.png` | Browser and home-screen icons (Next.js file conventions). |

**The mark** is our shield carrying a five-point sheriff's star with ball tips, with the two-tone capsule at its centre: the pharmacy (the capsule) under rules that are the law (the star), inside rules it can't get out of (the shield). The star is our nod to Hack Western, where Aegis was built; it is our own drawing, not Hack Western's logo or art. In code, use `<Mark />` or `<Logo />` from `components/ui`: they take their colours from the tokens, and `<Logo />` sets the word in the live headline serif.

- Clear space around the logo: at least the mark's width on every side.
- Minimum size: mark 16 px, full logo 96 px wide.
- Never recolour, stretch, rotate, outline or add effects. Never put the green mark on a busy background.
- Write the name as **Aegis**: one word, capital A. Describe it as "an AI phone line for pharmacies". The repo and code still say `refill-guard`; that is fine and stays.

## Colour

Tokens live in `app/globals.css` as CSS variables (`--rg-*`) and Tailwind colours. Use the Tailwind names (`bg-canvas`, `text-ink-2`, `bg-accent`...), never raw hex in components. Every theme class (`theme-light`, `theme-dark`, `theme-app`) now uses the same light palette, so existing pages opt in unchanged.

| Token | Value | Use |
|---|---|---|
| `canvas` | `#F7F4EA` | Page background (warm cream) |
| `surface` | `#FDFBF5` | Cards |
| `sunken` | `#EFEADB` | Wells, chips, agent bubbles |
| `line` / `line-strong` | `#E1DAC6` / `#C4BB9F` | Borders |
| `ink` | `#1F2B1F` | Text (deep forest, never pure black) |
| `ink-2` | `#46523F` | Secondary text |
| `ink-3` | `#77806A` | Labels, metadata |
| **`accent`** | **`#4D7C3A`** | Fern green: primary buttons, the mark, "0 rules broken", focus rings |
| `quick` | `#9A7424` | Quick check lane (ochre) |
| `review` | `#A2593C` | Review lane (clay) |
| `stop` | `#A3452E` | Blocked lines, refusals, Deny, the BLOCKED stamp (brick) |
| `label` | `#DFE8BF` | The pale sage sticker |

The **Safety suite** adds `theme-safety`: eucalyptus `#4A7F70` instead of fern, so it reads as its own desk while staying in the family. Each of `accent`, `quick`, `review` and `stop` has a `-soft` tint for badge backgrounds.

**One palette.** Green is the only colour used at size. Lane and state colours are muted earth tones, for badges, dots and small text, never large fills.

**Light everywhere.** The landing page, the stage (a projector), the patient's phone and the signed-in app (`/app`) share the cream base. Behind each page sits `<Aurora />` (`components/landing/Aurora.tsx`): soft sage, olive, moss and wheat lights that drift slowly on the landing, stage and phone, and hold still in the app (`<Aurora soft />`) so tables stay calm. Panels over it use `rg-glass` (a frosted cream).

**In the app (Trail #72):** times are `<When iso>` (relative, full time on hover), loading is `Skeleton*`, empty states are one line plus the next step (`TableEmpty action=…`), charts are `Sparkline`, `StackedBar` and `Columns` from real data only, and demo levers live in the top bar's Demo menu, never on a page.

**Every page links home.** The app's logo and the stage's logo go to `/`, and the app, stage and phone each have a "← Main site" link.

## Western touches (Hack Western 13)

A nod to where Aegis was built, kept small so it still reads as a health product.

- **Where:** the brand art (logo, icons) and the README. The dashboard stays plain; its only touches are the badge icon for the Safety suite ("the law") and one empty state ("Nothing waiting. The herd's all set.").
- **Leather tan** (`tan`: `#8A6A3B`): the "Built at Hack Western 13" tag. Never for buttons, numbers or status.
- **Drawings** in `components/landing/Western.tsx`, all our own: `Horseshoe`, `HorseHead` (line drawing), `StitchDivider` (a dashed seam with a horseshoe), `HoofTrail`, `BuiltAtHackWestern`.
- **Don't:** use Hack Western's logo, mascot or artwork, rope fonts, wanted-poster textures, or slab type.

## Lanes

Always the same name, colour and order. Use `<LaneBadge lane=... />`.

| Lane | Colour | Means |
|---|---|---|
| Automatic | accent | Went through on its own |
| Quick check | quick | Policy-only, one tap from a pharmacist |
| Review | review | A pharmacist decides, with the reason attached |

## Type

Three faces, loaded once in `app/layout.tsx`:

- **Instrument Serif** (`font-display`, and every `h1` and `h2`): a light editorial serif in sentence case, set tight. Headlines, page and section titles, the wordmark, big figures (stat tiles, the ticker). One weight only, so never bold. Its italic is the editor's voice for asides (`font-serif italic`).
- **Schibsted Grotesk** (`font-sans`): everything you read.
- **IBM Plex Mono** (`font-mono`): small capital labels, buttons, codes, ids, button names, record entries and the AI's lines.

| Style | Classes |
|---|---|
| Display (landing hero) | `h1` at `text-[clamp(4rem,11.5vw,10.5rem)]` |
| H1 (page title) | `<PageHeader>`: `text-[34px] md:text-[44px]` |
| H2 (section) | `text-[22px]` in the app, up to `text-[clamp(2.75rem,6.5vw,6rem)]` on the landing |
| H3 | `text-xl font-semibold` (sans) |
| Body | `text-[15px] leading-relaxed text-ink-2` |
| Label (eyebrow) | `<Eyebrow>`, or `h2.rg-eyebrow` for a heading: mono, `text-[11px] uppercase tracking-[0.16em] text-ink-3` |
| Numbers | `font-display tabular-nums` |

## Components

The shared kit is `components/ui/` (import from `@/components/ui`): `Logo`, `Mark`, `Button`, `ButtonLink`, `Card`, `Eyebrow`, `Badge`, `LaneBadge`, `RuleTag`, `StatTile`, `SiteHeader`, `PageShell`, `PageHeader`, `SectionHeader`, `Table` (+ `RowNav`), `TableEmpty`, `When`, `Skeleton`, `Sparkline`, `StackedBar`, `Columns`, `chipClass`, `inputClass`. Build new screens from these before writing new styles.

- Buttons are square, in mono capitals; the primary (fern) has a hard ink offset shadow. One primary per view. `approve` and `deny` variants for decisions.
- Corners are cut sharp (print, not app); pills stay round. Cards: `rounded-card`, hairline `border-line`, `shadow-card`.
- Focus: every interactive element shows the green focus ring (`:focus-visible`, set globally). Never remove it.
- Touch targets at least 40 px high on the phone and console.

## Motion

Short and only to show what changed: 150 to 300 ms for UI, up to 550 ms for the gate. Use `rg-rise` (fade up on load), `rg-strike` (a blocked line draws its strike), `rg-ring` (a live call), `rg-redact` (a censor bar swipes across a line) and `rg-stamp` (the BLOCKED stamp lands). Slow ambient motion: `<Aurora />` and the `rg-mesh` and `rg-rainbow` panels. The glow is drawn with gradients, never a live blur, so it stays cheap. Everything respects `prefers-reduced-motion`.

## Words

Short and concrete. Say what the product does, with real numbers from `results/` only.

- Do: "0 rules broken across 77,648 hostile press sequences." "A pharmacist sees only the tricky calls."
- Don't: "Revolutionize pharmacy care with AI-powered...", "seamless", "cutting-edge", exclamation marks, emoji.
- Patients are made up (phone numbers 555-01xx). Never a real person.
