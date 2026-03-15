/**
 * Security Logs Component
 * 
 * Displays security-related events and allows export
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Shield,
  Download,
  Trash2,
  Key,
  Lock,
  Unlock,
  Cloud,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface SecurityEvent {
  id: string;
  type: 'auth' | 'encryption' | 'sync' | 'recovery' | 'error';
  action: string;
  timestamp: Date;
  details?: string;
  severity: 'info' | 'warning' | 'error' | 'success';
}

export function SecurityLogs() {
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [filter, setFilter] = useState<SecurityEvent['type'] | 'all'>('all');

  useEffect(() => {
    // Load security events from localStorage
    const loadEvents = () => {
      const stored = localStorage.getItem('security_logs');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setEvents(
            parsed.map((e: SecurityEvent) => ({
              ...e,
              timestamp: new Date(e.timestamp),
            }))
          );
        } catch (err) {
          console.error('Failed to load security logs:', err);
        }
      }
    };

    loadEvents();
  }, []);

  const handleExportLogs = () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      events: events.map((e) => ({
        ...e,
        timestamp: e.timestamp.toISOString(),
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studylm-security-logs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearLogs = () => {
    if (confirm('Are you sure you want to clear all security logs?')) {
      localStorage.removeItem('security_logs');
      setEvents([]);
    }
  };

  const getEventIcon = (type: SecurityEvent['type']) => {
    switch (type) {
      case 'auth':
        return <Key className="w-4 h-4" />;
      case 'encryption':
        return <Lock className="w-4 h-4" />;
      case 'sync':
        return <Cloud className="w-4 h-4" />;
      case 'recovery':
        return <Unlock className="w-4 h-4" />;
      case 'error':
        return <AlertTriangle className="w-4 h-4" />;
      default:
        return <Shield className="w-4 h-4" />;
    }
  };

  const getSeverityColor = (severity: SecurityEvent['severity']) => {
    switch (severity) {
      case 'success':
        return 'text-green-500 bg-green-500/10';
      case 'warning':
        return 'text-amber-500 bg-amber-500/10';
      case 'error':
        return 'text-red-500 bg-red-500/10';
      default:
        return 'text-blue-500 bg-blue-500/10';
    }
  };

  const filteredEvents = filter === 'all' ? events : events.filter((e) => e.type === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold mb-2">Security Logs</h3>
          <p className="text-sm text-muted-foreground">
            Track authentication, encryption, and sync events
          </p>
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleExportLogs} disabled={events.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleClearLogs}
            disabled={events.length === 0}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Clear
          </Button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        <Button
          size="sm"
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
        >
          All ({events.length})
        </Button>
        <Button
          size="sm"
          variant={filter === 'auth' ? 'default' : 'outline'}
          onClick={() => setFilter('auth')}
        >
          <Key className="w-4 h-4 mr-2" />
          Auth ({events.filter((e) => e.type === 'auth').length})
        </Button>
        <Button
          size="sm"
          variant={filter === 'encryption' ? 'default' : 'outline'}
          onClick={() => setFilter('encryption')}
        >
          <Lock className="w-4 h-4 mr-2" />
          Encryption ({events.filter((e) => e.type === 'encryption').length})
        </Button>
        <Button
          size="sm"
          variant={filter === 'sync' ? 'default' : 'outline'}
          onClick={() => setFilter('sync')}
        >
          <Cloud className="w-4 h-4 mr-2" />
          Sync ({events.filter((e) => e.type === 'sync').length})
        </Button>
        <Button
          size="sm"
          variant={filter === 'recovery' ? 'default' : 'outline'}
          onClick={() => setFilter('recovery')}
        >
          <Unlock className="w-4 h-4 mr-2" />
          Recovery ({events.filter((e) => e.type === 'recovery').length})
        </Button>
      </div>

      {/* Events List */}
      <div className="space-y-2">
        {filteredEvents.length === 0 ? (
          <Alert>
            <AlertDescription>
              No security events recorded yet. Events will appear here as you use the app.
            </AlertDescription>
          </Alert>
        ) : (
          filteredEvents.map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-3 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
            >
              <div className={`p-2 rounded-full ${getSeverityColor(event.severity)}`}>
                {getEventIcon(event.type)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{event.action}</span>
                  <Badge variant="outline" className="text-xs">
                    {event.type}
                  </Badge>
                </div>

                {event.details && (
                  <p className="text-sm text-muted-foreground mb-2">{event.details}</p>
                )}

                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(event.timestamp, { addSuffix: true })} •{' '}
                  {event.timestamp.toLocaleString()}
                </p>
              </div>

              {event.severity === 'success' && (
                <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
              )}
              {event.severity === 'error' && (
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
              )}
            </div>
          ))
        )}
      </div>

      {/* Info */}
      <Alert>
        <AlertDescription className="text-xs">
          <strong>Privacy Note:</strong> Security logs are stored locally on your device and never
          sent to any server. They help you track access to your encrypted data.
        </AlertDescription>
      </Alert>
    </div>
  );
}
