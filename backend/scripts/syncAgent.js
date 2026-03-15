/**
 * StudyPod Agent Starter Kit (Node.js)
 * 
 * This script allows an external agent to autonomously:
 * 1. Register/Login as a linked agent to a human owner.
 * 2. Push research notes to a specific notebook.
 * 3. Engage in chat discourse.
 */

import axios from 'axios';

// CONFIGURATION
const API_BASE = 'http://localhost:3001/api';
const AGENT_CONFIG = {
    displayName: 'Autonomous_Research_Bot',
    passphrase: 'secure_passphrase_123',
    ownerName: 'Human Tester' // MUST match the human user display name
};

async function syncAgent() {
    try {
        console.log(`--- Initializing Agent: ${AGENT_CONFIG.displayName} ---`);

        // 1. HUMAN AUTHENTICATION (Service Account Mode)
        console.log(`🔑 Authenticating as Human Owner: ${AGENT_CONFIG.ownerName}...`);
        const humanAuth = await axios.post(`${API_BASE}/auth/signin`, {
            displayName: AGENT_CONFIG.ownerName,
            passphrase: 'password123' // The verified password for Human Tester
        });

        const humanToken = humanAuth.data.accessToken;
        console.log('✅ Human session established.');

        // 2. AGENT REGISTRATION / SIGNIN (Linked to owner via humanToken)
        console.log(`🤖 Re-registering/Syncing Agent: ${AGENT_CONFIG.displayName}...`);
        let agentToken;
        try {
            const agentResponse = await axios.post(`${API_BASE}/auth/register`, {
                display_name: AGENT_CONFIG.displayName,
                passphrase: AGENT_CONFIG.passphrase,
                account_type: 'agent'
            }, {
                headers: { Authorization: `Bearer ${humanToken}` }
            });
            agentToken = agentResponse.data.accessToken;
            console.log('✅ Agent registered and linked.');
        } catch (regError) {
            if (regError.response?.status === 400) {
                console.log('ℹ️ Agent already exists, signing in directly...');
                const agentSignIn = await axios.post(`${API_BASE}/auth/signin`, {
                    displayName: AGENT_CONFIG.displayName,
                    passphrase: AGENT_CONFIG.passphrase
                });
                agentToken = agentSignIn.data.accessToken;
                console.log('✅ Agent authenticated.');
            } else {
                throw regError;
            }
        }

        const headers = { Authorization: `Bearer ${agentToken}` };

        // 3. DISCOVER SHARED NOTEBOOKS
        const notebooks = await axios.get(`${API_BASE}/notebooks`, { headers });
        if (notebooks.data.length === 0) {
            console.log('❌ No shared notebooks found. Human owner must create one first.');
            return;
        }
        
        const targetNotebookId = notebooks.data[0].id;
        console.log(`🔗 Targeting Notebook: ${notebooks.data[0].title} (${targetNotebookId})`);

        // 4. PUSH RESEARCH NOTE
        const notePayload = {
            title: `Insight from ${AGENT_CONFIG.displayName} (${new Date().toLocaleTimeString()})`,
            content: `# Automated Research Update\n\nI have scanned the latest Gauteng High Court dockets and confirmed that the quantum encryption transition remains a priority for Q4 2026.`,
            type: 'text'
        };

        await axios.post(`${API_BASE}/notebooks/${targetNotebookId}/notes`, notePayload, { headers });
        console.log('✅ Research note synchronized.');

        // 4. ENGAGE IN DISCOURSE (Chat)
        const chatPayload = {
            notebookId: targetNotebookId,
            content: `I've just added a new note regarding the High Court dockets. Most financial institutions are required to comply by December 2026. Shall I look into specific case law examples next?`,
            role: 'assistant'
        };

        await axios.post(`${API_BASE}/chat/messages`, chatPayload, { headers });
        console.log('✅ Chat message posted to discourse layer.');

        console.log('--- Agent Sync Complete ---');

    } catch (error) {
        console.error('❌ Sync Failed:', error.response?.data?.message || error.message);
    }
}

syncAgent();
