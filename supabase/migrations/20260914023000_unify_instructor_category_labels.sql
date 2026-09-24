-- Unify Arabic lecturer-category labels without changing category codes or business rules.
-- Both legacy "from_other_college" and external collaborator categories are presented
-- to users as «محاضر من كلية أخرى» across the platform.

UPDATE public.instructor_types
SET name_ar = 'محاضر من كلية أخرى'
WHERE lower(COALESCE(code, '')) IN ('from_other_college', 'external_collaborator', 'external')
   OR name_ar IN ('محاضر خارجي', 'متعاون خارجي', 'من كلية أخرى');
