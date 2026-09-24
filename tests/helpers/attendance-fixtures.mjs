export const session = (id, day, start, end, extra = {}) => ({
  id,
  updated_at: "t0",
  cohort_id: "c",
  delivery_group_id: "g",
  instructor_id: id,
  room_id: "r",
  teaching_assignment_id: "a",
  day_of_week: day,
  start_time: start,
  end_time: end,
  study_system: "regular",
  expected_students: 30,
  is_locked: false,
  ...extra,
});
export const snapshot = (sessions) => ({
  sessions,
  cohorts: [
    {
      id: "c",
      program_id: "p",
      level_id: "l",
      study_system: "regular",
      term_id: "t",
    },
  ],
  groups: [{ id: "g", cohort_id: "c", expected_students: 30 }],
  members: [{ delivery_group_id: "g", partition_id: "p1", cohort_id: "c" }],
  partitions: [{ id: "p1", cohort_id: "c", headcount: 30, active: true }],
  assignments: [{ id: "a", required_room_type: "lecture_hall", is_active: true }],
  rooms: [{ id: "r", capacity: 60, room_type: "lecture_hall", is_active: true }],
  instructors: [...new Set(sessions.map((s) => s.instructor_id))].map((id) => ({
    id,
    instructor_type_id: "permanent",
    max_hours_per_day: 6,
    availability_status: "available",
  })),
  types: [{ id: "permanent", code: "permanent", is_external: false }],
  availability: [],
  roomAvailability: [],
  roomUnavailability: [],
  templates: [0, 1, 2, 3, 4, 6].map((day) => ({
    day_of_week: day,
    start_time: "08:00:00",
    end_time: "14:00:00",
    study_system: "regular",
    is_active: true,
  })),
  settings: {
    working_days: [0, 1, 2, 3, 4, 6],
    day_start_time: "08:00:00",
    day_end_time: "14:00:00",
    slot_minutes: 60,
    min_session_hours: 1,
    max_session_hours: 3,
    max_daily_hours_per_instructor: 6,
    max_daily_hours_per_section: 6,
    break_between_sessions_min: 0,
  },
});
export function addCohort(s, id, group, partition, headcount = 30) {
  s.cohorts.push({
    id,
    program_id: `program:${id}`,
    level_id: "l",
    study_system: "regular",
    term_id: "t",
  });
  s.groups.push({ id: group, cohort_id: id, expected_students: headcount });
  s.partitions.push({ id: partition, cohort_id: id, headcount, active: true });
  s.members.push({
    delivery_group_id: group,
    cohort_id: id,
    partition_id: partition,
  });
}
