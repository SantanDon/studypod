import { describe, it, expect, beforeEach } from 'vitest';
import { localStorageService } from '../src/services/localStorageService';

describe('LocalStorage Service - Core Functionality', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('User Management', () => {
    it('should create and store a user', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        created_at: new Date().toISOString(),
      };
      
      await localStorageService.addUser(user, 'password123');
      
      const users = JSON.parse(localStorage.getItem('users') || '[]');
      expect(users).toHaveLength(1);
      expect(users[0].email).toBe('test@example.com');
    });

    it('should hash passwords correctly', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        created_at: new Date().toISOString(),
      };
      
      await localStorageService.addUser(user, 'password123');
      
      const passwords = JSON.parse(localStorage.getItem('passwords') || '[]');
      expect(passwords[0].password).not.toBe('password123');
      expect(passwords[0].password.length).toBeGreaterThan(20);
    });

    it('should authenticate with correct password', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        created_at: new Date().toISOString(),
      };
      
      await localStorageService.addUser(user, 'password123');
      const authUser = await localStorageService.authenticate('test@example.com', 'password123');
      
      expect(authUser).not.toBeNull();
      expect(authUser?.email).toBe('test@example.com');
    });

    it('should reject wrong password', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        created_at: new Date().toISOString(),
      };
      
      await localStorageService.addUser(user, 'password123');
      const authUser = await localStorageService.authenticate('test@example.com', 'wrongpassword');
      
      expect(authUser).toBeNull();
    });

    it('should set and get current user', () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        created_at: new Date().toISOString(),
      };
      
      localStorageService.setCurrentUser(user);
      const currentUser = localStorageService.getCurrentUser();
      
      expect(currentUser).toEqual(user);
    });
  });

  describe('Notebook Management', () => {
    beforeEach(() => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        created_at: new Date().toISOString(),
      };
      localStorageService.setCurrentUser(user);
    });

    it('should create a notebook', () => {
      const notebook = localStorageService.createNotebook({
        title: 'Test Notebook',
        user_id: 'user-1',
        generation_status: 'pending',
      });

      expect(notebook).toBeDefined();
      expect(notebook.title).toBe('Test Notebook');
      expect(notebook.id).toBeDefined();
    });

    it('should retrieve notebooks for user', () => {
      localStorageService.createNotebook({
        title: 'Notebook 1',
        user_id: 'user-1',
        generation_status: 'pending',
      });
      
      localStorageService.createNotebook({
        title: 'Notebook 2',
        user_id: 'user-1',
        generation_status: 'pending',
      });

      const notebooks = localStorageService.getNotebooks('user-1');
      expect(notebooks).toHaveLength(2);
    });

    it('should update notebook', () => {
      const notebook = localStorageService.createNotebook({
        title: 'Original Title',
        user_id: 'user-1',
        generation_status: 'pending',
      });

      localStorageService.updateNotebook(notebook.id, {
        title: 'Updated Title',
      });

      const updated = localStorageService.getNotebookById(notebook.id);
      expect(updated?.title).toBe('Updated Title');
    });

    it('should delete notebook', () => {
      const notebook = localStorageService.createNotebook({
        title: 'To Delete',
        user_id: 'user-1',
        generation_status: 'pending',
      });

      localStorageService.deleteNotebook(notebook.id);
      const deleted = localStorageService.getNotebookById(notebook.id);
      
      expect(deleted).toBeNull();
    });
  });

  describe('Source Management', () => {
    let notebookId: string;

    beforeEach(() => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        created_at: new Date().toISOString(),
      };
      localStorageService.setCurrentUser(user);
      
      const notebook = localStorageService.createNotebook({
        title: 'Test Notebook',
        user_id: 'user-1',
        generation_status: 'pending',
      });
      notebookId = notebook.id;
    });

    it('should create a source', () => {
      const source = localStorageService.createSource({
        notebook_id: notebookId,
        title: 'Test Source',
        type: 'pdf',
        content: 'Source content',
      });

      expect(source).toBeDefined();
      expect(source.title).toBe('Test Source');
      expect(source.type).toBe('pdf');
    });

    it('should retrieve sources for notebook', () => {
      localStorageService.createSource({
        notebook_id: notebookId,
        title: 'Source 1',
        type: 'pdf',
        content: 'Content 1',
      });

      localStorageService.createSource({
        notebook_id: notebookId,
        title: 'Source 2',
        type: 'website',
        content: 'Content 2',
      });

      const sources = localStorageService.getSources(notebookId);
      expect(sources).toHaveLength(2);
    });

    it('should update source', () => {
      const source = localStorageService.createSource({
        notebook_id: notebookId,
        title: 'Original',
        type: 'pdf',
        content: 'Content',
      });

      localStorageService.updateSource(source.id, {
        title: 'Updated',
      });

      const updated = localStorageService.getSourceById(source.id);
      expect(updated?.title).toBe('Updated');
    });

    it('should delete source', () => {
      const source = localStorageService.createSource({
        notebook_id: notebookId,
        title: 'To Delete',
        type: 'pdf',
        content: 'Content',
      });

      localStorageService.deleteSource(source.id);
      const deleted = localStorageService.getSourceById(source.id);
      
      expect(deleted).toBeNull();
    });
  });

  describe('Note Management', () => {
    let notebookId: string;

    beforeEach(() => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        created_at: new Date().toISOString(),
      };
      localStorageService.setCurrentUser(user);
      
      const notebook = localStorageService.createNotebook({
        title: 'Test Notebook',
        user_id: 'user-1',
        generation_status: 'pending',
      });
      notebookId = notebook.id;
    });

    it('should create a note', () => {
      const note = localStorageService.createNote({
        notebook_id: notebookId,
        title: 'Test Note',
        content: 'Note content',
        source_type: 'user',
      });

      expect(note).toBeDefined();
      expect(note.title).toBe('Test Note');
    });

    it('should retrieve notes for notebook', () => {
      localStorageService.createNote({
        notebook_id: notebookId,
        title: 'Note 1',
        content: 'Content 1',
        source_type: 'user',
      });

      localStorageService.createNote({
        notebook_id: notebookId,
        title: 'Note 2',
        content: 'Content 2',
        source_type: 'ai',
      });

      const notes = localStorageService.getNotes(notebookId);
      expect(notes).toHaveLength(2);
    });

    it('should update note', () => {
      const note = localStorageService.createNote({
        notebook_id: notebookId,
        title: 'Original',
        content: 'Content',
        source_type: 'user',
      });

      localStorageService.updateNote(note.id, {
        content: 'Updated content',
      });

      const updated = localStorageService.getNoteById(note.id);
      expect(updated?.content).toBe('Updated content');
    });

    it('should delete note', () => {
      const note = localStorageService.createNote({
        notebook_id: notebookId,
        title: 'To Delete',
        content: 'Content',
        source_type: 'user',
      });

      localStorageService.deleteNote(note.id);
      const deleted = localStorageService.getNoteById(note.id);
      
      expect(deleted).toBeNull();
    });
  });

  describe('Cascading Delete', () => {
    it('should delete all related data when notebook is deleted', () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        created_at: new Date().toISOString(),
      };
      localStorageService.setCurrentUser(user);

      const notebook = localStorageService.createNotebook({
        title: 'Test Notebook',
        user_id: 'user-1',
        generation_status: 'pending',
      });

      const source = localStorageService.createSource({
        notebook_id: notebook.id,
        title: 'Test Source',
        type: 'pdf',
        content: 'Content',
      });

      const note = localStorageService.createNote({
        notebook_id: notebook.id,
        title: 'Test Note',
        content: 'Note content',
        source_type: 'user',
      });

      // Delete notebook
      localStorageService.deleteNotebook(notebook.id);

      // Verify cascading delete
      expect(localStorageService.getNotebookById(notebook.id)).toBeNull();
      expect(localStorageService.getSourceById(source.id)).toBeNull();
      expect(localStorageService.getNoteById(note.id)).toBeNull();
    });
  });
});


