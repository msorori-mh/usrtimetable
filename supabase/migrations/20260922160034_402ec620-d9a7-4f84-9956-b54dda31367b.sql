REVOKE ALL ON FUNCTION public.issue_account_provisioning_grant(text, text, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_account_provisioning_grant(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_account_provisioning_grant(text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_account_provisioning_grant(uuid) TO service_role;