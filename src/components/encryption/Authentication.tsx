/**
 * Authentication Component
 * 
 * Handles user authentication with PIN/passphrase
 * Derives encryption key on successful authentication
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Lock, Eye, EyeOff } from 'lucide-react';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { deriveMasterKey } from '@/lib/encryption/keyDerivation';
import { base64ToArrayBuffer } from '@/lib/encryption/utils';
import { UserStorage, getCurrentUserId } from '@/lib/encryption/userStorage';

interface AuthenticationProps {
  userId?: string; // Optional userId prop for multi-user support
  onSuccess?: () => void;
  onRecoveryClick?: () => void;
}

export function Authentication({ userId, onSuccess, onRecoveryClick }: AuthenticationProps) {
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { setMasterKey } = useEncryptionStore();

  const handleAuthenticate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!passphrase) {
      setError('Please enter your PIN or passphrase');
      return;
    }

    setIsAuthenticating(true);

    try {
      // Determine which user to authenticate
      const targetUserId = userId || getCurrentUserId();
      if (!targetUserId) {
        throw new Error('No user account found. Please create an account first.');
      }

      // Create user-namespaced storage
      const storage = new UserStorage(targetUserId);

      // Get stored salt from user-namespaced localStorage
      const storedSalt = storage.get('encryption_salt');
      if (!storedSalt) {
        throw new Error('No encryption data found for this account.');
      }

      const salt = base64ToArrayBuffer(storedSalt);

      // Derive master key from passphrase
      const masterKey = await deriveMasterKey(passphrase, new Uint8Array(salt));

      // Verify the key by attempting to decrypt a test value
      const testValue = storage.get('encryption_test');
      if (testValue) {
        try {
          const { decrypt } = await import('@/lib/encryption/encryption');
          const encryptedData = JSON.parse(testValue);
          await decrypt(encryptedData, masterKey);
        } catch {
          throw new Error('Invalid PIN or passphrase');
        }
      }

      // Store key in memory (never persisted) with userId
      setMasterKey(masterKey, new Uint8Array(salt), targetUserId);

      // Clear passphrase from memory
      setPassphrase('');

      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <div className="flex justify-center">
          <div className="p-3 bg-primary/10 rounded-full">
            <Lock className="w-8 h-8 text-primary" />
          </div>
        </div>
        <h2 className="text-2xl font-semibold">Welcome Back</h2>
        <p className="text-sm text-muted-foreground">
          Enter your PIN or passphrase to unlock your notes
        </p>
      </div>

      <form onSubmit={handleAuthenticate} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="passphrase">PIN or Passphrase</Label>
          <div className="relative">
            <Input
              id="passphrase"
              type={showPassphrase ? 'text' : 'password'}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter your PIN or passphrase"
              disabled={isAuthenticating}
              autoFocus
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassphrase(!showPassphrase)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showPassphrase ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={isAuthenticating || !passphrase}
        >
          {isAuthenticating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Unlocking...
            </>
          ) : (
            'Unlock'
          )}
        </Button>

        {onRecoveryClick && (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={onRecoveryClick}
            disabled={isAuthenticating}
          >
            Forgot your PIN or passphrase?
          </Button>
        )}
      </form>

      <div className="text-xs text-center text-muted-foreground">
        <p>Your passphrase never leaves your device</p>
        <p>All encryption happens locally in your browser</p>
      </div>
    </div>
  );
}
