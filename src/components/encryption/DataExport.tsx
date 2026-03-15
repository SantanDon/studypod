/**
 * Data Export/Import Component
 * 
 * Allows users to export their data (encrypted or decrypted)
 * and import data from backup files
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import { Loader2, Download, Upload, FileJson, Lock, LockOpen } from 'lucide-react';
import { useEncryptionStore } from '@/stores/encryptionStore';
import { encrypt } from '@/lib/encryption/encryption';
import { generateChecksum } from '@/lib/encryption/integrity';

type ExportFormat = 'encrypted' | 'decrypted';

export function DataExport() {
  const [exportFormat, setExportFormat] = useState<ExportFormat>('encrypted');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { masterKey } = useEncryptionStore();

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    setSuccess(null);
    setProgress(0);

    try {
      // Gather all data from localStorage
      const allData: Record<string, unknown> = {};
      const keys = Object.keys(localStorage);
      
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = localStorage.getItem(key);
        if (value) {
          allData[key] = value;
        }
        setProgress(((i + 1) / keys.length) * 50);
      }

      let exportData: unknown;
      let filename: string;

      if (exportFormat === 'encrypted') {
        // Export as encrypted
        if (!masterKey) {
          throw new Error('No encryption key available. Please unlock first.');
        }

        const dataString = JSON.stringify(allData);
        const encrypted = await encrypt(dataString, masterKey);
        const encryptedString = JSON.stringify(encrypted);
        const checksum = await generateChecksum(encryptedString);

        exportData = {
          version: 1,
          encrypted: true,
          data: encrypted,
          checksum,
          exportedAt: new Date().toISOString(),
        };

        filename = `studylm-backup-encrypted-${Date.now()}.json`;
      } else {
        // Export as decrypted (plain JSON)
        exportData = {
          version: 1,
          encrypted: false,
          data: allData,
          exportedAt: new Date().toISOString(),
        };

        filename = `studylm-backup-decrypted-${Date.now()}.json`;
      }

      setProgress(75);

      // Create and download file
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      setProgress(100);
      setSuccess(`Data exported successfully as ${filename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
      setTimeout(() => setProgress(0), 2000);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setError(null);
    setSuccess(null);
    setProgress(0);

    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      setProgress(25);

      // Validate import data structure
      if (!importData.version || !importData.data) {
        throw new Error('Invalid backup file format');
      }

      setProgress(50);

      if (importData.encrypted) {
        // Handle encrypted import
        if (!masterKey) {
          throw new Error('No encryption key available. Please unlock first.');
        }

        // Verify checksum if present
        if (importData.checksum) {
          const { verifyChecksum } = await import('@/lib/encryption/integrity');
          const dataString = JSON.stringify(importData.data);
          const isValid = await verifyChecksum(dataString, importData.checksum);
          if (!isValid) {
            throw new Error('Data integrity check failed. File may be corrupted.');
          }
        }

        // Decrypt data
        const { decrypt } = await import('@/lib/encryption/encryption');
        const decrypted = await decrypt(importData.data, masterKey);
        const data = JSON.parse(decrypted);

        setProgress(75);

        // Restore to localStorage
        Object.entries(data).forEach(([key, value]) => {
          localStorage.setItem(key, value as string);
        });
      } else {
        // Handle decrypted import
        setProgress(75);

        // Restore to localStorage
        Object.entries(importData.data).forEach(([key, value]) => {
          localStorage.setItem(key, value as string);
        });
      }

      setProgress(100);
      setSuccess('Data imported successfully. Please refresh the page.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
      setTimeout(() => setProgress(0), 2000);
      // Reset file input
      event.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">Export & Import Data</h3>
        <p className="text-sm text-muted-foreground">
          Backup your data or restore from a previous backup
        </p>
      </div>

      {/* Export Section */}
      <div className="space-y-4 p-4 border rounded-lg">
        <div className="flex items-center gap-2">
          <Download className="w-5 h-5" />
          <h4 className="font-medium">Export Data</h4>
        </div>

        <RadioGroup value={exportFormat} onValueChange={(v) => setExportFormat(v as ExportFormat)}>
          <div className="flex items-start space-x-2 p-3 border rounded-lg">
            <RadioGroupItem value="encrypted" id="encrypted" />
            <div className="flex-1">
              <Label htmlFor="encrypted" className="flex items-center gap-2 cursor-pointer">
                <Lock className="w-4 h-4" />
                Encrypted Export
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Recommended. Data is encrypted and can only be imported with your passphrase.
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-2 p-3 border rounded-lg">
            <RadioGroupItem value="decrypted" id="decrypted" />
            <div className="flex-1">
              <Label htmlFor="decrypted" className="flex items-center gap-2 cursor-pointer">
                <LockOpen className="w-4 h-4" />
                Decrypted Export
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Plain JSON format. Anyone with the file can read your data.
              </p>
            </div>
          </div>
        </RadioGroup>

        {isExporting && progress > 0 && (
          <div className="space-y-2">
            <Progress value={progress} />
            <p className="text-xs text-center text-muted-foreground">
              Exporting... {progress}%
            </p>
          </div>
        )}

        <Button
          onClick={handleExport}
          disabled={isExporting || isImporting}
          className="w-full"
        >
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Export Data
            </>
          )}
        </Button>
      </div>

      {/* Import Section */}
      <div className="space-y-4 p-4 border rounded-lg">
        <div className="flex items-center gap-2">
          <Upload className="w-5 h-5" />
          <h4 className="font-medium">Import Data</h4>
        </div>

        <Alert>
          <AlertDescription className="text-xs">
            <strong>Warning:</strong> Importing will overwrite your current data. Make sure to
            export your current data first if you want to keep it.
          </AlertDescription>
        </Alert>

        {isImporting && progress > 0 && (
          <div className="space-y-2">
            <Progress value={progress} />
            <p className="text-xs text-center text-muted-foreground">
              Importing... {progress}%
            </p>
          </div>
        )}

        <div>
          <input
            type="file"
            accept=".json"
            onChange={handleImport}
            disabled={isExporting || isImporting}
            className="hidden"
            id="import-file"
          />
          <Label htmlFor="import-file">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={isExporting || isImporting}
              onClick={() => document.getElementById('import-file')?.click()}
            >
              {isImporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <FileJson className="w-4 h-4 mr-2" />
                  Choose Backup File
                </>
              )}
            </Button>
          </Label>
        </div>
      </div>

      {/* Status Messages */}
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

      {/* Info */}
      <Alert>
        <AlertDescription className="text-xs">
          <strong>Backup Tips:</strong>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>Export your data regularly to prevent data loss</li>
            <li>Store encrypted backups in a secure location</li>
            <li>Keep your recovery key safe - you'll need it to restore encrypted backups</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}
