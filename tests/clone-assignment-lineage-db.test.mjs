import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.CLONE_DB_MODULE || '@electric-sql/pglite');
const migration = await readFile(new URL('../supabase/migrations/20261002235000_clone_assignment_exclusion_lineage.sql', import.meta.url), 'utf8');
const fixture = await readFile(new URL('./fixtures/clone-assignment-lineage.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const q = n => `'${id(n)}'`;
async function seed(activeReplacement = false) {
  const db = new PGlite();
  await db.exec(fixture);
  await db.exec(`
    INSERT INTO schedule_versions VALUES
      (${q(1)},${q(90)},${q(91)},'published'),
      (${q(2)},${q(90)},${q(91)},'draft'),
      (${q(3)},${q(90)},${q(91)},'draft'),
      (${q(4)},${q(90)},${q(91)},'draft'),
      (${q(5)},${q(92)},${q(91)},'draft'),
      (${q(6)},${q(90)},${q(93)},'draft');
    INSERT INTO teaching_assignments VALUES
      (${q(100)},${q(200)},${q(90)},3,true),
      (${q(101)},${q(200)},${q(90)},3,${activeReplacement}),
      (${q(102)},${q(200)},${q(90)},3,${!activeReplacement});
    INSERT INTO assignment_version_private.scope VALUES(${q(101)},${q(1)},${q(100)});
    INSERT INTO assignment_version_private.promotions VALUES(${q(1)});
    INSERT INTO schedule_version_delivery_private.clone_provenance VALUES
      (${q(2)},${q(1)}),(${q(3)},${q(2)}),(${q(5)},${q(1)}),(${q(6)},${q(1)});
    INSERT INTO schedule_sessions VALUES
      (${q(11)},${q(1)},${q(activeReplacement?101:102)}),
      (${q(12)},${q(2)},${q(activeReplacement?101:102)}),
      (${q(13)},${q(3)},${q(activeReplacement?101:102)});
  `);
  return db;
}
async function effective(db, version) {
  return (await db.query(`SELECT assignment_id FROM public.version_effective_assignments(${q(version)}) WHERE delivery_group_id=${q(200)} ORDER BY assignment_id`)).rows.map(r=>r.assignment_id);
}
async function state(db) {
  return (await db.query(`SELECT jsonb_build_object(
    'versions',(SELECT jsonb_agg(v ORDER BY id) FROM schedule_versions v),
    'sessions',(SELECT jsonb_agg(s ORDER BY id) FROM schedule_sessions s),
    'assignments',(SELECT jsonb_agg(a ORDER BY id) FROM teaching_assignments a),
    'scopes',(SELECT jsonb_agg(s ORDER BY assignment_id) FROM assignment_version_private.scope s),
    'promotions',(SELECT jsonb_agg(p ORDER BY version_id) FROM assignment_version_private.promotions p),
    'provenance',(SELECT jsonb_agg(p ORDER BY version_id) FROM schedule_version_delivery_private.clone_provenance p)
  ) AS state`)).rows[0].state;
}
async function metadata(db) {
  return (await db.query(`SELECT proowner,prolang,provolatile,prosecdef,proisstrict,proparallel,proconfig,proacl::text,prorettype,proargtypes::text FROM pg_proc WHERE oid='public.version_effective_assignments(uuid)'::regprocedure`)).rows[0];
}

test('inactive ancestral replacement stays excluded through direct and nested clones without writes or privilege drift', async () => {
  const db=await seed();
  try {
    assert.deepEqual(await effective(db,1),[id(102)]);
    assert.deepEqual(await effective(db,2),[id(100),id(102)],'reproduces the clone duplicate');
    const before=await state(db), meta=await metadata(db);
    await db.exec(migration);
    assert.deepEqual(await effective(db,1),[id(102)],'published source is unchanged');
    assert.deepEqual(await effective(db,2),[id(102)]);
    assert.deepEqual(await effective(db,3),[id(102)],'nested clone inherits exclusion');
    assert.deepEqual(await state(db),before,'the migration changes no data');
    assert.deepEqual(await metadata(db),meta,'owner, ACL and function security properties are unchanged');
    await db.exec(migration);
    assert.deepEqual(await effective(db,2),[id(102)],'replay is idempotent');
    await db.exec('SET ROLE authenticated');
    assert.deepEqual(await effective(db,2),[id(102)],'existing authenticated execute permission is retained');
    await assert.rejects(db.exec(`INSERT INTO schedule_version_delivery_private.clone_provenance VALUES(${q(4)},${q(1)})`),/permission denied/);
  } finally { await db.close(); }
});

test('guarded relink to an active original restores only the descendant and survives its next clone', async () => {
  const db=await seed(true);
  try {
    await db.exec(migration);
    assert.deepEqual(await effective(db,2),[id(101)]);
    const source=(await db.query(`SELECT to_jsonb(s) row FROM schedule_sessions s WHERE id=${q(11)}`)).rows[0].row;
    await db.exec(`BEGIN; UPDATE schedule_sessions SET teaching_assignment_id=${q(100)} WHERE id=${q(12)}; SET CONSTRAINTS ALL IMMEDIATE; COMMIT;`);
    assert.deepEqual(await effective(db,2),[id(100)],'explicit original session overrides only inherited suppression');
    assert.deepEqual(await effective(db,1),[id(101)]);
    assert.deepEqual(await effective(db,3),[id(101)],'pre-existing descendant referencing replacement remains unchanged');
    assert.deepEqual((await db.query(`SELECT to_jsonb(s) row FROM schedule_sessions s WHERE id=${q(11)}`)).rows[0].row,source);
    await db.exec(`INSERT INTO schedule_version_delivery_private.clone_provenance VALUES(${q(4)},${q(2)}); INSERT INTO schedule_sessions VALUES(${q(14)},${q(4)},${q(100)});`);
    assert.deepEqual(await effective(db,4),[id(100)],'a clone of the restored version retains the original');
    await db.exec(`UPDATE teaching_assignments SET is_active=false WHERE id=${q(100)}`);
    assert.deepEqual(await effective(db,2),[],'explicit reference never bypasses is_active');
  } finally { await db.close(); }
});

test('own-version scope precedence and the existing cross-version promotion guard are preserved', async () => {
  const db=await seed(true);
  try {
    await db.exec(migration);
    await db.exec(`UPDATE schedule_sessions SET teaching_assignment_id=${q(100)} WHERE id=${q(11)}`);
    assert.deepEqual(await effective(db,1),[id(101)],'origin scope wins before its sessions are relinked');
    await assert.rejects(db.exec(`INSERT INTO schedule_sessions VALUES(${q(15)},${q(5)},${q(101)})`),/VERSION_SCOPED_ASSIGNMENT_OTHER_VERSION/);
    await assert.rejects(db.exec(`INSERT INTO schedule_sessions VALUES(${q(16)},${q(6)},${q(101)})`),/VERSION_SCOPED_ASSIGNMENT_OTHER_VERSION/);
    await db.exec(`DELETE FROM assignment_version_private.promotions WHERE version_id=${q(1)}`);
    await assert.rejects(db.exec(`INSERT INTO schedule_sessions VALUES(${q(14)},${q(4)},${q(101)})`),/VERSION_SCOPED_ASSIGNMENT_OTHER_VERSION/);
  } finally { await db.close(); }
});

test('unrelated or cross-college/term provenance does not inherit exclusions; recursive UNION terminates cycles', async () => {
  const db=await seed();
  try {
    await db.exec(migration);
    for(const version of [4,5,6]) assert.deepEqual(await effective(db,version),[id(100),id(102)]);
    await db.exec(`INSERT INTO schedule_version_delivery_private.clone_provenance VALUES(${q(1)},${q(3)}); SET statement_timeout='2s';`);
    assert.deepEqual(await effective(db,2),[id(102)],'a malformed cycle terminates without expanding authority');
  } finally { await db.close(); }
});

test('preserves existing duplicate and incomplete coverage signals instead of selecting an instructor silently', async () => {
  const db=await seed();
  try {
    await db.exec(migration);
    await db.exec(`UPDATE schedule_sessions SET teaching_assignment_id=${q(100)} WHERE id=${q(12)}`);
    assert.deepEqual(await effective(db,2),[id(100),id(102)],'restoration does not silently remove another active global assignment');
    await db.exec(`UPDATE schedule_sessions SET teaching_assignment_id=${q(102)} WHERE id=${q(12)}; UPDATE teaching_assignments SET is_active=false WHERE id=${q(102)}`);
    assert.deepEqual(await effective(db,2),[],'missing substitute remains visible to the coverage gate');
  } finally { await db.close(); }
});

test('refuses unexpected baseline function changes', async () => {
  const db=await seed();
  try {
    await db.exec(`CREATE OR REPLACE FUNCTION public.version_effective_assignments(p_version uuid) RETURNS TABLE(assignment_id uuid,delivery_group_id uuid,college_id uuid,assigned_component_hours numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT id,delivery_group_id,college_id,assigned_component_hours FROM public.teaching_assignments WHERE false $$;`);
    await assert.rejects(db.exec(migration),/VERSION_EFFECTIVE_ASSIGNMENTS_DEFINITION_DRIFT/);
  } finally { await db.close(); }
});
