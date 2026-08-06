module.exports = {
  content: ["./index.html", "./app.js"],
  theme: {
    extend: {
      colors: {
        background: "#fdf8f6",
        primary: "#1c1b1a",
        surface: "#fdf8f6",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#f7f3f0",
        "surface-container": "#f1edeb",
        "surface-container-high": "#ece7e5",
        "surface-container-highest": "#e6e2df",
        "on-surface": "#1c1b1a",
        "on-surface-variant": "#4a463f",
        outline: "#7b776e",
        "outline-variant": "#ccc6bb",
        tertiary: "#944925",
        "status-active": "#2f6f68",
        error: "#ba1a1a",
        "major-festival": "#24211f",
        "rating-12": "#1d4ed8",
        "rating-all": "#15803d",
        "primary-fixed": "#e9e2d3"
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
