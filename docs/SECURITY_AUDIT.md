# StudyPodLM Security & Privacy Audit + Signed-In User Experience Plan

## Current Security & Privacy Holes

### Critical Issues

1. **Plaintext Password Storage in localStorage**
   - Location: `localStorageService.ts` lines 198-213
   - Issue: Passwords are SHA-256 hashed but stored in localStorage which is:
     - Accessible to any JavaScript on the page (XSS vulnerability)
     - Not encrypted at rest
     - Accessible to browser extensions
     - Persisted to disk unencrypted
   - Risk: If a user has malware or a malicious browser extension, passwords can be extracted

2. **No Password Strength Requirements**
   - No validation on password complexity
   - Users can use "123456" or "password"
   - No rate limiting on auth attempts

3. **Session Token Vulnerability**
   - Location: `client.ts` lines 47-52
   - Issue: Tokens are simple timestamps, not cryptographically secure
   - No JWT validation or expiration checking
   - `access_token: 'local-token-' + Date.now()` is easily guessable

4. **XSS Vulnerabilities in Content Rendering**
   - MarkdownRenderer likely doesn't sanitize HTML
   - User-uploaded content can contain malicious scripts
   - No Content Security Policy (CSP) headers

5. **No Data Encryption**
   - All notebooks, sources, messages stored as plaintext JSON
   - If computer is stolen/compromised, all data is readable
   - No encryption at rest or in transit for local storage

6. **Browser Extension Access**
   - Any browser extension can read localStorage
   - Malicious extensions can steal all user data

### Medium Issues

7. **No Email Verification**
   - Users can sign up with any email (even fake ones)
   - No verification flow means password resets are impossible
   - Account takeover risk if someone typos an email

8. **Guest Data Not Isolated**
   - Guest and authenticated data share same storage keys
   - Potential for data leakage between modes

9. **No Audit Logging**
   - Can't detect suspicious activity
   - No way to know if account was compromised

10. **CORS Issues**
    - API routes may not have strict CORS policies
    - `Access-Control-Allow-Origin: *` on some endpoints

## Privacy-First Signed-In User Experience

### Core Philosophy
- **Zero-knowledge architecture**: We can't read user data even if we wanted to
- **End-to-end encryption**: Data encrypted in browser before storage
- **No tracking**: No analytics, no cookies, no fingerprinting
- **Data sovereignty**: User owns their data completely

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    STUDYLM ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐     ┌──────────────┐                     │
│  │   Browser    │────▶│   Encryption │  (Client-side)      │
│  │   (React)    │◀────│   (AES-GCM)  │                     │
│  └──────────────┘     └──────────────┘                     │
│         │                       │                           │
│         ▼                       ▼                           │
│  ┌──────────────┐     ┌──────────────┐                     │
│  │  localStorage│     │  IndexedDB   │  (Encrypted)        │
│  │  (Metadata)  │     │  (Content)   │                     │
│  └──────────────┘     └──────────────┘                     │
│                                                             │
│  Optional: Encrypted backup to user's cloud (iCloud/Drive) │
└─────────────────────────────────────────────────────────────┘
```

### Signed-In User Features (Privacy-Preserving)

#### 1. **Enhanced AI Models**
- Signed-in users get priority access to larger context windows
- Use Ollama locally for privacy, or user-provided API keys
- No AI calls go through our servers

#### 2. **Cross-Device Sync (E2E Encrypted)**
- Export encrypted data package
- Import on another device with same password
- QR code transfer for mobile

#### 3. **Advanced Studio Features**
```typescript
// Signed-in user capabilities
interface PremiumFeatures {
  // From PaperDebugger concepts:
  academicWriting: {
    citationManager: boolean;      // Auto-citation in academic formats
    plagiarismCheck: boolean;      // Local similarity analysis
    peerReviewMode: boolean;       // AI reviewer persona
  };
  
  // Enhanced processing:
  parallelProcessing: boolean;     // Process multiple sources simultaneously
  largerFileUploads: boolean;      // Up to 100MB vs 10MB for guests
  priorityQueue: boolean;          // Skip processing queue
  
  // Organization:
  folders: boolean;                // Organize notebooks into folders
  tags: boolean;                   // Tag-based organization
  search: boolean;                 // Full-text search across all notebooks
  
  // Export options:
  exportFormats: ['pdf', 'docx', 'markdown', 'latex', 'epub'];
}
```

#### 4. **Academic Writing Assistant (PaperDebugger-style)**
Multi-agent system for writing:
- **Research Agent**: Finds gaps in sources, suggests additional papers
- **Reviewer Agent**: Provides peer-review style feedback
- **Editor Agent**: Suggests improvements to writing
- **Citation Agent**: Manages and formats citations

#### 5. **Backup & Export**
- Automatic encrypted backups to user's chosen location
- Export as: PDF, Word, Markdown, LaTeX, EPUB
- Version history (stored locally)

### Email Verification Strategy

#### Option 1: Reacher (Self-Hosted) ✅ RECOMMENDED
```dockerfile
# docker-compose.reacher.yml
services:
  reacher:
    image: reacherhq/backend:latest
    ports:
      - "8080:8080"
    environment:
      - RCH_HTTP_HOST=0.0.0.0
    # Runs locally, no email leaves your server
```

Pros:
- Self-hosted = complete privacy
- No email actually sent
- Verifies if email exists without notification
- Free and open source

Cons:
- Requires port 25 open (outbound)
- Takes 1-3 seconds per check
- Some email providers block these checks

#### Option 2: Magic Links (Passwordless)
- No passwords at all
- Sign in via email link
- Similar to Medium, Slack
- Still requires email verification but more user-friendly

#### Option 3: No Verification (Current) + Better UX
- Skip email verification entirely
- Focus on data encryption instead
- Users can optionally add verification later

### Implementation Plan

#### Phase 1: Security Fixes (Priority 1)

1. **Implement Password Encryption**
```typescript
// New: encryptionService.ts
class EncryptionService {
  // Derive encryption key from password
  async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );
    
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  
  // Encrypt data before storing
  async encrypt(data: string, key: CryptoKey): Promise<EncryptedData> {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(data)
    );
    
    return {
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted))
    };
  }
}
```

2. **Migrate Storage to Encrypted**
```typescript
// Each user gets their own encryption key
// Data is encrypted before hitting localStorage
// Key is derived from password (never stored)
```

3. **Add Security Headers**
```typescript
// vite.config.ts
export default defineConfig({
  server: {
    headers: {
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
    }
  }
});
```

#### Phase 2: Signed-In Experience (Priority 2)

1. **Premium Feature Flags**
```typescript
// Check if user is signed in, enable features
const { isAuthenticated } = useAuth();
const { isGuest } = useGuest();

// In component
{isAuthenticated && <AdvancedFeatures />}
{isGuest && <UpgradePrompt feature="advanced-ai" />}
```

2. **Add Reacher for Email Verification (Optional)**
```typescript
// If user wants verification, they can self-host Reacher
// Or use our hosted instance (if we provide one)
const verifyEmail = async (email: string) => {
  const response = await fetch('/api/verify-email', {
    method: 'POST',
    body: JSON.stringify({ email })
  });
  return response.json();
};
```

3. **Implement Cross-Device Sync**
```typescript
// Export encrypted data
const exportData = async () => {
  const data = await collectAllUserData();
  const encrypted = await encryptionService.encrypt(
    JSON.stringify(data),
    userKey
  );
  downloadAsFile(encrypted, 'studylm-backup.enc');
};
```

#### Phase 3: Academic Writing Features (Priority 3)

From PaperDebugger concepts:
1. Citation manager (BibTeX, APA, MLA support)
2. Peer review mode (AI acts as reviewer)
3. Writing suggestions (style, clarity)
4. Plagiarism detection (local similarity)

### Recommended Open Source Projects to Integrate

From your stars, these would add value:

1. **alibaba/zvec** - Vector database for embeddings
   - Enable semantic search across notebooks
   - Local, fast, in-process

2. **block/goose** - AI agent framework
   - More sophisticated agent workflows
   - Could power the academic writing assistant

3. **microsoft/agent-lightning** - Agent training
   - Train custom agents for specific domains

4. **getmaxun/maxun** - Web scraping
   - Already discussed for source extraction

### What NOT to Add (Avoid Bloat)

- ❌ External analytics (Google Analytics, Mixpanel)
- ❌ Cloud sync (unless E2E encrypted and optional)
- ❌ Social features (sharing, collaboration)
- ❌ Third-party auth (Google, GitHub login)
- ❌ Push notifications
- ❌ Mobile apps (PWA is sufficient)

## Email Verification Recommendation

**My Recommendation: Skip email verification entirely**

Instead, focus on:
1. **Strong encryption** - Even if someone signs up with a fake email, their data is secure
2. **Magic links** - Passwordless auth via email (if they want to verify)
3. **Export/import** - Cross-device sync without cloud storage
4. **Optional Reacher** - For users who want email validation, provide self-hosted option

This aligns with privacy-first philosophy:
- We don't need to know if email is real
- We don't need to send emails
- Users control their own verification

## Next Steps

1. **Immediate**: Fix password hashing and add encryption
2. **This week**: Implement signed-in feature flags
3. **Next week**: Add cross-device export/import
4. **Future**: Academic writing assistant features

Would you like me to implement Phase 1 (security fixes) first?