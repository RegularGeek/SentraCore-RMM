/**
 * SentraCore Design System — Tailwind config
 *
 * Values point at the CSS custom properties in ui/tokens/tokens.css rather
 * than duplicating hex codes, so tokens.css remains the single source of
 * truth whether a given piece of UI is styled with a Tailwind utility class
 * or a hand-written component class.
 *
 * This project has no bundler/framework — Tailwind is compiled with the
 * standalone Tailwind CLI (see package.json "build:css") into
 * ui/styles/tailwind.build.css, which is linked from the HTML pages
 * alongside tokens.css and the component CSS.
 */
module.exports = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./server/public/**/*.html",
    "./server/public/**/*.js",
  ],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "var(--sc-primary)", hover: "var(--sc-primary-hover)" },
        accent: "var(--sc-accent)",
        background: "var(--sc-background)",
        surface: { DEFAULT: "var(--sc-surface)", elevated: "var(--sc-surface-elevated)" },
        border: "var(--sc-border)",
        success: "var(--sc-success)",
        warning: "var(--sc-warning)",
        danger: "var(--sc-danger)",
        info: "var(--sc-info)",
        text: {
          primary: "var(--sc-text-primary)",
          secondary: "var(--sc-text-secondary)",
          muted: "var(--sc-text-muted)",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        display: ["var(--sc-text-display-size)", { lineHeight: "var(--sc-text-display-lh)", fontWeight: "var(--sc-text-display-weight)" }],
        h1: ["var(--sc-text-h1-size)", { lineHeight: "var(--sc-text-h1-lh)", fontWeight: "var(--sc-text-h1-weight)" }],
        h2: ["var(--sc-text-h2-size)", { lineHeight: "var(--sc-text-h2-lh)", fontWeight: "var(--sc-text-h2-weight)" }],
        h3: ["var(--sc-text-h3-size)", { lineHeight: "var(--sc-text-h3-lh)", fontWeight: "var(--sc-text-h3-weight)" }],
        h4: ["var(--sc-text-h4-size)", { lineHeight: "var(--sc-text-h4-lh)", fontWeight: "var(--sc-text-h4-weight)" }],
        "body-lg": ["var(--sc-text-body-lg-size)", { lineHeight: "var(--sc-text-body-lg-lh)" }],
        body: ["var(--sc-text-body-size)", { lineHeight: "var(--sc-text-body-lh)" }],
        small: ["var(--sc-text-small-size)", { lineHeight: "var(--sc-text-small-lh)" }],
        caption: ["var(--sc-text-caption-size)", { lineHeight: "var(--sc-text-caption-lh)", fontWeight: "var(--sc-text-caption-weight)" }],
      },
      spacing: {
        1: "var(--sc-space-1)",
        2: "var(--sc-space-2)",
        3: "var(--sc-space-3)",
        4: "var(--sc-space-4)",
        6: "var(--sc-space-6)",
        8: "var(--sc-space-8)",
        12: "var(--sc-space-12)",
        16: "var(--sc-space-16)",
        24: "var(--sc-space-24)",
      },
      borderRadius: {
        sm: "var(--sc-radius-sm)",
        md: "var(--sc-radius-md)",
        lg: "var(--sc-radius-lg)",
        xl: "var(--sc-radius-xl)",
        full: "var(--sc-radius-full)",
      },
      boxShadow: {
        sm: "var(--sc-shadow-sm)",
        md: "var(--sc-shadow-md)",
        lg: "var(--sc-shadow-lg)",
        focus: "var(--sc-shadow-focus)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "180ms",
        slow: "260ms",
      },
    },
  },
  plugins: [],
};
