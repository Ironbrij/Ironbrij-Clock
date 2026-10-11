import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { BillingRatesTab } from "@/components/billing-rates-tab";
import { CasualServiceTab } from "@/components/casual-service-tab";
import { PlacementsTab } from "@/components/placements-tab";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// The finance tabs, moved out of Manage so Manage is only about running the
// team (approvals, schedules, entries, activity) and the accounts workflow
// sits next to Reports. Each tab component still does its own canManage
// check, and RLS still decides what any of them can load. Old
// /manage?tab=casual|rates|placements links redirect here (see manage.tsx).
const BILLING_TABS = [
  { id: "casual", label: "Casual Service" },
  { id: "rates", label: "Billing Rates" },
  { id: "placements", label: "Placements" },
] as const;
type BillingTab = (typeof BILLING_TABS)[number]["id"];

const isBillingTab = (v: unknown): v is BillingTab => BILLING_TABS.some((t) => t.id === v);

export const Route = createFileRoute("/billing")({
  // The default (first) tab stays out of the URL, same as Manage.
  validateSearch: (search: Record<string, unknown>): { tab?: BillingTab } => ({
    tab: isBillingTab(search.tab) && search.tab !== BILLING_TABS[0].id ? search.tab : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Billing — IronTrack" },
      {
        name: "description",
        content: "Casual service entries, client billing rates and VA placements.",
      },
      { property: "og:title", content: "Billing — IronTrack" },
      {
        property: "og:description",
        content: "Casual service, billing rates and placements in one place.",
      },
    ],
  }),
  component: BillingPage,
});

function BillingPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: BillingTab = search.tab ?? BILLING_TABS[0].id;

  return (
    <AppShell
      title="Billing"
      subtitle="Casual service, client rates and placements — what clients are charged."
    >
      <Tabs
        value={tab}
        onValueChange={(value) =>
          void navigate({
            search: { tab: value === BILLING_TABS[0].id ? undefined : (value as BillingTab) },
            replace: true,
          })
        }
      >
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          {BILLING_TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === "casual" ? (
        <CasualServiceTab />
      ) : tab === "rates" ? (
        <BillingRatesTab />
      ) : (
        <PlacementsTab />
      )}
    </AppShell>
  );
}
