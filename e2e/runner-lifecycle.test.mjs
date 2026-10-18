import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { monitorLifecycle } from './runner-lifecycle.mjs';
function fixture(persistOverride) {
 const records=[], interrupted=[];
 const monitor=monitorLifecycle({persist:persistOverride || (async record=>records.push(record)), interruptBrowser: child=>{interrupted.push(child);child.kill('SIGTERM');}});
 return {monitor,records,interrupted};
}
function child(script) { return spawn(process.execPath,['-e',script],{stdio:'ignore',windowsHide:true}); }
for(const code of [0,7]) test(`unexpected service exit${code} records code and interrupts actual idle child promptly`,async()=>{
 const f=fixture(), backend=child(`setTimeout(()=>process.exit(${code}),100)`), browser=child('setInterval(()=>{},1000)');
 const browserExit=once(browser,'exit'); f.monitor.watch(backend,'backend');f.monitor.trackBrowser(browser);
 await once(backend,'exit');await browserExit;const evidence=await f.monitor.flush();
 assert.deepEqual(evidence.failure,{service:'backend',phase:'exit'});assert.equal(f.interrupted.length,1);
 assert.equal(evidence.events.find(e=>e.phase==='exit').code,code);assert.ok(evidence.events.every(e=>typeof e.at==='string'));
 assert.throws(()=>f.monitor.assertHealthy(),/lifecycle failed/);
});
test('service exit before browser attachment still interrupts newly attached browser',async()=>{
 const f=fixture(), preview=child('process.exit(3)');f.monitor.watch(preview,'preview');await once(preview,'exit');
 const browser=child('setInterval(()=>{},1000)'), stopped=once(browser,'exit');f.monitor.trackBrowser(browser);await stopped;
 assert.equal(f.interrupted.length,1);assert.equal((await f.monitor.flush()).failure.service,'preview');
});
test('intentional cleanup signal is recorded without failure or browser interruption',async()=>{
 const f=fixture(), backend=child('setInterval(()=>{},1000)');f.monitor.watch(backend,'backend');f.monitor.beginCleanup();
 const ended=once(backend,'exit');backend.kill('SIGTERM');await ended;const result=await f.monitor.flush();
 assert.equal(result.failure,null);assert.equal(f.interrupted.length,0);assert.equal(result.events.find(e=>e.phase==='exit').unexpected,false);
 f.monitor.assertHealthy();
});
test('evidence persistence failure blocks acceptance and no arbitrary child metadata is serialized',async()=>{
 const f=fixture(async()=>{throw new Error('private secret');}), backend=child('process.exit(0)');
 backend.privateIdentity='private secret';f.monitor.watch(backend,'backend');await once(backend,'exit');const result=await f.monitor.flush();
 assert.equal(result.persistenceFailed,true);assert.throws(()=>f.monitor.assertHealthy());assert.ok(!JSON.stringify(result).includes('private secret'));
 assert.throws(()=>f.monitor.watch(backend,'arbitrary-private-url'),/Unknown service/);
});
