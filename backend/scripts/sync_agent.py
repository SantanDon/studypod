import requests

# CONFIGURATION
API_BASE = "http://localhost:3001/api"
AGENT_CONFIG = {
    "displayName": "Python_Research_Bot",
    "passphrase": "secure_passphrase_456",
    "ownerName": "Human Tester"  # MUST match the human user display name
}

def sync_agent():
    print(f"--- Initializing Agent: {AGENT_CONFIG['displayName']} ---")

    try:
        # 1. HUMAN AUTHENTICATION (Service Account Mode)
        print(f"🔑 Authenticating as Human Owner: {AGENT_CONFIG['ownerName']}...")
        human_auth = requests.post(f"{API_BASE}/auth/signin", json={
            "displayName": AGENT_CONFIG["ownerName"],
            "passphrase": "password123" # The verified password for Human Tester
        })
        human_auth.raise_for_status()
        human_token = human_auth.json().get("accessToken")
        print("✅ Human session established.")

        # 2. AGENT REGISTRATION (Linked to owner via human_token)
        print(f"🤖 Re-registering/Syncing Agent: {AGENT_CONFIG['displayName']}...")
        agent_response = requests.post(
            f"{API_BASE}/auth/register", 
            json={
                "display_name": AGENT_CONFIG["displayName"],
                "passphrase": AGENT_CONFIG["passphrase"],
                "account_type": "agent"
            },
            headers={"Authorization": f"Bearer {human_token}"}
        )
        agent_response.raise_for_status()
        
        agent_token = agent_response.json().get("accessToken")
        headers = {"Authorization": f"Bearer {agent_token}"}
        print("✅ Agent linked and authenticated.")

        # 3. DISCOVER SHARED NOTEBOOKS
        notebooks_response = requests.get(f"{API_BASE}/notebooks", headers=headers)
        notebooks_response.raise_for_status()
        notebooks = notebooks_response.json()

        if not notebooks:
            print("❌ No shared notebooks found. Human owner must create one first.")
            return

        target_notebook = notebooks[0]
        target_id = target_notebook["id"]
        print(f"🔗 Targeting Notebook: {target_notebook['title']} ({target_id})")

        # 4. PUSH RESEARCH NOTE
        import datetime
        note_payload = {
            "title": f"Scientific Insight from {AGENT_CONFIG['displayName']} ({datetime.datetime.now().strftime('%H:%M:%S')})",
            "content": f"# Python Context Update\n\nI have analyzed several research papers on post-quantum cryptography. The consensus suggests a hybrid approach during the 2026 transition period.",
            "type": "text"
        }
        requests.post(f"{API_BASE}/notebooks/{target_id}/notes", json=note_payload, headers=headers).raise_for_status()
        print("✅ Research note synchronized.")

        # 4. ENGAGE IN DISCOURSE (Chat)
        chat_payload = {
            "notebookId": target_notebook["id"],
            "content": "I've uploaded my latest findings on hybrid cryptography. Based on these papers, our Gauteng division strategy should prioritize RSA-Quantum hybrid systems. Would you like a more detailed breakdown?",
            "role": "assistant"
        }
        requests.post(f"{API_BASE}/chat/messages", json=chat_payload, headers=headers).raise_for_status()
        print("✅ Chat message posted to discourse layer.")

        print("--- Agent Sync Complete ---")

    except requests.exceptions.RequestException as e:
        print(f"❌ Sync Failed: {e}")

if __name__ == "__main__":
    sync_agent()
