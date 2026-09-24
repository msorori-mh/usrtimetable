
ALTER TABLE public.academic_terms DROP CONSTRAINT IF EXISTS at_term_type_check;
UPDATE public.academic_terms SET term_type='first' WHERE term_type='fall';
UPDATE public.academic_terms SET term_type='second' WHERE term_type IN ('spring','summer');
ALTER TABLE public.academic_terms ADD CONSTRAINT at_term_type_check
  CHECK (term_type IS NULL OR term_type = ANY (ARRAY['first'::text,'second'::text]));
