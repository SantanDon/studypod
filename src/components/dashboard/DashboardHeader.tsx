import React from 'react';
import Logo from '@/components/ui/Logo';
import MetallicText from '@/components/ui/MetallicText';
import { ProfileMenu } from '@/components/profile/ProfileMenu';
import { useVisualEffectsStore } from '@/stores/visualEffectsStore';

interface DashboardHeaderProps {
  userEmail?: string;
}

const DashboardHeader = ({ userEmail }: DashboardHeaderProps) => {
  const { metallicTextEnabled, metallicTextSpeed, useCustomFonts } = useVisualEffectsStore();

  return (
    <header className="bg-background border-b border-border px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Logo />
          <h1 className={`text-xl font-medium text-foreground ${useCustomFonts ? 'font-heading' : ''}`}>
            <MetallicText enabled={metallicTextEnabled} speed={metallicTextSpeed}>
              StudyPodLM
            </MetallicText>
          </h1>
        </div>

        <div className="flex items-center space-x-4">
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
