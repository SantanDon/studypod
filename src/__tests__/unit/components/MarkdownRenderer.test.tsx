import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MarkdownRenderer, { normalizeAssistantMarkdown } from '@/components/chat/MarkdownRenderer';
import { Citation } from '@/types/message';

describe('MarkdownRenderer answer readability', () => {
  it('renders the malformed standalone labels seen in generated answers as bold', () => {
    const { container } = render(<MarkdownRenderer content={[
      'Based on the transcript:',
      '',
      '- **Character Appreciation*',
      '- He discusses the characters.',
      '- **Gameplay Mechanics*',
      '- He describes the parry system.',
      '- **General Engagement*',
    ].join('\n')} />);

    expect(Array.from(container.querySelectorAll('strong'), node => node.textContent)).toEqual([
      'Character Appreciation', 'Gameplay Mechanics', 'General Engagement',
    ]);
    expect(container.textContent).not.toContain('*');
    expect(screen.getByText('He describes the parry system.')).toBeInTheDocument();
  });

  it('preserves valid emphasis, inline expressions and code when repairing labels', () => {
    const valid = [
      '**Already bold**', '*Already italic*', 'Use **bold** inside prose.',
      '2 * 3 = 6', '`**literal*`', '- `**literal*`',
      '```markdown', '- **Code example*', '```',
      '~~~text', '**Another code example*', '~~~',
    ].join('\n');
    expect(normalizeAssistantMarkdown(valid)).toBe(valid);
    expect(normalizeAssistantMarkdown('- **Label*\r\nBody')).toBe('- **Label**\r\nBody');
  });

  it('does not guess at malformed inline prose', () => {
    const prose = 'The speaker **likes the characters* and discusses their role.';
    expect(normalizeAssistantMarkdown(prose)).toBe(prose);
  });

  it('retains interactive source citations alongside repaired headings', () => {
    const citation: Citation = {
      citation_id: 1, source_id: 'video-source', source_title: 'Campaign transcript',
      source_type: 'youtube', chunk_index: 0, excerpt: 'We keep using this parry system.',
    };
    render(<MarkdownRenderer content={{
      segments: [{ text: '- **Gameplay Mechanics*\n- The speaker discusses parrying [1].' }],
      citations: [citation],
    }} />);

    const citationButton = screen.getByRole('button', { name: 'Citation 1' });
    fireEvent.click(citationButton);
    expect(citationButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('We keep using this parry system.')).toBeInTheDocument();
  });

  it('opens the source panel callback when a numbered citation marker is clicked', () => {
    const citation: Citation = {
      citation_id: 1, source_id: 'book-source', source_title: 'The Republic',
      source_type: 'pdf', chunk_index: 0, excerpt: 'Then according to your argument it is just to injure those who do no wrong?',
    };
    const onCitationClick = vi.fn();
    render(<MarkdownRenderer content={{
      segments: [{ text: '> “Then according to your argument it is just to injure those who do no wrong?” [1]' }],
      citations: [citation],
    }} onCitationClick={onCitationClick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Citation 1' }));

    expect(onCitationClick).toHaveBeenCalledWith(citation);
    expect(screen.getByText(citation.excerpt!)).toBeInTheDocument();
  });

  it('does not repair text authored by the user', () => {
    const { container } = render(<MarkdownRenderer content="**Character Appreciation*" isUserMessage />);
    expect(container.textContent).toBe('**Character Appreciation*');
    expect(container.querySelector('strong')).toBeNull();
  });

  it('keeps citations clickable when a malformed label contains a reference', () => {
    const text = '- **Evidence [1]*';
    const citation: Citation = {
      citation_id: 1, source_id: 'evidence', source_title: 'Source evidence', source_type: 'text',
      excerpt: 'The source supports this finding.',
    };
    expect(normalizeAssistantMarkdown(text)).toBe(text);
    const { container } = render(<MarkdownRenderer content={{ segments: [{ text }], citations: [citation] }} />);
    expect(container.querySelector('strong')).toBeNull();
    const citationButton = screen.getByRole('button', { name: 'Citation 1' });
    fireEvent.click(citationButton);
    expect(citationButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('The source supports this finding.')).toBeInTheDocument();
  });

  it('updates rendering role and styling when the text stays the same', () => {
    const { container, rerender } = render(<MarkdownRenderer content="**Label*" className="first" isUserMessage />);
    rerender(<MarkdownRenderer content="**Label*" className="second" />);
    expect(container.querySelector('strong')).toHaveTextContent('Label');
    expect(container.firstElementChild).toHaveClass('second');
    expect(container.firstElementChild).not.toHaveClass('first');
  });

  it('uses the current citation action after a parent callback changes', () => {
    const citation: Citation = {
      citation_id: 1, source_id: 'source', source_title: 'Notes', source_type: 'text',
    };
    const content = { segments: [{ text: 'A fact', citation_id: 1 }], citations: [citation] };
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<MarkdownRenderer content={content} onCitationClick={first} isUserMessage />);
    rerender(<MarkdownRenderer content={content} onCitationClick={second} isUserMessage />);
    fireEvent.click(screen.getByRole('button'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(citation);
  });
});
