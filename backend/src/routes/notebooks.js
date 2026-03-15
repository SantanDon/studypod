import express from "express";
import { v4 as uuidv4 } from "uuid";
import { dbHelpers } from "../db/database.js";
import { authenticateToken } from "../middleware/auth.js";
import { MemoryService } from "../services/memoryService.js";

const router = express.Router();

/**
 * All notebook routes require authentication
 */
router.use(authenticateToken);

/**
 * GET /api/notebooks
 * List all notebooks for the authenticated user
 */
router.get("/", (req, res) => {
  try {
    const notebooks = dbHelpers.getNotebooksByUserId(req.user.userId);
    res.json(notebooks);
  } catch (error) {
    console.error("List notebooks error:", error);
    res.status(500).json({ error: "Failed to list notebooks" });
  }
});

/**
 * POST /api/notebooks
 * Create a new notebook
 */
router.post("/", (req, res) => {
  try {
    const { title, description, id: providedId } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Notebook title is required" });
    }

    const id = providedId || uuidv4();
    dbHelpers.createNotebook(id, req.user.userId, title, description);
    
    const notebook = dbHelpers.getNotebookById(id, req.user.userId);
    res.status(201).json(notebook);
  } catch (error) {
    console.error("Create notebook error:", error);
    res.status(500).json({ error: "Failed to create notebook" });
  }
});

/**
 * GET /api/notebooks/:id
 * Get details for a specific notebook
 */
router.get("/:id", (req, res) => {
  try {
    const notebook = dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }
    res.json(notebook);
  } catch (error) {
    console.error("Get notebook error:", error);
    res.status(500).json({ error: "Failed to get notebook" });
  }
});

/**
 * PUT /api/notebooks/:id
 * Update notebook metadata
 */
router.put("/:id", (req, res) => {
  try {
    const { title, description } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    dbHelpers.updateNotebook(req.params.id, req.user.userId, updates);
    const notebook = dbHelpers.getNotebookById(req.params.id, req.user.userId);
    res.json(notebook);
  } catch (error) {
    console.error("Update notebook error:", error);
    res.status(500).json({ error: "Failed to update notebook" });
  }
});

/**
 * DELETE /api/notebooks/:id
 * Delete a notebook
 */
router.delete("/:id", (req, res) => {
  try {
    const result = dbHelpers.deleteNotebook(req.params.id, req.user.userId);
    if (result.changes === 0) {
      return res.status(404).json({ error: "Notebook not found" });
    }
    res.json({ message: "Notebook deleted successfully" });
  } catch (error) {
    console.error("Delete notebook error:", error);
    res.status(500).json({ error: "Failed to delete notebook" });
  }
});

/**
 * GET /api/notebooks/:id/notes
 * List all notes in a notebook
 */
router.get("/:id/notes", (req, res) => {
  try {
    const notes = dbHelpers.getNotesByNotebookId(req.params.id, req.user.userId);
    res.json(notes);
  } catch (error) {
    console.error("List notes error:", error);
    res.status(500).json({ error: "Failed to list notes" });
  }
});

/**
 * POST /api/notebooks/:id/notes
 * Create a new note in a notebook
 */
router.post("/:id/notes", async (req, res) => {
  try {
    const { content, authorId } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Note content is required" });
    }

    const id = uuidv4();
    const userId = req.user.userId;
    const author_id = authorId || userId;
    
    dbHelpers.createNote(id, req.params.id, userId, content, author_id);
    
    // Phase 3 Hook: Auto-sync to EverMemOS for AI agents
    const authorUser = dbHelpers.getUserById(author_id);
    if (authorUser && authorUser.account_type === 'agent') {
      console.log(`[Phase 3] Auto-syncing agent note ${id} to EverMemOS...`);
      // We don't await this to avoid blocking the main API response
      MemoryService.storeMemory(author_id, content, {
        notebook_id: req.params.id,
        note_id: id
      });
    }

    res.status(201).json({ id, content, author_id, notebook_id: req.params.id });
  } catch (error) {
    console.error("Create note error:", error);
    res.status(500).json({ error: "Failed to create note" });
  }
});

/**
 * POST /api/notebooks/:id/memory/search
 * Semantic search in EverMemOS for this notebook's context
 */
router.post("/:id/memory/search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const userId = req.user.userId;
    const memories = await MemoryService.searchMemories(userId, query, {
      notebook_id: req.params.id
    });

    res.json({ results: memories });
  } catch (error) {
    console.error("Memory search error:", error);
    res.status(500).json({ error: "Memory search failed" });
  }
});


/**
 * GET /api/notebooks/:id/sources
 * List all sources in a notebook
 */
router.get("/:id/sources", (req, res) => {
  try {
    const sources = dbHelpers.getSourcesByNotebookId(req.params.id, req.user.userId);
    res.json(sources);
  } catch (error) {
    console.error("List sources error:", error);
    res.status(500).json({ error: "Failed to list sources" });
  }
});

export default router;
