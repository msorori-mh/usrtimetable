import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const {baseline:b,constraints:c}=JSON.parse(readFileSync(new URL('./input.json',import.meta.url)));
const rooms=new Map(b.rooms.map(r=>[r.id,r]));
const components=new Map(c.components.map(r=>[r.id,r]));
const days=[6,0,1,2,3,4];
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
const duration=s=>minute(s.end_time)-minute(s.start_time);
const overlap=(a,b)=>a.day_of_week===b.day_of_week&&a.start_time<b.end_time&&b.start_time<a.end_time;
const roomType=s=>rooms.get(s.room_id)?.room_type_id??null;
const mismatch=s=>s.room_id&&components.get(s.plan_course_component_id)?.required_room_type_id&&components.get(s.plan_course_component_id).required_room_type_id!==roomType(s);
function metrics(sessions){
 const perRoom=b.rooms.map(r=>{
  let hours=0,fullDays=0,blocks2=0,blocks3=0,longHours=0;
  const free=[];
  for(const day of days){
   const rows=sessions.filter(s=>s.room_id===r.id&&s.day_of_week===day).sort((a,b)=>a.start_time.localeCompare(b.start_time));
   if(!rows.length)fullDays++;
   let cursor=480;
   for(const s of [...rows,{start_time:'14:00:00',end_time:'14:00:00'}]){
    const end=minute(s.start_time);
    if(end>cursor){const minutes=end-cursor;free.push({day,start:cursor,end,minutes});if(minutes>=120)blocks2++;if(minutes>=180){blocks3++;longHours+=minutes/60;}}
    cursor=Math.max(cursor,minute(s.end_time));
   }
   hours+=rows.reduce((n,s)=>n+duration(s)/60,0);
  }
  return {id:r.id,name:r.name,hours,fullDays,blocks2,blocks3,longHours,free};
 });
 return {sessions:sessions.length,hours:sessions.reduce((n,s)=>n+duration(s)/60,0),assignedHours:perRoom.reduce((n,r)=>n+r.hours,0),unassignedSessions:sessions.filter(s=>!s.room_id).length,usedRooms:perRoom.filter(r=>r.hours).length,usedRoomDays:perRoom.reduce((n,r)=>n+6-r.fullDays,0),fullFreeRoomDays:perRoom.reduce((n,r)=>n+r.fullDays,0),blocks2:perRoom.reduce((n,r)=>n+r.blocks2,0),blocks3:perRoom.reduce((n,r)=>n+r.blocks3,0),longFreeHours:perRoom.reduce((n,r)=>n+r.longHours,0),perRoom};
}
assert.equal(c.availability,null);assert.equal(c.unavailability,null);
assert.equal(b.sessions.filter(s=>s.is_locked).length,0);
const score=new Map(b.rooms.map(r=>[r.id,b.sessions.filter(s=>s.room_id===r.id).reduce((n,s)=>n+duration(s),0)]));
const result=b.sessions.filter(s=>!s.room_id);const daily=[];
for(const day of days){
 const types=[...new Set(b.sessions.filter(s=>s.day_of_week===day&&s.room_id).map(roomType))];
 for(const type of types){
  const sessions=b.sessions.filter(s=>s.day_of_week===day&&roomType(s)===type).sort((a,b)=>a.start_time.localeCompare(b.start_time)||b.end_time.localeCompare(a.end_time)||a.id.localeCompare(b.id));
  const peak=Math.max(...sessions.map(s=>sessions.filter(t=>t.start_time<=s.start_time&&t.end_time>s.start_time).length));
  const originalCapacity=Math.max(...sessions.map(s=>rooms.get(s.room_id).capacity));
  const eligible=b.rooms.filter(r=>r.is_active&&r.room_type_id===type&&r.capacity>=originalCapacity&&score.get(r.id)>0).sort((a,b)=>score.get(b.id)-score.get(a.id)||a.id.localeCompare(b.id));
  assert(eligible.length>=peak);
  const fixed=sessions.filter(mismatch);
  const fixedIds=new Set(fixed.map(s=>s.room_id));
  eligible.sort((a,b)=>Number(fixedIds.has(b.id))-Number(fixedIds.has(a.id)));
  const selected=eligible.slice(0,Math.max(peak,fixedIds.size));
  const scheduled=[...fixed];
  for(const s of sessions){
   if(mismatch(s))continue;
   const free=selected.filter(r=>!scheduled.some(t=>t.room_id===r.id&&overlap(s,t)));
   assert(free.length);
   const chosen=free.find(r=>r.id===s.room_id)||free[0];
   scheduled.push({...s,room_id:chosen.id});
  }
  daily.push({day,type,peak,rooms:peak,sessions:sessions.length});result.push(...scheduled);
 }
}
const original=new Map(b.sessions.map(s=>[s.id,s]));
for(const s of result){
 const old=original.get(s.id);assert.deepEqual({...s,room_id:old.room_id},old);
 if(!s.room_id){assert.equal(old.room_id,null);continue;}
 const room=rooms.get(s.room_id);assert.equal(room.room_type_id,rooms.get(old.room_id).room_type_id);assert(room.capacity>=rooms.get(old.room_id).capacity);
 const required=components.get(s.plan_course_component_id)?.required_room_type_id;
 if(required&&required!==room.room_type_id)assert.equal(s.room_id,old.room_id);
 if(s.expected_students!==null)assert(s.expected_students<=room.capacity);
}
let conflicts=0;for(let i=0;i<result.length;i++)for(let j=i+1;j<result.length;j++)if(result[i].room_id&&result[i].room_id===result[j].room_id&&overlap(result[i],result[j]))conflicts++;
assert.equal(conflicts,0);assert.equal(result.length,b.sessions.length);
const before=metrics(b.sessions),after=metrics(result);
assert.equal(before.hours,after.hours);assert(after.usedRoomDays<before.usedRoomDays);
console.log(JSON.stringify({window:'08:00–14:00',days,before,after,daily,moves:result.filter(s=>s.room_id!==original.get(s.id).room_id).map(s=>({source_id:s.id,from_room_id:original.get(s.id).room_id,to_room_id:s.room_id})),sessions:result,tests:{sessionIdentityPreserved:true,roomTypePreserved:true,noSmallerRecordedCapacity:true,roomConflicts:conflicts,unchangedTimes:true,unknownHeadcounts:result.filter(s=>s.expected_students===null).length}}));
