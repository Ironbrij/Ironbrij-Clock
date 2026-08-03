import { Check } from "lucide-react";
import { dotColors } from "@/lib/workspace-store";
import { cn } from "@/lib/utils";

export function ColorDotPicker({
  value,
  onChange,
  colors = dotColors,
}: {
  value: string;
  onChange: (color: string) => void;
  colors?: string[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Select colour ${color}`}
          onClick={() => onChange(color)}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow",
            value === color ? "ring-2 ring-ring" : "hover:ring-2 hover:ring-border",
          )}
          style={{ backgroundColor: color }}
        >
          {value === color && <Check className="h-4 w-4 text-white" />}
        </button>
      ))}
    </div>
  );
}
