import { localStorageService } from '@/services/localStorageService';

interface Notebook {
  id: string;
  title: string;
  description?: string;
  user_id: string;
  generation_status: string;
  updated_at: string;
  created_at?: string;
  audio_overview_url?: string;
  audio_url_expires_at?: string;
  icon?: string;
  example_questions?: string[];
}

class LocalNotebookStore {
  async getNotebooks(userId: string): Promise<Notebook[]> {
    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 50));
    return localStorageService.getNotebooks(userId);
  }

  async createNotebook(notebookData: { title: string; description?: string }, userId: string): Promise<Notebook> {
    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 50));
    const newNotebook = localStorageService.createNotebook({
      title: notebookData.title,
      description: notebookData.description,
      user_id: userId,
      generation_status: 'pending',
    });
    return newNotebook;
  }

  async updateNotebook(notebookId: string, updates: Partial<Notebook>): Promise<Notebook | null> {
    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 50));
    const updatedNotebook = localStorageService.updateNotebook(notebookId, updates);
    return updatedNotebook;
  }

  async deleteNotebook(notebookId: string): Promise<boolean> {
    // Simulate async operation
    await new Promise(resolve => setTimeout(resolve, 50));
    const success = localStorageService.deleteNotebook(notebookId);
    return success;
  }
}

export const localNotebookStore = new LocalNotebookStore();
