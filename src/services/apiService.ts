
/**
 * ApiService
 * 
 * Client for the StudyPod LM Express Backend.
 * Handles identity authentication and cloud content management.
 */

const API_BASE_URL = 'http://localhost:3001/api';

export const ApiService = {
  /**
   * signin
   * Authenticates with display name or email and passphrase.
   */
  async signin(credentials: { email?: string; password?: string; displayName?: string; passphrase?: string }) {
    const response = await fetch(`${API_BASE_URL}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to sign in to cloud');
    }

    return response.json();
  },

  /**
   * fetchProfile
   * Gets user profile metadata.
   */
  async fetchProfile(token: string) {
    const response = await fetch(`${API_BASE_URL}/user/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.json();
  },

  /**
   * fetchNotebooks
   * Lists all notebooks for the current token.
   */
  async fetchNotebooks(token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.json();
  },

  /**
   * fetchNotes
   * Gets notes for a specific notebook.
   */
  async fetchNotes(notebookId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/notes`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.json();
  },

  /**
   * fetchSources
   * Gets sources for a specific notebook.
   */
  async fetchSources(notebookId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/notebooks/${notebookId}/sources`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.json();
  }
};

export default ApiService;
