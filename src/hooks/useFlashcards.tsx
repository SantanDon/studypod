import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Flashcard, FlashcardDeck, FlashcardStats } from '@/types/flashcard';
import { generateFlashcards } from '@/lib/flashcards/flashcardGenerator';
import { useStudioIdentity, studioApi, readGuestStudio, writeGuestStudio } from '@/services/studioApiService';

function calculateNextReview(card: Flashcard, quality: number): { nextReview: string; interval: number; easeFactor: number } {
  let { easeFactor, interval } = card;
  
  if (quality < 3) {
    interval = 0;
  } else {
    if (interval === 0) {
      interval = 1;
    } else if (interval === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
  }
  
  easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + interval);
  
  return {
    nextReview: nextDate.toISOString(),
    interval,
    easeFactor,
  };
}

export function useFlashcards(notebookId?: string) {
  const queryClient = useQueryClient();
  const identity = useStudioIdentity(notebookId);
  const api = studioApi(identity.token);
  const queryKey = ['flashcard-decks', identity.owner, notebookId];
  const [generatingProgress, setGeneratingProgress] = useState<string | null>(null);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      identity.assertCurrent();
      const result = identity.authenticated
        ? await api.decks(notebookId!)
        : readGuestStudio<FlashcardDeck>(identity.owner, 'decks').filter(d => !notebookId || d.notebookId === notebookId);
      identity.assertCurrent();
      return result;
    },
    enabled: identity.ready && (!identity.authenticated || !!notebookId),
  });
  const decks = query.data || [];
  const isLoading = query.isLoading;
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const findDeck = (deckId: string) => {
    identity.assertCurrent();
    const deck = (queryClient.getQueryData<FlashcardDeck[]>(queryKey) || decks).find(d => d.id === deckId);
    if (!deck) throw new Error('Deck not found. Reload the notebook and try again.');
    return deck;
  };
  const saveCards = async (deckId: string, edit: (cards: Flashcard[]) => Flashcard[]) => {
    const deck = findDeck(deckId);
    const cards = edit(deck.cards);
    let saved: FlashcardDeck;
    if (identity.authenticated) saved = await api.updateDeck(deck, cards);
    else {
      saved = { ...deck, cards, updatedAt: new Date().toISOString() };
      const all = readGuestStudio<FlashcardDeck>(identity.owner, 'decks');
      writeGuestStudio(identity.owner, 'decks', all.map(d => d.id === deck.id ? saved : d));
    }
    identity.assertCurrent();
    queryClient.setQueryData<FlashcardDeck[]>(queryKey, old => (old || []).map(d => d.id === saved.id ? saved : d));
    return saved;
  };
  const createDeckMutation = useMutation({
    mutationFn: async ({ name, notebookId: id }: { name: string; notebookId: string }) => {
      identity.assertCurrent();
      const deck = identity.authenticated ? await api.createDeck(id, name) : {
        id: crypto.randomUUID(), notebookId: id, name, cards: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      identity.assertCurrent();
      if (!identity.authenticated) writeGuestStudio(identity.owner, 'decks', [...readGuestStudio<FlashcardDeck>(identity.owner, 'decks'), deck]);
      return deck;
    }, onSuccess: refresh,
  });
  const deleteDeckMutation = useMutation({
    mutationFn: async (id: string) => {
      const deck = findDeck(id);
      if (identity.authenticated) await api.deleteDeck(deck);
      identity.assertCurrent();
      if (!identity.authenticated) writeGuestStudio(identity.owner, 'decks', readGuestStudio<FlashcardDeck>(identity.owner, 'decks').filter(d => d.id !== id));
      return id;
    }, onSuccess: refresh,
  });
  const addCardsMutation = useMutation({
    mutationFn: ({ deckId, cards }: { deckId: string; cards: Flashcard[] }) => saveCards(deckId, old => [...old, ...cards]), onSuccess: refresh,
  });
  const updateCardMutation = useMutation({
    mutationFn: async ({ deckId, cardId, updates }: { deckId: string; cardId: string; updates: Partial<Flashcard> }) => {
      const saved = await saveCards(deckId, old => {
        if (!old.some(c => c.id === cardId)) throw new Error('Card not found');
        return old.map(c => c.id === cardId ? { ...c, ...updates, id: c.id } : c);
      });
      return saved.cards.find(c => c.id === cardId)!;
    }, onSuccess: refresh,
  });
  const deleteCardMutation = useMutation({
    mutationFn: async ({ deckId, cardId }: { deckId: string; cardId: string }) => {
      await saveCards(deckId, old => old.filter(c => c.id !== cardId)); return cardId;
    }, onSuccess: refresh,
  });
  const reviewCardMutation = useMutation({
    mutationFn: async ({ deckId, cardId, quality }: { deckId: string; cardId: string; quality: 0 | 1 | 2 | 3 | 4 | 5 }) => {
      const saved = await saveCards(deckId, old => {
        if (!old.some(c => c.id === cardId)) throw new Error('Card not found');
        return old.map(card => card.id !== cardId ? card : {
          ...card, ...calculateNextReview(card, quality), lastReviewed: new Date().toISOString(),
          correctCount: card.correctCount + (quality >= 3 ? 1 : 0),
          incorrectCount: card.incorrectCount + (quality < 3 ? 1 : 0),
          difficulty: quality >= 4 ? 'easy' : quality >= 2 ? 'medium' : 'hard',
        });
      });
      return saved.cards.find(c => c.id === cardId)!;
    }, onSuccess: refresh,
  });
  useEffect(() => {
    setGeneratingProgress(null);
    createDeckMutation.reset(); deleteDeckMutation.reset(); addCardsMutation.reset();
    updateCardMutation.reset(); deleteCardMutation.reset(); reviewCardMutation.reset();
  }, [identity.key]);
  const generateFromSource = useCallback(async (
    deckId: string,
    sourceId: string,
    sourceTitle: string,
    content: string,
    numCards: number = 5
  ) => {
    try {
      setGeneratingProgress('Starting generation...');
      
      const cards = await generateFlashcards(
        content,
        numCards,
        sourceId,
        sourceTitle,
        progress => { try { identity.assertCurrent(); setGeneratingProgress(progress); } catch { /* stale generation */ } }
      );
      
      identity.assertCurrent();
      await addCardsMutation.mutateAsync({ deckId, cards });
      try { identity.assertCurrent(); setGeneratingProgress(null); } catch { /* stale generation */ }
      return cards;
    } catch (error) {
      try { identity.assertCurrent(); setGeneratingProgress(null); } catch { /* stale generation */ }
      throw error;
    }
  }, [addCardsMutation, identity.key]);

  const getDueCards = useCallback((deckId: string): Flashcard[] => {
    const deck = decks.find(d => d.id === deckId);
    if (!deck) return [];
    
    const now = new Date();
    return deck.cards.filter(card => {
      if (!card.nextReview) return true;
      return new Date(card.nextReview) <= now;
    });
  }, [decks]);

  const getDeckStats = useCallback((deckId: string): FlashcardStats => {
    const deck = decks.find(d => d.id === deckId);
    if (!deck) {
      return {
        totalCards: 0,
        cardsDue: 0,
        cardsLearning: 0,
        cardsMastered: 0,
        averageAccuracy: 0,
      };
    }
    
    const now = new Date();
    const dueCards = deck.cards.filter(c => !c.nextReview || new Date(c.nextReview) <= now);
    const learningCards = deck.cards.filter(c => c.interval > 0 && c.interval < 21);
    const masteredCards = deck.cards.filter(c => c.interval >= 21);
    
    const totalReviews = deck.cards.reduce((sum, c) => sum + c.correctCount + c.incorrectCount, 0);
    const totalCorrect = deck.cards.reduce((sum, c) => sum + c.correctCount, 0);
    
    return {
      totalCards: deck.cards.length,
      cardsDue: dueCards.length,
      cardsLearning: learningCards.length,
      cardsMastered: masteredCards.length,
      averageAccuracy: totalReviews > 0 ? (totalCorrect / totalReviews) * 100 : 0,
    };
  }, [decks]);

  return {
    decks,
    scopeKey: identity.key,
    isLoading,
    generatingProgress,
    loadError: query.error?.message || null,
    mutationError: [createDeckMutation, deleteDeckMutation, addCardsMutation, updateCardMutation, deleteCardMutation, reviewCardMutation].find(m => m.error)?.error?.message || null,
    
    createDeck: createDeckMutation.mutate,
    createDeckAsync: createDeckMutation.mutateAsync,
    isCreatingDeck: createDeckMutation.isPending,
    
    deleteDeck: deleteDeckMutation.mutate,
    deleteDeckAsync: deleteDeckMutation.mutateAsync,
    isDeletingDeck: deleteDeckMutation.isPending,
    
    addCards: addCardsMutation.mutate,
    addCardsAsync: addCardsMutation.mutateAsync,
    isAddingCards: addCardsMutation.isPending,
    
    updateCard: updateCardMutation.mutate,
    updateCardAsync: updateCardMutation.mutateAsync,
    isUpdatingCard: updateCardMutation.isPending,
    
    deleteCard: deleteCardMutation.mutate,
    deleteCardAsync: deleteCardMutation.mutateAsync,
    isDeletingCard: deleteCardMutation.isPending,
    
    reviewCard: reviewCardMutation.mutate,
    reviewCardAsync: reviewCardMutation.mutateAsync,
    isReviewing: reviewCardMutation.isPending,
    
    generateFromSource,
    getDueCards,
    getDeckStats,
  };
}
