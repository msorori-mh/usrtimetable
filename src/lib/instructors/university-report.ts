export type FacultySession = {
  id: string;
  college: string;
  college_id: string;
  version_id: string;
  day: number;
  start: string;
  end: string;
  course: string | null;
  room: string | null;
  group_name?: string | null;
  program?: string | null;
  type: string;
  study_system: string;
};
export type FacultyReport = {
  identity_id: string;
  university_number: string;
  academic_year: string;
  term_type: string;
  members: {
    id: string;
    name: string;
    college_id: string;
    college: string;
    base_quota: number | null;
    release: number | null;
    specialization: string | null;
  }[];
  quota: number | null;
  quota_status: "ok" | "missing" | "conflict";
  assigned_hours: number;
  project_hours: number;
  allocation_pending: boolean;
  overload: number | null;
  deficit: number | null;
  colleges: {
    college_id: string;
    college: string;
    assigned_hours: number;
    project_hours: number;
  }[];
  versions: {
    id: string;
    college_id: string;
    college: string;
    name: string;
    status: string;
    is_coordination: boolean;
  }[];
  sessions: FacultySession[];
  selected_version_ids?: string[];
  unscheduled?: {
    id: string;
    college: string;
    course: string;
    group_name: string | null;
    hours: number | null;
  }[];
};
const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
/** IDs, never names, deduplicate shared teaching; overlap never reduces credited load. */
export function summarizeFacultySessions(rows: FacultySession[]) {
  const sessions = [...new Map(rows.map((s) => [s.id, s])).values()];
  const conflicts: [FacultySession, FacultySession][] = [];
  let theory = 0,
    practical = 0;
  for (let i = 0; i < sessions.length; i++) {
    const a = sessions[i],
      hours = (minutes(a.end) - minutes(a.start)) / 60;
    if (a.type === "lab") practical += hours;
    else theory += hours;
    for (let j = i + 1; j < sessions.length; j++) {
      const b = sessions[j];
      if (a.day === b.day && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end))
        conflicts.push([a, b]);
    }
  }
  return { sessions, theory, practical, total: theory + practical, conflicts };
}
