# InsightsLM Testing Documentation

## Test Suite Overview

This testing suite provides comprehensive coverage for all InsightsLM features.

## Running Tests

\\\ash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test localStorage.test.ts

# Run tests in UI mode
npm test -- --ui
\\\

## Test Coverage

### 1. Core Functionality Tests (tests/localStorage.test.ts)
- ✅ User Management
  - User creation
  - Password hashing
  - Authentication
  - Session management
- ✅ Notebook Management
  - CRUD operations
  - Notebook retrieval
  - Updates
- ✅ Source Management
  - Adding sources (PDF, DOCX, Web, YouTube)
  - Updating source metadata
  - Deleting sources
- ✅ Note Management
  - Creating notes
  - Editing notes
  - Deleting notes
- ✅ Cascading Deletes
  - Notebook deletion removes all related data

### 2. Content Extraction Tests (tests/extraction.test.ts)
- ✅ PDF Extraction
  - Text extraction
  - Encrypted PDF handling
  - OCR for scanned PDFs
- ✅ DOCX Extraction
  - Text extraction
  - Formatting preservation
- ✅ Web Content Extraction
  - HTML parsing
  - Content cleaning
  - Retry logic
- ✅ YouTube Extraction
  - Video ID extraction
  - Transcript fetching
  - Multiple language support
- ✅ Content Validation
  - Length validation
  - Quality checks
  - Sanitization

### 3. AI Service Tests (tests/ai.test.ts)
- ✅ Ollama Connection
  - Service availability check
  - Model listing
- ✅ Chat Completion
  - Message generation
  - Streaming responses
  - Context management
- ✅ Embeddings
  - Vector generation
  - Batch processing
- ✅ Semantic Search
  - Cosine similarity
  - Result ranking
- ✅ Caching
  - Response caching
  - TTL management
- ✅ Podcast Generation
  - Script generation
  - Speaker alternation
  - Duration estimation

### 4. UI Component Tests (tests/ui.test.tsx)
- ✅ Dashboard
  - Empty state
  - Notebook grid
  - Navigation
- ✅ Notebook View
  - Source sidebar
  - Chat interface
  - Note editor
- ✅ File Upload
  - File validation
  - Progress tracking
- ✅ Authentication
  - Login/logout
  - Form validation
- ✅ Responsive Design
  - Mobile adaptation
  - Menu behavior
- ✅ Error Handling
  - Error display
  - Retry mechanisms

### 5. Integration Tests (tests/integration.test.ts)
- ✅ End-to-End Workflows
  - Complete notebook creation
  - Multi-source analysis
  - Podcast generation
  - Search and citation
- ✅ Error Recovery
  - Upload failures
  - Service unavailability
- ✅ Data Persistence
  - Cross-reload persistence
  - Cross-tab sync
- ✅ Performance
  - Large document handling
  - Batch processing
  - Caching efficiency
- ✅ Security
  - Password hashing
  - Input sanitization
  - URL validation
- ✅ Accessibility
  - ARIA labels
  - Keyboard navigation
  - Color contrast

## Test Execution Checklist

### Before Running Tests
- [ ] Ollama is running (for AI tests)
- [ ] Dependencies installed (\
pm install\)
- [ ] Test environment configured

### Critical Test Scenarios

#### Scenario 1: New User Onboarding
1. Sign up
2. Create first notebook
3. Add source (PDF)
4. Generate notes
5. Ask questions in chat

#### Scenario 2: Multi-Source Research
1. Create notebook
2. Add PDF document
3. Add YouTube video
4. Add website article
5. Create personal notes
6. Generate podcast
7. Search across sources

#### Scenario 3: Collaboration & Export
1. Create comprehensive notebook
2. Generate study materials
3. Export to Markdown
4. Share notebook

#### Scenario 4: Error Handling
1. Upload invalid file
2. Network interruption during upload
3. Ollama service down
4. Large file handling
5. Invalid URL input

#### Scenario 5: Performance Testing
1. Upload 50+ page PDF
2. Add 10+ sources
3. Generate embeddings
4. Search with complex queries
5. Generate long podcast

## Manual Testing Checklist

### Authentication Flow
- [ ] Sign up with valid email/password
- [ ] Sign up with invalid email (should fail)
- [ ] Login with correct credentials
- [ ] Login with wrong credentials (should fail)
- [ ] Logout successfully
- [ ] Session persists on page reload

### Notebook Management
- [ ] Create new notebook
- [ ] View notebook list
- [ ] Open existing notebook
- [ ] Rename notebook
- [ ] Delete notebook
- [ ] Verify cascading delete (sources, notes deleted)

### Source Upload - PDF
- [ ] Upload valid PDF (< 10MB)
- [ ] Upload PDF > 10MB (should fail or warn)
- [ ] Upload encrypted PDF (should handle gracefully)
- [ ] Upload scanned PDF (should use OCR)
- [ ] Verify extracted text is correct
- [ ] Verify processing status updates

### Source Upload - DOCX
- [ ] Upload DOCX file
- [ ] Verify text extraction
- [ ] Check formatting preservation
- [ ] Verify table handling

### Source Upload - Website
- [ ] Add valid URL
- [ ] Add invalid URL (should fail)
- [ ] Add URL requiring auth (should handle)
- [ ] Verify content extraction quality
- [ ] Check metadata extraction (title, author, date)

### Source Upload - YouTube
- [ ] Add YouTube URL (watch?v= format)
- [ ] Add YouTube URL (youtu.be format)
- [ ] Add video with captions
- [ ] Add video without captions (should fail gracefully)
- [ ] Verify transcript accuracy
- [ ] Check timestamp preservation

### Note Taking
- [ ] Create new note
- [ ] Edit existing note
- [ ] Auto-save works
- [ ] Note persists on reload
- [ ] Delete note

### Chat Interface
- [ ] Send message
- [ ] Receive AI response
- [ ] View citations in response
- [ ] Click citation to view source
- [ ] Chat history persists
- [ ] Streaming response works

### Search Functionality
- [ ] Search across sources
- [ ] View search results
- [ ] Results ranked by relevance
- [ ] Click result to view full content
- [ ] Search highlights correct passages

### Podcast Generation
- [ ] Generate podcast from sources
- [ ] Verify script quality
- [ ] Play audio (if implemented)
- [ ] Check user perspective integration
- [ ] Verify speaker alternation
- [ ] Export podcast script

### Mobile Responsiveness
- [ ] Open on mobile device
- [ ] Navigation works
- [ ] Sidebar collapses
- [ ] Touch interactions work
- [ ] File upload works
- [ ] Chat interface usable

### Performance
- [ ] Upload large PDF (20+ pages) - should complete
- [ ] Add 10+ sources - UI remains responsive
- [ ] Search with long query - returns results quickly
- [ ] Generate podcast from large notebook - completes
- [ ] Page load time < 3 seconds

### Error Handling
- [ ] Network error displays user-friendly message
- [ ] File upload failure shows retry option
- [ ] Invalid input shows validation error
- [ ] Ollama unavailable shows appropriate message
- [ ] Storage quota exceeded handled gracefully

### Browser Compatibility
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)

## Known Issues & Limitations

### Current Limitations
1. **PDF Processing**: Complex layouts may not extract perfectly
2. **YouTube**: Requires captions to be available
3. **Large Files**: Files > 10MB may be slow to process
4. **Ollama Dependency**: Requires local Ollama installation
5. **Storage**: LocalStorage has 5-10MB limit per domain

### Issues to Fix
- [ ] PDF.js worker configuration
- [ ] Better error messages for failed uploads
- [ ] Progress indicators for long operations
- [ ] Retry logic for failed API calls
- [ ] Batch operations for multiple files

## Performance Benchmarks

### Target Performance Metrics
- Page load: < 2 seconds
- PDF extraction (10 pages): < 5 seconds
- Website extraction: < 10 seconds
- YouTube transcript: < 15 seconds
- Chat response: < 3 seconds (streaming)
- Search query: < 1 second
- Podcast generation: < 30 seconds

### Memory Usage Targets
- Idle: < 100MB
- With 5 sources: < 250MB
- With 20 sources: < 500MB

## Continuous Integration

### Automated Test Pipeline
\\\yaml
# .github/workflows/test.yml
name: Test Suite
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm test -- --coverage
      - run: npm run lint
\\\

## Reporting Issues

### Bug Report Template
- **Description**: What went wrong?
- **Steps to Reproduce**: How to recreate the issue?
- **Expected Behavior**: What should happen?
- **Actual Behavior**: What actually happened?
- **Environment**: Browser, OS, Ollama version
- **Screenshots**: If applicable

## Contributing Tests

### Adding New Tests
1. Create test file in \	ests/\ directory
2. Follow existing test structure
3. Use descriptive test names
4. Include setup and teardown
5. Mock external dependencies
6. Run tests locally before committing

### Test Guidelines
- One assertion per test (when possible)
- Use \describe\ blocks for grouping
- Use \eforeEach\ for setup
- Use \fterEach\ for cleanup
- Mock external services
- Test edge cases
- Test error conditions

## Next Steps

1. **Run Initial Test Suite**
   \\\ash
   npm test
   \\\

2. **Review Coverage Report**
   \\\ash
   npm test -- --coverage
   \\\

3. **Fix Failing Tests**
   - Identify root causes
   - Update implementation
   - Re-run tests

4. **Add Missing Tests**
   - Identify untested code paths
   - Write comprehensive tests
   - Achieve > 80% coverage

5. **Setup CI/CD**
   - Configure GitHub Actions
   - Add automated testing
   - Setup coverage reporting

---

**Last Updated**: 2025-11-27
**Test Coverage Target**: 80%+
**Status**: Test suite created, ready for execution
