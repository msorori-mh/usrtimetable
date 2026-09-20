import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVersionInstructorLimits } from '../src/lib/auto-scheduler/version-instructor-limits.ts';
test('only the selected instructor receives the version maximum',()=>{
 const input=[{id:'a',max_attendance_days_per_week:null},{id:'b',max_attendance_days_per_week:4}];
 const output=applyVersionInstructorLimits(input,{a:5});
 assert.equal(output[0].max_attendance_days_per_week,5);
 assert.equal(output[1].max_attendance_days_per_week,4);
 assert.equal(input[0].max_attendance_days_per_week,null);
 assert.deepEqual(applyVersionInstructorLimits(input,{}),input);
});
test('invalid override values are rejected',()=>{
 for(const value of [0,7,3.5,'5',null]) assert.throws(()=>applyVersionInstructorLimits([{id:'a'}],{a:value}));
 assert.throws(()=>applyVersionInstructorLimits([],[]));
});
