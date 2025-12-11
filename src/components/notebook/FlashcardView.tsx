import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
// import { RotateCcw, ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown, Zap, RefreshCw } from 'lucide-react'; // Removed Lucide imports
import { Flashcard } from '@/types/flashcard';
import { cn } from '@/lib/utils';

interface FlashcardViewProps {
  cards: Flashcard[];
  deckId: string;
  onReview: (deckId: string, cardId: string, quality: 0 | 1 | 2 | 3 | 4 | 5) => void;
  onClose: () => void;
  isReviewing?: boolean;
}

const FlashcardView: React.FC<FlashcardViewProps> = ({
  cards,
  deckId,
  onReview,
  onClose,
  isReviewing = false,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewedCards, setReviewedCards] = useState<Set<string>>(new Set());

  const currentCard = cards[currentIndex];
  const progress = cards.length > 0 ? ((reviewedCards.size) / cards.length) * 100 : 0;

  const handleFlip = useCallback(() => {
    setIsFlipped(prev => !prev);
  }, []);

  const handleReview = useCallback((quality: 0 | 1 | 2 | 3 | 4 | 5) => {
    if (!currentCard) return;
    
    onReview(deckId, currentCard.id, quality);
    setReviewedCards(prev => new Set(prev).add(currentCard.id));
    
    if (currentIndex < cards.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setIsFlipped(false);
    }
  }, [currentCard, currentIndex, cards.length, deckId, onReview]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      setIsFlipped(false);
    }
  }, [currentIndex]);

  const handleNext = useCallback(() => {
    if (currentIndex < cards.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setIsFlipped(false);
    }
  }, [currentIndex, cards.length]);

  const handleRestart = useCallback(() => {
    setCurrentIndex(0);
    setIsFlipped(false);
    setReviewedCards(new Set());
  }, []);

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center p-4">
        <div className="text-muted-foreground mb-4">
          <i className="fi fi-rr-bolt h-12 w-12 mx-auto"></i>
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">No cards to review</h3>
        <p className="text-sm text-muted-foreground mb-4">
          All caught up! Generate more cards or come back later.
        </p>
        <Button variant="outline" onClick={onClose}>
          Go Back
        </Button>
      </div>
    );
  }

  const isSessionComplete = reviewedCards.size === cards.length;

  if (isSessionComplete) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center p-4">
        <div className="text-green-500 dark:text-green-400 mb-4">
          <i className="fi fi-rr-thumbs-up h-12 w-12 mx-auto"></i>
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">Session Complete!</h3>
        <p className="text-sm text-muted-foreground mb-4">
          You reviewed {cards.length} card{cards.length !== 1 ? 's' : ''}.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRestart}>
            <i className="fi fi-rr-refresh h-4 w-4 mr-2"></i>
            Review Again
          </Button>
          <Button onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            Card {currentIndex + 1} of {cards.length}
          </span>
          <span className="text-sm text-muted-foreground">
            {reviewedCards.size} reviewed
          </span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      <div 
        className="flex-1 perspective-1000 cursor-pointer mb-4"
        onClick={handleFlip}
      >
        <div
          className={cn(
            "relative w-full h-full min-h-[200px] transition-transform duration-500 transform-style-preserve-3d",
            isFlipped && "rotate-y-180"
          )}
          style={{
            transformStyle: 'preserve-3d',
            transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          <Card
            className={cn(
              "absolute inset-0 p-6 flex flex-col items-center justify-center backface-hidden",
              "bg-card border-2 border-blue-200 dark:border-blue-800"
            )}
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div className="text-xs text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-2">
              Question
            </div>
            <p className="text-lg text-center text-foreground font-medium">
              {currentCard?.front}
            </p>
            <div className="mt-4 text-xs text-muted-foreground">
              Click to reveal answer
            </div>
          </Card>

          <Card
            className={cn(
              "absolute inset-0 p-6 flex flex-col items-center justify-center",
              "bg-green-50 dark:bg-green-950 border-2 border-green-200 dark:border-green-800"
            )}
            style={{ 
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            <div className="text-xs text-green-600 dark:text-green-400 uppercase tracking-wide mb-2">
              Answer
            </div>
            <p className="text-lg text-center text-foreground">
              {currentCard?.back}
            </p>
          </Card>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <Button 
          variant="ghost" 
          size="sm"
          onClick={handlePrevious}
          disabled={currentIndex === 0}
        >
          <i className="fi fi-rr-angle-left h-4 w-4 mr-1"></i>
          Previous
        </Button>
        <Button 
          variant="ghost" 
          size="sm"
          onClick={handleFlip}
        >
          <i className="fi fi-rr-rotate-left h-4 w-4 mr-1"></i>
          Flip
        </Button>
        <Button 
          variant="ghost" 
          size="sm"
          onClick={handleNext}
          disabled={currentIndex === cards.length - 1}
        >
          Next
          <i className="fi fi-rr-angle-right h-4 w-4 ml-1"></i>
        </Button>
      </div>

      {isFlipped && (
        <div className="border-t pt-4">
          <p className="text-xs text-muted-foreground text-center mb-3">
            How well did you know this?
          </p>
          <div className="grid grid-cols-4 gap-2">
            <Button 
              variant="outline" 
              size="sm"
              className="border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950 text-red-700 dark:text-red-400"
              onClick={() => handleReview(0)}
              disabled={isReviewing}
            >
              <i className="fi fi-rr-thumbs-down h-3 w-3 mr-1"></i>
              Again
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              className="border-orange-200 dark:border-orange-800 hover:bg-orange-50 dark:hover:bg-orange-950 text-orange-700 dark:text-orange-400"
              onClick={() => handleReview(2)}
              disabled={isReviewing}
            >
              Hard
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              className="border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950 text-blue-700 dark:text-blue-400"
              onClick={() => handleReview(3)}
              disabled={isReviewing}
            >
              Good
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              className="border-green-200 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-950 text-green-700 dark:text-green-400"
              onClick={() => handleReview(5)}
              disabled={isReviewing}
            >
              <i className="fi fi-rr-thumbs-up h-3 w-3 mr-1"></i>
              Easy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FlashcardView;
