import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { matchPassage } from './match.mjs';

const guide = await readFile(new URL('./guide.md', import.meta.url), 'utf8');
const passages = [...guide.matchAll(/^## (\w+)\r?\n([^\r\n]+)/gm)]
  .map(([, heading, quote]) => ({ heading, quote }));

for (const [question, expected] of [
  ['What should I do on Friday?', 'Friday'],
  ["What is Friday's plan?", 'Friday'],
  ['What is Tuesday’s activity?', 'Tuesday'],
  ['What is Friday’s weather?', null],
  ['What activity is scheduled for Tuesday?', 'Tuesday'],
  ['When do I revisit mistakes?', 'Wednesday'],
  ['When do I take a practice quiz?', 'Friday'],
  ['Should I take a practice quiz on Monday?', null],
  ['What is the weather on Friday?', null],
  ['What should I do on Sunday?', null],
  ['Compare Monday and Friday', null],
]) {
  test(question, () => assert.equal(matchPassage(question, passages)?.heading ?? null, expected));
}
