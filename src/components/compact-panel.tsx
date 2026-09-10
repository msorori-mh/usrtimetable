import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { compact, type Proposal, type Metrics } from '@/lib/auto-scheduler/compact';
import { loadCompactSnapshot, applyCompactProposal, type Applied } from '@/lib/auto-scheduler/compact-service';

export function CompactSchedulePanel({collegeId,versionId,canManage,disabled,onBusy}:{collegeId:string;versionId:string;canManage:boolean;disabled:boolean;onBusy:(busy:boolean)=>void}) {
  const [proposal,setProposal]=useState<Proposal|null>(null);
  const [result,setResult]=useState<Applied|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const abort=useRef<AbortController|null>(null);const qc=useQueryClient();
  const execute=async(apply:boolean)=>{
    if(!canManage||!versionId||busy||disabled)return;
    const controller=new AbortController();abort.current=controller;setBusy(true);onBusy(true);setMessage('جارٍ قراءة الجدول والتحقق…');setResult(null);
    try{
      if(apply&&proposal){
        const saved=await applyCompactProposal(collegeId,versionId,proposal,{signal:controller.signal,onProgress:(n,total)=>setMessage(`تم حفظ ${n} من ${total} نقلاً`)});
        setResult(saved);setProposal(null);setMessage(saved.stopped||'اكتمل حفظ التنقلات المقترحة والتحقق من النتيجة.');await qc.invalidateQueries();
      }else{
        setProposal(null);const snapshot=await loadCompactSnapshot(collegeId,versionId);
        const p=await compact(snapshot,{signal:controller.signal,onProgress:n=>setMessage(`جارٍ البحث — ${n} نقلاً محسّناً حتى الآن`)});
        setProposal(p);setMessage(p.stopped?'توقفت المعاينة؛ لم يُحفظ أي نقل.':'اكتملت المعاينة؛ لم يُحفظ أي نقل بعد.');
      }
    }catch(error){setMessage(error instanceof Error?error.message:'تعذر التحقق. أعد المعاينة قبل المتابعة.');setProposal(null);}
    finally{abort.current=null;setBusy(false);onBusy(false);}
  };
  const before=result?.before||proposal?.before,after=result?.after||proposal?.after;
  const fields:Array<[keyof Metrics,string]>=[['levelsOverFive','مستويات تتجاوز خمسة أيام'],['excessDaysOverFour','أيام إضافية فوق هدف أربعة أيام'],['studentGapMinutes','دقائق فراغ الطلاب المجمّعة'],['shortStudentDays','حالات حضور طالب لساعتين أو أقل'],['studentAttendanceDays','مجموع أيام حضور الطلاب'],['sessions','المحاضرات المحفوظة'],['teachingMinutes','دقائق التدريس المحفوظة']];
  return <Card className="p-4 space-y-3" dir="rtl">
    <h2 className="font-bold">تحسين توزيع الجدول</h2>
    <p className="text-sm text-muted-foreground">الهدف أربعة أيام حضور للمستوى، وبحد أقصى خمسة أيام، مع تقليل فراغات كل شعبة فعلية وأيام الحضور القصيرة. تُحفظ ساعات المحاضرات وإسناداتها وتُفحص التنقلات قبل حفظها.</p>
    <p className="text-sm">هذا التحسين يعيد توزيع المحاضرات الموجودة فقط؛ المحاضرات غير المجدولة تبقى بحاجة إلى الإكمال. تحقق النتيجة الجزئية لا يعني اكتمال الجدول النهائي.</p>
    <div className="flex flex-wrap gap-2">
      <Button disabled={!canManage||!versionId||busy||disabled} onClick={()=>void execute(false)}>معاينة تحسين التوزيع</Button>
      <Button disabled={!canManage||busy||disabled||!proposal?.moves.length||proposal.stopped} onClick={()=>void execute(true)}>تطبيق التحسين على المسودة</Button>
      {busy&&<Button variant="outline" onClick={()=>abort.current?.abort()}>إيقاف التحسين</Button>}
    </div>
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
    {before&&after&&<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="text-right p-2">المقياس</th><th>قبل</th><th>{result?'المحفوظ فعلياً':'المقترح'}</th></tr></thead><tbody>{fields.map(([key,label])=><tr key={key} className="border-t"><td className="p-2">{label}</td><td className="text-center">{String(before[key])}</td><td className="text-center">{String(after[key])}</td></tr>)}</tbody></table><p className="text-xs text-muted-foreground">دقائق الفراغ وأيام الحضور موزونة بعدد الطلاب؛ تُجمع لكل شعبة من الطلاب دون إخفاء فراغات العملي.</p></div>}
    {after&&after.levelsOverFive>0&&<p role="alert" className="text-amber-700">لم يتحقق حد خمسة أيام بعد في {after.levelsOverFive} مستوى. النتيجة تحسين جزئي وليست جاهزة للاعتماد النهائي؛ يلزم حل القيود المتبقية وإعادة التحسين.</p>}
    {proposal&&<p className="text-xs">التنقلات المقترحة: {proposal.moves.length}.</p>}
  </Card>;
}
