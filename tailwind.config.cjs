module.exports = {
  content: ["./index.html", "./app.js"],
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--rgb-background) / <alpha-value>)",
        primary: "rgb(var(--rgb-primary) / <alpha-value>)",
        surface: "rgb(var(--rgb-surface) / <alpha-value>)",
        "surface-container-lowest": "rgb(var(--rgb-surface-container-lowest) / <alpha-value>)",
        "surface-container-low": "rgb(var(--rgb-surface-container-low) / <alpha-value>)",
        "surface-container": "rgb(var(--rgb-surface-container) / <alpha-value>)",
        "surface-container-high": "rgb(var(--rgb-surface-container-high) / <alpha-value>)",
        "surface-container-highest": "rgb(var(--rgb-surface-container-highest) / <alpha-value>)",
        "on-surface": "rgb(var(--rgb-on-surface) / <alpha-value>)",
        "on-surface-variant": "rgb(var(--rgb-on-surface-variant) / <alpha-value>)",
        outline: "rgb(var(--rgb-outline) / <alpha-value>)",
        "outline-variant": "rgb(var(--rgb-outline-variant) / <alpha-value>)",
        tertiary: "rgb(var(--rgb-tertiary) / <alpha-value>)",
        "status-active": "rgb(var(--rgb-status-active) / <alpha-value>)",
        error: "rgb(var(--rgb-error) / <alpha-value>)",
        "major-festival": "rgb(var(--rgb-major-festival) / <alpha-value>)",
        "rating-12": "rgb(var(--rgb-rating-12) / <alpha-value>)",
        "rating-all": "rgb(var(--rgb-rating-all) / <alpha-value>)",
        "primary-fixed": "rgb(var(--rgb-primary-fixed) / <alpha-value>)",
        // Age/festival badges carry white text, so they keep AA contrast in both themes.
        "badge-fest": "#ba1a1a",
        "badge-15": "#944925",
        "badge-19": "rgb(var(--rgb-badge-19) / <alpha-value>)"
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        full: "9999px"
      },
      spacing: {
        "margin-desktop": "64px",
        "margin-mobile": "24px",
        "section-gap": "80px",
        "container-max": "1280px",
        gutter: "24px"
      },
      fontFamily: {
        "body-md": ["system-ui", "-apple-system", "BlinkMacSystemFont", "Apple SD Gothic Neo", "Malgun Gothic", "sans-serif"],
        "display-lg": ["system-ui", "-apple-system", "BlinkMacSystemFont", "Apple SD Gothic Neo", "Malgun Gothic", "sans-serif"],
        "label-caps": ["system-ui", "-apple-system", "BlinkMacSystemFont", "Apple SD Gothic Neo", "Malgun Gothic", "sans-serif"],
        "schedule-time": ["ui-monospace", "SFMono-Regular", "Consolas", "Liberation Mono", "monospace"]
      },
      fontSize: {
        "label-caps": ["12px", { lineHeight: "1", letterSpacing: "0", fontWeight: "700" }]
      }
    }
  },
  plugins: [require("@tailwindcss/forms"), require("@tailwindcss/container-queries")]
};
