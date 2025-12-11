import React, { useState } from 'react';
import Logo from '@/components/ui/Logo';
import MetallicText from '@/components/ui/MetallicText';
import { ProfileMenu } from '@/components/profile/ProfileMenu';
import { Button } from '@/components/ui/button';
import { useVisualEffectsStore } from '@/stores/visualEffectsStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ModelManager } from '@/components/ollama/ModelManager';

interface DashboardHeaderProps {
  userEmail?: string;
}

const DashboardHeader = ({ userEmail }: DashboardHeaderProps) => {
  const [modelManagerOpen, setModelManagerOpen] = useState(false);
  const { metallicTextEnabled, metallicTextSpeed, useCustomFonts } = useVisualEffectsStore();

  return (
    <>
      <header className="bg-background border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Logo />
            <h1 className={`text-xl font-medium text-foreground ${useCustomFonts ? 'font-heading' : ''}`}>
              <MetallicText enabled={metallicTextEnabled} speed={metallicTextSpeed}>
                StudyLM
              </MetallicText>
            </h1>
          </div>

          <div className="flex items-center space-x-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModelManagerOpen(true)}
              className="hidden sm:flex items-center gap-2"
            >
              <i className="fi fi-rr-settings-sliders h-4 w-4"></i>
              Manage Models
            </Button>
            <ProfileMenu />
          </div>
        </div>
      </header>

      <Dialog open={modelManagerOpen} onOpenChange={setModelManagerOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>AI Model Manager</DialogTitle>
          </DialogHeader>
          <ModelManager />
        </DialogContent>
      </Dialog>
    </>
  );
};

export default DashboardHeader;
