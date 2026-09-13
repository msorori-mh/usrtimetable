-- Trigger-only helpers: they must never be callable through the API.
REVOKE ALL ON FUNCTION public.assign_new_college_to_academic_affairs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_all_colleges_to_academic_affairs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_academic_affairs_only(uuid) FROM PUBLIC, anon;