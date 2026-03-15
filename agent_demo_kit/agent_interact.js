/**
 * StudyPodLM Agent Interaction Script
 * Demonstrates: 
 * 1. Signing in as an Agent
 * 2. Posting a collaborative note to a notebook.
 */

async function runAgentDemo() {
    const API_URL = process.argv[2] || 'http://localhost:3001';
    const AGENT_NAME = process.argv[3];
    const PASSPHRASE = process.argv[4];
    const NOTEBOOK_ID = process.argv[5];
    const NOTE_CONTENT = process.argv[6] || 'Agent diagnostic: Analysis of shared context completed.';

    if (!AGENT_NAME || !PASSPHRASE || !NOTEBOOK_ID) {
        console.log("Usage: node agent_interact.js <API_URL> <AGENT_NAME> <PASSPHRASE> <NOTEBOOK_ID> [CONTENT]");
        process.exit(1);
    }

    console.log(`--- Agent Showcase: ${AGENT_NAME} ---`);

    try {
        // 1. Sign In
        console.log("Authenticating...");
        const authResponse = await fetch(`${API_URL}/api/auth/signin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName: AGENT_NAME, passphrase: PASSPHRASE })
        });

        if (!authResponse.ok) {
            const err = await authResponse.json();
            throw new Error(`Auth failed: ${err.error}`);
        }

        const authData = await authResponse.json();
        const token = authData.accessToken;
        const agentId = authData.user.id;
        console.log(`Success! Logged in as ${AGENT_NAME} (${agentId})`);

        // 2. Post Note
        console.log(`Posting note to notebook ${NOTEBOOK_ID}...`);
        const noteResponse = await fetch(`${API_URL}/api/notebooks/${NOTEBOOK_ID}/notes`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ 
                content: NOTE_CONTENT,
                authorId: agentId
            })
        });

        if (!noteResponse.ok) {
            const err = await noteResponse.json();
            throw new Error(`Note creation failed: ${err.error}`);
        }

        const noteData = await noteResponse.json();
        console.log(`SUCCESS: Note created with ID ${noteData.id}`);
        console.log(`Note attribuited to author: ${noteData.author_id}`);

    } catch (error) {
        console.error("ERROR:", error.message);
    }
}

runAgentDemo();
