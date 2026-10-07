/** localStorage key holding the person's theme choice: "dark" | "light". */
export const THEME_STORAGE_KEY = "ironbrij-theme";

/**
 * Runs inline in <head>, before the first paint, so a dark-mode user never
 * sees the light theme flash in while React hydrates. Kept as a plain string
 * (not a function's .toString()) so minification can't change what ships.
 * Wrapped in try/catch because localStorage throws in some private-browsing
 * and blocked-storage setups — the page just stays light, as before.
 *
 * ThemeToggle reads the resulting class back rather than localStorage, so
 * the two can never disagree.
 */
export const themeInitScript = `try{if(localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})==="dark")document.documentElement.classList.add("dark")}catch(e){}`;
