/**
 * Account Creation Component
 * 
 * Allows users to create encrypted account with PIN/passphrase.
 * Generates and displays recovery key for backup.
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle, Copy, Eye, EyeOff } from 'lucide-react';
import { generateKeyFromPassphrase, exportSalt } from '@/lib/encryption/keyDerivation';
import { generateRecoveryKey, formatRecoveryKey, storeRecoveryKeyHash, hashRecoveryKey } from '@/lib/recovery/recoveryKey';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { UserStorage, setCurrentUserId } from '@/lib/encryption/userStorage';
import { encrypt } from '@/lib/encryption/encryption';

export default function AccountCreation() {
  const [step, setStep] = useState<'passphrase' | 'recovery' | 'confirm'>('passphrase');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const { toast } = useToast();
  const navigate = useNavigate();
  const { setMasterKey } = useEncryptionStore();

  const validatePassphrase = (): string | null => {
    if (passphrase.length < 8) {
      return 'Passphrase must be at least 8 characters';
    }
    if (passphrase !== confirmPassphrase) {
      return 'Passphrases do not match';
    }
    return null;
  };

  const handleCreateAccount = async () => {
    const error = validatePassphrase();
    if (error) {
      toast({
        title: 'Invalid Passphrase',
        description: error,
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Generate encryption key
      const { key, salt } = await generateKeyFromPassphrase(passphrase);
      
      // Generate recovery key
      const newRecoveryKey = generateRecoveryKey();
      setRecoveryKey(newRecoveryKey);
      
      // Create user ID
      const userId = crypto.randomUUID();
      
      // Create user-namespaced storage
      const storage = new UserStorage(userId);
      
      // Store encryption salt with user namespace
      storage.set('encryption_salt', exportSalt(salt));
      
      // Store account creation timestamp
      storage.set('created_at', new Date().toISOString());
      
      // Store a test encrypted value to verify passphrase later
      const testData = await encrypt('test', key);
      storage.set('encryption_test', JSON.stringify(testData));
      
      // Store recovery key hash with user namespace
      const hash = await hashRecoveryKey(newRecoveryKey);
      storeRecoveryKeyHash(userId, hash);
      
      // Set current user as global pointer
      setCurrentUserId(userId);
      
      // Set encryption key in store
      setMasterKey(key, salt, userId);
      
      // Move to recovery key display
      setStep('recovery');
    } catch (error) {
      toast({
        title: 'Account Creation Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const copyRecoveryKey = () => {
    navigator.clipboard.writeText(recoveryKey);
    toast({
      title: 'Copied!',
      description: 'Recovery key copied to clipboard',
    });
  };

  const handleConfirmRecovery = () => {
    if (!recoveryConfirmed) {
      toast({
        title: 'Confirmation Required',
        description: 'Please confirm you have saved your recovery key',
        variant: 'destructive',
      });
      return;
    }
    
    // Navigate to dashboard
    navigate('/');
    toast({
      title: 'Account Created!',
      description: 'Your encrypted account is ready to use',
    });
  };

  if (step === 'passphrase') {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle>Create Encrypted Account</CardTitle>
          <CardDescription>
            Choose a strong passphrase to protect your data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your passphrase encrypts all your data. Without it or your recovery key, your data cannot be accessed.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="passphrase">Passphrase</Label>
            <div className="relative">
              <Input
                id="passphrase"
                type={showPassphrase ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter a strong passphrase"
                minLength={8}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowPassphrase(!showPassphrase)}
              >
                {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm Passphrase</Label>
            <Input
              id="confirm"
              type={showPassphrase ? 'text' : 'password'}
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              placeholder="Re-enter your passphrase"
              minLength={8}
            />
          </div>

          <Button
            onClick={handleCreateAccount}
            disabled={loading || !passphrase || !confirmPassphrase}
            className="w-full"
          >
            {loading ? 'Creating Account...' : 'Create Account'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (step === 'recovery') {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle>Save Your Recovery Key</CardTitle>
          <CardDescription>
            This key allows you to recover your account if you forget your passphrase
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              This recovery key will only be shown once. Save it in a secure location!
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>Recovery Key</Label>
            <div className="p-4 bg-muted rounded-md font-mono text-sm break-all">
              {formatRecoveryKey(recoveryKey)}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={copyRecoveryKey}
              className="w-full"
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy Recovery Key
            </Button>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="confirm-saved"
              checked={recoveryConfirmed}
              onChange={(e) => setRecoveryConfirmed(e.target.checked)}
              className="rounded"
            />
            <Label htmlFor="confirm-saved" className="text-sm cursor-pointer">
              I have saved my recovery key in a secure location
            </Label>
          </div>

          <Button
            onClick={handleConfirmRecovery}
            disabled={!recoveryConfirmed}
            className="w-full"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Continue to Dashboard
          </Button>
        </CardContent>
      </Card>
    );
  }

  return null;
}
