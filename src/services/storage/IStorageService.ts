import {
  Notebook,
  CreateNotebookInput,
  UpdateNotebookInput,
  Source,
  CreateSourceInput,
  UpdateSourceInput,
  ChatMessage,
  CreateChatMessageInput,
} from '@/types/domain';

/**
 * Storage Service Interface
 * Abstracts storage operations for all domain models
 */
export interface IStorageService {
  // Notebook operations
  /**
   * Get a notebook by ID
   */
  getNotebook(id: string): Promise<Notebook | null>;

  /**
   * Get all notebooks for a user
   */
  getNotebooks(userId: string): Promise<Notebook[]>;

  /**
   * Create a new notebook
   */
  createNotebook(data: CreateNotebookInput): Promise<Notebook>;

  /**
   * Update a notebook
   */
  updateNotebook(id: string, data: UpdateNotebookInput): Promise<Notebook | null>;

  /**
   * Delete a notebook
   */
  deleteNotebook(id: string): Promise<boolean>;

  // Source operations
  /**
   * Get a source by ID
   */
  getSource(id: string): Promise<Source | null>;

  /**
   * Get all sources for a notebook
   */
  getSources(notebookId: string): Promise<Source[]>;

  /**
   * Get source with content
   */
  getSourceWithContent(id: string): Promise<Source | null>;

  /**
   * Get all sources with content for a notebook
   */
  getSourcesWithContent(notebookId: string): Promise<Source[]>;

  /**
   * Create a new source
   */
  createSource(data: CreateSourceInput): Promise<Source>;

  /**
   * Update a source
   */
  updateSource(id: string, data: UpdateSourceInput): Promise<Source | null>;

  /**
   * Delete a source
   */
  deleteSource(id: string): Promise<boolean>;

  // Chat message operations
  /**
   * Get a chat message by ID
   */
  getChatMessage(id: string): Promise<ChatMessage | null>;

  /**
   * Get all chat messages for a notebook
   */
  getChatMessages(notebookId: string): Promise<ChatMessage[]>;

  /**
   * Create a new chat message
   */
  createChatMessage(data: CreateChatMessageInput): Promise<ChatMessage>;

  /**
   * Delete a chat message
   */
  deleteChatMessage(id: string): Promise<boolean>;

  // Utility operations
  /**
   * Clear all data
   */
  clearAllData(): Promise<void>;

  /**
   * Export all data as JSON
   */
  exportData(): Promise<string>;

  /**
   * Import data from JSON
   */
  importData(jsonData: string): Promise<void>;
}
