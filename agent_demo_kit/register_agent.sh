#!/bin/bash

# StudyPodLM Agent Registration Script
# Requires a Human Owner JWT to register a new agent.

if [ "$#" -ne 4 ]; then
    echo "Usage: ./register_agent.sh <API_URL> <OWNER_JWT> <AGENT_NAME> <PASSPHRASE>"
    echo "Example: ./register_agent.sh http://localhost:3001 'human_jwt_here' 'QwenBot' 'secret_pass_123'"
    exit 1
fi

API_URL=$1
OWNER_JWT=$2
AGENT_NAME=$3
PASSPHRASE=$4

echo "Registering agent: $AGENT_NAME..."

curl -X POST "$API_URL/api/auth/register" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $OWNER_JWT" \
     -d "{
           \"display_name\": \"$AGENT_NAME\",
           \"passphrase\": \"$PASSPHRASE\",
           \"account_type\": \"agent\"
         }"

echo -e "\nRegistration complete."
