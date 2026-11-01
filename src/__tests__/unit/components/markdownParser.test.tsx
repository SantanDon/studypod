import { describe, it, expect, vi } from 'vitest';
import { processMarkdownWithCitations } from '@/components/chat/markdownParser';
import { MessageSegment, Citation } from '@/types/message';
import React from 'react';
import { fireEvent, render } from '@testing-library/react';

describe('processMarkdownWithCitations', () => {
  it('renders raw text as paragraphs', () => {
    const segments: MessageSegment[] = [{ text: 'Hello world' }];
    const citations: Citation[] = [];
    const elements = processMarkdownWithCitations(segments, citations);
    
    expect(elements).toHaveLength(1);
    const { container } = render(<>{elements}</>);
    const p = container.querySelector('p');
    expect(p).toBeInTheDocument();
    expect(p?.textContent).toBe('Hello world');
  });

  it('renders headings correctly', () => {
    const segments: MessageSegment[] = [{ text: '## Section Title\n### Sub Section' }];
    const citations: Citation[] = [];
    const elements = processMarkdownWithCitations(segments, citations);
    
    const { container } = render(<>{elements}</>);
    const h2 = container.querySelector('h2');
    const h3 = container.querySelector('h3');
    expect(h2).toBeInTheDocument();
    expect(h2?.textContent).toBe('Section Title');
    expect(h3).toBeInTheDocument();
    expect(h3?.textContent).toBe('Sub Section');
  });

  it('renders bullet lists correctly', () => {
    const segments: MessageSegment[] = [{ text: '- Item 1\n- Item 2' }];
    const citations: Citation[] = [];
    const elements = processMarkdownWithCitations(segments, citations);
    
    const { container } = render(<>{elements}</>);
    const ul = container.querySelector('ul');
    expect(ul).toBeInTheDocument();
    expect(ul?.querySelectorAll('li')).toHaveLength(2);
    expect(ul?.querySelectorAll('li')[0].textContent).toBe('Item 1');
    expect(ul?.querySelectorAll('li')[1].textContent).toBe('Item 2');
  });

  it('renders numbered lists correctly', () => {
    const segments: MessageSegment[] = [{ text: '1. First\n2. Second' }];
    const citations: Citation[] = [];
    const elements = processMarkdownWithCitations(segments, citations);
    
    const { container } = render(<>{elements}</>);
    const ol = container.querySelector('ol');
    expect(ol).toBeInTheDocument();
    expect(ol?.querySelectorAll('li')).toHaveLength(2);
    expect(ol?.querySelectorAll('li')[0].textContent).toBe('First');
    expect(ol?.querySelectorAll('li')[1].textContent).toBe('Second');
  });

  it('preserves the starting number of an ordered list', () => {
    const elements = processMarkdownWithCitations([{ text: '4. Fourth\n5. Fifth' }], []);
    const { container } = render(<>{elements}</>);
    expect(container.querySelector('ol')).toHaveAttribute('start', '4');
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('renders loose list items as one semantic list', () => {
    const elements = processMarkdownWithCitations([{ text: '- First point\n\n- Second point' }], []);
    const { container } = render(<>{elements}</>);
    expect(container.querySelectorAll('ul')).toHaveLength(1);
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('renders quote markers as blockquotes', () => {
    const elements = processMarkdownWithCitations([{ text: '> A quoted thought\n> on two lines' }], []);
    const { container } = render(<>{elements}</>);
    expect(container.querySelector('blockquote')).toBeInTheDocument();
    expect(container.querySelector('blockquote')?.textContent).toBe('A quoted thoughton two lines');
    expect(container.textContent).not.toContain('>');
  });

  it('keeps unmatched emphasis markers literal without swallowing following text', () => {
    const elements = processMarkdownWithCitations([{ text: '**On Polemarchus:* still readable * source_file.pdf' }], []);
    const { container } = render(<>{elements}</>);
    expect(container.textContent).toBe('**On Polemarchus:* still readable * source_file.pdf');
    expect(container.querySelector('strong, em')).toBeNull();
  });

  it('renders balanced emphasis and preserves source filenames without treating underscores as emphasis', () => {
    const elements = processMarkdownWithCitations([{ text: '**Key point** and *emphasis*, source_file_name.pdf' }], []);
    const { container } = render(<>{elements}</>);
    expect(container.querySelector('strong')?.textContent).toBe('Key point');
    expect(container.querySelector('em')?.textContent).toBe('emphasis');
    expect(container.textContent).toContain('source_file_name.pdf');
  });

  it('preserves fenced code and treats HTML as text', () => {
    const elements = processMarkdownWithCitations([{ text: '```html\n<script>alert(1)</script>\n\n<div>ok</div>\n```' }], []);
    const { container } = render(<>{elements}</>);
    expect(container.querySelector('pre code')?.textContent).toBe('<script>alert(1)</script>\n\n<div>ok</div>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('div')).toBeNull();
  });

  it('starts a fenced code block after prose in the same paragraph block', () => {
    const elements = processMarkdownWithCitations([{ text: 'Example:\n```ts\nconst answer = 42;\n```' }], []);
    const { container } = render(<>{elements}</>);
    expect(container.querySelector('p')?.textContent).toBe('Example:');
    expect(container.querySelector('pre code')?.textContent).toBe('const answer = 42;');
    expect(container.querySelector('pre')?.previousElementSibling?.tagName).toBe('P');
  });

  it('keeps markdown link and table syntax as safe readable text', () => {
    const text = '[safe](https://example.com) [unsafe](javascript:alert(1))\n| Name | Value |\n| --- | --- |\n| one | two |';
    const elements = processMarkdownWithCitations([{ text }], []);
    const { container } = render(<>{elements}</>);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('[safe](https://example.com)');
    expect(container.textContent).toContain('[unsafe](javascript:alert(1))');
    expect(container.textContent).toContain('| one | two |');
  });

  it('keeps segment citation callbacks clickable after formatted content', () => {
    const citation = { citation_id: 8, chunk_index: 3 } as Citation;
    const onCitationClick = vi.fn();
    const elements = processMarkdownWithCitations([{ text: '- A supported point', citation_id: 8 }], [citation], onCitationClick);
    const { getByRole } = render(<>{elements}</>);
    fireEvent.click(getByRole('button', { name: '4' }));
    expect(onCitationClick).toHaveBeenCalledWith(citation);
  });

  it('renders citation markers when a matching citation exists and leaves unknown markers readable', () => {
    const citation = { citation_id: 1, chunk_index: 0 } as Citation;
    const elements = processMarkdownWithCitations([{ text: 'Supported [1], unknown [9].' }], [citation]);
    const { container } = render(<>{elements}</>);
    expect(container.querySelector('[aria-label="Citation 1"]')).toBeInTheDocument();
    expect(container.textContent).toContain('unknown [9].');
  });
});
