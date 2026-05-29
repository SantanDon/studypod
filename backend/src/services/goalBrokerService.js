/**
 * Goal Broker Service — Closed Loop Research Broker
 * 
 * Matches newly crawled bookmark sources against active user research goals,
 * generates a comprehensive "Research Synthesis & Recommendations" note,
 * and automatically triggers agent tasks and social queue signal drafts.
 */

import { v4 as uuidv4 } from 'uuid';
import { dbHelpers } from '../db/database.js';
import { dispatchToTitan } from './titanProvider.js';
import { logger } from '../utils/logger.js';

/**
 * Execute Closed-Loop Synthesis matching sources against notebook goals
 */
export async function brokerResearchGoals(notebookId, userId, sourceIds) {
  try {
    logger.info(`🎯 [GoalBroker] Starting closed-loop synthesis for notebook ${notebookId}`);

    // 1. Fetch active goals
    const goals = await dbHelpers.getResearchGoalsByNotebookId(notebookId, userId);
    if (!goals || goals.length === 0) {
      logger.info(`[GoalBroker] No active research goals in notebook ${notebookId} — skipping synthesis`);
      return null;
    }

    // 2. Fetch source contents
    const allSources = await dbHelpers.getSourcesByNotebookId(notebookId, userId);
    const targetSources = allSources.filter(s => sourceIds.includes(s.id) && s.content);

    if (targetSources.length === 0) {
      logger.info(`[GoalBroker] No source contents available for synthesis in notebook ${notebookId}`);
      return null;
    }

    logger.info(`[GoalBroker] Synthesizing ${targetSources.length} source(s) against ${goals.length} goal(s)`);

    // 3. Construct prompt for AI
    const goalsText = goals.map(g => `- **${g.title}**: ${g.description || 'No description provided'}`).join('\n');
    const sourcesText = targetSources.map(s => `--- SOURCE: ${s.title} (${s.url || 'No URL'}) ---\n${s.content.substring(0, 8000)}`).join('\n\n');

    const systemPrompt = `You are the StudyPod Goal Broker & Research Synthesizer.
Your voice is "Direct. Highly technical. Dark, clean, and developer-centric."
No preachy AI filler, no "delighted" or "leverage".

TASK:
Analyze the newly crawled bookmarks/sources against the user's active Research Goals. Generate a cohesive research synthesis and action plan.

USER RESEARCH GOALS:
${goalsText}

NEW WEB/BOOKMARK SOURCES:
${sourcesText}

Generate a Markdown synthesis containing:
1. 🎯 STRATEGIC RECONNAISSANCE: How these bookmarks map to the user's goals. Be specific.
2. 🛠️ ACTIONABLE RECOMMENDATIONS: Specific suggestions (e.g. IDE configurations, tools, architecture upgrades, repos to fork) for their agents/development.
3. 📋 AGENT CHECKS & TASKS: List 2-3 concrete tasks that can be assigned to autonomous agents (e.g., "Analyze repo X", "Integrate library Y"). Provide them in a clear bullet-point section prefixed with "[TASK]".
4. 📢 OUTREACH HOOKS: List 1-2 punchy social outreach copy drafts based on the findings. Prefix with "[OUTREACH]".`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Begin analysis and compile the Research Synthesis & Recommendations report now.' }
    ];

    const { answer } = await dispatchToTitan({
      messages,
      priority: 'reasoning',
      temperature: 0.75
    });

    // 4. Extract tasks and outreach copy from the response
    const tasksToCreate = extractPrefixLines(answer, '[TASK]');
    const outreachToCreate = extractPrefixLines(answer, '[OUTREACH]');

    // 5. Update or create the Synthesis Note in the notebook
    const notes = await dbHelpers.getNotesByNotebookId(notebookId, userId);
    const existingSynthesisNote = notes.find(n => n.content.includes('# 🎯 Research Synthesis & Recommendations') || n.content.startsWith('# 🎯 Research Synthesis'));

    const cleanAnswer = answer
      .replace(/\[TASK\]\s*/gi, '')
      .replace(/\[OUTREACH\]\s*/gi, '');

    const noteContent = `# 🎯 Research Synthesis & Recommendations\n\n*Updated: ${new Date().toLocaleString()}*\n\n${cleanAnswer}\n\n---\n*Synthesized by the StudyPod Goal Broker.*`;

    let noteId;
    if (existingSynthesisNote) {
      noteId = existingSynthesisNote.id;
      await dbHelpers.updateNote(noteId, notebookId, userId, noteContent);
      logger.info(`[GoalBroker] Pre-existing synthesis note updated: ${noteId}`);
    } else {
      noteId = uuidv4();
      await dbHelpers.createNote(noteId, notebookId, userId, noteContent, userId);
      logger.info(`[GoalBroker] New synthesis note created: ${noteId}`);
    }

    // 6. Persist extracted tasks to database
    for (const taskText of tasksToCreate) {
      try {
        await dbHelpers.createTask(userId, notebookId, taskText, 'agent', 'medium', null, null);
        logger.info(`[GoalBroker] Auto-provisioned agent task: "${taskText.substring(0, 40)}..."`);
      } catch (err) {
        logger.warn(`[GoalBroker] Failed to auto-provision agent task: ${err.message}`);
      }
    }

    // 7. Persist outreach hooks to signal_queue
    for (const hookText of outreachToCreate) {
      try {
        const platform = hookText.toLowerCase().includes('linkedin') ? 'linkedin' : 'twitter';
        const content = hookText.replace(/^(linkedin|twitter|reddit|threads):\s*/i, '').trim();
        await dbHelpers.createSignalQueueItem(
          uuidv4(), userId, notebookId, platform, content,
          null, null, null, noteId
        );
        logger.info(`[GoalBroker] Auto-staged outreach hook to signal queue: ${platform}`);
      } catch (err) {
        logger.warn(`[GoalBroker] Failed to auto-stage outreach signal: ${err.message}`);
      }
    }

    return { noteId, tasksCount: tasksToCreate.length, signalsCount: outreachToCreate.length };

  } catch (err) {
    logger.error(`[GoalBroker] Synthesis error: ${err.message}`);
    return null;
  }
}

function extractPrefixLines(text, prefix) {
  const lines = text.split('\n');
  const results = [];
  for (const line of lines) {
    if (line.trim().startsWith(prefix)) {
      results.push(line.replace(prefix, '').trim().replace(/^[:\-*#\s]+/, ''));
    }
  }
  return results;
}

export default { brokerResearchGoals };
