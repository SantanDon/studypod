import { ChatMessage, CreateChatMessageInput } from '@/types/domain';

/**
 * Factory for creating ChatMessage domain objects
 */
export class ChatMessageFactory {
  /**
   * Create a new chat message instance
   */
  static create(input: CreateChatMessageInput): ChatMessage {
    return {
      id: this.generateId(),
      ...input,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Create a chat message from existing data
   */
  static fromData(data: Partial<ChatMessage>): ChatMessage {
    return {
      id: data.id || this.generateId(),
      notebook_id: data.notebook_id || '',
      message: data.message || {
        type: 'human',
        content: '',
      },
      created_at: data.created_at || new Date().toISOString(),
    };
  }

  /**
   * Create a test chat message
   */
  static createTest(overrides?: Partial<ChatMessage>): ChatMessage {
    return {
      id: 'test-message-' + Math.random().toString(36).substr(2, 9),
      notebook_id: 'test-notebook',
      message: {
        type: 'human',
        content: 'Test message',
      },
      created_at: new Date().toISOString(),
      ...overrides,
    };
  }

  /**
   * Create a human message
   */
  static createHuman(content: string, notebookId: string): ChatMessage {
    return this.create({
      notebook_id: notebookId,
      message: {
        type: 'human',
        content,
      },
    });
  }

  /**
   * Create an AI message
   */
  static createAI(content: string, notebookId: string): ChatMessage {
    return this.create({
      notebook_id: notebookId,
      message: {
        type: 'ai',
        content,
      },
    });
  }

  /**
   * Generate a unique ID
   */
  private static generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
