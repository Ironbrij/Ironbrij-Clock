import { useState } from "react";
import { ClipboardCopy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { buildEodText } from "@/lib/eod";
import { useWorkspace, type WorkspaceEntry } from "@/lib/workspace-store";

/**
 * Copies one day's tasks as the plain-text end-of-day message (see
 * buildEodText). `entries` can span more than the day — only `day`'s are
 * used — so callers can pass a whole history list as-is.
 *
 * If the browser refuses clipboard access (permissions, a non-HTTPS
 * preview), the text opens in a dialog, already selected, to copy by hand
 * rather than failing with nothing to show for it.
 */
export function CopyEodButton({ day, entries }: { day: Date; entries: WorkspaceEntry[] }) {
  const { projectById } = useWorkspace();
  const [manualText, setManualText] = useState<string | null>(null);
  const text = buildEodText(day, entries, projectById);

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied — paste it into your EOD");
    } catch {
      setManualText(text);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs"
        disabled={!text}
        title={text ? "Copy this day's tasks for your end-of-day message" : "Nothing logged yet"}
        onClick={() => void copy()}
      >
        <ClipboardCopy className="h-3.5 w-3.5" />
        Copy EOD
      </Button>
      <Dialog open={manualText !== null} onOpenChange={(open) => !open && setManualText(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your EOD</DialogTitle>
            <DialogDescription>
              Your browser didn't allow copying automatically. The text below is selected — press
              Ctrl+C (or ⌘C) to copy it.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            readOnly
            autoFocus
            rows={Math.min(14, (manualText ?? "").split("\n").length + 1)}
            value={manualText ?? ""}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
