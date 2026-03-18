import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
// import { Brain, Zap, AlertCircle, Play, Loader2 } from 'lucide-react'; // Removed Lucide imports
import { QuestionDifficulty, QuestionType } from '@/types/quiz';
import { cn } from '@/lib/utils';

interface QuizSelectorProps {
  onStart: (config: QuizConfig) => void;
  isGenerating: boolean;
  error?: string | null;
  sourcesCount: number;
  availableModels?: string[];
  defaultModel?: string;
}

export interface QuizConfig {
  numQuestions: number;
  difficulty: QuestionDifficulty;
  questionType: QuestionType;
  model: string;
}

const QuizSelector: React.FC<QuizSelectorProps> = ({
  onStart,
  isGenerating,
  error,
  sourcesCount,
  availableModels = [],
  defaultModel = 'llama3.2:latest',
}) => {
  const [numQuestions, setNumQuestions] = useState(5);
  const [difficulty, setDifficulty] = useState<QuestionDifficulty>('medium');
  const [questionType, setQuestionType] = useState<QuestionType>('multiple_choice');
  const [selectedModel, setSelectedModel] = useState(defaultModel);

  const handleStart = () => {
    onStart({
      numQuestions,
      difficulty,
      questionType,
      model: selectedModel,
    });
  };

  const difficultyDescriptions: Record<QuestionDifficulty, string> = {
    easy: 'Basic recall and simple understanding',
    medium: 'Apply concepts and make connections',
    hard: 'Analyze, evaluate, and synthesize information',
  };

  const canStart = sourcesCount > 0 && !isGenerating;

  return (
    <Card className="p-5">
      <div className="flex items-center space-x-2 mb-4">
        <i className="fi fi-rr-brain h-5 w-5 text-blue-600"></i>
        <h3 className="font-semibold text-gray-900">Quiz Settings</h3>
      </div>

      {sourcesCount === 0 && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg flex items-start space-x-2">
          <i className="fi fi-rr-exclamation h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0"></i>
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Add some sources to your notebook before generating a quiz.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg flex items-start space-x-2">
          <i className="fi fi-rr-exclamation h-4 w-4 text-red-600 dark:text-red-500 mt-0.5 flex-shrink-0"></i>
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      <div className="space-y-5">
        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">
            Number of Questions: {numQuestions}
          </Label>
          <Slider
            value={[numQuestions]}
            onValueChange={(value) => setNumQuestions(value[0])}
            min={3}
            max={15}
            step={1}
            className="w-full"
            disabled={isGenerating}
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>3</span>
            <span>15</span>
          </div>
        </div>

        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">
            Difficulty Level
          </Label>
          <RadioGroup
            value={difficulty}
            onValueChange={(value) => setDifficulty(value as QuestionDifficulty)}
            className="grid grid-cols-3 gap-2"
            disabled={isGenerating}
          >
            {(['easy', 'medium', 'hard'] as const).map((level) => (
              <Label
                key={level}
                htmlFor={`difficulty-${level}`}
                className={cn(
                  'flex flex-col items-center justify-center rounded-lg border-2 p-3 cursor-pointer transition-all',
                  difficulty === level
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-400'
                    : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600',
                  isGenerating && 'opacity-50 cursor-not-allowed'
                )}
              >
                <RadioGroupItem
                  value={level}
                  id={`difficulty-${level}`}
                  className="sr-only"
                />
                <Badge
                  variant="outline"
                  className={cn(
                    'mb-1 capitalize',
                    level === 'easy' && 'border-green-500 text-green-600',
                    level === 'medium' && 'border-yellow-500 text-yellow-600',
                    level === 'hard' && 'border-red-500 text-red-600'
                  )}
                >
                  {level}
                </Badge>
              </Label>
            ))}
          </RadioGroup>
          <p className="text-xs text-gray-500 mt-2 text-center">
            {difficultyDescriptions[difficulty]}
          </p>
        </div>

        <div>
          <Label className="text-sm font-medium text-gray-700 mb-2 block">
            Question Type
          </Label>
          <RadioGroup
            value={questionType}
            onValueChange={(value) => setQuestionType(value as QuestionType)}
            className="grid grid-cols-2 gap-2"
            disabled={isGenerating}
          >
            <Label
              htmlFor="type-mc"
              className={cn(
                'flex items-center justify-center rounded-lg border-2 p-3 cursor-pointer transition-all',
                questionType === 'multiple_choice'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-400'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600',
                isGenerating && 'opacity-50 cursor-not-allowed'
              )}
            >
              <RadioGroupItem value="multiple_choice" id="type-mc" className="sr-only" />
              <span className="text-sm">Multiple Choice</span>
            </Label>
            <Label
              htmlFor="type-tf"
              className={cn(
                'flex items-center justify-center rounded-lg border-2 p-3 cursor-pointer transition-all',
                questionType === 'true_false'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-400'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600',
                isGenerating && 'opacity-50 cursor-not-allowed'
              )}
            >
              <RadioGroupItem value="true_false" id="type-tf" className="sr-only" />
              <span className="text-sm">True / False</span>
            </Label>
          </RadioGroup>
        </div>

        {availableModels.length > 0 && (
          <div>
            <Label className="text-sm font-medium text-gray-700 mb-2 block">
              AI Model
            </Label>
            <Select
              value={selectedModel}
              onValueChange={setSelectedModel}
              disabled={isGenerating}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button
          onClick={handleStart}
          disabled={!canStart}
          className="w-full"
          size="lg"
        >
          {isGenerating ? (
            <>
              <i className="fi fi-rr-spinner h-4 w-4 mr-2 animate-spin"></i>
              Generating Quiz...
            </>
          ) : (
            <>
              <i className="fi fi-rr-play h-4 w-4 mr-2"></i>
              Start Quiz
            </>
          )}
        </Button>

        {sourcesCount > 0 && (
          <p className="text-xs text-gray-500 text-center">
            <i className="fi fi-rr-bolt h-3 w-3 inline mr-1"></i>
            Quiz will be generated from {sourcesCount} source{sourcesCount !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </Card>
  );
};

export default QuizSelector;
