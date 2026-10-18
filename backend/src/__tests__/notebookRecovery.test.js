import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { construct as drizzle } from "drizzle-orm/libsql/driver-core";
import { recoverNotebookIfAbsent } from "../db/notebookRecovery.js";
import * as schema from "../db/schema.js";

async function fixture(t) {
  const client = createClient({url: "file::memory:"});
  t.after(() => client.close());
  await client.executeMultiple(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY);
    INSERT INTO users VALUES ('owner'),('foreign');
    CREATE TABLE notebooks(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,description TEXT,example_questions TEXT,generation_status TEXT DEFAULT 'pending',icon TEXT,join_code TEXT UNIQUE,created_at INTEGER,updated_at INTEGER);`);
  return { client, db: drizzle(client, {schema}) };
}
async function rows(client) { return (await client.execute("SELECT id,user_id,title,description,join_code FROM notebooks ORDER BY id")).rows; }
async function seed(client, id, owner, code) {
  await client.execute({sql:"INSERT INTO notebooks(id,user_id,title,description,join_code) VALUES (?,?,?,?,?)",args:[id,owner,"Original","Keep original",code]});
}
test("baseline blindly inserting a foreign existing ID yields the observed wrapped PRIMARYKEY error", async t => {
  const {client,db}=await fixture(t); await seed(client,"book","owner","ORIGIN");
  await assert.rejects(db.insert(schema.notebooks).values({id:"book",userId:"foreign",title:"Recovered",joinCode:"SECOND"}), e => {
    assert.equal(e.code,undefined); assert.equal(e.cause.extendedCode,"SQLITE_CONSTRAINT_PRIMARYKEY"); assert.equal(e.cause.rawCode,1555);
    assert.equal(e.message.includes("UNIQUE constraint"),false); return true;
  });
});
test("foreign recovery leaves original owner and content unchanged without an INSERT", async t => {
  const {client,db}=await fixture(t); await seed(client,"book","owner","ORIGIN");
  const before=await rows(client); let insertCalls=0;
  const execute=client.execute.bind(client); client.execute=(statement,...rest)=>{
    if (/^insert /i.test(typeof statement==='string'?statement:statement.sql)) insertCalls++;
    return execute(statement,...rest);
  };
  await recoverNotebookIfAbsent(db,"book","foreign","Recovered","Replacement","SECOND");
  assert.equal(insertCalls,0); assert.deepEqual(await rows(client),before);
});
test("twenty concurrent recovery requests for one owner persist exactly one notebook", async t => {
  const {client,db}=await fixture(t);
  await Promise.all(Array.from({length:20},(_,i)=>recoverNotebookIfAbsent(db,"book","owner","Original",null,`JOIN${i}`)));
  const persisted=await rows(client); assert.equal(persisted.length,1); assert.equal(persisted[0].user_id,"owner");
});
test("two competing owners cannot claim the same missing notebook", async t => {
  const {client,db}=await fixture(t);
  await Promise.all([recoverNotebookIfAbsent(db,"book","owner","Owner book",null,"OWNER1"),recoverNotebookIfAbsent(db,"book","foreign","Foreign book",null,"OTHER1")]);
  const persisted=await rows(client); assert.equal(persisted.length,1);
  assert.ok(["owner","foreign"].includes(persisted[0].user_id));
  const original={...persisted[0]}; const loser=original.user_id==='owner'?'foreign':'owner';
  await recoverNotebookIfAbsent(db,"book",loser,"Claimed",null,"OTHER2");
  assert.deepEqual({...((await rows(client))[0])},original);
  const denied=await client.execute({sql:"SELECT id FROM notebooks WHERE id=? AND user_id=?",args:["book",loser]});
  assert.equal(denied.rows.length,0);
});
test("distinct concurrent IDs remain distinct and repeated same-owner recovery does not edit content", async t => {
  const {client,db}=await fixture(t);
  await Promise.all(Array.from({length:20},(_,i)=>recoverNotebookIfAbsent(db,`book${i}`,"owner",`Title${i}`,null,`CODE${i}`)));
  const before=await rows(client); assert.equal(before.length,20);
  await recoverNotebookIfAbsent(db,"book0","owner","Changed","Changed","CHANGE");
  assert.deepEqual(await rows(client),before);
});
test("join-code uniqueness and foreign-key failures remain errors, never swallowed as primary-key recovery", async t => {
  const {client,db}=await fixture(t); await seed(client,"book","owner","ORIGIN");
  await assert.rejects(recoverNotebookIfAbsent(db,"new","owner","New",null,"ORIGIN"),e=>e.cause?.extendedCode==='SQLITE_CONSTRAINT_UNIQUE');
  await assert.rejects(recoverNotebookIfAbsent(db,"absent-owner","missing","New",null,"FRESH1"),e=>e.cause?.extendedCode==='SQLITE_CONSTRAINT_FOREIGNKEY');
  assert.equal((await rows(client)).length,1);
});
