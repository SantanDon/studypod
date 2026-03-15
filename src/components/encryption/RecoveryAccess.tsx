/**
 * Recovery Access Component
 * 
 * Allows users to recover account access using:
 * - Recovery key
 * - Backup phrase
 * - Email recovery (if configured)
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Key, FileText, Mail } from 'lucide-react';
import { verifyRecoveryKey } from '@/lib/recovery/recoveryKey';
import { verifyBackupPhrase } from '@/lib/recovery/backupPhrase';
import { recoverWithEmail } from '@/lib/recovery/emailRecovery';

interface RecoveryAccessProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function RecoveryAccess({ onSuccess, onCancel }: RecoveryAccessProps) {
  const [activeTab, setActiveTab] = useState('recovery-key');
  const [isRecovering, setIsRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Recovery key state
  const [recoveryKey, setRecoveryKey] = useState('');

  // Backup phrase state
  const [backupPhrase, setBackupPhrase] = useState('');

  // Email recovery state
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  const handleRecoveryKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsRecovering(true);

    try {
      const isValid = await verifyRecoveryKey(recoveryKey);
      if (!isValid) {
        throw new Error('Invalid recovery key');
      }

      setSuccess('Recovery key verified! You can now set a new passphrase.');
      setTimeout(() => onSuccess?.(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recovery failed');
    } finally {
      setIsRecovering(false);
    }
  };

  const handleBackupPhraseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsRecovering(true);

    try {
      const isValid = await verifyBackupPhrase(backupPhrase);
      if (!isValid) {
        throw new Error('Invalid backup phrase');
      }

      setSuccess('Backup phrase verified! You can now set a new passphrase.');
      setTimeout(() => onSuccess?.(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recovery failed');
    } finally {
      setIsRecovering(false);
    }
  };

  const handleEmailRecoveryRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsRecovering(true);

    try {
      // Check if email recovery is configured
      const emailRecoveryEnabled = localStorage.getItem('email_recovery_enabled');
      if (!emailRecoveryEnabled) {
        throw new Error('Email recovery not configured for this account');
      }

      // Send recovery email
      await recoverWithEmail(email);
      setEmailSent(true);
      setSuccess('Recovery code sent to your email');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send recovery email');
    } finally {
      setIsRecovering(false);
    }
  };

  const handleEmailRecoveryVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsRecovering(true);

    try {
      // Verify recovery code
      const storedCode = localStorage.getItem('email_recovery_code');
      if (storedCode !== recoveryCode) {
        throw new Error('Invalid recovery code');
      }

      setSuccess('Email verified! You can now set a new passphrase.');
      setTimeout(() => onSuccess?.(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setIsRecovering(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">Recover Your Account</h2>
        <p className="text-sm text-muted-foreground">
          Use one of your recovery methods to regain access
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="recovery-key">
            <Key className="w-4 h-4 mr-2" />
            Key
          </TabsTrigger>
          <TabsTrigger value="backup-phrase">
            <FileText className="w-4 h-4 mr-2" />
            Phrase
          </TabsTrigger>
          <TabsTrigger value="email">
            <Mail className="w-4 h-4 mr-2" />
            Email
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recovery-key" className="space-y-4">
          <form onSubmit={handleRecoveryKeySubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recovery-key">Recovery Key</Label>
              <Input
                id="recovery-key"
                type="text"
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value)}
                placeholder="Enter your 64-character recovery key"
                disabled={isRecovering}
                maxLength={64}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                This is the 64-character key shown when you created your account
              </p>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isRecovering || recoveryKey.length !== 64}
            >
              {isRecovering ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Verify Recovery Key'
              )}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="backup-phrase" className="space-y-4">
          <form onSubmit={handleBackupPhraseSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="backup-phrase">Backup Phrase</Label>
              <Input
                id="backup-phrase"
                type="text"
                value={backupPhrase}
                onChange={(e) => setBackupPhrase(e.target.value)}
                placeholder="Enter your 12-word backup phrase"
                disabled={isRecovering}
              />
              <p className="text-xs text-muted-foreground">
                Enter the 12 words separated by spaces
              </p>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isRecovering || !backupPhrase}
            >
              {isRecovering ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Verify Backup Phrase'
              )}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="email" className="space-y-4">
          {!emailSent ? (
            <form onSubmit={handleEmailRecoveryRequest} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your recovery email"
                  disabled={isRecovering}
                />
                <p className="text-xs text-muted-foreground">
                  We'll send a recovery code to this email
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isRecovering || !email}
              >
                {isRecovering ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Send Recovery Code'
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleEmailRecoveryVerify} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="recovery-code">Recovery Code</Label>
                <Input
                  id="recovery-code"
                  type="text"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  placeholder="Enter the 6-digit code"
                  disabled={isRecovering}
                  maxLength={6}
                />
                <p className="text-xs text-muted-foreground">
                  Check your email for the recovery code
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isRecovering || recoveryCode.length !== 6}
              >
                {isRecovering ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify Code'
                )}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setEmailSent(false)}
                disabled={isRecovering}
              >
                Use a different email
              </Button>
            </form>
          )}
        </TabsContent>
      </Tabs>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <AlertDescription className="text-green-600">{success}</AlertDescription>
        </Alert>
      )}

      {onCancel && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={onCancel}
          disabled={isRecovering}
        >
          Back to Login
        </Button>
      )}
    </div>
  );
}
