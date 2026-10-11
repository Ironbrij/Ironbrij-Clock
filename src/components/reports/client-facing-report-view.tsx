// Split out of src/routes/reports.tsx. Presentation only: every figure is
// computed in Reports() and passed in, so this file holds no report logic.
import type { Dispatch, SetStateAction } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNextButton,
  PaginationPreviousButton,
} from "@/components/ui/pagination";
import { formatHours } from "@/lib/mock-data";
import type { WorkspaceSettings } from "@/lib/workspace/types";
import type { ClientFacingRow } from "./report-rows";

type ClientFacingReportViewProps = {
  clientFacingRows: ClientFacingRow[];
  clientFacingTotalHours: number;
  currentClientFacingPage: number;
  pagedClientFacingRows: ClientFacingRow[];
  profitTruncated: boolean;
  rangeLabel: string;
  setClientFacingPage: Dispatch<SetStateAction<number>>;
  settings: WorkspaceSettings;
  totalClientFacingPages: number;
};

export function ClientFacingReportView({
  clientFacingRows,
  clientFacingTotalHours,
  currentClientFacingPage,
  pagedClientFacingRows,
  profitTruncated,
  rangeLabel,
  setClientFacingPage,
  settings,
  totalClientFacingPages,
}: ClientFacingReportViewProps) {
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="text-base">Client hours · {rangeLabel}</CardTitle>
        <p className="text-xs text-muted-foreground">
          Safe to send out — no cost, pay rate or margin figures. Hours are what's invoiced
          {settings.clientBillingUpliftPct > 0
            ? `, including the ${settings.clientBillingUpliftPct}% uplift on Paid Casual work, rounded up`
            : ", rounded up"}
          . Remaining hours are the client's whole subscription allowance less everything ever
          rendered against it, not just this range.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {profitTruncated && (
          <p className="border-b border-border bg-destructive/10 px-5 py-3 text-sm text-destructive">
            This range has more entries than a single report can load, so these totals would be
            incomplete. Narrow the date range and try again.
          </p>
        )}
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3 text-left font-medium">Name</th>
              <th className="px-5 py-3 text-left font-medium">Client</th>
              <th className="px-5 py-3 text-left font-medium">Task</th>
              <th className="px-5 py-3 text-left font-medium">Description</th>
              <th className="px-5 py-3 text-right font-medium">Hours</th>
              <th className="px-5 py-3 text-right font-medium">Remaining Hours</th>
            </tr>
          </thead>
          <tbody>
            {profitTruncated ? null : clientFacingRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No client-facing work in this range.
                </td>
              </tr>
            ) : (
              pagedClientFacingRows.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-medium">{r.employeeName}</td>
                  <td className="px-5 py-3">{r.clientLabel}</td>
                  <td className="px-5 py-3 text-muted-foreground">{r.task}</td>
                  <td className="max-w-xs px-5 py-3 text-muted-foreground">
                    {r.description || <span title="No description was entered">—</span>}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {formatHours(r.billedHours)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                    {r.remainingHours == null ? (
                      <span title="This client has no subscription allowance set">—</span>
                    ) : r.remainingHours < 0 ? (
                      <span className="text-destructive">
                        {formatHours(Math.abs(r.remainingHours))} over
                      </span>
                    ) : (
                      formatHours(r.remainingHours)
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {!profitTruncated && clientFacingRows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/50">
                <td className="px-5 py-3 font-semibold">Total</td>
                <td className="px-5 py-3" />
                <td className="px-5 py-3" />
                <td className="px-5 py-3" />
                <td className="px-5 py-3 text-right font-semibold tabular-nums">
                  {formatHours(clientFacingTotalHours)}
                </td>
                <td className="px-5 py-3" />
              </tr>
            </tfoot>
          )}
        </table>
      </CardContent>
      {!profitTruncated && clientFacingRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-sm text-muted-foreground">
            {clientFacingRows.length} {clientFacingRows.length === 1 ? "line" : "lines"}
            {totalClientFacingPages > 1 &&
              ` · page ${currentClientFacingPage} of ${totalClientFacingPages} · the total and the export include every line`}
          </p>
          {totalClientFacingPages > 1 && (
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPreviousButton
                    disabled={currentClientFacingPage <= 1}
                    onClick={() => setClientFacingPage(currentClientFacingPage - 1)}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNextButton
                    disabled={currentClientFacingPage >= totalClientFacingPages}
                    onClick={() => setClientFacingPage(currentClientFacingPage + 1)}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}
    </Card>
  );
}
