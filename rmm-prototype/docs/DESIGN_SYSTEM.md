# SentraCore Design System — v1.0

**Status:** official. Every future page, feature, and component in SentraCore RMM should be built from this system rather than one-off CSS.

Tagline: *Secure Infrastructure. Smarter Operations.*

---

## 1. Design Principles

Enterprise, minimal, professional, modern, security-first, readable, accessible, consistent.

Concretely, that means:

- **No neon-hacker aesthetic.** The prototype's cyan-glow "oscilloscope" traces have been retinted onto the token palette and the glow reduced (`shadowBlur` 6–8 → 2–3 in `app.js`). Status color still carries meaning; it no longer looks like a hacking-movie prop.
- **No heavy gradients or glassmorphism.** The one gradient in the system (the login background) is a very low-opacity radial wash, not a decorative surface treatment.
- **Subtle motion only.** Hover, focus, expand/collapse, fade — all 120–260ms ease transitions. Nothing bounces, scales dramatically, or auto-plays.
- **Familiar, not derivative.** Dark-first enterprise console, sidebar + topbar shell, data-dense cards — the same genre as Intune/Defender/Falcon/NinjaOne/Datadog/Linear/Tailscale, without copying any of them screen-for-screen.

---

## 2. Tokens

All tokens live in **`server/public/ui/tokens/tokens.css`** as CSS custom properties on `:root`, prefixed `--sc-`. This is the single source of truth — Tailwind's config (`tailwind.config.js`) references these same variables via `var(--sc-*)` rather than duplicating hex values, and the legacy `styles.css` now aliases its old variable names (`--bg`, `--cyan`, etc.) onto them too, so a color only ever has one real definition.

### Color

| Token | Value | Use |
|---|---|---|
| `--sc-primary` | `#2563EB` | Primary actions, links, focus accents |
| `--sc-primary-hover` | `#1D4ED8` | Primary hover/active state |
| `--sc-accent` | `#38BDF8` | Secondary accent, highlights |
| `--sc-background` | `#0F172A` | App background (dark) |
| `--sc-surface` | `#1E293B` | Cards, panels, sidebar, topbar |
| `--sc-surface-elevated` | `#334155` | Hover states, popovers, table header |
| `--sc-border` | `#334155` | All hairline borders |
| `--sc-success` | `#22C55E` | Online / healthy / completed |
| `--sc-warning` | `#F59E0B` | Warning / maintenance / pending |
| `--sc-danger` | `#EF4444` | Critical / failed / destructive actions |
| `--sc-info` | `#3B82F6` | Informational badges/banners |
| `--sc-text-primary` | `#F8FAFC` | Primary text |
| `--sc-text-secondary` | `#CBD5E1` | Secondary text, labels |
| `--sc-text-muted` | `#94A3B8` | Placeholders, disabled, captions |

**Contrast:** `--sc-text-primary` on `--sc-background` and on `--sc-surface` both exceed 12:1. `--sc-text-secondary` on `--sc-surface` is ~7.4:1. `--sc-text-muted` on `--sc-surface` is ~4.6:1 — usable for body text (WCAG AA needs 4.5:1) but avoid it for anything below 14px/bold. Status colors on their tinted backgrounds (badges, banners — see below) were chosen to also clear 4.5:1 against `--sc-surface`.

### Typography

Font: **Inter** (loaded from Google Fonts in both `login.html` and `index.html`, replacing the prototype's Space Grotesk). Monospace contexts (script output, agent tokens, code snippets) keep **IBM Plex Mono**.

| Role | Class | Size / Line-height | Weight |
|---|---|---|---|
| Display | `.sc-text-display` | 40 / 48 | 700 |
| Heading 1 | `.sc-text-h1` | 32 / 40 | 700 |
| Heading 2 | `.sc-text-h2` | 24 / 32 | 700 |
| Heading 3 | `.sc-text-h3` | 20 / 28 | 600 |
| Heading 4 | `.sc-text-h4` | 16 / 24 | 600 |
| Body Large | `.sc-text-body-lg` | 16 / 24 | 400 |
| Body | `.sc-text-body` | 14 / 20 | 400 |
| Small | `.sc-text-small` | 13 / 18 | 400 |
| Caption | `.sc-text-caption` | 12 / 16 | 500, uppercase |
| Button | *(built into `.sc-btn`)* | 14 / 20 | 600 |

### Spacing

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96` px, exposed as `--sc-space-1` … `--sc-space-24` and as Tailwind spacing keys `1,2,3,4,6,8,12,16,24`.

### Radius

`--sc-radius-sm` 4px · `--sc-radius-md` 8px · `--sc-radius-lg` 12px · `--sc-radius-xl` 16px · `--sc-radius-full` 9999px.

### Elevation (shadows)

Three tiers plus a focus ring, all intentionally subtle (low opacity, small blur, no dramatic floating effect):

- `--sc-shadow-sm` — cards at rest
- `--sc-shadow-md` — popovers, dropdown menus
- `--sc-shadow-lg` — dialogs, drawers
- `--sc-shadow-focus` — the universal focus ring (see Accessibility)

### Icon sizes

Lucide icons at `--sc-icon-16/20/24/32`, applied via `.sc-icon-16` etc. utility classes that just set `width`/`height`.

---

## 3. Tailwind

Tailwind is configured (`tailwind.config.js`) but this project has **no bundler** — it's static HTML/CSS/vanilla JS served from `server/public`. Rather than force in a framework, Tailwind is compiled with the **standalone Tailwind CLI**:

```bash
npm install          # installs the tailwindcss devDependency (repo root package.json)
npm run build:css    # one-off build -> server/public/ui/styles/tailwind.build.css
npm run watch:css    # rebuilds on change, for local dev
```

The compiled file is gitignored (generated artifact). **The hand-written component library in `ui/components/*.css` does not depend on this build** — it's plain CSS using the tokens directly, so the app renders correctly with zero build step. Tailwind utility classes are available as an *addition*, for one-off layout tweaks that don't deserve a new component class, not a replacement for the component library.

---

## 4. Icons

[Lucide](https://lucide.dev) via CDN (`unpkg.com/lucide@latest`), no build step:

```html
<i data-lucide="server" class="sc-icon-20"></i>
```

Call `SC.icons.refresh()` (from `ui/icons/icons.js`) after injecting new `data-lucide` markup dynamically — it's already called once on `DOMContentLoaded` for anything present at load.

---

## 5. Component Library

All in `server/public/ui/components/`. Import everything at once via `ui/styles/index.css`.

### Buttons (`buttons.css`)
`.sc-btn` + one of `--primary / --secondary / --ghost / --danger`. Add `--sm` / `--lg` for size, `--icon` for a square icon-only button (always pair with an `.sc-sr-only` label or `aria-label`).

### Inputs (`inputs.css`)
`.sc-field` wrapper with `.sc-label` (always `for=` an id) → `.sc-input` / `.sc-textarea` / `.sc-select`. Search (`.sc-search`), password reveal (`.sc-password-field`), checkbox/radio (native inputs, restyled — never div-based), and a toggle switch built on a real checkbox for keyboard/AT support.

### Badges (`badges.css`)
`.sc-badge--online/offline/critical/warning/healthy/maintenance/info`. Status → badge mapping used across the app:

| Status | Badge |
|---|---|
| Agent online | `--online` |
| Agent offline | `--offline` |
| Alert firing (breach) | `--critical` |
| Alert acknowledged | `--warning` |
| Script run: completed | `--healthy` |
| Script run: failed / timed_out | `--critical` |
| Script run: pending / running | `--warning` |

### Cards (`cards.css`)
`.sc-card` base, `--elevated` variant, plus role modifiers `--metric` (Overview tiles), `--device` (endpoint list items), `--alert` (drawer rows).

### Tables (`tables.css`)
`.sc-table-wrap > table.sc-table`, `.sc-th--sortable` for future sortable headers, `.sc-table-actions` for row-level buttons, `.sc-table-empty` for the zero-rows state.

### Navigation (`navigation.css`)
`.sc-topbar`, `.sc-sidebar` (+ `.is-collapsed` / `.is-open` for the responsive drawer), `.sc-breadcrumb`, `.sc-tabs`/`.sc-tab[aria-selected]`, `.sc-menu`/`.sc-menu-item` (dropdown or context menu — same markup), `.sc-pagination`.

### Notifications (`notifications.css` + `toast.js`)
`SC.toast.show(message, { variant })` for transient toasts (`role="status"` or `"alert"` depending on severity). `.sc-alert-banner--info/warning/danger/success` for persistent page-level banners. `.sc-inline-alert` for small form-adjacent errors.

### Progress (`progress.css`)
`.sc-spinner` (+ `--sm`/`--lg`), `.sc-skeleton` (shimmer placeholder), `.sc-progress > .sc-progress-bar` (+ status modifiers).

### Dialogs (`dialogs.css` + `dialog.js`)
`SC.dialog.confirm({ title, body, variant, confirmLabel, onConfirm })` — focus-trapped, ESC/backdrop-dismissible, `role="alertdialog"`. Covers confirmation and delete flows. Settings/profile dialogs use the same `.sc-dialog` shell with custom body content once those screens exist (see Technical Debt).

### Empty / Error / Loading states (`dialogs.css`)
`.sc-state`, `.sc-state--error`, `.sc-state-icon`, `.sc-state-title` — a consistent centered icon+title+body block for "no data yet," "couldn't load," etc.

---

## 6. Layouts

`server/public/ui/layouts/layouts.css`:

| Layout | Class | Status |
|---|---|---|
| Authentication | `.sc-layout-auth` | Built — `login.html` |
| Dashboard | `.sc-layout-dashboard` (+ `-body`, `-main`) | Built — `index.html` |
| Device detail | `.sc-layout-detail-head` | Scaffolded — the dashboard currently shows device detail inline in the right pane rather than as its own route; this class is ready for when it becomes one |
| Settings | `.sc-layout-settings` | Scaffolded — no settings page exists yet |
| Report | `.sc-layout-report` (print-aware via `.sc-no-print`) | Scaffolded — no report/export view exists yet |

---

## 7. Accessibility

- **Focus states:** a single `:focus-visible` rule in `base.css` applies `--sc-shadow-focus` (a 3px `primary`-colored ring) to *everything* by default; components only override it when they need a different shape (e.g. the toggle switch's track).
- **Keyboard navigation:** native `<button>`/`<input>`/`<select>` throughout — no click-only `<div>` controls. `SC.dialog.confirm()` traps Tab/Shift+Tab inside the dialog and restores focus to the trigger on close; ESC and backdrop-click both close it.
- **Forms:** `login.html` was migrated to real `<label for="...">` ↔ `id` pairs (previously the labels existed but weren't programmatically associated with their inputs). Error text uses `role="alert" aria-live="polite"`.
- **Contrast:** see the Color section above — text tokens were checked against `--sc-surface`/`--sc-background` for AA.
- **ARIA:** `.sc-tab` expects `aria-selected`; `.sc-breadcrumb` expects `aria-current="page"` on the active crumb; toasts use `role="status"` (info/success) or `role="alert"` (warning/danger) so screen readers announce failures immediately but don't interrupt for routine ones; the mobile sidebar toggle carries `aria-expanded`.
- **Known gap:** the alerts drawer and its rule form haven't been audited/relabeled yet — see Technical Debt.

---

## 8. Responsive Rules

Single breakpoint at **900px** (matches the point where the 280px sidebar + detail pane stop comfortably fitting a tablet in portrait):

- **Desktop (>900px):** sidebar is a permanent column.
- **Tablet/Mobile (≤900px):** sidebar becomes a fixed, full-height drawer (`position: fixed`, slides in via `transform`), triggered by the hamburger button that appears in the topbar (`#sidebarToggleBtn`, hidden above 900px). Wired by `ui/hooks/useSidebarToggle.js`, which also auto-closes the drawer if the viewport grows past 900px while it's open.
- Card grids (`.metric-grid`, `.inv-grid`) already used `auto-fit`/`minmax` in the prototype, which continues to reflow correctly at any width — no changes needed there.

---

## 9. Folder Structure

```
server/public/ui/
  tokens/       tokens.css                 — design tokens (colors, type, spacing, radius, shadow)
  styles/       index.css                  — single entry point, imports everything below in cascade order
                base.css                    — resets + typography utility classes
                tailwind.input.css          — Tailwind @tailwind directives (source for the CLI build)
                tailwind.build.css          — generated by `npm run build:css` (gitignored)
  components/   buttons.css, inputs.css, badges.css, cards.css, tables.css,
                navigation.css, notifications.css, progress.css, dialogs.css
                toast.js, dialog.js         — the two components with real interactive behavior
  layouts/      layouts.css                — page-level shells
  hooks/        useMediaQuery.js, useSidebarToggle.js — small reusable vanilla-JS behaviors
                                              (named "hooks" per the requested structure; this app
                                              has no framework, so they're plain functions, not React hooks)
  icons/        icons.js                    — Lucide loader/refresher

docs/
  DESIGN_SYSTEM.md   — this file
```

Nothing here duplicates styling: page-specific CSS that hasn't been migrated yet (`server/public/styles.css`) now *reads* the tokens instead of redefining colors, so there's exactly one definition of every color/spacing/radius value in the app.

---

## 10. Usage Guidelines

- **Always link `ui/styles/index.css` before `styles.css`** in `<head>`, so page-specific overrides (where they still exist) can win the cascade if truly needed.
- **New UI should not introduce new hex values.** If a color you need isn't a token, that's a sign to either reuse an existing token or raise it as a new token addition — not to hardcode it locally.
- **Prefer a component class over a Tailwind utility soup** for anything reused more than once (buttons, badges, cards). Reach for Tailwind utilities for one-off spacing/layout tweaks on a specific page.
- **Every interactive element needs a visible focus state and a keyboard path.** If you build something custom, don't remove the default `:focus-visible` behavior without replacing it with an equivalent.
- **Status color always goes through a badge or the status-color tokens**, never a one-off inline color, so "critical" always looks the same everywhere.

---

## Example: metric card (existing pattern, now documented)

```html
<div class="sc-card sc-card--metric">
  <div class="sc-card-header">
    <span class="sc-text-caption sc-text-secondary">CPU load</span>
    <span class="sc-metric-value">42<span class="sc-metric-unit">%</span></span>
  </div>
  <canvas class="trace" id="trace-cpu"></canvas>
  <div class="sc-metric-sub">8 cores</div>
</div>
```

## Example: status badge

```html
<span class="sc-badge sc-badge--online">Online</span>
<span class="sc-badge sc-badge--critical">Critical</span>
```

## Example: toast

```js
SC.toast.show("Alert rule saved", { variant: "success" });
SC.toast.show("Couldn't reach the server", { variant: "danger" });
```

## Example: confirmation dialog

```js
SC.dialog.confirm({
  title: "Delete this alert rule?",
  body: "This can't be undone.",
  variant: "danger",
  confirmLabel: "Delete",
  onConfirm: () => api(`/api/alert-rules/${id}`, { method: "DELETE" }),
});
```
