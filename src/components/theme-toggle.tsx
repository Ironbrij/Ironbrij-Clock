import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THEME_STORAGE_KEY } from "@/lib/theme";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  // The theme class itself is applied before first paint by themeInitScript
  // (see __root.tsx); this only syncs the button's icon and pressed state to
  // whatever that script decided.
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Storage blocked — the toggle still works for this page view.
    }
  };

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Dark mode" aria-pressed={dark}>
      {dark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </Button>
  );
}
