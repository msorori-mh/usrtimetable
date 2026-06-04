
-- Helper functions
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.user_in_college(_user_id UUID, _college_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_colleges WHERE user_id = _user_id AND college_id = _college_id);
$$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_universities_updated BEFORE UPDATE ON public.universities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_colleges_updated BEFORE UPDATE ON public.colleges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- New user handler (creates profile + bootstraps first super_admin)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sa_count INT;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  SELECT COUNT(*) INTO sa_count FROM public.user_roles WHERE role = 'super_admin';
  IF sa_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'super_admin') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'read_only') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== RLS Policies =====

-- universities: any authenticated reads; only super_admin writes
CREATE POLICY uni_select ON public.universities FOR SELECT TO authenticated USING (true);
CREATE POLICY uni_insert ON public.universities FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY uni_update ON public.universities FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY uni_delete ON public.universities FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));

-- colleges: super_admin sees all; others only their assigned colleges
CREATE POLICY col_select ON public.colleges FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.user_in_college(auth.uid(), id));
CREATE POLICY col_insert ON public.colleges FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY col_update ON public.colleges FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY col_delete ON public.colleges FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));

-- profiles: self + super_admin
CREATE POLICY prof_select ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY prof_update ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_super_admin(auth.uid()))
  WITH CHECK (id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY prof_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid() OR public.is_super_admin(auth.uid()));

-- user_roles: self read; super_admin full
CREATE POLICY ur_select ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY ur_insert ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY ur_update ON public.user_roles FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY ur_delete ON public.user_roles FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));

-- user_colleges: self read; super_admin full
CREATE POLICY uc_select ON public.user_colleges FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY uc_insert ON public.user_colleges FOR INSERT TO authenticated WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY uc_update ON public.user_colleges FOR UPDATE TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY uc_delete ON public.user_colleges FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));

-- audit_logs: super_admin reads all; college members read their college's logs; authenticated may insert their own
CREATE POLICY al_select ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (college_id IS NOT NULL AND public.user_in_college(auth.uid(), college_id)));
CREATE POLICY al_insert ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid());
