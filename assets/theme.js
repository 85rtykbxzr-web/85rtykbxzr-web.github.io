// Applies a saved light/dark choice before first paint; without one the CSS follows the system.
(() => {
  try {
    const theme = localStorage.getItem("theme");
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  } catch {
    // Storage can be unavailable (private mode); the system preference still applies.
  }
})();
