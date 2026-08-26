import { useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const MAX_SUGGESTIONS = 8;

/**
 * A free-text input that suggests recently used descriptions as you type —
 * Clockify's "recent tasks" dropdown, adapted for a field that (unlike
 * Combobox) has no fixed option list: the typed text is always the value,
 * suggestions only ever fill it in, they never gate what can be submitted.
 */
export function DescriptionAutocomplete({
  id,
  value,
  onChange,
  suggestions,
  placeholder,
  disabled,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const query = value.trim().toLowerCase();
    const pool = query
      ? suggestions.filter((s) => s.toLowerCase().includes(query) && s.toLowerCase() !== query)
      : suggestions;
    return pool.slice(0, MAX_SUGGESTIONS);
  }, [value, suggestions]);

  const open = focused && matches.length > 0;

  const select = (text: string) => {
    onChange(text);
    setFocused(false);
    inputRef.current?.focus();
  };

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <Input
          id={id}
          ref={inputRef}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          className={className}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value);
            setHighlighted(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlighted((h) => (h + 1) % matches.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted((h) => (h - 1 + matches.length) % matches.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              select(matches[highlighted]);
            } else if (e.key === "Escape") {
              setFocused(false);
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-(--radix-popover-trigger-width) p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {matches.map((m, i) => (
          <button
            key={m}
            type="button"
            // Fires before the input's blur, so preventDefault here keeps
            // focus in the input instead of losing it (and closing this
            // dropdown) before the click is registered.
            onMouseDown={(e) => {
              e.preventDefault();
              select(m);
            }}
            className={cn(
              "block w-full truncate rounded-sm px-2 py-1.5 text-left text-sm",
              i === highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
            )}
          >
            {m}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
