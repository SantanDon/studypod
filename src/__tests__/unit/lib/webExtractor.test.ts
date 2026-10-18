import { describe, expect, it } from 'vitest';
import { sanitizeWebContent } from '@/lib/extraction/webExtractor';

describe('saved website source formatting', () => {
  it('preserves headings, paragraphs and list lines while cleaning whitespace', () => {
    expect(sanitizeWebContent('# Cedar\r\n\r\n  First   paragraph.\r\n\r\n\r\n## Method\n- Tray one\n- Tray two')).toBe('# Cedar\n\nFirst paragraph.\n\n## Method\n- Tray one\n- Tray two');
  });
  it('removes scripts, styles and comments without flattening paragraphs', () => {
    expect(sanitizeWebContent('First.\n\n<script>bad()</script><style>bad</style><!--bad-->Second.')).toBe('First.\n\nSecond.');
  });
});
