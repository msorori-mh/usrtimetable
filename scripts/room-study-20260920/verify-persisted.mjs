import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const live=JSON.parse(readFileSync(new URL('./live-verification.json',import.meta.url)));
const expected=JSON.parse(execFileSync(process.execPath,[new URL('./optimize.mjs',import.meta.url).pathname],{encoding:'utf8'}));
const sourceId='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50',targetId='f7348192-b851-4ac1-90aa-1b85d13dfc48';
assert.equal(live.source_hash,'7e0b7e291e3668c8e30c4ee7fe009878');
const sourceVersion=live.versions.find(v=>v.id===sourceId),targetVersion=live.versions.find(v=>v.id===targetId);
assert.equal(sourceVersion.status,'published');assert.equal(sourceVersion.eligibility_revision,685);
assert.equal(new Date(sourceVersion.updated_at).toISOString(),'2026-09-20T01:30:55.326Z');
assert.equal(targetVersion.status,'draft');assert.match(targetVersion.notes,/^TEST_ONLY ROOM-STUDY-20260920/);
assert.equal(targetVersion.college_id,sourceVersion.college_id);assert.equal(targetVersion.academic_term_id,sourceVersion.academic_term_id);
assert.equal(live.identity_differences,0);assert.equal(live.room_changes,38);
assert.equal(live.source_target_map.length,112);
const actual=live.sessions.filter(s=>s.schedule_version_id===targetId),original=live.sessions.filter(s=>s.schedule_version_id===sourceId);
assert.equal(actual.length,112);assert.equal(original.length,112);
for(const link of live.source_target_map){
 const proposal=expected.sessions.find(s=>s.id===link.source_id);assert.equal(link.target_room_id,proposal.room_id);
 const oldRoom=live.rooms.find(r=>r.id===link.source_room_id),newRoom=live.rooms.find(r=>r.id===link.target_room_id);
 if(link.source_room_id!==link.target_room_id){assert(newRoom.is_active);assert.equal(newRoom.room_type_id,oldRoom.room_type_id);assert(newRoom.capacity>=oldRoom.capacity);}
}
const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
function measure(sessions){
 let assignedHours=0,roomConflicts=0;
 for(let i=0;i<sessions.length;i++)for(let j=i+1;j<sessions.length;j++){
  const a=sessions[i],b=sessions[j];if(a.room_id&&a.room_id===b.room_id&&a.day_of_week===b.day_of_week&&a.start_time<b.end_time&&b.start_time<a.end_time)roomConflicts++;
 }
 const perRoom=live.rooms.map(room=>{
  let hours=0,fullDays=0,blocks2=0,blocks3=0,longHours=0;const free=[];
  for(const day of [6,0,1,2,3,4]){
   const rows=sessions.filter(s=>s.room_id===room.id&&s.day_of_week===day).sort((a,b)=>a.start_time.localeCompare(b.start_time));
   if(!rows.length)fullDays++;let cursor=480;
   for(const s of [...rows,{start_time:'14:00:00',end_time:'14:00:00'}]){
    const end=minute(s.start_time);if(end>cursor){let m=end-cursor;free.push({day,start:cursor,end,minutes:m});if(m>=120)blocks2++;if(m>=180){blocks3++;longHours+=m/60;}}
    cursor=Math.max(cursor,minute(s.end_time));
   }
   hours+=rows.reduce((n,s)=>n+(minute(s.end_time)-minute(s.start_time))/60,0);
  }
  assignedHours+=hours;return {id:room.id,name:room.name,hours,fullDays,blocks2,blocks3,longHours,free};
 });
 return {sessions:sessions.length,hours:sessions.reduce((n,s)=>n+(minute(s.end_time)-minute(s.start_time))/60,0),assignedHours,unassignedSessions:sessions.filter(s=>!s.room_id).length,usedRooms:perRoom.filter(r=>r.hours).length,usedRoomDays:perRoom.reduce((n,r)=>n+6-r.fullDays,0),fullFreeRoomDays:perRoom.reduce((n,r)=>n+r.fullDays,0),blocks2:perRoom.reduce((n,r)=>n+r.blocks2,0),blocks3:perRoom.reduce((n,r)=>n+r.blocks3,0),longFreeHours:perRoom.reduce((n,r)=>n+r.longHours,0),roomConflicts,perRoom};
}
const before=measure(original),after=measure(actual);
for(const key of ['sessions','hours','assignedHours','unassignedSessions','usedRooms','usedRoomDays','fullFreeRoomDays','blocks2','blocks3','longFreeHours']){assert.equal(before[key],expected.before[key]);assert.equal(after[key],expected.after[key]);}
assert.equal(before.roomConflicts,0);assert.equal(after.roomConflicts,0);
console.log(JSON.stringify({decision:'PASS',sourceVersion,targetVersion,sourceHash:live.source_hash,targetHash:live.target_hash,identityDifferences:live.identity_differences,roomMoves:live.room_changes,before,after}));
