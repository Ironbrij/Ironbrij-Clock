// Presentation helpers plus the still-unwired Time off sample data.
// Everything else now comes from the database via the workspace store.

export type Role = "Admin" | "Manager" | "Member";

export const tasks = [
  "Development",
  "Design",
  "Client call",
  "Research",
  "QA & testing",
  "Admin",
];

export const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type TimeOffBalance = { id: string; label: string; used: number; total: number };

export const timeOffBalances: TimeOffBalance[] = [
  { id: "vacation", label: "Vacation", used: 9, total: 20 },
  { id: "sick", label: "Sick leave", used: 2, total: 10 },
  { id: "personal", label: "Personal days", used: 1, total: 5 },
];

export type TimeOffRequest = {
  id: string;
  type: string;
  range: string;
  days: number;
  status: "Approved" | "Pending" | "Declined";
  note: string;
};

export const timeOffHistory: TimeOffRequest[] = [
  { id: "r1", type: "Vacation", range: "4 – 8 August 2026", days: 5, status: "Pending", note: "Family trip up the coast" },
  { id: "r2", type: "Sick leave", range: "12 June 2026", days: 1, status: "Approved", note: "Migraine" },
  { id: "r3", type: "Personal", range: "22 May 2026", days: 1, status: "Approved", note: "House move" },
  { id: "r4", type: "Vacation", range: "7 – 11 April 2026", days: 5, status: "Approved", note: "Easter break" },
  { id: "r5", type: "Vacation", range: "3 March 2026", days: 1, status: "Declined", note: "Clashed with client launch" },
];

export function formatHours(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function formatMinutes(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}
