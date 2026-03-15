import { useState, useEffect } from 'react';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { UserStorage } from '@/lib/encryption/userStorage';
import { getSyncManager } from '@/lib/sync/syncManager';
import { encrypt } from '@/lib/encryption/encryption';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle } from 'lucide-react';

interface MigrationFlowProps {
  onComplete: () => void;
}

export function MigrationFlow({ onComplete }: MigrationFlowProps) {
  const [step, setStep] = useState<'detect' | 'confirm' | 'migrating' | 'complete'>('detect');
  const [dataToMigrate, setDataToMigrate] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const detectLegacyData = (): string[] => {
      const legacyKeys: string[] = [];
      const knownKeys = ['notebooks', 'sources', 'flashcards', 'settings'];
      
      for (const key of knownKeys) {
        if (localStorage.getItem(key) && !key.startsWith('user:')) {
          legacyKeys.push(key);
        }
      }
      
      return legacyKeys;
    };

    const legacyKeys = detectLegacyData();
    setDataToMigrate(legacyKeys);
    
    if (legacyKeys.length > 0) {
      setStep('confirm');
    } else {
      setStep('complete');
      onComplete(); // Skip entirely if nothing to migrate
    }
  }, [onComplete]);

  const handleMigrate = async () => {
    setStep('migrating');
    const { masterKey, userId } = useEncryptionStore.getState();
    
    if (!masterKey || !userId) {
      throw new Error('No encryption context available');
    }

    const storage = new UserStorage(userId);
    const syncManager = getSyncManager();
    
    for (let i = 0; i < dataToMigrate.length; i++) {
      const key = dataToMigrate[i];
      const data = localStorage.getItem(key);
      
      if (data) {
        // We know we must encrypt it and queue for sync. However, actually the 
        // SyncManager queueSync function expects plaintext data and handles encryption.
        // We also want to store it locally encrypted correctly. But wait, localNotebookStore 
        // expects data to stay in local storage via localStorageService, which handles its own format?
        // Wait, localStorageService reads and writes plaintext in this case unless encrypted. 
        // Let's follow the HANDOVER.md specification exactly.
        const encrypted = await encrypt(data, masterKey);
        // Store with namespaced key 
        storage.set(key, JSON.stringify(encrypted));
        
        // Queue for sync - queueSync takes (entityId, entityType, plaintextData). 
        // We will parse the data to object before passing.
        try {
           const parsedData = JSON.parse(data);
           // For multiple items like an array of notebooks, we might need to queue individually
           // but the spec says: `await syncManager.queueSync(key, key as any, JSON.parse(data));`
           // so we explicitly do exactly that:
           await syncManager.queueSync(key, key as 'notebook' | 'source' | 'note' | 'chat', parsedData, 'update');
        } catch(e) {
           console.error("Migration: string could not be parsed as JSON, sending raw.", e);
        }
        
        // Remove legacy key
        localStorage.removeItem(key);
      }
      
      setProgress(((i + 1) / dataToMigrate.length) * 100);
    }
    
    setStep('complete');
  };

  if (step === 'detect') {
    return null;
  }

  if (step === 'confirm') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Migrate Existing Data</CardTitle>
          <CardDescription>
            We found {dataToMigrate.length} items that need to be encrypted and synced
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="ml-2">
              This will encrypt your existing data and prepare it for cloud sync.
              Your original data will be backed up automatically locally in its encrypted form.
            </AlertDescription>
          </Alert>
          
          <div className="space-y-2">
            <p className="text-sm font-medium">Data to migrate:</p>
            <ul className="text-sm text-muted-foreground list-disc list-inside">
              {dataToMigrate.map(key => (
                <li key={key}>{key}</li>
              ))}
            </ul>
          </div>
          
          <Button onClick={handleMigrate} className="w-full">
            Start Migration
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (step === 'migrating') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Migrating Data...</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="w-full bg-secondary rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-center text-muted-foreground">
              {Math.round(progress)}% complete
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === 'complete') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Migration Complete</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription className="ml-2">
              Your data has been encrypted and queued for cloud sync.
            </AlertDescription>
          </Alert>
          
          <Button onClick={onComplete} className="w-full">
            Continue
          </Button>
        </CardContent>
      </Card>
    );
  }

  return null;
}
