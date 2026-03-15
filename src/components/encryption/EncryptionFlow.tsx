/**
 * Encryption Flow Component
 * 
 * Orchestrates the encryption setup and authentication flow.
 * Determines whether to show account creation or authentication based on existing setup.
 */

import { useState, useEffect } from 'react';
import AccountCreation from './AccountCreation';
import { Authentication } from './Authentication';
import { RecoveryAccess } from './RecoveryAccess';
import { RecoverySetup } from './RecoverySetup';
import { AccountSelector } from './AccountSelector';
import { MigrationFlow } from './MigrationFlow';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { listAllUserIds, getCurrentUserId } from '@/lib/encryption/userStorage';
import { CloudLogin } from '../auth/CloudLogin';

type FlowState = 'loading' | 'select-account' | 'create-account' | 'authenticate' | 'recovery-setup' | 'recovery-access' | 'migrate' | 'unlocked' | 'cloud-login';

interface EncryptionFlowProps {
  onUnlocked?: () => void;
  allowGuest?: boolean;
}

export function EncryptionFlow({ onUnlocked, allowGuest = true }: EncryptionFlowProps) {
  const [flowState, setFlowState] = useState<FlowState>('loading');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const { isUnlocked } = useEncryptionStore();
  const navigate = useNavigate();

  useEffect(() => {
    // Check if encryption is already set up
    const checkEncryptionSetup = () => {
      const userIds = listAllUserIds();
      const currentUserId = getCurrentUserId();

      console.log('EncryptionFlow: Checking setup', { 
        isUnlocked, 
        userIdsCount: userIds.length,
        currentUserId,
        userIds 
      });

      if (isUnlocked) {
        console.log('EncryptionFlow: User is unlocked, calling onUnlocked');
        setFlowState('unlocked');
        onUnlocked?.();
      } else if (userIds.length === 0) {
        // No accounts - show account creation
        console.log('EncryptionFlow: No accounts found, showing account creation');
        setFlowState('create-account');
      } else if (userIds.length > 1 || !currentUserId) {
        // Multiple accounts or no current user - show account selector
        console.log('EncryptionFlow: Multiple accounts or no current user, showing account selector');
        setFlowState('select-account');
      } else {
        // Single account with current user - show authentication
        console.log('EncryptionFlow: Single account, showing authentication');
        setSelectedUserId(currentUserId);
        setFlowState('authenticate');
      }
    };

    checkEncryptionSetup();
  }, [isUnlocked, onUnlocked]);

  const handleAccountSelected = (userId: string) => {
    if (userId === 'new') {
      // User wants to create a new account
      setFlowState('create-account');
    } else {
      // User selected an existing account
      setSelectedUserId(userId);
      setFlowState('authenticate');
    }
  };

  const handleAccountCreated = () => {
    // After account creation, check for legacy data
    const hasLegacyData = ['notebooks', 'sources', 'flashcards', 'settings'].some(
      key => localStorage.getItem(key) && !key.startsWith('user:')
    );
    
    if (hasLegacyData) {
      setFlowState('migrate');
    } else {
      setFlowState('unlocked');
      onUnlocked?.();
    }
  };

  const handleRecoverySetupComplete = () => {
    // After recovery setup, user is authenticated
    setFlowState('unlocked');
    onUnlocked?.();
  };

  const handleAuthenticationSuccess = () => {
    const hasLegacyData = ['notebooks', 'sources', 'flashcards', 'settings'].some(
      key => localStorage.getItem(key) && !key.startsWith('user:')
    );
    
    if (hasLegacyData) {
      setFlowState('migrate');
    } else {
      setFlowState('unlocked');
      onUnlocked?.();
    }
  };

  const handleMigrationComplete = () => {
    setFlowState('unlocked');
    onUnlocked?.();
  };

  const handleShowRecovery = () => {
    setFlowState('recovery-access');
  };

  const handleRecoverySuccess = () => {
    // After successful recovery, show authentication
    setFlowState('authenticate');
  };

  const handleRecoveryCancel = () => {
    setFlowState('authenticate');
  };

  const handleContinueAsGuest = () => {
    if (onUnlocked) {
      onUnlocked();
    } else {
      navigate('/', { replace: true });
    }
  };

  if (flowState === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (flowState === 'unlocked') {
    // User is authenticated - this component can be unmounted
    return null;
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        {flowState === 'select-account' && (
          <AccountSelector onAccountSelected={handleAccountSelected} />
        )}

        {flowState === 'create-account' && (
          <AccountCreation />
        )}

        {flowState === 'recovery-setup' && (
          <RecoverySetup onComplete={handleRecoverySetupComplete} />
        )}

        {flowState === 'authenticate' && selectedUserId && (
          <Authentication
            userId={selectedUserId}
            onSuccess={handleAuthenticationSuccess}
            onRecoveryClick={handleShowRecovery}
          />
        )}

        {flowState === 'recovery-access' && (
          <RecoveryAccess
            onSuccess={handleRecoverySuccess}
            onCancel={handleRecoveryCancel}
          />
        )}

        {flowState === 'cloud-login' && (
          <CloudLogin
            onSuccess={handleAuthenticationSuccess}
            onCancel={() => setFlowState('authenticate')}
          />
        )}

        {flowState === 'migrate' && (
          <MigrationFlow onComplete={handleMigrationComplete} />
        )}

        {allowGuest && (flowState === 'select-account' || flowState === 'create-account' || flowState === 'authenticate') && (
          <div className="text-center">
            <Button
              variant="ghost"
              onClick={handleContinueAsGuest}
              className="w-full"
            >
              Continue as Guest
            </Button>
            {flowState === 'authenticate' && (
              <Button
                variant="link"
                onClick={() => setFlowState('cloud-login')}
                className="w-full mt-2 text-blue-500"
              >
                Sign in to Cloud (Agents / Sync)
              </Button>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Limited features • Data stored locally only
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
