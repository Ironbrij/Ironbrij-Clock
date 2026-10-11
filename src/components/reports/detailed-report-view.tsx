// Split out of src/routes/reports.tsx. Presentation only: every figure is
// computed in Reports() and passed in, so this file holds no report logic.
import type { Dispatch, SetStateAction } from "react";
import { ProjectDot } from "@/components/app-shell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNextButton,
  PaginationPreviousButton,
} from "@/components/ui/pagination";
import { tintedChipStyle } from "@/lib/chip-style";
import { formatMinutes } from "@/lib/mock-data";
import { fromDateKey } from "@/lib/time-utils";
import type { WorkspaceTag } from "@/lib/workspace/types";
import type { DetailedReportRow } from "./report-rows";

type DetailedReportViewProps = {
  currentDetailedPage: number;
  filteredDetailed: DetailedReportRow[];
  pagedDetailed: DetailedReportRow[];
  setDetailedPage: Dispatch<SetStateAction<number>>;
  tags: WorkspaceTag[];
  totalDetailedPages: number;
};

export function DetailedReportView({
  currentDetailedPage,
  filteredDetailed,
  pagedDetailed,
  setDetailedPage,
  tags,
  totalDetailedPages,
}: DetailedReportViewProps) {
  return (
    <>
      <Card className="shadow-card">
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">Date</th>
                <th className="px-5 py-3 text-left font-medium">Employee</th>
                <th className="px-5 py-3 text-left font-medium">Project</th>
                {tags.length > 0 && <th className="px-5 py-3 text-left font-medium">Tags</th>}
                <th className="px-5 py-3 text-left font-medium">Task</th>
                <th className="px-5 py-3 text-left font-medium">Description</th>
                <th className="px-5 py-3 text-right font-medium">Hours</th>
                <th className="px-5 py-3 text-center font-medium">Billable</th>
              </tr>
            </thead>
            <tbody>
              {pagedDetailed.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                    {fromDateKey(r.date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2">
                      <Avatar className="h-6 w-6 shrink-0">
                        <AvatarImage src={r.employeeAvatarUrl ?? undefined} alt={r.employeeName} />
                        <AvatarFallback className="bg-secondary text-[10px]">
                          {r.employeeInitials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{r.employeeName}</span>
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2">
                      <ProjectDot color={r.projectColor} />
                      {r.projectName}
                    </span>
                  </td>
                  {tags.length > 0 && (
                    <td className="px-5 py-3">
                      {r.projectTags.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.projectTags.map((t) => (
                            <span
                              key={t.id}
                              className="rounded-full px-2 py-0.5 text-xs font-medium"
                              style={tintedChipStyle(t.color)}
                            >
                              {t.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  )}
                  <td className="px-5 py-3 text-muted-foreground">{r.task || "—"}</td>
                  <td
                    className="max-w-[280px] truncate px-5 py-3 text-muted-foreground"
                    title={r.description || undefined}
                  >
                    {r.description || "—"}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{formatMinutes(r.minutes)}</td>
                  <td className="px-5 py-3 text-center text-xs text-muted-foreground">
                    {r.billable ? "Billable" : "Non-billable"}
                  </td>
                </tr>
              ))}
              {pagedDetailed.length === 0 && (
                <tr>
                  <td
                    colSpan={tags.length > 0 ? 8 : 7}
                    className="px-5 py-8 text-center text-sm text-muted-foreground"
                  >
                    No entries in this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {filteredDetailed.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {filteredDetailed.length} {filteredDetailed.length === 1 ? "entry" : "entries"}
            {totalDetailedPages > 1 && ` · page ${currentDetailedPage} of ${totalDetailedPages}`}
          </p>
          {totalDetailedPages > 1 && (
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPreviousButton
                    disabled={currentDetailedPage <= 1}
                    onClick={() =>
                      currentDetailedPage > 1 && setDetailedPage(currentDetailedPage - 1)
                    }
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNextButton
                    disabled={currentDetailedPage >= totalDetailedPages}
                    onClick={() =>
                      currentDetailedPage < totalDetailedPages &&
                      setDetailedPage(currentDetailedPage + 1)
                    }
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}
    </>
  );
}
