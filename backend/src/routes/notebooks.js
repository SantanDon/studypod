import express from "express";
import { v4 as uuidv4 } from "uuid";
import { generateSovereignHooks } from "../services/outreachService.js";
import { dbHelpers } from "../db/database.js";
import { authenticateToken, requireScope } from "../middleware/auth.js";
import { MemoryService } from "../services/memoryService.js";
import { chatWithNotebook } from "../services/aiChatService.js";
import { MasticationService } from "../services/masticationService.js";
import { agentPulse } from "../services/agentPulse.js";
import { WebhookDispatcher } from "../services/webhookDispatcher.js";
import { logger } from "../utils/logger.js";

const router = express.Router();

// Track explicitly deleted notebooks to prevent JIT recovery race condition
const deletedNotebooks = new Set();

async function getNotebookOrRecover(id, userId, description = "Auto-provisioned") {
  if (deletedNotebooks.has(id)) {
    return null;
  }
  let notebook = await dbHelpers.getNotebookById(id, userId);
  if (!notebook) {
    logger.info(`🛠️ JIT Recovery: Notebook ${id} missing. Attempting auto-provision...`);
    try {
      await dbHelpers.createNotebook(id, userId, "Recovered Notebook", description);
      notebook = await dbHelpers.getNotebookById(id, userId);
    } catch (e) {
      logger.error(`Failed to JIT recover notebook ${id}:`, e);
    }
  }
  return notebook;
}

/**
 * All notebook routes require authentication
 */
router.use(authenticateToken);

/**
 * GET /api/notebooks
 * List all notebooks for the authenticated user
 */
router.get("/", async (req, res) => {
  try {
    const { include_contexts } = req.query;
    let notebooks;
    
    if (include_contexts === 'true') {
      notebooks = await dbHelpers.getNotebooksWithDeepContext(req.user.userId);
    } else {
      notebooks = await dbHelpers.getNotebooksByUserId(req.user.userId);
    }

    notebooks.forEach(notebook => {
      if (notebook.exampleQuestions && typeof notebook.exampleQuestions === 'string') {
        try { notebook.exampleQuestions = JSON.parse(notebook.exampleQuestions); } catch (e) {}
      }
    });
    
    res.json(notebooks);
  } catch (error) {
    logger.error("List notebooks failed:", error.message);
    res.status(500).json({ error: "Failed to list notebooks" });
  }
});

/**
 * POST /api/notebooks
 * Create a new notebook
 */
router.post("/", async (req, res, next) => {
  logger.debug("Creating notebook:", { title: req.body?.title, id: req.body?.id });
  try {
    const { title, description, id: providedId } = req.body;
    if (!title) {
      logger.warn("Notebook creation failed: Missing title");
      return res.status(400).json({ error: "Notebook title is required" });
    }

    const id = providedId || uuidv4();
    logger.debug(`Creating notebook ${id} for user ${req.user.userId}`);
    
    try {
      await dbHelpers.createNotebook(id, req.user.userId, title, description);
    } catch (insertError) {
      if (insertError.code === 'SQLITE_CONSTRAINT' || insertError.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || insertError.message.includes('UNIQUE constraint')) {
        logger.debug(`Notebook ${id} already exists, proceeding`);
      } else {
        throw insertError;
      }
    }
    
    // Joint check compatible - returns based on owner/member status
    const notebook = await dbHelpers.getNotebookById(id, req.user.userId);
    res.status(201).json(notebook);
  } catch (error) {
    logger.error("Notebook creation failed:", error.message);
    next(error);
  }
});

/**
 * POST /api/notebooks/join
 * Join a notebook using a shared join code
 */
router.post("/join", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: "Join code is required" });
    }

    const notebook = await dbHelpers.joinNotebookByCode(req.user.userId, code.toUpperCase());
    res.json({ 
      message: "Joined notebook successfully", 
      notebook: {
        id: notebook.id,
        title: notebook.title
      }
    });
  } catch (error) {
    if (error.message === "INVALID_JOIN_CODE") {
      return res.status(404).json({ error: "Invalid or expired join code" });
    }
    logger.error("Join notebook failed:", error.message, error.stack);
    res.status(500).json({ error: "Failed to join notebook", detail: error.message });
  }
});

/**
 * GET /api/notebooks/:id
 * Get details for a specific notebook
 */
router.get("/:id", async (req, res) => {
  try {
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId);
    if (!notebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }
    // Parse exampleQuestions if it exists and is a string
    if (notebook.exampleQuestions && typeof notebook.exampleQuestions === 'string') {
      try {
        notebook.exampleQuestions = JSON.parse(notebook.exampleQuestions);
      } catch (e) {
        logger.error('Failed to parse example questions:', e);
      }
    }
    res.json(notebook);
  } catch (error) {
    logger.error("Get notebook failed:", error.message);
    res.status(500).json({ error: "Failed to get notebook" });
  }
});

/**
 * PUT /api/notebooks/:id
 * Update notebook metadata
 */
router.put("/:id", async (req, res) => {
  try {
    const { title, description, example_questions, generation_status, icon } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (generation_status !== undefined) updates.generationStatus = generation_status;
    if (icon !== undefined) updates.icon = icon;
    
    if (example_questions !== undefined) {
      updates.exampleQuestions = Array.isArray(example_questions) 
        ? JSON.stringify(example_questions) 
        : example_questions;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    // VERCEL WORKAROUND: Auto-provision notebook if it was wiped before updating
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId, 'Auto-provisioned from PUT');

    await dbHelpers.updateNotebook(req.params.id, req.user.userId, updates);
    notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    
    if (!notebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }

    // Parse it back for the response using the ORM key
    if (notebook.exampleQuestions && typeof notebook.exampleQuestions === 'string') {
      try {
        notebook.exampleQuestions = JSON.parse(notebook.exampleQuestions);
      } catch (e) {
        logger.error('Failed to parse example questions:', e);
      }
    }
    
    res.json(notebook);
  } catch (error) {
    logger.error("Update notebook error:", error);
    res.status(500).json({ error: "Failed to update notebook", detail: error.message, stack: error.stack });
  }
});

/**
 * DELETE /api/notebooks/batch
 * Batch delete multiple notebooks
 */
router.delete("/batch", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No notebook IDs provided" });
    }
    const result = await dbHelpers.batchDeleteNotebooks(ids, req.user.userId);
    if (result.changes > 0) {
      ids.forEach(id => deletedNotebooks.add(id));
    }
    res.json({ message: `${result.changes} notebooks deleted successfully`, deletedCount: result.changes });
  } catch (error) {
    logger.error("Batch delete notebooks failed:", error.message);
    res.status(500).json({ error: "Failed to batch delete notebooks" });
  }
});

/**
 * DELETE /api/notebooks/:id
 * Delete a notebook
 */
router.delete("/:id", async (req, res) => {
  try {
    const result = await dbHelpers.deleteNotebook(req.params.id, req.user.userId);
    if (result.action === 'none') {
      return res.status(404).json({ error: "Notebook not found" });
    }
    if (result.action === 'deleted') {
      deletedNotebooks.add(req.params.id);
    }
    const message = result.action === 'deleted' 
      ? "Notebook deleted successfully" 
      : "You have successfully left the notebook";
    res.json({ message, action: result.action });
  } catch (error) {
    logger.error("Delete notebook error:", error.message);
    res.status(500).json({ error: "Failed to delete notebook" });
  }
});

/**
 * GET /api/notebooks/:id/notes
 * List all notes in a notebook
 */
router.get("/:id/notes", async (req, res) => {
  try {
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });
    const notes = await dbHelpers.getNotesByNotebookId(req.params.id, req.user.userId);
    res.json(notes);
  } catch (error) {
    logger.error("List notes error:", error);
    res.status(500).json({ error: "Failed to list notes" });
  }
});

/**
 * POST /api/notebooks/:id/notes
 * Create a new note in a notebook
 */
router.post("/:id/notes", requireScope('notes:create'), async (req, res) => {
  try {
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId, "Automatically provisioned after system reset");
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found and could not be recovered" } });

    const { content, authorId } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Note content is required" });
    }

    const id = uuidv4();
    const userId = req.user.userId;
    const author_id = authorId || userId;
    
    await dbHelpers.createNote(id, req.params.id, userId, content, author_id);
    
    const authorUser = await dbHelpers.getUserById(author_id);
    if (authorUser && authorUser.accountType === 'agent') {
      MemoryService.storeMemory(userId, req.params.id, content, {
        source: 'agent_note',
        noteId: id
      });
    }

    WebhookDispatcher.recordActivityAndNotify(
      req.params.id, userId, req.user.displayName || 'agent', 'note.created',
      content.substring(0, 100)
    );

    res.status(201).json({ id, content, author_id, notebook_id: req.params.id });
  } catch (error) {
    logger.error("Create note error:", error);
    res.status(500).json({ error: "Failed to create note" });
  }
});

/**
 * GET /api/notebooks/:id/notes/:noteId
 * Get a single note
 */
router.get("/:id/notes/:noteId", async (req, res) => {
  try {
    const note = await dbHelpers.getNoteById(req.params.noteId, req.user.userId);
    if (!note) return res.status(404).json({ error: "Note not found" });
    res.json(note);
  } catch (error) {
    res.status(500).json({ error: "Failed to get note" });
  }
});

/**
 * PUT /api/notebooks/:id/notes/:noteId
 * Update note content
 */
router.put("/:id/notes/:noteId", async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "content is required" });
    const result = await dbHelpers.updateNote(req.params.noteId, req.user.userId, content);
    if (result.changes === 0) return res.status(404).json({ error: "Note not found" });
    res.json(await dbHelpers.getNoteById(req.params.noteId, req.user.userId));
  } catch (error) {
    res.status(500).json({ error: "Failed to update note" });
  }
});

/**
 * DELETE /api/notebooks/:id/notes/:noteId
 * Delete a note
 */
router.delete("/:id/notes/:noteId", async (req, res) => {
  try {
    const result = await dbHelpers.deleteNote(req.params.noteId, req.user.userId);
    if (result.changes === 0) return res.status(404).json({ error: "Note not found" });
    res.json({ message: "Note deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete note" });
  }
});


/**
 * POST /api/notebooks/:id/memory/store
 * Generate a local embedding and store it in SQLite
 */
router.post("/:id/memory/store", async (req, res) => {
  try {
    const { content, metadata } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Memory content is required" });
    }

    const userId = req.user.userId;
    const notebookId = req.params.id;
    
    let notebook = await getNotebookOrRecover(notebookId, userId);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });

    const memory = await MemoryService.storeMemory(userId, notebookId, content, metadata || {});
    if (!memory) {
      return res.status(500).json({ error: "Pipeline failed to generate embedding" });
    }

    res.status(201).json({ success: true, memory });
  } catch (error) {
    logger.error("Memory store error:", error);
    res.status(500).json({ error: "Memory store failed" });
  }
});

/**
 * POST /api/notebooks/:id/memory/search
 * Semantic search using local Cosine Similarity
 */
router.post("/:id/memory/search", async (req, res) => {
  try {
    const { query, limit = 5, metadataFilter } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const userId = req.user.userId;
    const notebookId = req.params.id;
    
    const result = await MemoryService.searchMemories(userId, notebookId, query, limit, { metadataFilter });

    res.json(result);
  } catch (error) {
    logger.error("Memory search error:", error);
    res.status(500).json({ error: "Memory search failed" });
  }
});


/**
 * POST /api/notebooks/:id/sources
 * Create a new source in a notebook
 */
router.post("/:id/sources", async (req, res) => {
  try {
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId, "Automatically provisioned after system reset");
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found and could not be recovered" } });

    const { id: providedId, title, type, content, url, metadata, processing_status, file_path, file_size } = req.body;
    if (!title || !type) {
      return res.status(400).json({ error: "title and type are required" });
    }
    
    const id = providedId || uuidv4();
    // Serialize metadata to JSON string for SQLite TEXT column
    const metadataStr = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;
    
    await dbHelpers.createSource(id, req.params.id, req.user.userId, title, type, content, url, metadataStr, file_path, file_size);
    
    // If processing_status is provided and not default, update it immediately
    if (processing_status && processing_status !== 'pending') {
      try {
        await dbHelpers.updateSource(id, req.user.userId, { processing_status });
      } catch(e) {
        logger.warn('Could not update initial processing_status:', e.message);
      }
    }
    
    res.status(201).json({ id, notebook_id: req.params.id, title, type, processing_status: processing_status || 'pending' });
  } catch (error) {
    logger.error("Create source error:", error);
    res.status(500).json({ error: "Failed to create source", details: error.message });
  }
});

/**
 * PUT /api/notebooks/:id/sources/:sourceId
 * Update an existing source
 */
router.put("/:id/sources/:sourceId", async (req, res) => {
  try {
    const updates = req.body;
    const result = await dbHelpers.updateSource(req.params.sourceId, req.user.userId, updates);
    
    // VERCEL WORKAROUND: If changes is 0, the source was wiped by Vercel serverless. We MUST auto-provision it.
    if (result.changes === 0) {
      logger.info(`🛠️ PUT /sources/:sourceId: Source missing, auto-provisioning...`);
      try {
        let notebook = await getNotebookOrRecover(req.params.id, req.user.userId);
        
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
          logger.error("Failed to auto-provision source:", e);
          return res.status(404).json({ error: "Source not found and could not be recovered" });
      }
    }
    
    res.json({ success: true, message: "Source updated" });
  } catch (error) {
    logger.error("Update source error:", error);
    res.status(500).json({ error: "Failed to update source" });
  }
});

/**
 * GET /api/notebooks/:id/sources
 * List all sources in a notebook
 */
router.get("/:id/sources", async (req, res) => {
  try {
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });
    const sources = await dbHelpers.getSourcesByNotebookId(req.params.id, req.user.userId);
    res.json(sources);
  } catch (error) {
    logger.error("List sources error:", error);
    res.status(500).json({ error: "Failed to list sources" });
  }
});

/**
 * POST /api/notebooks/:id/sources/:sourceId/generate-hooks
 * Generates viral outreach hooks from a source and persists as a note.
 */
router.post("/:id/sources/:sourceId/generate-hooks", async (req, res) => {
  try {
    const { id, sourceId } = req.params;
    const userId = req.user.userId;

    // 1. Verify access and fetch source
    const sources = await dbHelpers.getSourcesByNotebookId(id, userId);
    const source = sources.find(s => s.id === sourceId);
    
    if (!source) {
      return res.status(404).json({ error: "Source not found or access denied" });
    }

    if (!source.content || source.content.length < 50) {
      return res.status(400).json({ error: "Source content is too thin for high-quality signal generation." });
    }

    // 2. Generate Hooks
    logger.info(`🧬 [SOVEREIGN SIGNAL] Generating hooks for source: ${source.title}`);
    const hooks = await generateSovereignHooks(source.content, source.title);

    // 3. Persist as Note for later refinement (as requested by LO)
    const noteContent = `# 🧬 Sovereign Signal: Social Hooks\n\n**Source:** ${source.title}\n\n## LinkedIn Strike\n${hooks.linkedin}\n\n## Reddit Thread-Starter\n${hooks.reddit}\n\n## Twitter/X Hook\n${hooks.twitter}\n\n--- \n*Generated by the Sovereign Signal Engine. Refine and strike.*`;
    
    const noteId = uuidv4();
    await dbHelpers.createNote(noteId, id, userId, noteContent);

    res.json({ 
      hooks, 
      noteId,
      message: "Sovereign Signal generated and persisted as a note for later refinement." 
    });
  } catch (error) {
    logger.error("Signal generation error:", error);
    res.status(500).json({ error: "Sovereign Signal failed", details: error.message });
  }
});

/**
 * GET /api/notebooks/:id/messages
 * Get conversation history for a notebook
 */
router.get("/:id/messages", async (req, res) => {
  try {
    let notebook = await getNotebookOrRecover(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: { code: "NOTEBOOK_NOT_FOUND", message: "Notebook not found" } });
    const messages = await dbHelpers.getChatMessagesByNotebookId(req.params.id, req.user.userId);
    res.json(messages);
  } catch (error) {
    logger.error("Get messages error:", error);
    res.status(500).json({ error: "Failed to get messages" });
  }
});

/**
 * GET /api/notebooks/:id/context
 * Build an AI-optimized context payload for agents loading a notebook
 */
router.get("/:id/context", async (req, res) => {
  try {
    const notebook = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });

    const sources = await dbHelpers.getSourcesByNotebookId(req.params.id, req.user.userId);
    const notes = await dbHelpers.getNotesByNotebookId(req.params.id, req.user.userId);

    // Provide a structured snapshot so agents don't have to assemble it manually
    res.json({
      notebook: {
        id: notebook.id,
        title: notebook.title,
        description: notebook.description,
        createdAt: notebook.createdAt
      },
      sources: sources.map(s => ({
        id: s.id,
        title: s.title,
        type: s.type,
        status: s.processingStatus,
        contentPreview: s.content ? s.content.substring(0, 500) + (s.content.length > 500 ? '...' : '') : null,
        contentLength: s.content ? s.content.length : 0
      })),
      notes: notes.map(n => ({
        id: n.id,
        content: n.content,
        authorId: n.authorId,
        createdAt: n.createdAt
      })),
      agentReady: true
    });
  } catch (error) {
    logger.error("Get context error:", error);
    res.status(500).json({ error: "Failed to build context" });
  }
});

/**
 * POST /api/notebooks/:id/immerse
 * Trigger the Mastication Loop for a specific source
 */
router.post("/:id/immerse", async (req, res) => {
  try {
    const { sourceId, agentId } = req.body;
    const notebookId = req.params.id;
    const userId = req.user.userId;

    if (!sourceId) {
      return res.status(400).json({ error: "sourceId is required" });
    }

    // Fire and forget (Background immersion)
    MasticationService.immerseInSource(notebookId, userId, sourceId, agentId);

    res.json({ message: "Immersion loop triggered in the background. Margin notes will appear as they generate." });
  } catch (error) {
    logger.error("Immersion trigger failed:", error.message);
    res.status(500).json({ error: "Failed to trigger immersion" });
  }
});

/**
 * POST /api/notebooks/:id/chat
 * Human/Agent conversation endpoint powered by notebook context
 */
router.post("/:id/chat", async (req, res) => {
  try {
    const { message, saveAsNote = false, agentId = null } = req.body;
    if (!message) return res.status(400).json({ error: "message is required" });

    const notebookId = req.params.id;
    const userId = req.user.userId;

    let notebook = await getNotebookOrRecover(notebookId, userId);
    if (!notebook) return res.status(404).json({ error: "Notebook not found" });

    const sources = await dbHelpers.getSourcesByNotebookId(notebookId, userId);
    const notes = await dbHelpers.getNotesByNotebookId(notebookId, userId);
    const messages = await dbHelpers.getChatMessagesByNotebookId(notebookId, userId);
    const user = await dbHelpers.getUserById(userId);

    // BYOK: Load user's private keys if they exist
    let userKeys = null;
    if (user && user.apiKeys) {
      try {
        userKeys = typeof user.apiKeys === 'string' ? JSON.parse(user.apiKeys) : user.apiKeys;
      } catch (e) {
        logger.warn(`Failed to parse apiKeys for user ${userId}:`, e.message);
      }
    }

    // Save the user's message to history
    const userMsgId = uuidv4();
    await dbHelpers.createChatMessage(userMsgId, notebookId, userId, agentId ? 'agent' : 'user', message);

    try {
      // Call Gemini using our context service
      const chatResult = await chatWithNotebook({
        notebook,
        sources,
        notes,
        message,
        history: messages,
        callerType: agentId ? 'agent' : 'human',
        userKeys
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

      WebhookDispatcher.recordActivityAndNotify(
        notebookId, userId, agentId ? 'agent' : 'human', 'chat.message',
        message.substring(0, 100)
      );

      res.json({
        answer: chatResult.answer,
        groundedSources: chatResult.groundedSources,
        tokensUsed: chatResult.tokensUsed,
        messageId: aiMsgId,
        noteId,
        joinCode: notebook.joinCode
      });

    } catch (aiError) {
      logger.error("AI chat processing error:", aiError);
      res.status(500).json({ error: "AI processing failed", details: aiError.message });
    }

  } catch (error) {
    logger.error("Chat endpoint error:", error);
    res.status(500).json({ error: "Failed to process chat" });
  }
});

// ====== SOVEREIGN BRIDGE ROUTES ======

// Helper to verify notebook access
const requireNotebookAccess = async (req, res, next) => {
  try {
    const access = await dbHelpers.getNotebookById(req.params.id, req.user.userId);
    if (!access) return res.status(404).json({ error: "Notebook not found" });
    next();
  } catch (error) {
    logger.error("Access check failed:", error);
    res.status(500).json({ error: "Access check failed" });
  }
};

/**
 * GET /api/notebooks/:id/activity
 * Get activity log
 */
router.get("/:id/activity", requireNotebookAccess, async (req, res) => {
  try {
    const activities = await dbHelpers.getActivityLogsByNotebookId(req.params.id);
    res.json({ activities });
  } catch (error) {
    logger.error("Failed to get activity log:", error);
    res.status(500).json({ error: "Failed to get activity log" });
  }
});

/**
 * POST /api/notebooks/:id/activity
 * Record an activity log entry (for agents reporting actions)
 */
router.post("/:id/activity", requireNotebookAccess, async (req, res) => {
  try {
    const { actionType, contentPreview } = req.body;
    if (!actionType) return res.status(400).json({ error: "actionType is required" });

    await dbHelpers.createActivityLog(
      req.params.id,
      req.user.userId,
      req.user.displayName || 'Agent',
      actionType,
      contentPreview || null
    );
    res.status(201).json({ message: "Activity recorded" });
  } catch (error) {
    logger.error("Failed to record activity:", error);
    res.status(500).json({ error: "Failed to record activity" });
  }
});

/**
 * GET /api/notebooks/:id/sources/:sourceId/content
 * Get full untruncated source content
 */
router.get("/:id/sources/:sourceId/content", requireNotebookAccess, async (req, res) => {
  try {
    const sources = await dbHelpers.getSourcesByNotebookId(req.params.id, req.user.userId);
    const source = sources.find(s => s.id === req.params.sourceId);
    if (!source) return res.status(404).json({ error: "Source not found" });
    
    // Log activity if it's an agent reading
    if (req.user.accountType === 'agent') {
      await dbHelpers.createActivityLog(req.params.id, req.user.userId, req.user.displayName || 'Agent', 'read_source', `Read full source: ${source.title}`);
    }
    
    res.json({
      id: source.id,
      title: source.title,
      type: source.type,
      content: source.content,
      contentLength: source.content ? source.content.length : 0
    });
  } catch (error) {
    logger.error("Failed to get full source content:", error);
    res.status(500).json({ error: "Failed to get full source content" });
  }
});

/**
 * GET /api/notebooks/:id/tasks
 */
router.get("/:id/tasks", requireNotebookAccess, async (req, res) => {
  try {
    const tasks = await dbHelpers.getTasksByNotebookId(req.params.id);
    res.json({ tasks });
  } catch (error) {
    logger.error("Failed to list tasks:", error);
    res.status(500).json({ error: "Failed to list tasks" });
  }
});

/**
 * POST /api/notebooks/:id/tasks
 */
router.post("/:id/tasks", requireNotebookAccess, async (req, res) => {
  try {
    const { instruction, assignee, priority, due_by } = req.body;
    const task = await dbHelpers.createTask(req.user.userId, req.params.id, instruction, assignee, priority, null, due_by);
    
    await dbHelpers.createActivityLog(req.params.id, req.user.userId, req.user.displayName || 'User', 'created_task', `Task assigned to ${assignee || 'human'}: ${instruction.substring(0, 50)}...`);
    
    res.status(201).json(task);
  } catch (error) {
    logger.error("Failed to create task:", error);
    res.status(500).json({ error: "Failed to create task" });
  }
});

/**
 * PUT /api/notebooks/:id/tasks/:taskId
 */
router.put("/:id/tasks/:taskId", requireNotebookAccess, async (req, res) => {
  try {
    const { status, result } = req.body;
    const updates = { status, result };
    if (status === 'completed') updates.completedAt = new Date();
    
    await dbHelpers.updateTask(req.params.taskId, updates);
    await dbHelpers.createActivityLog(req.params.id, req.user.userId, req.user.displayName || 'User', 'updated_task', `Task ${req.params.taskId} marked as ${status}`);
    
    res.json({ message: "Task updated" });
  } catch (error) {
    logger.error("Failed to update task:", error);
    res.status(500).json({ error: "Failed to update task" });
  }
});

/**
 * GET /api/notebooks/:id/scratch
 */
router.get("/:id/scratch", requireNotebookAccess, async (req, res) => {
  try {
    const entries = await dbHelpers.getScratchpadByNotebookId(req.params.id, req.user.userId);
    res.json({ scratchpad: entries });
  } catch (error) {
    logger.error("Failed to get scratchpad:", error);
    res.status(500).json({ error: "Failed to get scratchpad" });
  }
});

/**
 * POST /api/notebooks/:id/scratch
 */
router.post("/:id/scratch", requireNotebookAccess, async (req, res) => {
  try {
    const { content, ttl_hours } = req.body;
    const expiresAt = ttl_hours ? new Date(Date.now() + ttl_hours * 60 * 60 * 1000) : null;
    const entry = await dbHelpers.createScratchpadEntry(req.params.id, req.user.userId, content, expiresAt);
    res.status(201).json(entry);
  } catch (error) {
    logger.error("Failed to create scratchpad entry:", error);
    res.status(500).json({ error: "Failed to create scratchpad entry" });
  }
});

/**
 * POST /api/notebooks/:id/scratch/:scratchId/promote
 */
router.post("/:id/scratch/:scratchId/promote", requireNotebookAccess, async (req, res) => {
  try {
    const entries = await dbHelpers.getScratchpadByNotebookId(req.params.id, req.user.userId);
    const entry = entries.find(e => e.id === req.params.scratchId);
    if (!entry) return res.status(404).json({ error: "Scratchpad entry not found" });
    
    const noteId = uuidv4();
    await dbHelpers.createNote(noteId, req.params.id, req.user.userId, entry.content, req.user.userId);
    await dbHelpers.deleteScratchpadEntry(entry.id);
    
    await dbHelpers.createActivityLog(req.params.id, req.user.userId, req.user.displayName || 'User', 'promoted_scratchpad', "Promoted a scratchpad entry to a persistent note");
    
    res.json({ message: "Promoted to note successfully", noteId });
  } catch (error) {
    logger.error("Failed to promote scratchpad entry:", error);
    res.status(500).json({ error: "Failed to promote scratchpad entry" });
  }
});

/**
 * GET /api/notebooks/:id/webhooks
 */
router.get("/:id/webhooks", requireNotebookAccess, async (req, res) => {
  try {
    const hooks = await dbHelpers.getWebhooksByNotebookId(req.params.id);
    res.json({ webhooks: hooks });
  } catch (error) {
    logger.error("Failed to get webhooks:", error);
    res.status(500).json({ error: "Failed to get webhooks" });
  }
});

/**
 * POST /api/notebooks/:id/webhooks
 */
router.post("/:id/webhooks", requireNotebookAccess, async (req, res) => {
  try {
    const { url, events } = req.body;
    const hook = await dbHelpers.createWebhook(req.params.id, req.user.userId, url, JSON.stringify(events || []));
    res.status(201).json(hook);
  } catch (error) {
    logger.error("Failed to create webhook:", error);
    res.status(500).json({ error: "Failed to create webhook" });
  }
});

/**
 * POST /api/notebooks/:id/pulse
 * Agent broadcasts a thought to the notebook activity stream.
 */
router.post("/:id/pulse", async (req, res) => {
  try {
    const { thought, mission } = req.body;
    const notebookId = req.params.id;
    const userId = req.user.userId;

    if (mission === 'start') {
      await agentPulse.startMission(userId, notebookId, thought || 'Unnamed mission');
      return res.json({ message: "Mission started" });
    }
    if (mission === 'end') {
      await agentPulse.endMission(userId, notebookId);
      return res.json({ message: "Mission ended" });
    }

    if (!thought) {
      return res.status(400).json({ error: "thought is required" });
    }

    await agentPulse.broadcastThought(userId, notebookId, thought);
    res.json({ message: "Thought broadcast" });
  } catch (error) {
    logger.error("Pulse error:", error);
    res.status(500).json({ error: "Failed to broadcast thought" });
  }
});

export default router;
