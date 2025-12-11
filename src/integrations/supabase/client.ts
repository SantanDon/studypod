// Local Supabase client replacement
// This replaces @supabase/supabase-js functionality with localStorage

import { localStorageService, LocalUser, LocalSession } from '@/services/localStorageService';

export interface Tables<T = unknown> {
  [key: string]: T;
}

// Mock Supabase types and interfaces
export interface Database {
  public: {
    Tables: {
      notebooks: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      sources: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      notes: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
      n8n_chat_histories: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
      };
    };
  };
}

class LocalSupabase {
  auth = {
    signUp: async ({ email, password }: { email: string; password?: string }) => {
      const user: LocalUser = {
        id: Date.now().toString(),
        email,
        created_at: new Date().toISOString(),
      };
      
      const session: LocalSession = {
        access_token: 'local-token-' + Date.now(),
        refresh_token: 'local-refresh-' + Date.now(),
        user,
        expires_at: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      };

      try {
        if (password) {
          await localStorageService.addUser(user, password);
        }
        
        localStorageService.setCurrentUser(user);
        localStorage.setItem('currentSession', JSON.stringify(session));
        
        return { data: { user, session }, error: null };
      } catch (error) {
        return { data: { user: null, session: null }, error: error as any };
      }
    },

    signInWithPassword: async ({ email, password }: { email: string; password?: string }) => {
      try {
        if (!password) {
          return { data: { user: null, session: null }, error: new Error("Password required") as any };
        }

        const user = await localStorageService.authenticate(email, password);

        if (!user) {
           return { data: { user: null, session: null }, error: new Error("Invalid login credentials") as any };
        }
        
        const session: LocalSession = {
          access_token: 'local-token-' + Date.now(),
          refresh_token: 'local-refresh-' + Date.now(),
          user,
          expires_at: Date.now() + 24 * 60 * 60 * 1000,
        };

        localStorageService.setCurrentUser(user);
        localStorage.setItem('currentSession', JSON.stringify(session));
        
        return { data: { user, session }, error: null };
      } catch (error) {
        return { data: { user: null, session: null }, error: error as any };
      }
    },

    signOut: async (options?: { scope?: 'local' | 'global' }) => {
      localStorageService.setCurrentUser(null);
      localStorage.removeItem('currentSession');
      return { error: null };
    },

    getSession: async () => {
      const session = localStorage.getItem('currentSession');
      const user = localStorageService.getCurrentUser();
      
      if (session && user) {
        return { data: { session: JSON.parse(session) }, error: null };
      }
      
      return { data: { session: null }, error: null };
    },

    onAuthStateChange: (callback: (event: string, session: LocalSession | null) => void) => {
      // Listen for local storage changes
      const handleStorageChange = (e: StorageEvent) => {
        if (e.key === 'currentSession' || e.key === 'currentUser') {
          const session = localStorage.getItem('currentSession');
          callback('SIGNED_OUT', session ? JSON.parse(session) : null);
        }
      };
      
      window.addEventListener('storage', handleStorageChange);
      
      return {
        data: {
          subscription: {
            unsubscribe: () => window.removeEventListener('storage', handleStorageChange)
          }
        }
      };
    }
  };

  from(table: string) {
    return {
      select: (columns?: string) => ({
        eq: (column: string, value: unknown) => ({
          single: () => this.getSingle(table, column, value),
          then: (callback: (result: unknown) => void) => this.getMany(table, column, value).then(callback)
        }),
        then: (callback: (result: unknown) => void) => this.getAll(table).then(callback)
      }),
      insert: (data: Record<string, unknown>) => ({
        then: (callback: (result: unknown) => void) => this.insertData(table, data).then(callback)
      }),
      update: (data: Record<string, unknown>) => ({
        eq: (column: string, value: unknown) => ({
          then: (callback: (result: unknown) => void) => this.updateData(table, column, value, data).then(callback)
        })
      }),
      delete: () => ({
        eq: (column: string, value: unknown) => ({
          then: (callback: (result: unknown) => void) => this.deleteData(table, column, value).then(callback)
        })
      })
    };
  }

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, file: File) => {
        // Store file as base64 in localStorage for demo
        const base64 = await this.fileToBase64(file);
        localStorage.setItem(`file_${path}`, base64);
        return { data: { path }, error: null };
      },
      getPublicUrl: (path: string) => ({
        data: {
          publicUrl: URL.createObjectURL(this.base64ToFile(localStorage.getItem(`file_${path}`) || ''))
        }
      }),
      list: async (path?: string) => {
        const files: Array<{ name: string; id: string }> = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith(`file_${path}`)) {
            files.push({ name: key.replace(`file_${path}`, ''), id: key });
          }
        }
        return { data: files, error: null };
      },
      remove: async (paths: string[]) => {
        paths.forEach(path => localStorage.removeItem(`file_${path}`));
        return { error: null };
      }
    })
  };

  functions = {
    invoke: async (functionName: string, options?: { body?: Record<string, unknown> }) => {
      // Mock AI processing functions with simple responses
      switch (functionName) {
        case 'generate-notebook-content':
          return { data: { content: 'Generated content based on sources (demo mode)' }, error: null };
        case 'process-document':
          return { data: { status: 'processed', content: 'Document processed (demo mode)' }, error: null };
        case 'generate-audio-overview':
          return { data: { audioUrl: null, status: 'not_available', message: 'Audio generation not available in local mode' }, error: null };
        case 'send-chat-message':
          return { data: { response: 'AI response (demo mode) - connect to local AI service for real responses' }, error: null };
        case 'generate-note-title':
          return { data: { title: 'Generated Title (demo mode)' }, error: null };
        case 'process-additional-sources':
          return { data: { status: 'processed', message: 'Sources processed (demo mode)' }, error: null };
        default:
          return { data: { message: 'Function not available in local mode' }, error: null };
      }
    }
  };

  channel(name: string) {
    return {
      on: () => this,
      subscribe: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      removeChannel: () => {}
    };
  }

  // Helper methods for local data operations
  private async getAll(table: string) {
    const user = localStorageService.getCurrentUser();
    if (!user) return { data: [], error: null };

    switch (table) {
      case 'notebooks':
        return { data: localStorageService.getNotebooks(user.id), error: null };
      case 'sources':
        return { data: [], error: null }; // Will be filtered by notebook_id
      case 'notes':
        return { data: [], error: null }; // Will be filtered by notebook_id
      default:
        return { data: [], error: null };
    }
  }

  private async getSingle(table: string, column: string, value: unknown) {
    const user = localStorageService.getCurrentUser();
    if (!user) return { data: null, error: null };

    switch (table) {
      case 'notebooks': {
        const notebook = localStorageService.getNotebooks(user.id).find(n => n[column as keyof typeof n] === value);
        return { data: notebook || null, error: null };
      }
      default:
        return { data: null, error: null };
    }
  }

  private async getMany(table: string, column: string, value: unknown) {
    // This would filter by the column/value in a real implementation
    return { data: [], error: null };
  }

  private async insertData(table: string, data: Record<string, unknown>) {
    const user = localStorageService.getCurrentUser();
    if (!user) return { data: null, error: new Error('Not authenticated') };

    try {
      switch (table) {
        case 'notebooks': {
          const newNotebook = localStorageService.createNotebook({
            title: data.title as string,
            description: data.description as string | undefined,
            user_id: user.id,
            generation_status: (data.generation_status as any) || 'pending',
            audio_overview_url: data.audio_overview_url as string | undefined,
            audio_url_expires_at: data.audio_url_expires_at as string | undefined,
          });
          return { data: newNotebook, error: null };
        }
        default:
          return { data: null, error: null };
      }
    } catch (error) {
      return { data: null, error };
    }
  }

  private async updateData(table: string, column: string, value: unknown, updates: Record<string, unknown>) {
    try {
      switch (table) {
        case 'notebooks': {
          const updated = localStorageService.updateNotebook(value as string, updates);
          return { data: updated, error: null };
        }
        default:
          return { data: null, error: null };
      }
    } catch (error) {
      return { data: null, error };
    }
  }

  private async deleteData(table: string, column: string, value: unknown) {
    try {
      switch (table) {
        case 'notebooks': {
          localStorageService.deleteNotebook(value as string);
          return { data: { success: true }, error: null };
        }
        default:
          return { data: null, error: null };
      }
    } catch (error) {
      return { data: null, error };
    }
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  }

  private base64ToFile(base64: string): File {
    const arr = base64.split(',');
    const mime = arr[0].match(/:(.*?);/)![1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], 'file', { type: mime });
  }
}

export const supabase = new LocalSupabase();
export type { LocalUser, LocalSession };