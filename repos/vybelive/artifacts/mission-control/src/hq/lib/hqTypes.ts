export type ExecRole =
  | "chief_of_staff"
  | "cto"
  | "qa_director"
  | "release_manager"
  | "product_manager"
  | "creative_director"
  | "marketing_director";

export type ExecStatus =
  | "active"
  | "busy"
  | "idle"
  | "offline"
  | "planning"
  | "collaborating"
  | "needs_approval";

export type AvatarActivity =
  | "working"
  | "reviewing"
  | "meeting"
  | "idle"
  | "offline"
  | "planning"
  | "collaborating"
  | "awaiting";

export interface HQExecutive {
  id: string;
  role: ExecRole;
  name: string;
  title: string;
  tagline: string;
  accentColor: string;
  avatarInitials: string;
  specialties: string[];
  status: ExecStatus;
  openCount: number;
  criticalCount: number;
  blockedCount: number;
}

export interface HQStats {
  totalExecutives: number;
  activeExecutives: number;
  openTasks: number;
  blockedTasks: number;
  criticalTasks: number;
  completedTasks: number;
  handoffsToday: number;
}

export interface HQActivity {
  id: string;
  type:
    | "task_created"
    | "task_updated"
    | "handoff"
    | "message"
    | "collaboration"
    | "approval"
    | "objective";
  executiveId: string | null;
  executiveName: string | null;
  summary: string;
  createdAt: string;
}

export interface HQBriefing {
  headline: string;
  summary: string;
  focus: string[];
  generatedAt: string;
}

/** A derived "energy packet" of work moving through the HQ, grounded in real activity. */
export interface TaskFlowEvent {
  id: string;
  fromRole: ExecRole | null; // null = originates from the command center hub
  toRole: ExecRole | null; // null = flows into the hub
  kind: "task" | "handoff" | "report" | "message";
  color: string;
}

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export interface HQState {
  ready: boolean;
  loading: boolean;
  founderName: string;
  executives: HQExecutive[];
  stats: HQStats;
  briefing: HQBriefing | null;
  activity: HQActivity[];
  flows: TaskFlowEvent[];
  timeOfDay: TimeOfDay;
}
