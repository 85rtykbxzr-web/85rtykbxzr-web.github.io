// Applies the theme before first paint: the visitor's saved choice, otherwise light.
// The site opens in light mode even when the device is set to dark; the toggle still switches.
(() => {
  let theme = "light";
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") theme = saved;
  } catch {
    // Storage can be unavailable (private mode); light still applies.
  }
  document.documentElement.dataset.theme = theme;
})();
