# Requirements Document

## Introduction

This document specifies the requirements for fixing two critical bugs in the notebook application:
1. Quiz generation fails due to malformed JSON responses from the LLM (double curly braces `{{` instead of single `{`)
2. Podcast audio does not auto-save to history after generation completes

## Glossary

- **Quiz_Generator**: The system component responsible for generating quiz questions from source content using an LLM
- **JSON_Parser**: The utility module that parses and validates JSON responses from LLM outputs
- **Podcast_Generator**: The system component that generates podcast scripts and audio from source content
- **Auto_Save**: The automatic persistence of generated content to local storage without user intervention
- **LLM**: Large Language Model used for content generation
- **TTS**: Text-to-Speech system used for podcast audio generation

## Requirements

### Requirement 1

**User Story:** As a user, I want quiz generation to succeed even when the LLM returns malformed JSON with double curly braces, so that I can reliably generate quizzes from my study materials.

#### Acceptance Criteria

1. WHEN the JSON_Parser receives a response containing double curly braces `{{` THEN the JSON_Parser SHALL normalize the braces to single curly braces `{` before parsing
2. WHEN the JSON_Parser receives a response containing double closing braces `}}` THEN the JSON_Parser SHALL normalize them to single closing braces `}` before parsing
3. WHEN the Quiz_Generator receives a normalized JSON response THEN the Quiz_Generator SHALL successfully parse and return valid quiz questions
4. WHEN the JSON_Parser encounters any brace normalization THEN the JSON_Parser SHALL log the normalization for debugging purposes

### Requirement 2

**User Story:** As a user, I want my generated podcasts to automatically save to history after generation completes, so that I can access them later without manual intervention.

#### Acceptance Criteria

1. WHEN the TTS generation completes successfully AND produces a valid audio blob THEN the Podcast_Generator SHALL automatically save the podcast to history
2. WHEN the auto-save operation succeeds THEN the system SHALL display a success notification to the user
3. WHEN the auto-save operation fails THEN the system SHALL display an error notification and log the failure details
4. WHEN the podcast script title is available THEN the system SHALL use the script title as the saved podcast title
5. WHEN the audio blob size is less than 1000 bytes THEN the system SHALL skip auto-save to avoid saving invalid audio

### Requirement 3

**User Story:** As a developer, I want robust JSON parsing that handles common LLM output formatting issues, so that content generation features work reliably.

#### Acceptance Criteria

1. WHEN the JSON_Parser receives a response with escaped double braces in template literals THEN the JSON_Parser SHALL preserve the template structure while normalizing actual JSON braces
2. WHEN the JSON_Parser normalizes braces THEN the JSON_Parser SHALL handle nested objects correctly without corrupting the structure
3. WHEN the JSON_Parser encounters mixed single and double braces THEN the JSON_Parser SHALL normalize all double braces to single braces consistently
