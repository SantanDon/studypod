# Guest Mode Implementation

## Overview
StudyPodLM now supports **Guest Mode** - users can try the app immediately without signing up, with usage limits that encourage account creation after experiencing the value.

## User Flow

```
Landing on StudyPodLM
        ↓
   Dashboard loads
        ↓
   User can immediately:
   - Create notebooks (up to 3)
   - Add sources (up to 5 per notebook)
   - Chat with AI (up to 20 messages)
   - Generate 1 podcast
        ↓
   When limit reached →
   Friendly auth prompt
        ↓
   Sign up to unlock unlimited
```

## Guest Limits

| Feature | Guest Limit | Signed-in User |
|---------|-------------|----------------|
| Notebooks | 3 | Unlimited |
| Sources/Notebook | 5 | Unlimited |
| Messages/Notebook | 20 | Unlimited |
| Podcasts/Notebook | 1 | Unlimited |
| Flashcards/Notebook | 10 | Unlimited |
| Quizzes/Notebook | 2 | Unlimited |

## Technical Implementation

### Files Created/Modified

1. **`src/contexts/GuestContext.tsx`** - Core guest mode logic
   - Tracks usage across all features
   - Persists in localStorage
   - Provides limit-checking helpers

2. **`src/components/auth/AuthPrompt.tsx`** - Upgrade prompts
   - `AuthPromptModal` - Shown when limits hit
   - `GuestBanner` - Persistent indicator at top

3. **`src/App.tsx`** - Removed forced auth
   - Root route now accessible without login
   - GuestProvider wraps all routes

### Usage in Components

```typescript
import { useGuest, useNotebookLimits } from '@/contexts/GuestContext';

// In dashboard component
function Dashboard() {
  const { 
    isGuest, 
    canCreateNotebook, 
    remainingNotebooks,
    showAuthPrompt 
  } = useGuest();
  
  const handleCreateNotebook = () => {
    if (!canCreateNotebook) {
      showAuthPrompt('create notebook');
      return;
    }
    // Create notebook...
  };
  
  return (
    <div>
      {isGuest && <p>{remainingNotebooks} notebooks remaining</p>}
      <button onClick={handleCreateNotebook}>
        Create Notebook
      </button>
    </div>
  );
}

// In notebook component
function Notebook() {
  const { notebookId } = useParams();
  const { 
    canAddSource, 
    canSendMessage,
    sourcesRemaining,
    messagesRemaining 
  } = useNotebookLimits(notebookId);
  
  // Use these to disable inputs or show warnings
}
```

### Data Persistence

Guest data is stored in:
- `localStorage.getItem('guest_id')` - Unique guest identifier
- `localStorage.getItem('guest_mode_data')` - Usage tracking

When user signs up:
1. Guest data can be migrated (implement in `migrateToUser()`)
2. Or cleared to start fresh

### Authentication Flow

Before (forced auth):
```
User → / → ProtectedRoute → Not authenticated → /auth
```

After (guest mode):
```
User → / → Dashboard loads → Try features → Limits hit → Auth prompt → /auth
```

## Benefits

1. **Lower barrier to entry** - Try before committing
2. **Better UX** - No immediate friction
3. **Higher conversion** - Users understand value before signing up
4. **Viral potential** - Easier to share and try

## Future Enhancements

- [ ] Auto-migrate guest data on signup
- [ ] Time-based limits (e.g., 7-day trial)
- [ ] Feature previews (show locked features)
- [ ] Progress indicator toward limits
- [ ] "Upgrade to save" prompts
