# Atrium v2 Design System — Figma-Ready Specification
### Light ("Day") + Dark ("Night") · v2.0 — humanized revision · supersedes v1.0

**What changed from v1 and why:** v1's sage-glow-on-dark and single green accent felt too template-like. v2 removes every glow, removes green entirely, and adopts the two moves that make Oura and Notion feel human: **(1) monochrome ink chrome** — buttons and interactive surfaces carry no brand color — and **(2) a muted multi-hue data palette** — color appears only in the user's data, in three quiet tones. Body typography moves to the platform's native system font; a quiet serif appears only where the coach "speaks."

**Three rules that define Atrium v2:**
1. **Color belongs to data, not chrome.** Buttons, tabs, and bubbles are ink. Dusty blue = readiness, charts, completion. Sand = sleep and secondary series. Soft coral = PRs and watch-outs, nothing else.
2. **Nothing pure, nothing glowing.** No `#000`, no `#FFF`, no shadows-as-decoration, no luminance effects. Day text is Notion's warm ink; Night is warm graphite under warm off-white text — the whole system shares one warm temperature, like paper and its negative.
3. **Modes change surfaces, never structure.** Layout, type, and spacing are identical in Day and Night.

> **Decisions locked (specimen round, June 2026):** night canvas = **warm graphite** · display = **quiet serif** · hero numerals = **light** · buttons = **ink**. These are final; the values below reflect them.

---

## 1. Figma setup — variables

One Variable Collection named **`Atrium`**, two modes: **Day**, **Night**. Bind every fill and stroke to these; never hard-code a hex on a layer.

### 1.1 Color variables

| Variable | Day | Night | Usage |
|---|---|---|---|
| `bg/canvas` | `#FBFBF9` | `#1A1918` | App background. Paper white / Warm graphite (never blue-black or slate-blue). |
| `bg/surface` | `#FFFFFF` | `#22211F` | Cards, sheets, coach chat bubbles, tab bar base. |
| `bg/surface-2` | `#F2F1ED` | `#2C2B28` | Inset value fields, segmented track, icon dots, ring track. |
| `border/hairline` | `#EAE8E3` | `#EBE8E0 @ 8%` | Card borders, row dividers. Always 1px. |
| `border/strong` | `#D9D6CF` | `#EBE8E0 @ 17%` | Ghost buttons, unchecked set circles, suggestion chips. |
| `text/primary` | `#37352F` | `#EBE8E0` | Notion's warm ink by day; warm off-white by night. Never pure black/white. |
| `text/muted` | `#787774` | `#A39F97` | Secondary copy, labels, metadata. |
| `text/faint` | `#B3AFA7` | `#6E6A63` | Ghost values, inactive tabs, table headers. |
| `action/ink` | `#37352F` | `#EBE8E0` | Primary buttons, FAB, user chat bubble. The chrome color — same value as `text/primary`, intentionally. |
| `action/on-ink` | `#FFFFFF` | `#1A1918` | Text/icons on `action/ink`. |
| `data/blue` | `#6E87A8` | `#8FA9CD` | Readiness ring, set-check fill, primary chart line, completed segments, positive deltas, "Applied" state. |
| `data/sand` | `#B99F6F` | `#D3B788` | Sleep series, volume bars, secondary chart series. |
| `data/coral` | `#C06E54` | `#D08D72` | PR stamp cards, watch-out cards, chart endpoint dot, plan-diff reductions. Scarce by law. |

> Night values of the data hues are lightened (+~15 L) so they sit comfortably on graphite without saturating. There is no green, no purple, no gradient, and no glow anywhere in the system.

### 1.2 Number variables (single mode)

| Variable | Value | Usage |
|---|---|---|
| `radius/card` | `12` | Cards, sheets, chat bubbles |
| `radius/control` | `8` | Buttons, chips, inset fields, segmented controls |
| `space/1…8` | `4, 8, 12, 16, 20, 24, 32, 40` | The only spacing values allowed |
| `border/width` | `1` (1.5 for stamp cards & check circles) | |

---

## 2. Typography

Three roles. Two downloadable faces + the platform's native font.

| Role | Family | Notes |
|---|---|---|
| Display (the coach's voice) | **Source Serif 4** — 500, 600 | Greetings, screen titles, card titles, review headlines, PR titles. Google Fonts; iOS fallback New York, generic Georgia. |
| Body + UI | **System** (SF Pro on iOS / Roboto on Android) | In Figma, use **SF Pro Text/Display** as the stand-in. This native-font choice is most of the "feels like a real app" effect. |
| Data rows | **IBM Plex Mono** — 400, 500 | Set logging, plan diffs, ghost values, axis labels. Tabular figures always. |

Figma **text styles** (px / line-height multiple / tracking %):

| Style | Face & weight | Size | Line | Track | Used for |
|---|---|---|---|---|---|
| `Display/XL` | Source Serif 4 · 600 | 25 | 1.25 | -1% | Today greeting, screen titles |
| `Display/L` | Source Serif 4 · 600 | 23 | 1.25 | -1% | Weekly review headline |
| `Display/M` | Source Serif 4 · 600 | 20 | 1.3 | -1% | Card titles |
| `Display/S` | Source Serif 4 · 600 | 18 | 1.3 | -1% | Exercise & PR titles |
| `Body/M` | SF Pro · Regular | 13.5 | 1.55 | 0 | Body copy, chat |
| `Body/S` | SF Pro · Regular | 12.5 | 1.5 | 0 | Secondary copy |
| `Label/Caps` | SF Pro · Semibold | 10 | 1.2 | +8%, ALL CAPS | Eyebrows, table headers |
| `Hero/Num-XL` | SF Pro · **Light (300)** | 26 | 1.1 | -2% | Readiness score, stat tiles, rest countdown — the Oura move: big numbers set thin |
| `Hero/Num-L` | SF Pro · Light (300) | 20 | 1.1 | -2% | Summary stat tiles |
| `Data/M` | Plex Mono · 500 | 14 | 1.2 | -1% | Set-row values |
| `Data/S` | Plex Mono · 400 | 12 | 1.2 | 0 | Ghost values, rep ranges, diffs, axes |
| `Button` | SF Pro · Semibold | 14.5 | 1 | 0 | Buttons (sentence case, never caps) |

Voice rules: sentence case everywhere except `Label/Caps`. Serif appears **only** where the coach addresses the user — if a string is UI furniture, it's system sans. Hero numbers are thin and large; row data is mono and small; the two never swap jobs.

---

## 3. Layout grid

375 × 812 reference frame · 20px screen margins · 18px card padding · 14px card gap · 92px bottom clearance for the tab bar. Two-column grids (stat tiles) use a 14px gutter. Whitespace is still the brand: when in doubt, add 16, don't remove it.

---

## 4. Elevation & effects

| Element | Day | Night |
|---|---|---|
| Cards | None — 1px hairline only | Same |
| Primary button / FAB | Y1 B2, black @ 15% (a press affordance, not decoration) | Y1 B2, black @ 30% |
| Rest banner (floating) | Y16 B34 S-14, black @ 25% | Same |
| Readiness ring | **Matte. No glow in either mode.** | Same |

---

## 5. Component anatomy (Figma components, Day/Night via variable modes)

**Primary button** — H 48, full width, `radius/control`, fill `action/ink`, `Button` style in `action/on-ink`. Pressed: Y+1. Success variant: fill `data/blue`.
**Ghost button** — same geometry, no fill, 1px `border/strong`, text `text/primary`.
**Card** — fill `bg/surface`, 1px `border/hairline`, `radius/card`, padding 18. **Stamp variant:** 1.5px `data/coral` border; eyebrow in `data/coral`; title in `Display/S`.
**Eyebrow label** — `Label/Caps` in `text/muted`, 6–8 to the title below.
**Readiness ring** — 88×88; track 6px `bg/surface-2`; fill 6px `data/blue`, round caps, arc = score %, from 12 o'clock; center `Hero/Num-XL` + `Label/Caps`. Matte.
**Set row** — grid 34 / 1fr / 1fr / 1fr / 40, gap 8, padding-y 8, 1px hairline top rule. Set # & ghost in `Data/S` `text/faint`; value fields: `bg/surface-2`, `radius/control`, H 36, `Data/M` centered. Check: 32ø, 1.5px `border/strong`; done = fill `data/blue`, check glyph in `action/on-ink` (Night) / white (Day), row values at 50%.
**Rest banner** — floats 20 from sides, 90 above bottom; `bg/surface`, 1px `border/strong`, `radius/card`, padding 13×17; `Label/Caps` "REST" over `Hero/Num-XL` countdown; Skip = underlined `text/muted` text button.
**Consistency meter** — 4 segments H 5, radius 3, gap 6; done `data/blue`, pending `bg/surface-2`.
**Chat bubbles** — max 84%, padding 13×15, `radius/card` (tail corner 4). Coach: surface + hairline. User: `action/ink` + `action/on-ink`.
**Tab bar** — H 78, `bg/canvas @ 92%` + blur 14, hairline top. Icons 22, 1.8px rounded stroke. Active = `text/primary` (ink — never colored). FAB 52ø `action/ink`.
**Charts** — primary line 2.2px `data/blue`; secondary series `data/sand` (dotted 1×6 if same chart); area `data/blue @ 7%`; gridlines hairline; endpoint dot 4r `data/coral`; axes `Label/Caps` in `text/faint`. Bars/plates: 9px slabs radius 3 `data/sand @ 85%`.
**Iconography** — 22px frame, 1.8px stroke, round caps, no fills.

---

## 6. Motion

Screen transitions 220ms ease-out fade + 6px rise · set check 150ms · mode switch 350ms surface cross-fade · PR moment: coral border draws in over 400ms with a gentle 1.02 scale settle — **no confetti, no particles** (restraint is the brand; reduced-motion gets a plain fade) · countdown numerals tick without layout shift (tabular figures).

---

## 7. Frames to build

Same seven as v1: Today · Active Workout (+ rest-banner overlay variant) · Workout Summary · Progress · Coach · Weekly Review · Profile. Build once with variables bound and switch modes via the collection — that's the point of the setup.

```
📄 Atrium v2 Design System
 ├─ 🗂 Cover & principles (the three rules, verbatim)
 ├─ 🗂 Foundations  (variables, type styles, spacing, icons)
 ├─ 🗂 Components   (§5, Day/Night via modes)
 └─ 🗂 Screens      (7 frames, prototype-wired: Today→Workout→Summary→Today; Coach→Review)
```

---

## 8. Do / Don't

**Do** keep chrome monochrome; let the serif speak only in the coach's voice; set heroes thin and data mono; use coral like a wax seal; keep Night graphite-warm, never blue.

**Don't** add green, purple, gradients, or any glow; use pure black or pure white; color a button; put the serif on UI labels; let coral touch anything that isn't a PR or watch-out; add a shadow a press-state doesn't require.

---

*Source of truth: this spec + the Atrium v2 prototype (HTML) + the specimen sheet. Where they differ, the prototype's rendered values win. v1 (pine/sage/Manrope) is deprecated.*
