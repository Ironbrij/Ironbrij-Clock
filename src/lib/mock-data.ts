export type Role = "Admin" | "Manager" | "Member";

export type Member = {
  id: string;
  name: string;
  initials: string;
  role: Role;
  title: string;
  teamId: string;
};

export const teams = [
  { id: "web", name: "Web Development", color: "oklch(0.62 0.15 256)" },
  { id: "design", name: "Design Studio", color: "oklch(0.65 0.16 320)" },
  { id: "seo", name: "SEO & Content", color: "oklch(0.68 0.15 145)" },
  { id: "ads", name: "Paid Media", color: "oklch(0.7 0.16 60)" },
  { id: "va", name: "VA Operations", color: "oklch(0.6 0.15 25)" },
  { id: "support", name: "Client Support", color: "oklch(0.66 0.13 200)" },
  { id: "finance", name: "Finance", color: "oklch(0.55 0.1 280)" },
  { id: "people", name: "People & Culture", color: "oklch(0.7 0.14 35)" },
  { id: "recruit", name: "Recruitment", color: "oklch(0.63 0.14 170)" },
  { id: "sales", name: "Sales", color: "oklch(0.6 0.17 300)" },
  { id: "social", name: "Social Media", color: "oklch(0.68 0.16 15)" },
  { id: "data", name: "Data & Automation", color: "oklch(0.58 0.12 230)" },
  { id: "qa", name: "Quality Assurance", color: "oklch(0.64 0.12 110)" },
];

export const members: Member[] = [
  { id: "m1", name: "Maya Alvarez", initials: "MA", role: "Admin", title: "Head of Delivery", teamId: "web" },
  { id: "m2", name: "Tom Whitfield", initials: "TW", role: "Manager", title: "Lead Engineer", teamId: "web" },
  { id: "m3", name: "Priya Nandakumar", initials: "PN", role: "Member", title: "Frontend Developer", teamId: "web" },
  { id: "m4", name: "Jonas Meyer", initials: "JM", role: "Manager", title: "Design Lead", teamId: "design" },
  { id: "m5", name: "Aisha Rahman", initials: "AR", role: "Member", title: "Product Designer", teamId: "design" },
  { id: "m6", name: "Liam O'Connor", initials: "LO", role: "Manager", title: "SEO Strategist", teamId: "seo" },
  { id: "m7", name: "Chelsea Reyes", initials: "CR", role: "Member", title: "Content Writer", teamId: "seo" },
  { id: "m8", name: "Daniel Kim", initials: "DK", role: "Manager", title: "VA Team Lead", teamId: "va" },
  { id: "m9", name: "Grace Mwangi", initials: "GM", role: "Member", title: "Executive Assistant", teamId: "va" },
  { id: "m10", name: "Sofia Ricci", initials: "SR", role: "Member", title: "Support Specialist", teamId: "support" },
];

export const membersByTeam = (teamId: string) => members.filter((m) => m.teamId === teamId);

export const teamMemberCount = (teamId: string) => {
  const base = membersByTeam(teamId).length;
  const padding: Record<string, number> = {
    ads: 4, finance: 3, people: 3, recruit: 5, sales: 6, social: 4, data: 3, qa: 4,
  };
  return base + (padding[teamId] ?? 0);
};

export type Project = {
  id: string;
  name: string;
  client: string;
  teamId: string;
  color: string;
  hours: number;
  memberIds: string[];
};

export const projects: Project[] = [
  { id: "p1", name: "Northshore Dental Rebuild", client: "Northshore Dental", teamId: "web", color: "oklch(0.62 0.15 256)", hours: 184.5, memberIds: ["m1", "m2", "m3"] },
  { id: "p2", name: "Harbourview Brand Refresh", client: "Harbourview Legal", teamId: "design", color: "oklch(0.65 0.16 320)", hours: 96.25, memberIds: ["m4", "m5"] },
  { id: "p3", name: "Q3 Content Engine", client: "Bluegum Health", teamId: "seo", color: "oklch(0.68 0.15 145)", hours: 132, memberIds: ["m6", "m7"] },
  { id: "p4", name: "VA Onboarding Program", client: "Internal — VA Ops", teamId: "va", color: "oklch(0.6 0.15 25)", hours: 78.75, memberIds: ["m8", "m9"] },
  { id: "p5", name: "Client Support Desk", client: "Internal — Support", teamId: "support", color: "oklch(0.66 0.13 200)", hours: 210.5, memberIds: ["m10", "m8"] },
  { id: "p6", name: "Ironbrij Time (this app)", client: "Internal — Product", teamId: "data", color: "oklch(0.58 0.12 230)", hours: 41, memberIds: ["m2", "m5", "m3"] },
];

export const tasks = [
  "Development",
  "Design",
  "Client call",
  "Research",
  "QA & testing",
  "Admin",
];

export type TimeEntry = {
  id: string;
  projectId: string;
  task: string;
  description: string;
  minutes: number;
  start: string;
  dayIndex: number; // 0 = Monday
};

export const todayEntries: TimeEntry[] = [
  { id: "t1", projectId: "p1", task: "Development", description: "Booking flow validation states", minutes: 95, start: "09:05", dayIndex: 3 },
  { id: "t2", projectId: "p5", task: "Client call", description: "Weekly sync with Harbourview", minutes: 45, start: "10:45", dayIndex: 3 },
  { id: "t3", projectId: "p6", task: "Design", description: "Timesheet grid explorations", minutes: 130, start: "12:15", dayIndex: 3 },
  { id: "t4", projectId: "p3", task: "Research", description: "Keyword gap analysis, health vertical", minutes: 60, start: "14:40", dayIndex: 3 },
];

export const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// hours per project per weekday index
export const weekGrid: Record<string, number[]> = {
  p1: [3.5, 4, 2.5, 1.6, 3, 0, 0],
  p2: [1, 0, 2, 0, 1.5, 0, 0],
  p3: [2, 1.5, 1, 1, 2, 0.5, 0],
  p4: [0, 2, 1.5, 0, 1, 0, 0],
  p5: [1.5, 1, 1, 0.75, 2, 0, 0],
  p6: [0.5, 0, 2, 2.2, 1, 0, 0],
};

export const weekEntries: TimeEntry[] = [
  { id: "w1", projectId: "p1", task: "Development", description: "Sprint kickoff + ticket grooming", minutes: 210, start: "Mon 08:30", dayIndex: 0 },
  { id: "w2", projectId: "p3", task: "Research", description: "Competitor content audit", minutes: 120, start: "Mon 13:00", dayIndex: 0 },
  { id: "w3", projectId: "p2", task: "Design", description: "Logo lockup variations", minutes: 60, start: "Mon 15:30", dayIndex: 0 },
  { id: "w4", projectId: "p1", task: "Development", description: "Appointment API integration", minutes: 240, start: "Tue 09:00", dayIndex: 1 },
  { id: "w5", projectId: "p4", task: "Admin", description: "Onboarding checklist rewrite", minutes: 120, start: "Tue 14:00", dayIndex: 1 },
  { id: "w6", projectId: "p6", task: "Design", description: "Dashboard timer concepts", minutes: 120, start: "Wed 09:15", dayIndex: 2 },
  { id: "w7", projectId: "p1", task: "QA & testing", description: "Cross-browser pass", minutes: 150, start: "Wed 11:30", dayIndex: 2 },
  { id: "w8", projectId: "p5", task: "Client call", description: "Escalation review", minutes: 60, start: "Wed 15:00", dayIndex: 2 },
  { id: "w9", projectId: "p6", task: "Design", description: "Timesheet grid explorations", minutes: 130, start: "Thu 12:15", dayIndex: 3 },
  { id: "w10", projectId: "p1", task: "Development", description: "Booking flow validation states", minutes: 95, start: "Thu 09:05", dayIndex: 3 },
  { id: "w11", projectId: "p3", task: "Development", description: "Blog template performance fixes", minutes: 120, start: "Fri 10:00", dayIndex: 4 },
  { id: "w12", projectId: "p5", task: "Admin", description: "Support queue triage", minutes: 120, start: "Fri 13:00", dayIndex: 4 },
];

export const projectById = (id: string) => projects.find((p) => p.id === id)!;
export const memberById = (id: string) => members.find((m) => m.id === id)!;

export type Tag = { id: string; name: string; color: string; entryCount: number };

export const tags: Tag[] = [
  { id: "billable", name: "Billable", color: "oklch(0.62 0.15 256)", entryCount: 148 },
  { id: "internal", name: "Internal", color: "oklch(0.58 0.12 230)", entryCount: 63 },
  { id: "urgent", name: "Urgent", color: "oklch(0.6 0.17 25)", entryCount: 21 },
  { id: "meeting", name: "Meeting", color: "oklch(0.65 0.16 320)", entryCount: 39 },
  { id: "overtime", name: "Overtime", color: "oklch(0.7 0.16 60)", entryCount: 12 },
  { id: "training", name: "Training", color: "oklch(0.68 0.15 145)", entryCount: 8 },
];

export const clients = Array.from(new Set(projects.map((p) => p.client))).map((name) => {
  const linked = projects.filter((p) => p.client === name);
  return {
    name,
    projects: linked,
    hours: linked.reduce((sum, p) => sum + p.hours, 0),
    internal: name.startsWith("Internal"),
  };
});

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