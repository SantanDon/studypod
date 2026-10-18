import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import express from 'express';

const stripImports=s=>s.replace(/^import\s[\s\S]*?;\r?\n/gm,'');
async function fixture(extractionError){
 const logger={error(){},debug(){},warn(){},info(){}};
 const errorSource=stripImports(await readFile(new URL('../middleware/errorHandler.js',import.meta.url),'utf8')).replace(/export /g,'');
 const errors=vm.runInNewContext(`${errorSource}\n({AppError,errorHandler})`,{logger,multer:{MulterError:class extends Error{}},process:{env:{NODE_ENV:'production'}}});
 let source=stripImports(await readFile(new URL('./youtube.js',import.meta.url),'utf8')).replace('export default router;','router;').replace('async function performYouTubeExtraction(', 'async function unusedOriginalExtraction(');
 let sourceWrites=0;
 const router=vm.runInNewContext(source,{express,...errors,process:{env:{}},logger,authenticateToken:(_q,_s,n)=>n(),requireScope:()=>((_q,_s,n)=>n()),getDatabase:async()=>({}),dbHelpers:{getUserById:async()=>null,getNotebookById:async()=>({id:'synthetic'}),createSource:async()=>{sourceWrites++;}},performYouTubeExtraction:async()=>{throw typeof extractionError==='function'?extractionError(errors.AppError):extractionError;},setTimeout,clearTimeout,AbortController,URL});
 router.get('/health',(_req,res)=>res.json({status:'ok'}));
 router.post('/signup',(_req,res)=>res.status(201).json({synthetic:true}));
 async function request(path,method='GET'){
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('In-memory router did not complete')),500);
   const req={method,url:path,originalUrl:path,query:{url:'synthetic-url'},body:{notebookId:'synthetic',url:'synthetic-url'},user:{userId:'synthetic'}};
   const res={headersSent:false,statusCode:200,status(code){this.statusCode=code;return this;},json(body){clearTimeout(timer);resolve({status:this.statusCode,body});return this;}};
   router.handle(req,res,error=>error?errors.errorHandler(error,req,res,reject):reject(new Error('No route')));
  });
 }
 return {request,writes:()=>sourceWrites};
}
for(const [code,status] of [['YOUTUBE_EXTRACTION_UNRESOLVED',422],['YOUTUBE_UNAVAILABLE',404],['USAGE_LIMIT_REACHED',429]]){
 test(`${code} completes both actual Express4 routes through middleware and subsequent mock health/signup remain reachable`,async()=>{
  const f=await fixture(AppError=>new AppError(status,code,'Synthetic unavailable'));
  for(const [path,method] of [['/youtube-transcript','GET'],['/ingest','POST']]){
   const response=await f.request(path,method); assert.equal(response.status,status); assert.equal(response.body.code,code); assert.equal(f.writes(),0);
   assert.equal((await f.request('/health')).status,200); assert.equal((await f.request('/signup','POST')).status,201);
  }
 });
}
test('unexpected provider rejection becomes500 response with original route codes, no source write',async()=>{
 const f=await fixture(new Error('Synthetic provider error'));
 const transcript=await f.request('/youtube-transcript');
 const ingest=await f.request('/ingest','POST');
 assert.equal(transcript.status,500); assert.equal(transcript.body.code,'YOUTUBE_EXTRACTION_FAILED');
 assert.equal(ingest.status,500); assert.equal(ingest.body.code,'YOUTUBE_INGEST_FAILED');
 assert.equal(f.writes(),0); assert.equal((await f.request('/health')).status,200);
});
