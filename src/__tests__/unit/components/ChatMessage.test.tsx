import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatMessage from '@/components/chat/ChatMessage';
import { EnhancedChatMessage } from '@/types/message';

// Mock the MarkdownRenderer component
vi.mock('@/components/chat/MarkdownRenderer', () => ({
  default: ({ content, isUserMessage }: { content: string; isUserMessage: boolean }) => (
    <div data-testid="markdown-renderer" data-user-message={isUserMessage}>
      {content}
    </div>
  ),
}));

// Mock the SaveToNoteButton component
vi.mock('@/components/notebook/SaveToNoteButton', () => ({
  default: () => <button data-testid="save-to-note-button">Save</button>,
}));

describe('ChatMessage Component', () => {
  it('renders user message correctly', () => {
    const userMessage: EnhancedChatMessage = {
      id: '1',
      message: {
        type: 'human',
        content: 'Hello, how are you?',
      },
    } as EnhancedChatMessage;

    render(<ChatMessage message={userMessage} />);

    const renderer = screen.getByTestId('markdown-renderer');
    expect(renderer).toHaveAttribute('data-user-message', 'true');
    expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
  });

  it('renders AI message correctly', () => {
    const aiMessage: EnhancedChatMessage = {
      id: '2',
      message: {
        type: 'ai',
        content: 'I am doing well, thank you!',
      },
    } as EnhancedChatMessage;

    render(<ChatMessage message={aiMessage} />);

    const renderer = screen.getByTestId('markdown-renderer');
    expect(renderer).toHaveAttribute('data-user-message', 'false');
    expect(screen.getByText('I am doing well, thank you!')).toBeInTheDocument();
  });

  it('shows save button for AI messages', () => {
    const aiMessage: EnhancedChatMessage = {
      id: '2',
      message: {
        type: 'ai',
        content: 'AI response',
      },
    } as EnhancedChatMessage;

    render(<ChatMessage message={aiMessage} notebookId="notebook-1" />);

    expect(screen.getByTestId('save-to-note-button')).toBeInTheDocument();
  });

  it('does not show save button for user messages', () => {
    const userMessage: EnhancedChatMessage = {
      id: '1',
      message: {
        type: 'human',
        content: 'User message',
      },
    } as EnhancedChatMessage;

    render(<ChatMessage message={userMessage} />);

    expect(screen.queryByTestId('save-to-note-button')).not.toBeInTheDocument();
  });

  it('calls onCitationClick when citation is clicked', () => {
    const mockOnCitationClick = vi.fn();
    const aiMessage: EnhancedChatMessage = {
      id: '2',
      message: {
        type: 'ai',
        content: 'Response with citation',
      },
    } as EnhancedChatMessage;

    render(
      <ChatMessage
        message={aiMessage}
        onCitationClick={mockOnCitationClick}
      />
    );

    expect(screen.getByText('Response with citation')).toBeInTheDocument();
  });

  it('renders message with correct styling for user messages', () => {
    const userMessage: EnhancedChatMessage = {
      id: '1',
      message: {
        type: 'human',
        content: 'User message',
      },
    } as EnhancedChatMessage;

    const { container } = render(<ChatMessage message={userMessage} />);

    const messageContainer = container.querySelector('.flex.justify-end');
    expect(messageContainer).toBeInTheDocument();

    const messageBox = container.querySelector('.bg-blue-500');
    expect(messageBox).toBeInTheDocument();
  });

  it('renders message with correct styling for AI messages', () => {
    const aiMessage: EnhancedChatMessage = {
      id: '2',
      message: {
        type: 'ai',
        content: 'AI message',
      },
    } as EnhancedChatMessage;

    const { container } = render(<ChatMessage message={aiMessage} />);

    const messageContainer = container.querySelector('.flex.justify-start');
    expect(messageContainer).toBeInTheDocument();
  });

  it('returns null for unknown message type', () => {
    const unknownMessage: EnhancedChatMessage = {
      id: '3',
      message: {
        type: 'unknown' as 'human' | 'ai',
        content: 'Unknown message',
      },
    } as EnhancedChatMessage;

    const { container } = render(<ChatMessage message={unknownMessage} />);

    expect(container.firstChild).toBeNull();
  });

  it('passes notebookId to SaveToNoteButton', () => {
    const aiMessage: EnhancedChatMessage = {
      id: '2',
      message: {
        type: 'ai',
        content: 'AI response',
      },
    } as EnhancedChatMessage;

    render(
      <ChatMessage
        message={aiMessage}
        notebookId="notebook-123"
      />
    );

    expect(screen.getByTestId('save-to-note-button')).toBeInTheDocument();
  });
});
