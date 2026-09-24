import test from "node:test";
import assert from "node:assert/strict";
import { importJointPlan } from "../src/lib/auto-scheduler/joint-import.ts";
import { snapshot, session } from "./helpers/attendance-fixtures.mjs";
function fixture() {
 const s=snapshot([
  session("one",0,"08:00:00","10:00:00",{instructor_id:"teacher"}),
  session("two",1,"08:00:00","10:00:00",{instructor_id:"teacher"}),
 ]);
 s.revision="1";s.versionUpdatedAt="v1";
 const raw={purpose:"quality",versionId:"v",revision:"1",versionUpdatedAt:"v1",days:3,
 moves:s.sessions.map((x,i)=>({...x,expected_updated_at:x.updated_at,
 ...(i?{day_of_week:0,start_time:"10:00:00",end_time:"12:00:00"}:{})}))};
 return {s,raw};
}
test("quality import independently verifies an improving plan without claiming lower-day impossibility",()=>{
 const {s,raw}=fixture();const p=importJointPlan(s,"v",JSON.stringify(raw));
 assert.equal(p.qualitySearch.reason,"improved");assert.equal(p.attendanceSearch,undefined);
 assert.ok(p.after.studentAttendanceDays<p.before.studentAttendanceDays);
});
test("quality import rejects stale revisions and changed hours",()=>{
 const {s,raw}=fixture();
 assert.throws(()=>importJointPlan(s,"v",JSON.stringify({...raw,revision:"old"})),/تغير/);
 raw.moves[1].end_time="13:00:00";
 assert.throws(()=>importJointPlan(s,"v",JSON.stringify(raw)),/قيود/);
});
test("quality import rejects overlaps, fixed-session moves and external conflicts",()=>{
 const {s,raw}=fixture();raw.moves[1].start_time="09:00:00";raw.moves[1].end_time="11:00:00";
 assert.throws(()=>importJointPlan(s,"v",JSON.stringify(raw)),/قيود/);
 const b=fixture();b.s.sessions[1].is_locked=true;
 assert.throws(()=>importJointPlan(b.s,"v",JSON.stringify(b.raw)),/قيود/);
 const c=fixture();c.s.externalBusy=[{instructor_id:"teacher",day_of_week:0,start_time:"10:00:00",end_time:"12:00:00"}];
 assert.throws(()=>importJointPlan(c.s,"v",JSON.stringify(c.raw)),/قيود/);
});
test("quality import does not accept an increased day cap or an unchanged plan",()=>{
 const {s,raw}=fixture();
 assert.throws(()=>importJointPlan(s,"v",JSON.stringify({...raw,days:5})),/قيود/);
 raw.moves=s.sessions.map(x=>({...x,expected_updated_at:x.updated_at}));
 assert.throws(()=>importJointPlan(s,"v",JSON.stringify(raw)),/تحسن/);
});
test("generation import still requires independent proof for an increased day count",()=>{
 const {s,raw}=fixture();delete raw.purpose;raw.days=4;
 assert.throws(()=>importJointPlan(s,"v",JSON.stringify(raw)),/إثبات/);
});
