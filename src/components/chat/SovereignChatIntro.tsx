import React from 'react';
import { IMMERSIVE_PROMPTS } from '@/config/prompts';
import { ArrowUpRight } from 'lucide-react';

interface SovereignChatIntroProps {
  onPromptClick: (prompt: string) => void;
  username?: string;
}

const SovereignChatIntro: React.FC<SovereignChatIntroProps> = ({ onPromptClick, username }) => {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 pb-3 pt-3 sm:px-8 sm:pb-4 sm:pt-8" aria-label="Suggested questions">
      <div className="mb-2 sm:mb-5">
        <p className="hidden text-xs font-medium uppercase sm:block tracking-[0.18em] text-muted-foreground">Study chat</p>
        <h2 className="text-base font-semibold sm:mt-2 sm:text-2xl tracking-tight text-foreground">
          {username ? `Where should we start, ${username}?` : 'Start with your sources'}
        </h2>
        <p className="mt-2 hidden max-w-2xl sm:block text-sm leading-6 text-muted-foreground">
          Ask anything directly, or use one of these focused starting points.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {IMMERSIVE_PROMPTS.slice(0, 4).map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onPromptClick(category.prompts[0])}
            className="group flex min-h-12 items-center gap-2 sm:min-h-24 sm:items-start sm:gap-3 rounded-xl border border-border bg-card px-2.5 py-2 text-left sm:px-4 sm:py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img
              src={`${import.meta.env.BASE_URL}study-glyphs/prompt-${category.id}.webp`}
              alt=""
              width={32}
              height={32}
              className="size-6 shrink-0 object-contain sm:mt-0.5 sm:size-8"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-1 sm:gap-3 text-sm font-semibold text-foreground">
                {category.label}
                <ArrowUpRight className="hidden h-3.5 w-3.5 sm:block text-muted-foreground transition group-hover:text-primary" />
              </span>
              <span className="sr-only sm:not-sr-only sm:mt-1 sm:block text-xs leading-5 text-muted-foreground">
                {category.description}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};

export default SovereignChatIntro;
