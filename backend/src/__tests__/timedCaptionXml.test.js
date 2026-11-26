import { describe, expect, it } from 'vitest';
import { parseTimedCaptionXml } from '../services/timedCaptionXml.js';
import { parseYtDlpJson3 } from '../services/ytdlpTranscriptService.js';

describe('caption text extraction', () => {
  it('preserves literal XML examples, CDATA and singly decoded entity spellings', () => {
    const xml = '<transcript><text start="1.5" dur="2">A <b>name</b>: <![CDATA[<key>]]>, &amp;lt; and &#x2014;.</text></transcript>';
    expect(parseTimedCaptionXml(xml)).toEqual([{ text: 'A name: <key>, &lt; and —.', offset: 1500, duration: 2000 }]);
  });

  it('keeps unclocked lines for local imports and distinguishes inferred time from a supplied zero', () => {
    const xml = '<transcript><text start="0">Opening</text><text>Closing</text></transcript>';
    expect(parseTimedCaptionXml(xml, { includeTimingSource: true }).map(({ offset, timingSource }) => [offset, timingSource]))
      .toEqual([[0, 'provider'], [3000, 'inferred']]);
    expect(parseTimedCaptionXml(xml, { requireTiming: true })).toHaveLength(1);
  });

  it('reads inner timing-format words as one segment and falls back after incomplete documents', () => {
    expect(parseTimedCaptionXml('<timedtext><p t="110"><s>First</s> word</p></timedtext>'))
      .toEqual([{ text: 'First word', offset: 110, duration: 3000 }]);
    expect(parseTimedCaptionXml('<transcript><text')).toEqual([]);
  });

  it('decodes JSON caption entities once while preserving whitespace normalization', () => {
    expect(parseYtDlpJson3({ events: [{ segs: [{ utf8: 'Spell   &amp;lt;\nfor less than.' }] }] })[0].text)
      .toBe('Spell &lt; for less than.');
  });
});
