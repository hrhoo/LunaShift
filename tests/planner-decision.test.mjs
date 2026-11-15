import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {samePlan,shiftedSettings,checkedUTC,outcomeTitle,checkRows,orderedAlternatives,changeSummary} from '../components/manual-planner/planner-decision.js';
import {DEFAULTS,evaluate} from '../components/manual-planner/core/rehearsal.js';
const bundle=JSON.parse(fs.readFileSync(new URL('../public/data/lunar-data.json',import.meta.url)));
const current=evaluate(bundle,DEFAULTS);
const failed=evaluate(bundle,{...DEFAULTS,siteId:'ridge-shoulder'});
test('plan equality accepts equivalent UTC representations',()=>assert.ok(samePlan(DEFAULTS,{...DEFAULTS,startUTC:'2026-11-18T00:00:00.000Z'})));
test('plan equality is independent of key insertion order',()=>assert.ok(samePlan({siteId:'x',startUTC:DEFAULTS.startUTC},{startUTC:DEFAULTS.startUTC,siteId:'x'})));
test('plan equality detects an edited hardware assumption',()=>assert.equal(samePlan(DEFAULTS,{...DEFAULTS,batteryKWh:3}),false));
test('plan equality supports full calculated results',()=>assert.ok(samePlan(current,{settings:{...current.settings}})));
test('plan equality rejects missing results and extra fields',()=>{assert.equal(samePlan(null,current),false);assert.equal(samePlan({a:1},{a:1,b:2}),false);});
test('one-day delay changes time only, without mutating input',()=>{const before=JSON.stringify(DEFAULTS),x=shiftedSettings(DEFAULTS,1);assert.equal(Date.parse(x.startUTC)-Date.parse(DEFAULTS.startUTC),86400000);assert.equal(JSON.stringify(DEFAULTS),before);assert.deepEqual({...x,startUTC:DEFAULTS.startUTC},{...DEFAULTS});});
test('hour and fractional-day delays are supported',()=>{assert.equal(Date.parse(shiftedSettings(DEFAULTS,1.5,'hours').startUTC)-Date.parse(DEFAULTS.startUTC),5400000);assert.equal(Date.parse(shiftedSettings(DEFAULTS,.5).startUTC)-Date.parse(DEFAULTS.startUTC),43200000);});
test('negative and nonfinite delays are rejected',()=>{for(const v of [-1,NaN,Infinity,'words'])assert.throws(()=>shiftedSettings(DEFAULTS,v));});
test('unknown delay units rejected',()=>assert.throws(()=>shiftedSettings(DEFAULTS,2,'weeks')));
test('exact date parser adds an explicit UTC designation',()=>assert.equal(checkedUTC('2026-11-19T12:30'),'2026-11-19T12:30:00.000Z'));
test('invalid calendar dates do not roll into another month',()=>{assert.throws(()=>checkedUTC('2026-02-30T12:00'));assert.throws(()=>checkedUTC('2027-02-29T12:00'));assert.throws(()=>checkedUTC('2026-13-01T00:00'));});
test('date parser rejects unsupported year and incomplete time',()=>{for(const d of ['2028-01-01T00:00','2026-11-18','2026-11-18T24:01','<script>'])assert.throws(()=>checkedUTC(d));});
test('current verdict is from the computed feasibility result',()=>{assert.equal(outcomeTitle(current),'Your current plan works.');assert.equal(outcomeTitle(failed),'Your plan needs attention.');});
test('trial verdict does not imply adoption',()=>{assert.equal(outcomeTitle(current,true),'The revised plan still works.');assert.equal(outcomeTitle(failed,true),'This change needs an alternative.');});
test('passing reference passes science, deadline and reserve presentation checks',()=>assert.ok(checkRows(current).every(c=>c.pass)));
test('failure is not disguised as a successful objective',()=>assert.ok(checkRows(failed).some(c=>!c.pass)));
test('a reserve breach after data return does not rewrite completion',()=>{const r={...current,metrics:{...current.metrics,firstReserveHour:current.metrics.completeHour+1,firstOutageHour:null}};assert.ok(checkRows(r).find(c=>c.key==='reserve').pass);});
test('a reserve breach before completion is shown',()=>{const r={...current,metrics:{...current.metrics,firstReserveHour:0}};assert.equal(checkRows(r).find(c=>c.key==='reserve').pass,false);});
test('alternative ordering excludes unchanged plan and errored cases',()=>{const c=(day,pass,dist)=>({settings:shiftedSettings(DEFAULTS,day),metrics:{feasible:pass,completeHour:5},delay:day,distanceKm:dist});const x=orderedAlternatives([c(0,true,0),c(2,true,1),c(1,true,3),c(1,false,0),{error:'coverage'}],DEFAULTS);assert.equal(x.length,3);assert.equal(x[0].delay,1);assert.equal(x[1].delay,2);assert.equal(x[2].metrics.feasible,false);});
test('ordering uses distance only after passing status and delay',()=>{const c=d=>({settings:{...DEFAULTS,siteId:'site'+d},metrics:{feasible:true,completeHour:3},delay:0,distanceKm:d});assert.equal(orderedAlternatives([c(4),c(1)],DEFAULTS)[0].distanceKm,1);});
test('site/date search preserves hardware and relative objective',()=>{const d=changeSummary(DEFAULTS,{...shiftedSettings(DEFAULTS,2),siteId:'ridge-low'});assert.equal(d.hours,48);assert.ok(d.siteChanged&&d.hardwareFixed&&d.taskFixed);});
test('explicit objective and hardware edits are identified',()=>{const d=changeSummary(DEFAULTS,{...DEFAULTS,batteryKWh:5,dataMB:200});assert.equal(d.hardwareFixed,false);assert.equal(d.taskFixed,false);});
test('rabbit UI uses local idle and bongo artwork and keeps decorative images silent',async()=>{const {lunaRabbit}=await import('../components/manual-planner/luna-mascot.js');const html=lunaRabbit();assert.ok(html.includes('aria-hidden="true"'));for(const name of ['idle','bongo']){assert.ok(html.includes(`/assets/luna/${name}.png`));assert.ok(fs.existsSync(new URL(`../public/assets/luna/${name}.png`,import.meta.url)));}});

test('Luna reacts to inserted letters and Unicode, without drumming on deletion or spaces', async () => {
 const {insertedLetters}=await import('../components/manual-planner/luna-mascot.js');
 for (const [before,after,count] of [['','a',1],['a','ab',1],['abc','ab',0],['a','a ',0],['a','a',0],['ab','a你好b',2],['12','123',1],['hello world','hello new world',3],['','!?',0]]) {
  assert.equal(insertedLetters(before,after),count,`${before} -> ${after}`);
 }
});
