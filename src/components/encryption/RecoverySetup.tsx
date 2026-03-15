/**
 * Recovery Setup Component
 * 
 * Guides users through setting up recovery options:
 * - Recovery key backup
 * - Backup phrase generation
 * - Email recovery (optional)
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Copy, Check, Download, Key, FileText, Mail } from 'lucide-react';
import { generateRecoveryKey } from '@/lib/recovery/recoveryKey';
import { generateBackupPhrase } from '@/lib/recovery/backupPhrase';
import { setupEmailRecovery } from '@/lib/recovery/emailRecovery';
import { UI_DELAYS } from '@/lib/constants';

interface RecoverySetupProps {
  onComplete?: () => void;
  onSkip?: () => void;
}

export function RecoverySetup({ onComplete, onSkip }: RecoverySetupProps) {
  const [step, setStep] = useState<'recovery-key' | 'backup-phrase' | 'email'>('recovery-key');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [backupPhrase, setBackupPhrase] = useState('');
  const [email, setEmail] = useState('');
  
  const [recoveryKeyCopied, setRecoveryKeyCopied] = useState(false);
  const [recoveryKeyConfirmed, setRecoveryKeyConfirmed] = useState(false);
  const [backupPhraseCopied, setBackupPhraseCopied] = useState(false);
  const [backupPhraseConfirmed, setBackupPhraseConfirmed] = useState(false);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate recovery key on mount
  useEffect(() => {
    const key = generateRecoveryKey();
    setRecoveryKey(key);
  }, []);

  const handleCopyRecoveryKey = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setRecoveryKeyCopied(true);
      setTimeout(() => setRecoveryKeyCopied(false), UI_DELAYS.COPIED_FEEDBACK);
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  const handleDownloadRecoveryKey = () => {
    const blob = new Blob([`StudyPodLM Recovery Key\n\n${recoveryKey}\n\nKeep this safe! You'll need it to recover your account.`], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'studylm-recovery-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRecoveryKeyNext = () => {
    if (!recoveryKeyConfirmed) {
      setError('Please confirm you have saved your recovery key');
      return;
    }
    
    // Generate backup phrase for next step
    const phrase = generateBackupPhrase();
    setBackupPhrase(phrase);
    setStep('backup-phrase');
    setError(null);
  };

  const handleCopyBackupPhrase = async () => {
    try {
      await navigator.clipboard.writeText(backupPhrase);
      setBackupPhraseCopied(true);
      setTimeout(() => setBackupPhraseCopied(false), UI_DELAYS.COPIED_FEEDBACK);
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  const handleDownloadBackupPhrase = () => {
    const blob = new Blob([`StudyPodLM Backup Phrase\n\n${backupPhrase}\n\nKeep this safe! You'll need it to recover your account.`], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'studylm-backup-phrase.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBackupPhraseNext = () => {
    if (!backupPhraseConfirmed) {
      setError('Please confirm you have saved your backup phrase');
      return;
    }
    
    setStep('email');
    setError(null);
  };

  const handleEmailSetup = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      if (email) {
        await setupEmailRecovery(email, ''); // Pass empty string for userId
      }
      
      // Store recovery options
      localStorage.setItem('recovery_key_hash', recoveryKey); // Should be hashed in production
      localStorage.setItem('backup_phrase_hash', backupPhrase); // Should be hashed in production
      if (email) {
        localStorage.setItem('email_recovery_enabled', 'true');
        localStorage.setItem('recovery_email', email);
      }

      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to setup recovery');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">Setup Account Recovery</h2>
        <p className="text-sm text-muted-foreground">
          Save these recovery options to prevent losing access to your data
        </p>
      </div>

      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
          step === 'recovery-key' ? 'bg-primary text-primary-foreground' : 'bg-muted'
        }`}>
          <Key className="w-4 h-4" />
        </div>
        <div className="w-12 h-0.5 bg-muted" />
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
          step === 'backup-phrase' ? 'bg-primary text-primary-foreground' : 'bg-muted'
        }`}>
          <FileText className="w-4 h-4" />
        </div>
        <div className="w-12 h-0.5 bg-muted" />
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
          step === 'email' ? 'bg-primary text-primary-foreground' : 'bg-muted'
        }`}>
          <Mail className="w-4 h-4" />
        </div>
      </div>

      {step === 'recovery-key' && (
        <div className="space-y-4">
          <Alert>
            <AlertDescription>
              This recovery key is shown only once. Save it in a secure location.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>Your Recovery Key</Label>
            <div className="p-4 bg-muted rounded-lg font-mono text-sm break-all">
              {recoveryKey}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleCopyRecoveryKey}
            >
              {recoveryKeyCopied ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleDownloadRecoveryKey}
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>

          <div className="flex items-start space-x-2">
            <Checkbox
              id="recovery-key-confirm"
              checked={recoveryKeyConfirmed}
              onCheckedChange={(checked) => setRecoveryKeyConfirmed(checked as boolean)}
            />
            <label
              htmlFor="recovery-key-confirm"
              className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              I have saved my recovery key in a secure location
            </label>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="button"
            className="w-full"
            onClick={handleRecoveryKeyNext}
            disabled={!recoveryKeyConfirmed}
          >
            Continue
          </Button>
        </div>
      )}

      {step === 'backup-phrase' && (
        <div className="space-y-4">
          <Alert>
            <AlertDescription>
              This 12-word phrase is an alternative way to recover your account.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>Your Backup Phrase</Label>
            <div className="p-4 bg-muted rounded-lg">
              <div className="grid grid-cols-3 gap-2">
                {backupPhrase.split(' ').map((word, index) => (
                  <div key={index} className="text-sm">
                    <span className="text-muted-foreground">{index + 1}.</span> {word}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleCopyBackupPhrase}
            >
              {backupPhraseCopied ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleDownloadBackupPhrase}
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>

          <div className="flex items-start space-x-2">
            <Checkbox
              id="backup-phrase-confirm"
              checked={backupPhraseConfirmed}
              onCheckedChange={(checked) => setBackupPhraseConfirmed(checked as boolean)}
            />
            <label
              htmlFor="backup-phrase-confirm"
              className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              I have saved my backup phrase in a secure location
            </label>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep('recovery-key')}
            >
              Back
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={handleBackupPhraseNext}
              disabled={!backupPhraseConfirmed}
            >
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 'email' && (
        <div className="space-y-4">
          <Alert>
            <AlertDescription>
              Optionally add an email for recovery. This is not required.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="email">Email Address (Optional)</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              disabled={isProcessing}
            />
            <p className="text-xs text-muted-foreground">
              We'll send recovery codes to this email if you lose access
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep('backup-phrase')}
              disabled={isProcessing}
            >
              Back
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={handleEmailSetup}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Setting up...
                </>
              ) : (
                'Complete Setup'
              )}
            </Button>
          </div>

          {onSkip && (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={onSkip}
              disabled={isProcessing}
            >
              Skip email recovery
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
