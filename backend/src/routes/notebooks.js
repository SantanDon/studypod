import express from "express";
// [restart trigger - DB migration for file_path/file_size columns]
import { v4 as uuidv4 } from "uuid";
import { dbHelpers } from "../db/database.js";
import { authenticateToken } from "../middleware/auth.js";
import { MemoryService } from "../services/memoryService.js";
import { chatWithNotebook } from "../services/aiChatService.js";
import { AppError } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * All notebook routes require authentication
 */
router.use(authenticateToken);

/**
 * GET /api/notebooks
 * List all notebooks for the authenticated user
 */
router.get("/", async (req, res, next) => {
  try {
    const notebooks = await dbHelpers.getNotebooksByUserId(req.user.userId);
    notebooks.forEach(notebook => {
      if (notebook.example_questions && typeof notebook.example_questions === 'string') {
        try { notebook.example_questions = JSON.parse(notebook.example_questions); } catch (e) {
    next(e);
  }
});

/**
 * POST /api/notebooks
 * Create a new notebook
 */
router.post("/", async (req, res, next) => {
  try {
    const { title, description, id: providedId } = req.body;
    if (!title) {
      return next(new AppError(400, 'BAD_REQUEST', 'Notebook title is required'));
    }

    const id = providedId || uuidv4();
    await dbHelpers.createNotebook(id, req.user.userId, title, description);
    
    const notebook = await dbHelpers.getNotebookById(id, req.user.userId);
    res.status(201).json(notebook);
  } catch (error) {
    next(error);
  }
    // Parse example_questions if it exists and is a string
    if (notebook.example_questions && typeof notebook.example_questions === 'string') {
      try { notebook.example_questions = JSON.parse(notebook.example_questions); } catch (e) {
    next(e);
  }
});

/**
 * PUT /api/notebooks/:id
 * Update notebook metadata
 */
router.put("/:id", async (req, res, next) => {
  try {
    const { title, description, example_questions, generation_status, icon } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (generation_status !== undefined) updates.generation_status = generation_status;
    if (icon !== undefined) updates.icon = icon;
    
    if (example_questions !== undefined) {
      updates.example_questions = Array.isArray(example_questions) 
        ? JSON.stringify(example_questions) 
        : example_questions;
    }

    if (Object.keys(updates).length === 0) {
      return next(new AppError(400, 'BAD_REQUEST', 'No updates provided'));
    }

    // VERCEL WORKAROUND: Auto-provision notebook if it was wiped before updating
    let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) {
      console.log(`🛠️ PUT /:id: Auto-provisioning missing notebook ${req.params.id}...`);
      try {
        await dbHelpers.createNotebook(req.params.id, req.user.userId, title || "Recovered Notebook", description || "Automatically provisioned");
      } catch (e) {
    next(e);
  }

    // Parse it back for the response
    if (notebook.example_questions && typeof notebook.example_questions === 'string') {
      try { notebook.example_questions = JSON.parse(notebook.example_questions); } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/notebooks/:id
 * Delete a notebook
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const result = await dbHelpers.deleteNotebook(req.params.id, req.user.userId);
    if (result.changes === 0) {
      return next(new AppError(404, 'NOT_FOUND', 'Notebook not found'));
    }
    res.json({ message: "Notebook deleted successfully" });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/notebooks/:id/notes
 * List all notes in a notebook
 */
router.get("/:id/notes", async (req, res, next) => {
  try {
    let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) {
      try { await dbHelpers.createNotebook(req.params.id, req.user.userId, "Recovered Notebook", "Auto-provisioned"); notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId); } catch (e) {
    next(e);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/notebooks/:id/notes
 * Create a new note in a notebook
 */
router.post("/:id/notes", async (req, res, next) => {
  try {
    let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    
    // VERCEL WORKAROUND: If notebook missing but we have userId (DB reset)
    if (!notebook) {
      console.log(`🛠️ Auto-provisioning notebook ${req.params.id} for user ${req.user.userId}...`);
      try {
        await dbHelpers.createNotebook(req.params.id, req.user.userId, "Recovered Notebook", "Automatically provisioned after system reset");
        notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
      } catch (provisionError) {
    next(provisionError);
  } = req.body;
    if (!content) {
      return next(new AppError(400, 'BAD_REQUEST', 'Note content is required'));
    }

    const id = uuidv4();
    const userId = req.user.userId;
    const author_id = authorId || userId;
    
    await dbHelpers.createNote(id, req.params.id, userId, content, author_id);
    
    // Phase 3 Hook: Auto-sync to EverMemOS for AI agents
    const authorUser = await dbHelpers.getUserById(author_id);
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
    next(error);
  }
});

/**
 * GET /api/notebooks/:id/notes/:noteId
 * Get a single note
 */
router.get("/:id/notes/:noteId", async (req, res, next) => {
  try {
    const note = await dbHelpers.getNoteById(req.params.noteId, req.user.userId);
    if (!note) return next(new AppError(404, 'NOT_FOUND', 'Note not found'));
    res.json(note);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/notebooks/:id/notes/:noteId
 * Update note content
 */
router.put("/:id/notes/:noteId", async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content) return next(new AppError(400, 'BAD_REQUEST', 'content is required'));
    const result = await dbHelpers.updateNote(req.params.noteId, req.user.userId, content);
    if (result.changes === 0) return next(new AppError(404, 'NOT_FOUND', 'Note not found'));
    res.json(await dbHelpers.getNoteById(req.params.noteId, req.user.userId));
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/notebooks/:id/notes/:noteId
 * Delete a note
 */
router.delete("/:id/notes/:noteId", async (req, res, next) => {
  try {
    const result = await dbHelpers.deleteNote(req.params.noteId, req.user.userId);
    if (result.changes === 0) return next(new AppError(404, 'NOT_FOUND', 'Note not found'));
    res.json({ message: "Note deleted" });
  } catch (error) {
    next(error);
  }
});


/**
 * POST /api/notebooks/:id/memory/search
 * Semantic search in EverMemOS for this notebook's context
 */
router.post("/:id/memory/search", async (req, res, next) => {
  try {
    const { query } = req.body;
    if (!query) {
      return next(new AppError(400, 'BAD_REQUEST', 'Search query is required'));
    }

    const userId = req.user.userId;
    const memories = await MemoryService.searchMemories(userId, query, {
      notebook_id: req.params.id
    });

    res.json({ results: memories });
  } catch (error) {
    next(error);
  }
});


/**
 * POST /api/notebooks/:id/sources
 * Create a new source in a notebook
 */
router.post("/:id/sources", async (req, res, next) => {
  try {
    let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    
    // VERCEL WORKAROUND: If notebook missing but we have userId (DB reset)
    // Auto-provision a placeholder so sources can be attached
    if (!notebook) {
      console.log(`🛠️ Auto-provisioning notebook ${req.params.id} for user ${req.user.userId}...`);
      try {
        await dbHelpers.createNotebook(req.params.id, req.user.userId, "Recovered Notebook", "Automatically provisioned after system reset");
        notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
      } catch (provisionError) {
    next(provisionError);
  } = req.body;
    if (!title || !type) {
      return next(new AppError(400, 'BAD_REQUEST', 'title and type are required'));
    }
    
    const id = providedId || uuidv4();
    // Serialize metadata to JSON string for SQLite TEXT column
    const metadataStr = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;
    
    dbHelpers.createSource(id, req.params.id, req.user.userId, title, type, content, url, metadataStr, file_path, file_size);
    
    // If processing_status is provided and not default, update it immediately
    if (processing_status && processing_status !== 'pending') {
      try {
        await dbHelpers.updateSource(id, req.user.userId, { processing_status });
      } catch (e) {
    next(e);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/notebooks/:id/sources/:sourceId
 * Update an existing source
 */
router.put("/:id/sources/:sourceId", async (req, res, next) => {
  try {
    const updates = req.body;
    const result = await dbHelpers.updateSource(req.params.sourceId, req.user.userId, updates);
    
    // VERCEL WORKAROUND: If changes is 0, the source was wiped by Vercel serverless. We MUST auto-provision it.
    if (result.changes === 0) {
      console.log(`🛠️ PUT /sources/:sourceId: Source missing, auto-provisioning...`);
      try {
        let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
        if (!notebook) {
           await dbHelpers.createNotebook(req.params.id, req.user.userId, "Recovered Notebook", "Auto-provisioned");
        }
        
        await dbHelpers.createSource(
            req.params.sourceId, req.params.id, req.user.userId, 
            updates.title || "Recovered Source", 
            updates.type || "unknown", 
            updates.content || "", 
            updates.url || "", 
            updates.metadata ? (typeof updates.metadata === 'string' ? updates.metadata : JSON.stringify(updates.metadata)) : null,
            updates.file_path || "",
            updates.file_size || 0
        );
        if (updates.processing_status) {
           await dbHelpers.updateSource(req.params.sourceId, req.user.userId, { processing_status: updates.processing_status });
        }
      } catch (e) {
    next(e);
  }
    }
    
    res.json({ success: true, message: "Source updated" });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/notebooks/:id/sources
 * List all sources in a notebook
 */
router.get("/:id/sources", async (req, res, next) => {
  try {
    let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) {
      try { await dbHelpers.createNotebook(req.params.id, req.user.userId, "Recovered Notebook", "Auto-provisioned"); notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId); } catch (e) {
    next(e);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/notebooks/:id/messages
 * Get conversation history for a notebook
 */
router.get("/:id/messages", async (req, res, next) => {
  try {
    let notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) {
      try { await dbHelpers.createNotebook(req.params.id, req.user.userId, "Recovered Notebook", "Auto-provisioned"); notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId); } catch (e) {
    next(e);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/notebooks/:id/context
 * Build an AI-optimized context payload for agents loading a notebook
 */
router.get("/:id/context", async (req, res, next) => {
  try {
    const notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) return next(new AppError(404, 'NOT_FOUND', 'Notebook not found'));

    const sources = await dbHelpers.getSourcesByNotebookId(req.params.id, req.user.userId);
    const notes = await dbHelpers.getNotesByNotebookId(req.params.id, req.user.userId);

    // Provide a structured snapshot so agents don't have to assemble it manually
    res.json({
      notebook: {
        id: notebook.id,
        title: notebook.title,
        description: notebook.description,
        created_at: notebook.created_at
      },
      sources: sources.map(s => ({
        id: s.id,
        title: s.title,
        type: s.type,
        status: s.processing_status,
        contentPreview: s.content ? s.content.substring(0, 500) + (s.content.length > 500 ? '...' : '') : null,
        contentLength: s.content ? s.content.length : 0
      })),
      notes: notes.map(n => ({
        id: n.id,
        content: n.content,
        author: n.author_name,
        created_at: n.created_at
      })),
      agentReady: true
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/notebooks/:id/chat
 * Human/Agent conversation endpoint powered by notebook context
 */
router.post("/:id/chat", async (req, res, next) => {
  try {
    const { message, saveAsNote = false, agentId = null } = req.body;
    if (!message) return next(new AppError(400, 'BAD_REQUEST', 'message is required'));

    const notebookId = req.params.id;
    const userId = req.user.userId;

    // JIT recovery: the chat endpoint often hits a blank Vercel DB after a serverless cold-start
    let notebook = await dbHelpers.getNotebookById(notebookId, userId);
    let jitError = null;
    if (!notebook) {
      console.log(`🛠️ Chat: Auto-provisioning notebook ${notebookId}...`);
      try {
        await dbHelpers.createNotebook(notebookId, userId, "Recovered Notebook", "Auto-provisioned");
        notebook = await dbHelpers.getNotebookById(notebookId, userId);
      } catch (e) {
    next(e);
  });

      // Save the AI's response to history
      const aiMsgId = uuidv4();
      await dbHelpers.createChatMessage(aiMsgId, notebookId, userId, 'assistant', chatResult.answer, chatResult.groundedSources);

      let noteId = null;
      // Optionally save the interaction as a persistent note
      if (saveAsNote) {
        noteId = uuidv4();
        const noteContent = `**Q:** ${message}\n\n**A:** ${chatResult.answer}`;
        await dbHelpers.createNote(noteId, notebookId, userId, noteContent, agentId || userId);
      }

      res.json({
        answer: chatResult.answer,
        groundedSources: chatResult.groundedSources,
        tokensUsed: chatResult.tokensUsed,
        messageId: aiMsgId,
        noteId
      });

    } catch (aiError) {
    next(aiError);
  }

  } catch (error) {
    next(error);
  }
});

export default router;
