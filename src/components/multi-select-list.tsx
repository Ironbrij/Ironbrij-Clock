import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

export type MultiSelectOption = { id: string; label: string; hint?: string; color?: string };

export function MultiSelectList({
  options,
  selected,
  onToggle,
  emptyLabel = "Nothing to choose from yet.",
  height = "h-40",
}: {
  options: MultiSelectOption[];
  selected: string[];
  onToggle: (id: string) => void;
  emptyLabel?: string;
  height?: string;
}) {
  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ScrollArea className={`${height} rounded-xl border border-border`}>
      <ul className="divide-y divide-border">
        {options.map((o) => (
          <li key={o.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50">
              <Checkbox checked={selected.includes(o.id)} onCheckedChange={() => onToggle(o.id)} />
              {o.color && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: o.color }}
                />
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{o.label}</span>
                {o.hint && (
                  <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
