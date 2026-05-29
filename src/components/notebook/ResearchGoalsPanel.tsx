import React, { useState } from 'react';
import { useResearchGoals, ResearchGoal } from '@/hooks/useResearchGoals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

interface ResearchGoalsPanelProps {
  notebookId: string;
}

const ResearchGoalsPanel = ({ notebookId }: ResearchGoalsPanelProps) => {
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  
  const { goals, isLoading, createGoal, deleteGoal } = useResearchGoals(notebookId);
  const { toast } = useToast();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast({
        title: "Missing title",
        description: "Please specify a title for your goal.",
        variant: "destructive"
      });
      return;
    }

    try {
      await createGoal({ title, description });
      setTitle('');
      setDescription('');
      setIsAdding(false);
      toast({
        title: "Goal added",
        description: "Your research goal is active. Crawled bookmarks will now match against this goal.",
      });
    } catch (err: any) {
      toast({
        title: "Failed to add goal",
        description: err.message || "An error occurred.",
        variant: "destructive"
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to remove this research goal?")) return;
    try {
      await deleteGoal(id);
      toast({
        title: "Goal removed",
        description: "The research goal was deleted."
      });
    } catch (err: any) {
      toast({
        title: "Failed to delete",
        description: err.message || "An error occurred.",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center pb-2 border-b border-gray-150/40">
        <div className="text-xs text-gray-500 font-medium">
          {goals.length} active goal{goals.length !== 1 ? 's' : ''}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setIsAdding(!isAdding)}
          className="h-7 text-xs rounded-lg text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50/50"
        >
          <i className={`fi ${isAdding ? 'fi-rr-cross' : 'fi-rr-plus'} mr-1`}></i>
          {isAdding ? 'Cancel' : 'Add Goal'}
        </Button>
      </div>

      {isAdding && (
        <form onSubmit={handleCreate} className="bg-gray-50/40 border border-gray-100 p-3 rounded-xl space-y-3 transition-all">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-bold text-gray-500">Goal Title</Label>
            <Input
              placeholder="e.g. Find improvements for my agents"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-8 text-xs rounded-lg border-gray-200"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-bold text-gray-500">Criteria / Focus Areas</Label>
            <Textarea
              placeholder="e.g. Scan bookmarks for LLM orchestration, agent frameworks, or local model fine-tuning tips."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-16 text-xs rounded-lg border-gray-200"
            />
          </div>
          <div className="flex justify-end pt-1">
            <Button type="submit" size="sm" className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg">
              Save Goal
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400">
          <i className="fi fi-rr-spinner animate-spin mr-2"></i>
          Loading goals...
        </div>
      ) : goals.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-gray-150 rounded-xl bg-white/40">
          <p className="text-xs text-gray-400">No research goals defined yet.</p>
          <p className="text-[10px] text-gray-400 mt-1 max-w-[200px] mx-auto">
            Define goals so StudyPod can auto-synthesize bookmark findings into action recommendations.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {goals.map((goal) => (
            <div key={goal.id} className="p-3 bg-white border border-gray-100 rounded-xl shadow-sm hover:border-indigo-100 transition-all group">
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                  {goal.title}
                </h4>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(goal.id)}
                  className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
                >
                  <i className="fi fi-rr-trash text-[10px]"></i>
                </Button>
              </div>
              {goal.description && (
                <p className="text-[10px] text-gray-500 mt-1 leading-relaxed pl-3 font-sans">
                  {goal.description}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ResearchGoalsPanel;
