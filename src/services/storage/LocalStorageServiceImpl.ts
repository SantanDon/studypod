import { IStorageService } from './IStorageService';
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
import { localStorageService as legacyService } from '@/services/localStorageService';
import { NotebookFactory } from '@/factories/NotebookFactory';
import { SourceFactory } from '@/factories/SourceFactory';
import { ChatMessageFactory } from '@/factories/ChatMessageFactory';

/**
 * LocalStorageService Implementation
 * Wraps the existing localStorage service with the new interface
 */
export class LocalStorageServiceImpl implements IStorageService {
  constructor(private legacyService = legacyService) {}

  // Notebook operations
  async getNotebook(id: string): Promise<Notebook | null> {
    const notebook = this.legacyService.getNotebook(id);
    return notebook ? NotebookFactory.fromData(notebook) : null;
  }

  async getNotebooks(userId: string): Promise<Notebook[]> {
    const notebooks = this.legacyService.getNotebooks(userId);
    return notebooks.map((n) => NotebookFactory.fromData(n));
  }

  async createNotebook(data: CreateNotebookInput): Promise<Notebook> {
    const notebook = this.legacyService.createNotebook(data);
    return NotebookFactory.fromData(notebook);
  }

  async updateNotebook(
    id: string,
    data: UpdateNotebookInput
  ): Promise<Notebook | null> {
    const notebook = this.legacyService.updateNotebook(id, data);
    return notebook ? NotebookFactory.fromData(notebook) : null;
  }

  async deleteNotebook(id: string): Promise<boolean> {
    return this.legacyService.deleteNotebook(id);
  }

  // Source operations
  async getSource(id: string): Promise<Source | null> {
    const source = this.legacyService.getSourceById(id);
    return source ? SourceFactory.fromData(source) : null;
  }

  async getSources(notebookId: string): Promise<Source[]> {
    const sources = this.legacyService.getSources(notebookId);
    return sources.map((s) => SourceFactory.fromData(s));
  }

  async getSourceWithContent(id: string): Promise<Source | null> {
    const source = this.legacyService.getSourceById(id);
    if (!source) return null;

    const content = await this.legacyService.getSourceContent(id);
    return SourceFactory.fromData({ ...source, content });
  }

  async getSourcesWithContent(notebookId: string): Promise<Source[]> {
    const sources = await this.legacyService.getSourcesWithContent(notebookId);
    return sources.map((s) => SourceFactory.fromData(s));
  }

  async createSource(data: CreateSourceInput): Promise<Source> {
    const source = this.legacyService.createSource(data);
    return SourceFactory.fromData(source);
  }

  async updateSource(
    id: string,
    data: UpdateSourceInput
  ): Promise<Source | null> {
    const source = this.legacyService.updateSource(id, data);
    return source ? SourceFactory.fromData(source) : null;
  }

  async deleteSource(id: string): Promise<boolean> {
    return this.legacyService.deleteSource(id);
  }

  // Chat message operations
  async getChatMessage(id: string): Promise<ChatMessage | null> {
    const messages = this.legacyService.getChatMessages('');
    const message = messages.find((m) => m.id === id);
    return message ? ChatMessageFactory.fromData(message) : null;
  }

  async getChatMessages(notebookId: string): Promise<ChatMessage[]> {
    const messages = this.legacyService.getChatMessages(notebookId);
    return messages.map((m) => ChatMessageFactory.fromData(m));
  }

  async createChatMessage(data: CreateChatMessageInput): Promise<ChatMessage> {
    const message = this.legacyService.createChatMessage(data);
    return ChatMessageFactory.fromData(message);
  }

  async deleteChatMessage(id: string): Promise<boolean> {
    return this.legacyService.deleteChatMessage(id);
  }

  // Utility operations
  async clearAllData(): Promise<void> {
    this.legacyService.clearAllData();
  }

  async exportData(): Promise<string> {
    return this.legacyService.exportData();
  }

  async importData(jsonData: string): Promise<void> {
    this.legacyService.importData(jsonData);
  }
}
