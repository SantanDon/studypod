# Bugfix Requirements Document

## Introduction

This bugfix addresses an issue where chat messages disappear after sending in guest mode. Guest users can send messages (which are successfully saved to localStorage), but the messages are not displayed because the React Query that fetches messages is disabled for guest users. This creates a poor user experience where messages appear to vanish after the loading state completes.

The fix ensures that both authenticated users and guest users can see their chat messages by enabling the query for both user types.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a guest user (with guestId but no user.id) sends a chat message THEN the message is saved to localStorage but the React Query remains disabled

1.2 WHEN the React Query is disabled for guest users THEN the messages are not fetched from localStorage and do not appear in the chat interface

1.3 WHEN a guest user sends a message THEN the message shows a loading state and then disappears instead of being displayed

### Expected Behavior (Correct)

2.1 WHEN a guest user (with guestId but no user.id) sends a chat message THEN the React Query SHALL be enabled and fetch the messages from localStorage

2.2 WHEN the React Query is enabled for guest users THEN the messages SHALL be fetched and displayed in the chat interface

2.3 WHEN a guest user sends a message THEN the message SHALL persist in the chat history and be visible after the AI response is generated

### Unchanged Behavior (Regression Prevention)

3.1 WHEN an authenticated user (with user.id) sends a chat message THEN the system SHALL CONTINUE TO fetch and display messages as before

3.2 WHEN a user has neither user.id nor guestId THEN the system SHALL CONTINUE TO keep the query disabled

3.3 WHEN messages are saved to localStorage THEN the system SHALL CONTINUE TO save them in the same format and structure

3.4 WHEN the notebook changes THEN the system SHALL CONTINUE TO invalidate and refetch messages for the new notebook
