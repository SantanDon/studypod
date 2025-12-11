/**
 * TTS Provider Settings Component
 * Configure Ultimate TTS Studio or Web Speech API for podcast generation
 */

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  getTTSConfig,
  saveTTSConfig,
  TTSConfig,
} from '@/lib/tts/ttsService';
import {
  getPodcastAudioConfig,
  savePodcastAudioConfig,
  PodcastAudioConfig,
  PodcastAudioGenerator,
} from '@/lib/tts/podcastAudioGenerator';
import { KOKORO_VOICES } from '@/lib/tts/kokoroTTSProvider';

interface TTSProviderSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

interface VoiceOption {
  id: string;
  name: string;
  gender?: string;
}

const TTSProviderSettings: React.FC<TTSProviderSettingsProps> = ({
  isOpen,
  onClose,
}) => {
  const { toast } = useToast();
  const [ttsConfig, setTTSConfig] = useState<TTSConfig>(getTTSConfig());
  const [audioConfig, setAudioConfig] = useState<PodcastAudioConfig>(getPodcastAudioConfig());
  const [isChecking, setIsChecking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown');
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const config = getTTSConfig();
      setTTSConfig(config);
      setAudioConfig(getPodcastAudioConfig());
      // Only check connection if provider is ultimate-tts
      if (config.provider === 'ultimate-tts') {
        checkConnection();
      } else {
        setConnectionStatus('unknown');
      }
    }
  }, [isOpen]);

  const checkConnection = async () => {
    // Only check if provider is ultimate-tts
    if (ttsConfig.provider !== 'ultimate-tts') {
      setConnectionStatus('unknown');
      return;
    }
    
    setIsChecking(true);
    try {
      const isAvailable = await PodcastAudioGenerator.checkEndpoint(ttsConfig.endpoint);
      setConnectionStatus(isAvailable ? 'connected' : 'disconnected');
      
      if (isAvailable) {
        loadVoices();
      }
    } catch {
      setConnectionStatus('disconnected');
    } finally {
      setIsChecking(false);
    }
  };

  const loadVoices = async () => {
    setIsLoadingVoices(true);
    try {
      const generator = new PodcastAudioGenerator();
      await generator.initialize();
      const availableVoices = await generator.getAvailableVoices();
      setVoices(availableVoices);
    } catch (error) {
      console.error('Failed to load voices:', error);
    } finally {
      setIsLoadingVoices(false);
    }
  };

  const handleEndpointChange = (endpoint: string) => {
    setTTSConfig(prev => ({ ...prev, endpoint }));
    setConnectionStatus('unknown');
  };

  const handleTestConnection = async () => {
    setIsChecking(true);
    try {
      const isAvailable = await PodcastAudioGenerator.checkEndpoint(ttsConfig.endpoint);
      setConnectionStatus(isAvailable ? 'connected' : 'disconnected');
      
      if (isAvailable) {
        toast({
          title: '✅ Connected!',
          description: 'Ultimate TTS Studio is available.',
        });
        loadVoices();
      } else {
        toast({
          title: '❌ Connection Failed',
          description: 'Could not connect to Ultimate TTS Studio. Make sure it\'s running.',
          variant: 'destructive',
        });
      }
    } catch {
      setConnectionStatus('disconnected');
      toast({
        title: '❌ Connection Error',
        description: 'Failed to connect. Check the endpoint URL.',
        variant: 'destructive',
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleSave = () => {
    saveTTSConfig(ttsConfig);
    savePodcastAudioConfig(audioConfig);
    toast({
      title: 'Settings Saved',
      description: 'TTS settings have been updated.',
    });
    onClose();
  };

  const handleProviderChange = (provider: TTSConfig['provider']) => {
    setTTSConfig(prev => ({ ...prev, provider }));
    if (provider === 'kokoro' || provider === 'web-speech') {
      setConnectionStatus('connected');
      if (provider === 'kokoro') {
        loadVoices(); // Load Kokoro voices
      }
    } else {
      setConnectionStatus('unknown');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <i className="fi fi-rr-microphone-alt h-5 w-5"></i>
            Podcast Audio Settings
          </DialogTitle>
          <DialogDescription>
            Configure text-to-speech for high-quality podcast generation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Provider Selection */}
          <div className="space-y-2">
            <Label>TTS Provider</Label>
            <Select
              value={ttsConfig.provider}
              onValueChange={(v) => handleProviderChange(v as TTSConfig['provider'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kokoro">
                  <div className="flex items-center gap-2">
                    <span>🎙️ Kokoro TTS</span>
                    <span className="text-xs text-green-600">(Recommended - High Quality)</span>
                  </div>
                </SelectItem>
                <SelectItem value="ultimate-tts">
                  <div className="flex items-center gap-2">
                    <span>🔧 Ultimate TTS Studio</span>
                    <span className="text-xs text-gray-500">(Local Server)</span>
                  </div>
                </SelectItem>
                <SelectItem value="web-speech">
                  <div className="flex items-center gap-2">
                    <span>🔊 Web Speech API</span>
                    <span className="text-xs text-gray-500">(Browser Fallback)</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Kokoro TTS Info */}
          {ttsConfig.provider === 'kokoro' && (
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
                <i className="fi fi-rr-check-circle"></i>
                Ready to Use - No Setup Required!
              </div>
              <p className="text-sm text-green-600">
                Kokoro TTS runs directly in your browser using AI. The first generation 
                may take a moment to load the model (~80MB), then it's fast!
              </p>
              <p className="text-xs text-green-500 mt-2">
                ✨ High-quality voices • 🔒 100% private • 💰 Completely free
              </p>
            </div>
          )}

          {/* Ultimate TTS Studio Settings */}
          {ttsConfig.provider === 'ultimate-tts' && (
            <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
              <div className="space-y-2">
                <Label>Ultimate TTS Studio Endpoint</Label>
                <div className="flex gap-2">
                  <Input
                    value={ttsConfig.endpoint}
                    onChange={(e) => handleEndpointChange(e.target.value)}
                    placeholder="http://localhost:7860"
                  />
                  <Button
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={isChecking}
                  >
                    {isChecking ? (
                      <i className="fi fi-rr-spinner animate-spin h-4 w-4"></i>
                    ) : (
                      'Test'
                    )}
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {connectionStatus === 'connected' && (
                    <span className="text-green-600 flex items-center gap-1">
                      <i className="fi fi-rr-check-circle h-4 w-4"></i>
                      Connected
                    </span>
                  )}
                  {connectionStatus === 'disconnected' && (
                    <span className="text-red-600 flex items-center gap-1">
                      <i className="fi fi-rr-cross-circle h-4 w-4"></i>
                      Not Connected
                    </span>
                  )}
                  {connectionStatus === 'unknown' && (
                    <span className="text-gray-500">Click Test to check connection</span>
                  )}
                </div>
              </div>

              <div className="text-xs text-gray-500 space-y-1">
                <p>💡 <strong>Setup Instructions:</strong></p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Install <a href="https://pinokio.computer" target="_blank" rel="noopener" className="text-blue-600 hover:underline">Pinokio</a></li>
                  <li>Search for "Ultimate TTS Studio" and install it</li>
                  <li>Start the server (usually runs on port 7860)</li>
                  <li>Click "Test" above to verify connection</li>
                </ol>
              </div>
            </div>
          )}

          {/* Voice Selection */}
          <div className="space-y-4">
            <Label className="text-base font-medium">Voice Settings</Label>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm">Host 1 Voice (Main Host)</Label>
                <Select
                  value={audioConfig.host1Voice}
                  onValueChange={(v) => setAudioConfig(prev => ({ ...prev, host1Voice: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {ttsConfig.provider === 'kokoro' ? (
                      <>
                        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">Male Voices</div>
                        {Object.entries(KOKORO_VOICES)
                          .filter(([_, v]) => v.gender === 'male')
                          .map(([id, voice]) => (
                            <SelectItem key={id} value={id}>{voice.name}</SelectItem>
                          ))}
                        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 mt-2">Female Voices</div>
                        {Object.entries(KOKORO_VOICES)
                          .filter(([_, v]) => v.gender === 'female')
                          .map(([id, voice]) => (
                            <SelectItem key={id} value={id}>{voice.name}</SelectItem>
                          ))}
                      </>
                    ) : voices.length > 0 ? (
                      voices.map((voice) => (
                        <SelectItem key={voice.id} value={voice.id}>{voice.name}</SelectItem>
                      ))
                    ) : (
                      <>
                        <SelectItem value="male_1">Male Voice 1</SelectItem>
                        <SelectItem value="male_2">Male Voice 2</SelectItem>
                        <SelectItem value="default">Default</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Host 2 Voice (Co-Host)</Label>
                <Select
                  value={audioConfig.host2Voice}
                  onValueChange={(v) => setAudioConfig(prev => ({ ...prev, host2Voice: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {ttsConfig.provider === 'kokoro' ? (
                      <>
                        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">Female Voices</div>
                        {Object.entries(KOKORO_VOICES)
                          .filter(([_, v]) => v.gender === 'female')
                          .map(([id, voice]) => (
                            <SelectItem key={id} value={id}>{voice.name}</SelectItem>
                          ))}
                        <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 mt-2">Male Voices</div>
                        {Object.entries(KOKORO_VOICES)
                          .filter(([_, v]) => v.gender === 'male')
                          .map(([id, voice]) => (
                            <SelectItem key={id} value={id}>{voice.name}</SelectItem>
                          ))}
                      </>
                    ) : voices.length > 0 ? (
                      voices.map((voice) => (
                        <SelectItem key={voice.id} value={voice.id}>{voice.name}</SelectItem>
                      ))
                    ) : (
                      <>
                        <SelectItem value="female_1">Female Voice 1</SelectItem>
                        <SelectItem value="female_2">Female Voice 2</SelectItem>
                        <SelectItem value="default">Default</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Speed Control */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Speech Speed</Label>
              <span className="text-sm text-gray-500">{audioConfig.speed.toFixed(1)}x</span>
            </div>
            <Slider
              value={[audioConfig.speed]}
              onValueChange={([value]) => setAudioConfig(prev => ({ ...prev, speed: value }))}
              min={0.5}
              max={2.0}
              step={0.1}
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>Slower</span>
              <span>Faster</span>
            </div>
          </div>

          {/* Pause Between Segments */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Pause Between Speakers</Label>
              <span className="text-sm text-gray-500">{audioConfig.pauseBetweenSegments}ms</span>
            </div>
            <Slider
              value={[audioConfig.pauseBetweenSegments]}
              onValueChange={([value]) => setAudioConfig(prev => ({ ...prev, pauseBetweenSegments: value }))}
              min={0}
              max={2000}
              step={100}
            />
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              Save Settings
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TTSProviderSettings;
