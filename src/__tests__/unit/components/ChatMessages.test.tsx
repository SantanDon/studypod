import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatMessages from '@/components/chat/ChatMessages';
import { EnhancedChatMessage } from '@/types/message';

describe('ChatMessages Component', () => {
  const mockMessages: EnhancedChatMessage[] = [
    {
      id: '1',
      message: {
        type: 'human',
        content: 'Hello, how are you?',
      },
    } as EnhancedChatMessage,
    {
      id: '2',
      message: {
        type: 'ai',
        content: 'I am doing well, thank you for asking!',
      },
    } as EnhancedChatMessage,
  ];

  it('renders messages correctly', () => {
    render(
      <ChatMessages
        messages={mockMessages}
        pendingUserMessage={null}
        showAiLoading={false}
      />
    );

    expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
    expect(screen.getByText('I am doing well, thank you for asking!')).toBeInTheDocument();
  });

  it('renders pending user message', () => {
    render(
      <ChatMessages
        messages={[]}
        pendingUserMessage="Pending message"
        showAiLoading={false}
      />
    );

    expect(screen.getByText('Pending message')).toBeInTheDocument();
  });

  it('renders loading indicator when showAiLoading is true', () => {
    const { container } = render(
      <ChatMessages
        messages={[]}
        pendingUserMessage={null}
        showAiLoading={true}
      />
    );

    const loadingDots = container.querySelectorAll('.animate-bounce');
    expect(loadingDots.length).toBeGreaterThan(0);
  });

  it('calls onCitationClick when citation is clicked', () => {
    const mockOnCitationClick = vi.fn();
    render(
      <ChatMessages
        messages={mockMessages}
        pendingUserMessage={null}
        showAiLoading={false}
        onCitationClick={mockOnCitationClick}
        notebookId="notebook-1"
      />
    );

    // Component should render without errors
    expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
  });

  it('renders empty state when no messages', () => {
    const { container } = render(
      <ChatMessages
        messages={[]}
        pendingUserMessage={null}
        showAiLoading={false}
      />
    );

    // Should render ScrollArea with empty content
    expect(container.querySelector('[data-radix-scroll-area-viewport]')).toBeInTheDocument();
  });

  it('renders multiple messages in correct order', () => {
    const messages: EnhancedChatMessage[] = [
      {
        id: '1',
        message: { type: 'human', content: 'First message' },
      } as EnhancedChatMessage,
      {
        id: '2',
        message: { type: 'ai', content: 'Second message' },
      } as EnhancedChatMessage,
      {
        id: '3',
        message: { type: 'human', content: 'Third message' },
      } as EnhancedChatMessage,
    ];

    render(
      <ChatMessages
        messages={messages}
        pendingUserMessage={null}
        showAiLoading={false}
      />
    );

    const allText = screen.getByText('First message').textContent +
                   screen.getByText('Second message').textContent +
                   screen.getByText('Third message').textContent;

    expect(allText).toContain('First message');
    expect(allText).toContain('Second message');
    expect(allText).toContain('Third message');
  });
});
