import { describe, it, expect } from 'vitest';
import { processMarkdownWithCitations } from '@/components/chat/markdownParser';
import { MessageSegment, Citation } from '@/types/message';
import React from 'react';
import { render } from '@testing-library/react';

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
});
