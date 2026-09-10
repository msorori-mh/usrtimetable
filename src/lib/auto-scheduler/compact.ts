/** Pure, deterministic, bounded timetable compaction. No database writes. */
export interface Session {
  id: string; updated_at: string; cohort_id: string; delivery_group_id: string;
  instructor_id: string; room_id: string; teaching_assignment_id: string;
  day_of_week: number; start_time: string; end_time: string; study_system: string;
  expected_students: number; is_locked: boolean; replaced_by_split?: boolean;
}
export interface Snapshot {
  sessions: Session[];
  cohorts: {id: string; program_id: string; level_id: string; study_system: string; term_id: string}[];
  groups: {id: string; cohort_id: string; expected_students: number}[];
  members: {delivery_group_id: string; partition_id: string; cohort_id: string}[];
  partitions: {id: string; cohort_id: string; headcount: number; active: boolean}[];
  assignments: {id: string; required_room_type: string; is_active: boolean}[];
  rooms: {id: string; capacity: number; room_type: string; is_active: boolean; available_days: number[] | null; available_start_time: string | null; available_end_time: string | null}[];
  instructors: {id: string; instructor_type_id: string | null; max_hours_per_day: number | null}[];
  types: {id: string; code: string; is_external: boolean}[];
  availability: {instructor_id: string; day_of_week: number; start_time: string; end_time: string; availability_type: string; is_preference?: boolean}[];
  templates: {study_system: string; day_of_week: number; start_time: string; end_time: string; is_active: boolean}[];
  settings: {working_days: number[]; day_start_time: string; day_end_time: string; slot_minutes: number; max_daily_hours_per_instructor: number; max_daily_hours_per_section: number; break_between_sessions_min: number};
}
export interface Metrics {
  levelsOverFive: number; excessDaysOverFive: number; excessDaysOverFour: number;
  studentGapMinutes: number; shortStudentDays: number; studentAttendanceDays: number;
  instructorGapMinutes: number; sessions: number; teachingMinutes: number;
  levelDays: Record<string, number>;
}
export interface Move { id: string; day_of_week: number; start_time: string; end_time: string; room_id: string }
export interface Proposal {before: Metrics; after: Metrics; moves: Move[]; fingerprint: string; inputFingerprint: string; stopped: boolean}
export const minutes = (t: string) => Number(t.slice(0,2))*60+Number(t.slice(3,5));
const time = (n: number) => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}:00`;
const duration = (s: Session) => minutes(s.end_time)-minutes(s.start_time);
export const fingerprint = (sessions: Session[]) => JSON.stringify([...sessions].sort((a,b)=>a.id.localeCompare(b.id)));
export const inputFingerprint = (s: Snapshot) => JSON.stringify({...s, sessions: []});
const contexts = new WeakMap<Snapshot, {students:(x:Session)=>string[]; share:(a:Session,b:Session)=>boolean; level:(x:Session)=>string; weight:(id:string)=>number}>();
export function context(s: Snapshot) {
  const cached=contexts.get(s); if(cached)return cached;
  const partitions = new Map(s.partitions.filter(p=>p.active).map(p=>[p.id,p]));
  const memberMap = new Map<string,string[]>();
  for (const m of s.members) {
    if(partitions.get(m.partition_id)?.cohort_id!==m.cohort_id) continue;
    memberMap.set(m.delivery_group_id,[...new Set([...(memberMap.get(m.delivery_group_id)||[]),m.partition_id])]);
  }
  const groups = new Map(s.groups.map(g=>[g.id,g]));
  const complete = (id: string) => {
    const g=groups.get(id), ids=memberMap.get(id)||[];
    return !!g && g.expected_students>0 && ids.length>0 && ids.every(p=>partitions.get(p)?.cohort_id===g.cohort_id)
      && ids.reduce((n,p)=>n+(partitions.get(p)?.headcount||0),0)===g.expected_students;
  };
  // If any scheduled group in a cohort is incomplete, measure/collide conservatively for the entire cohort.
  const fallback = new Set(s.sessions.filter(x=>!complete(x.delivery_group_id)).map(x=>x.cohort_id));
  const students = (x: Session) => fallback.has(x.cohort_id) ? [`cohort:${x.cohort_id}`] : memberMap.get(x.delivery_group_id)||[`cohort:${x.cohort_id}`];
  const share = (a: Session,b: Session) => a.cohort_id===b.cohort_id && (fallback.has(a.cohort_id)||students(a).some(p=>students(b).includes(p)));
  const cohorts = new Map(s.cohorts.map(c=>[c.id,c]));
  const level = (x: Session) => {const c=cohorts.get(x.cohort_id); return c ? `${c.program_id}|${c.level_id}|${c.study_system}|${c.term_id}` : x.cohort_id;};
  const weight = (id: string) => partitions.get(id)?.headcount||Math.max(1,...s.groups.filter(g=>`cohort:${g.cohort_id}`===id).map(g=>g.expected_students));
  const result={students,share,level,weight}; contexts.set(s,result); return result;
}
export function measure(s: Snapshot, sessions=s.sessions): Metrics {
  const ctx=context(s);
  const levels=new Map<string,Set<number>>(), studentDays=new Map<string,{id:string; intervals:Session[]}>(), teacherDays=new Map<string,Session[]>();
  for(const x of sessions) {
    const key=ctx.level(x); if(!levels.has(key))levels.set(key,new Set()); levels.get(key)!.add(x.day_of_week);
    for(const id of ctx.students(x)){const k=`${id}|${x.day_of_week}`;if(!studentDays.has(k))studentDays.set(k,{id,intervals:[]});studentDays.get(k)!.intervals.push(x);}
    const k=`${x.instructor_id}|${x.day_of_week}`;if(!teacherDays.has(k))teacherDays.set(k,[]);teacherDays.get(k)!.push(x);
  }
  const gap=(xs:Session[])=> {const sorted=[...xs].sort((a,b)=>minutes(a.start_time)-minutes(b.start_time));let n=0,end=minutes(sorted[0].end_time);for(const x of sorted.slice(1)){n+=Math.max(0,minutes(x.start_time)-end);end=Math.max(end,minutes(x.end_time));}return n;};
  const dayValues=[...levels.values()].map(v=>v.size);
  return {levelsOverFive:dayValues.filter(n=>n>5).length,excessDaysOverFive:dayValues.reduce((a,n)=>a+Math.max(0,n-5),0),excessDaysOverFour:dayValues.reduce((a,n)=>a+Math.max(0,n-4),0),
    studentGapMinutes:[...studentDays.values()].reduce((a,v)=>a+gap(v.intervals)*ctx.weight(v.id),0),
    shortStudentDays:[...studentDays.values()].reduce((a,v)=>a+(v.intervals.reduce((n,x)=>n+duration(x),0)<=120?ctx.weight(v.id):0),0),
    studentAttendanceDays:[...studentDays.values()].reduce((a,v)=>a+ctx.weight(v.id),0),
    instructorGapMinutes:[...teacherDays.values()].reduce((a,xs)=>a+gap(xs),0),sessions:sessions.length,teachingMinutes:sessions.reduce((a,x)=>a+duration(x),0),
    levelDays:Object.fromEntries([...levels].map(([k,v])=>[k,v.size]))};
}
const vector=(m:Metrics)=>[m.excessDaysOverFive,m.excessDaysOverFour,m.studentGapMinutes,m.shortStudentDays,m.studentAttendanceDays,m.instructorGapMinutes];
export function better(a:Metrics,b:Metrics){const av=vector(a),bv=vector(b);for(let i=0;i<av.length;i++){if(av[i]!==bv[i])return av[i]<bv[i];}return false;}
export function feasible(s:Snapshot, sessions:Session[], candidate:Session, original:Session):boolean {
  const ctx=context(s), settings=s.settings, assignment=s.assignments.find(a=>a.id===candidate.teaching_assignment_id);
  const room=s.rooms.find(r=>r.id===candidate.room_id), teacher=s.instructors.find(t=>t.id===candidate.instructor_id);
  if(!assignment?.is_active||!room?.is_active||!teacher||candidate.is_locked||duration(candidate)!==duration(original))return false;
  const start=minutes(candidate.start_time),end=minutes(candidate.end_time),day=candidate.day_of_week;
  if(end<=start||!settings.working_days.includes(day)||start<minutes(settings.day_start_time)||end>minutes(settings.day_end_time))return false;
  if(room.capacity<candidate.expected_students||room.room_type!==assignment.required_room_type)return false;
  if(room.available_days?.length&&!room.available_days.includes(day))return false;
  if(room.available_start_time&&start<minutes(room.available_start_time)||room.available_end_time&&end>minutes(room.available_end_time))return false;
  if(!s.templates.some(t=>t.is_active&&t.day_of_week===day&&(t.study_system===candidate.study_system||t.study_system==='both')&&start>=minutes(t.start_time)&&end<=minutes(t.end_time)))return false;
  const windows=(s.availability||[]).filter(a=>a.instructor_id===teacher.id&&a.day_of_week===day&&!a.is_preference);
  const type=s.types.find(t=>t.id===teacher.instructor_type_id);
  if((type?.is_external||type?.code==='from_other_college')&&!windows.length)return false;
  if(windows.length&&(!windows.some(w=>w.availability_type!=='unavailable'&&start>=minutes(w.start_time)&&end<=minutes(w.end_time))||windows.some(w=>w.availability_type==='unavailable'&&start<minutes(w.end_time)&&end>minutes(w.start_time))))return false;
  const others=sessions.filter(x=>x.id!==candidate.id), sameDay=others.filter(x=>x.day_of_week===day);
  if(sameDay.some(x=>start<minutes(x.end_time)&&end>minutes(x.start_time)&&(x.room_id===candidate.room_id||x.instructor_id===teacher.id||ctx.share(x,candidate))))return false;
  const levelKey=ctx.level(candidate), days=new Set(others.filter(x=>ctx.level(x)===levelKey).map(x=>x.day_of_week));days.add(day);
  const beforeDays=new Set(sessions.filter(x=>ctx.level(x)===levelKey).map(x=>x.day_of_week)).size;
  if(days.size>Math.max(5,beforeDays))return false;
  // Existing violations may be repaired incrementally; never enlarge them.
  const teacherMinutes=sameDay.filter(x=>x.instructor_id===teacher.id).reduce((a,x)=>a+duration(x),0)+duration(candidate);
  const priorTeacher=sessions.filter(x=>x.day_of_week===day&&x.instructor_id===teacher.id).reduce((a,x)=>a+duration(x),0);
  if(teacherMinutes>Math.max((teacher.max_hours_per_day||settings.max_daily_hours_per_instructor||6)*60,priorTeacher))return false;
  for(const p of ctx.students(candidate)){
    const prior=sessions.filter(x=>x.day_of_week===day&&ctx.students(x).includes(p)).reduce((a,x)=>a+duration(x),0);
    const next=sameDay.filter(x=>ctx.students(x).includes(p)).reduce((a,x)=>a+duration(x),0)+duration(candidate);
    if(next>Math.max((settings.max_daily_hours_per_section||6)*60,prior))return false;
  }
  return true;
}
export async function compact(s:Snapshot, options:{signal?:AbortSignal;maxPasses?:number;onProgress?:(moves:number,metrics:Metrics)=>void}={}):Promise<Proposal> {
  const sessions=s.sessions.map(x=>({...x})), before=measure(s),moves:Move[]=[];let current=before;
  const candidateCache=new Map<string,Array<{day:number;start:string;end:string}>>();
  for(let pass=0;pass<(options.maxPasses??5);pass++){
    let changed=false;
    for(let i=0;i<sessions.length;i++){
      if(options.signal?.aborted)return {before,after:current,moves,fingerprint:fingerprint(s.sessions),inputFingerprint:inputFingerprint(s),stopped:true};
      const old=sessions[i];if(old.is_locked)continue;
      const key=`${old.study_system}|${duration(old)}`;
      if(!candidateCache.has(key)){
        const slots=new Map<string,{day:number;start:string;end:string}>();
        for(const t of s.templates.filter(t=>t.is_active&&(t.study_system===old.study_system||t.study_system==='both'))){
          for(let start=minutes(t.start_time);start+duration(old)<=minutes(t.end_time);start+=Math.max(30,s.settings.slot_minutes||60)){
            const slot={day:t.day_of_week,start:time(start),end:time(start+duration(old))};slots.set(`${slot.day}|${slot.start}`,slot);
          }
        }candidateCache.set(key,[...slots.values()]);
      }
      let best:Session|null=null,bestScore=current;
      for(const slot of candidateCache.get(key)!){
        if(slot.day===old.day_of_week&&slot.start===old.start_time)continue;
        for(const room of s.rooms){
          const candidate={...old,day_of_week:slot.day,start_time:slot.start,end_time:slot.end,room_id:room.id};
          if(!feasible(s,sessions,candidate,old))continue;
          const trial=[...sessions];trial[i]=candidate;const score=measure(s,trial);
          if(better(score,bestScore)){best=candidate;bestScore=score;}
          break; // room identity has no compactness score
        }
      }
      if(best){sessions[i]=best;current=bestScore;changed=true;moves.push({id:best.id,day_of_week:best.day_of_week,start_time:best.start_time,end_time:best.end_time,room_id:best.room_id});}
      if(i%4===0){options.onProgress?.(moves.length,current);await new Promise<void>(resolve=>setTimeout(resolve,0));}
    }
    if(!changed)break;
  }
  return {before,after:current,moves,fingerprint:fingerprint(s.sessions),inputFingerprint:inputFingerprint(s),stopped:false};
}
