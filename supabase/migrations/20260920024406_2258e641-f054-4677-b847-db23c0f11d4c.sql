CREATE INDEX IF NOT EXISTS idx_ss_college ON public.schedule_sessions (college_id);
CREATE INDEX IF NOT EXISTS idx_ss_college_version ON public.schedule_sessions (college_id, schedule_version_id);
CREATE INDEX IF NOT EXISTS idx_plan_courses_college ON public.plan_courses (college_id);
CREATE INDEX IF NOT EXISTS idx_dgpm_college ON public.delivery_group_partition_members (college_id);
CREATE INDEX IF NOT EXISTS idx_sll_anchor_group ON public.shared_lecture_links (anchor_group_id);
CREATE INDEX IF NOT EXISTS idx_sll_member_group ON public.shared_lecture_links (member_group_id);