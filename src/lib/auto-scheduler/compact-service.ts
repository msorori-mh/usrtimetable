import { supabase } from "@/integrations/supabase/client";
import { better, feasible, fingerprint, inputFingerprint, measure, type Snapshot, type Proposal, type Metrics, type Session } from "./compact";

type ErrorLike = {message:string};
interface Query extends PromiseLike<{data:unknown[]|null;error:ErrorLike|null}> {
  select(columns:string): Query; eq(column:string,value:string): Query;
  order(column:string): Query; range(from:number,to:number): Query;
}
const db=supabase as unknown as {from(table:string):Query};
async function rows(table:string,collegeId:string,versionId?:string) {
  const result:unknown[]=[];
  for(let offset=0;;offset+=500){
    let q=db.from(table).select('*').eq('college_id',collegeId).order('id');
    if(versionId)q=q.eq('schedule_version_id',versionId);
    const {data,error}=await q.range(offset,offset+499);if(error)throw new Error(error.message);
    result.push(...(data||[]));if((data||[]).length<500)return result;
  }
}
async function draft(collegeId:string,versionId:string){
  const {data,error}=await supabase.from('schedule_versions').select('id,status').eq('college_id',collegeId).eq('id',versionId).single();
  if(error)throw error;if(data.status!=='draft')throw new Error('التحسين متاح لنسخة مسودة فقط.');
}
export async function loadCompactSnapshot(collegeId:string,versionId:string):Promise<Snapshot>{
  await draft(collegeId,versionId);
  const names={sessions:'schedule_sessions',cohorts:'academic_cohorts',groups:'delivery_groups',members:'delivery_group_partition_members',partitions:'cohort_student_partitions',assignments:'teaching_assignments',rooms:'rooms',instructors:'instructors',types:'instructor_types',availability:'instructor_availability',templates:'time_slot_templates',settings:'scheduling_settings'};
  const values=await Promise.all(Object.entries(names).map(async([key,table])=>[key,await rows(table,collegeId,key==='sessions'?versionId:undefined)] as const));
  const raw=Object.fromEntries(values);if(raw.settings.length!==1)throw new Error('تعذر تحديد إعدادات الجدولة.');
  return {...raw,settings:raw.settings[0],sessions:(raw.sessions as Session[]).filter(s=>!s.replaced_by_split)} as unknown as Snapshot;
}
export interface Applied {applied:number; total:number; before:Metrics; after:Metrics; stopped:string|null}
/** Every move is authorized and revalidated by the existing RPC. No direct session writes. */
export async function applyCompactProposal(collegeId:string,versionId:string,proposal:Proposal,options:{signal?:AbortSignal;onProgress?:(applied:number,total:number)=>void}={}):Promise<Applied>{
  let fresh=await loadCompactSnapshot(collegeId,versionId);
  if(fingerprint(fresh.sessions)!==proposal.fingerprint||inputFingerprint(fresh)!==proposal.inputFingerprint)throw new Error('تغيرت البيانات منذ المعاينة؛ أعد حساب التحسين.');
  const before=measure(fresh);let applied=0,stopped:string|null=null;
  let simulated=fresh.sessions;
  for(const move of proposal.moves){
    const old=simulated.find(x=>x.id===move.id);if(!old)throw new Error('معاينة غير صالحة.');
    const candidate={...old,...move};if(!feasible(fresh,simulated,candidate,old))throw new Error('تغيرت صلاحية أحد التنقلات؛ أعد المعاينة.');
    simulated=simulated.map(x=>x.id===move.id?candidate:x);
  }
  if(!better(measure(fresh,simulated),before))throw new Error('الخطة لا تحسّن النتيجة.');
  for(const move of proposal.moves){
    if(options.signal?.aborted){stopped='أُوقف التنفيذ؛ بقيت التنقلات المحفوظة فقط.';break;}
    try{
      // Detect edits to any session or scheduling input, not just the moved session.
      const now=await loadCompactSnapshot(collegeId,versionId);
      if(fingerprint(now.sessions)!==fingerprint(fresh.sessions)||inputFingerprint(now)!==inputFingerprint(fresh))throw new Error('تغير الجدول أو موارده أثناء التنفيذ؛ أعد المعاينة.');
      const old=now.sessions.find(s=>s.id===move.id);if(!old)throw new Error('لم تعد المحاضرة موجودة.');
      const candidate={...old,...move};
      if(!feasible(now,now.sessions,candidate,old))throw new Error('لم يعد النقل يحسّن الجدول ضمن القيود؛ أعد المعاينة.');
      const {data,error}=await supabase.rpc('move_or_reschedule_schedule_session',{
        p_session_id:move.id,p_expected_updated_at:old.updated_at,p_target_day_of_week:move.day_of_week,
        p_target_start_time:move.start_time,p_target_end_time:move.end_time,p_target_room_id:move.room_id,
        p_change_reason:'تحسين تتابع الطلاب؛ الهدف 4 أيام والحد 5 أيام أسبوعياً',
      });
      if(error)throw error;
      const result=data as unknown as {ok:boolean;code?:string;session?:Partial<Session>};
      if(!result?.ok||!result.session?.updated_at)throw new Error(`رفض فحص الحفظ النقل: ${result?.code||'غير معروف'}`);
      fresh={...now,sessions:now.sessions.map(s=>s.id===move.id?{...candidate,...result.session}:s)};
      applied++;options.onProgress?.(applied,proposal.moves.length);
    }catch(error){stopped=error instanceof Error?error.message:'تعذر إكمال النقل؛ تحقق من الجدول وأعد المعاينة.';break;}
  }
  // Re-read authoritative data even after a network error (the last RPC may have committed).
  const actual=await loadCompactSnapshot(collegeId,versionId);
  return {applied,total:proposal.moves.length,before,after:measure(actual),stopped};
}
