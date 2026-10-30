import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { ProjectDot } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { WorkspaceProject } from "@/lib/workspace-store";

type PickerProject = Pick<WorkspaceProject, "id" | "name" | "client" | "color">;

/**
 * The Time page's project picker (2026-10-30): the old dropdown's Recent
 * group and colour dots, plus a search box that matches a project's name or
 * its client's, for when the list is too long to scroll.
 */
export function ProjectPicker({
  id,
  value,
  onChange,
  recent,
  rest,
  noneOption,
  disabled,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string;
  value: string;
  onChange: (projectId: string) => void;
  recent: PickerProject[];
  rest: PickerProject[];
  /** A first choice that isn't a project, such as the timer's "No project". */
  noneOption?: { value: string; label: string };
  disabled?: boolean;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = [...recent, ...rest].find((p) => p.id === value);
  const choose = (projectId: string) => {
    onChange(projectId);
    setOpen(false);
  };

  // cmdk filters on `value`: name and client so either finds it, and the id
  // so two projects with the same name stay two items.
  const item = (p: PickerProject) => (
    <CommandItem key={p.id} value={`${p.name} ${p.client} ${p.id}`} onSelect={() => choose(p.id)}>
      <Check className={cn("h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
      <ProjectDot color={p.color} />
      <span className="truncate">{p.name}</span>
      <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{p.client}</span>
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected ? (
              <>
                <ProjectDot color={selected.color} />
                <span className="truncate">{selected.name}</span>
              </>
            ) : noneOption && value === noneOption.value ? (
              <span className="truncate">{noneOption.label}</span>
            ) : (
              <span className="truncate text-muted-foreground">Project</span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search projects or clients…" />
          <CommandList>
            <CommandEmpty>No project matches.</CommandEmpty>
            {noneOption && (
              <CommandGroup>
                <CommandItem value={noneOption.label} onSelect={() => choose(noneOption.value)}>
                  <Check
                    className={cn(
                      "h-4 w-4",
                      value === noneOption.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {noneOption.label}
                </CommandItem>
              </CommandGroup>
            )}
            {recent.length > 0 && (
              <>
                {noneOption && <CommandSeparator />}
                <CommandGroup heading="Recent">{recent.map(item)}</CommandGroup>
              </>
            )}
            {rest.length > 0 && (
              <>
                {(noneOption || recent.length > 0) && <CommandSeparator />}
                <CommandGroup heading={recent.length > 0 ? "All projects" : undefined}>
                  {rest.map(item)}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
