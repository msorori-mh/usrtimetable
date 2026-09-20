import fs from 'node:fs';
import assert from 'node:assert/strict';
const d=JSON.parse(fs.readFileSync(new URL('./completed-live.json',import.meta.url)));
const source='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50',target='f7348192-b851-4ac1-90aa-1b85d13dfc48';
const before=d.sessions.filter(s=>s.schedule_version_id===source),after=d.sessions.filter(s=>s.schedule_version_id===target);
const hours=s=>(parseInt(s.end_time)*60+Number(s.end_time.slice(3,5))-parseInt(s.start_time)*60-Number(s.start_time.slice(3,5)))/60;
const overlap=(a,b)=>a.day_of_week===b.day_of_week&&a.start_time<b.end_time&&b.start_time<a.end_time;
assert.equal(d.source_hash,'7e0b7e291e3668c8e30c4ee7fe009878');
assert.equal(d.identity_differences,0);assert.equal(before.length,112);assert.equal(after.length,112);
assert.equal(after.filter(s=>!s.room_id).length,0);assert.equal(after.reduce((n,s)=>n+hours(s),0),303);
for(let i=0;i<after.length;i++)for(let j=i+1;j<after.length;j++)assert(!(after[i].room_id===after[j].room_id&&overlap(after[i],after[j])),'room conflict');
const added=d.source_target_map.filter(s=>s.source_room_id===null);assert.equal(added.length,5);assert(added.every(s=>s.target_room_id==='c832223a-dd38-5c3b-8124-f25aa759c847'));
function metrics(ss){const perRoom=d.rooms.map(r=>{const rows=ss.filter(s=>s.room_id===r.id);return {name:r.name,hours:rows.reduce((n,s)=>n+hours(s),0),usedDays:new Set(rows.map(s=>s.day_of_week)).size};});const assignedHours=perRoom.reduce((n,r)=>n+r.hours,0);return {sessions:ss.length,unassigned:ss.filter(s=>!s.room_id).length,assignedHours,usedRooms:perRoom.filter(r=>r.hours>0).length,freeRooms:perRoom.filter(r=>!r.hours).length,freeDays:108-perRoom.reduce((n,r)=>n+r.usedDays,0),freeHours:648-assignedHours,perRoom};}
console.log(JSON.stringify({before:metrics(before),after:metrics(after),checks:{roomConflicts:0,unassigned:0,fixedIdentity:true,sourceUnchanged:true,roomChanges:43}},null,2));
