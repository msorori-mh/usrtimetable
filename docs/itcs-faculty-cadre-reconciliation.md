# ITCS faculty reconciliation, 2026–2027

Source: user-uploaded 26-27 كادر الحاسوب_٠٤٣٤٤٢.xlsx, sheet كشف, rows 3–37 (35 names).

31 existing records matched, 3 absent inactive scholarship members to register with unknown quota, and one ambiguous identity: يحيي محمد علي محمد versus يحيى البركاني. Preserve original names/numbers until identity confirmation. The 24 current ITCS-home records without a confirmed match move to explicit home-review status, without being assigned to another college. Existing contractor categories, HR data, teaching assignments and sessions remain intact. These 24 include the ambiguous Yahya record and the non-person placeholder كلية العلوم الإدارية.

Mohammed Makrad is explicitly listed in the ITCS faculty source; correct his legacy declared Jawf affiliation to ITCS while preserving his original number. Ahmed Badawi and Mubarak Sufyani remain at Jawf per the user's explicit decisions.

Implementation: nullable home decisions represent an explicit unresolved home. A decision overrides legacy auto-filled fields, including when its home is null. Existing authorized reconciliation RPC retains source/university checks, audit, lock and stale-write protection. No nullable-home quota approval is allowed. Inactive instructors can be recorded with unknown quota; activation retains the existing quota validation.

Verification: existing home-roster PostgreSQL regression suite plus pending/resolution authorization, stale-write and inactive-quota tests. Production apply checks identity numbers, assignments, delivery groups and sessions before/after within one transaction. Verify final home membership, pending membership, new inactive records, Ahmed/Mubarak and workload formulas.

Rollback: audited decisions include prior decision and before-members. Restore those exact members and prior decisions; remove only newly added inactive rows if still unused, through normal integrity constraints. Schema rollback refuses unresolved decisions until data restoration is complete. Never change operational college IDs or disable triggers.
