import React, { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Send } from 'lucide-react';

/**
 * ChatInput Component
 * 
 * Handles user input for chat messages with send button and example questions carousel.
 * 
 * @component
 * @example
 * ```tsx
 * <ChatInput
 *   message={message}
 *   onMessageChange={setMessage}
 *   onSend={handleSend}
 *   disabled={isChatDisabled}
 *   isLoading={isSending}
 *   sourceCount={3}
 *   exampleQuestions={questions}
 *   onExampleQuestionClick={handleQuestion}
 * />
 * ```
 */
interface ChatInputProps {
  message: string;
  onMessageChange: (message: string) => void;
  onSend: () => void;
  disabled: boolean;
  isLoading: boolean;
  sourceCount: number;
  exampleQuestions?: string[];
  onExampleQuestionClick?: (question: string) => void;
  placeholder?: string;
}

const ChatInput: React.FC<ChatInputProps> = ({
  message,
  onMessageChange,
  onSend,
  disabled,
  isLoading,
  sourceCount,
  exampleQuestions = [],
  onExampleQuestionClick,
  placeholder = "Start typing...",
}) => {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const getExampleQuestionLabel = (question: string) => {
    if (question.startsWith('What evidence from my sources supports')) return 'Show the evidence';
    if (question.startsWith('Explain the key idea more simply')) return 'Explain simply';
    if (question.startsWith('What is uncertain or missing')) return 'What is missing?';
    if (question.startsWith('Help me practise the main idea')) return 'Test my understanding';
    if (question.startsWith('Help me connect ') && question.endsWith(' to the sources in my notebook.')) return 'Connect this chapter';
    if (question.startsWith('What should I focus on in ')) return 'What should I focus on?';
    if (question.startsWith('Ask me one question to check my understanding of ')) return 'Test this chapter';
    if (question.startsWith('What is still unclear about ')) return 'What is still unclear?';
    return question;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter confirms a composed character before it should submit the draft.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !disabled && !isLoading && message.trim()) {
      e.preventDefault();
      onSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/') || items[i].type.startsWith('video/') || items[i].type.startsWith('audio/')) {
        e.preventDefault();
        toast({
          title: "Attachments not supported",
          description: "This AI model processes text only. Images, video, and audio cannot be read.",
          variant: "destructive",
        });
        return;
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLInputElement>) => {
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith('image/') || files[i].type.startsWith('video/') || files[i].type.startsWith('audio/')) {
        e.preventDefault();
        toast({
          title: "Attachments not supported",
          description: "This AI model processes text only. Images, video, and audio cannot be read.",
          variant: "destructive",
        });
        return;
      }
    }
  };

  const shouldShowExamples = !disabled && !isLoading && !message.trim() && exampleQuestions.length > 0;

  return (
    <div className="p-3 sm:p-6 border-t border-border flex-shrink-0 bg-background dark:bg-background">
      <div className="max-w-4xl mx-auto">
        <div className="flex gap-2 sm:gap-4">
          <div className="min-w-0 flex-1 relative">
            <Input
              ref={inputRef}
              aria-label="Chat message"
              placeholder={placeholder}
              value={message}
              onChange={(e) => onMessageChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className={`h-11 sm:h-10 ${message ? 'pr-3' : 'pr-20'}`}
              disabled={disabled || isLoading}
            />
            {!message && (
              <div className="pointer-events-none absolute right-3 top-1/2 transform -translate-y-1/2 text-sm text-muted-foreground">
                {sourceCount} source{sourceCount !== 1 ? 's' : ''}
              </div>
            )}
          </div>
          <Button
            className="h-11 min-w-11 shrink-0 sm:h-10"
            onClick={onSend}
            aria-label="Send message"
            disabled={!message.trim() || disabled || isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </div>

        {/* Example Questions Carousel */}
        {shouldShowExamples && (
          <div className="mt-4">
            <Carousel aria-label="Suggested learning questions" className="w-full max-w-4xl">
              <CarouselContent className="-ml-2 md:-ml-4">
                {exampleQuestions.map((question, index) => (
                  <CarouselItem key={index} className="pl-2 md:pl-4 basis-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Suggested question: ${getExampleQuestionLabel(question)}`}
                      title={question}
                      className="h-auto max-w-[min(82vw,28rem)] whitespace-normal break-words py-2 px-3 text-left text-sm leading-snug sm:max-w-none sm:whitespace-nowrap"
                      onClick={() => onExampleQuestionClick?.(question)}
                    >
                      {getExampleQuestionLabel(question)}
                    </Button>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {exampleQuestions.length > 2 && (
                <>
                  <CarouselPrevious className="left-0 hidden sm:inline-flex" />
                  <CarouselNext className="right-0 hidden sm:inline-flex" />
                </>
              )}
            </Carousel>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatInput;
