
import React, { useState } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { useDeepResearch } from '@/hooks/useDeepResearch';
import { ResearchStep } from '@/lib/agents/DeepResearchAgent';

interface DeepResearchDialogProps {
  notebookId: string;
}

export function DeepResearchDialog({ notebookId }: DeepResearchDialogProps) {
  const [topic, setTopic] = useState("");
  const { 
    isResearching, 
    progress, 
    currentStep, 
    statusMessage, 
    report, 
    startResearch,
    reset,
    isOpen,
    openDialog,
    closeDialog,
    initialTopic,
    sourceContext
  } = useDeepResearch();

  // Initialize topic when dialog opens with a preset
  React.useEffect(() => {
      if (isOpen && initialTopic) {
          setTopic(initialTopic);
      }
  }, [isOpen, initialTopic]);

  // Auto-start research when opened with source context (triggered from a source)
  React.useEffect(() => {
      if (isOpen && sourceContext && initialTopic && !isResearching && !report) {
          // Auto-start research using the source
          startResearch(notebookId, initialTopic, sourceContext);
      }
  }, [isOpen, sourceContext, initialTopic, isResearching, report, notebookId, startResearch]);

  const handleStart = () => {
    if (topic.trim()) {
      startResearch(notebookId, topic, sourceContext);
    }
  };

  // Check if this was triggered from a source (has sourceContext)
  const isSourceTriggered = !!sourceContext;

  const handleOpenChange = (open: boolean) => {
    if (open) {
        openDialog(notebookId);
    } else {
        closeDialog();
        // Only reset if completely done or error, so background process isn't killed visually
        if (!isResearching && (report || currentStep === 'error')) {
             setTimeout(() => reset(), 300);
        }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {/* Trigger removed, controlled externally or via header button */}
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <i className="fi fi-rr-wand h-5 w-5 text-foreground" />
            Research
          </DialogTitle>
          <DialogDescription>
            {isSourceTriggered 
              ? "Generating a comprehensive research report based on your source content."
              : "Generate a comprehensive report from your notebook sources. The agent will plan, research, and write a structured document."
            }
          </DialogDescription>
        </DialogHeader>

        {/* Only show topic input when NOT triggered from a source */}
        {!isResearching && !report && !isSourceTriggered && (
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="topic">Research Topic</Label>
              <Input
                id="topic"
                placeholder="e.g., The impact of quantum computing on cryptography"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleStart()}
              />
            </div>
          </div>
        )}

        {isResearching && (
          <div className="py-6 space-y-6">
            <div className="flex items-center justify-between text-sm font-medium text-muted-foreground">
              <span>{statusMessage}</span>
              <span>{progress}%</span>
            </div>
            
            <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
              <div 
                className="h-full bg-purple-600 transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <StepIndicator step="planning" current={currentStep} label="Planning" />
              <StepIndicator step="researching" current={currentStep} label="Researching" />
              <StepIndicator step="writing" current={currentStep} label="Writing" />
            </div>
          </div>
        )}

        {report && (
          <div className="py-4 space-y-4">
            <div className="bg-green-50 p-4 rounded-md border border-green-200 flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
              <div>
                <h4 className="font-semibold text-green-900">Report Generated!</h4>
                <p className="text-sm text-green-700">
                  "{report.title}" has been saved to your sources.
                </p>
              </div>
            </div>

            <div className="mt-4 border rounded-md p-4 bg-muted/30 max-h-[200px] overflow-y-auto text-sm">
                <h5 className="font-semibold mb-2 text-muted-foreground uppercase text-xs">Preview</h5>
                <pre className="whitespace-pre-wrap font-sans text-foreground/80">
                  {report.content || "No content available."}
                </pre>
            </div>
          </div>
        )}
        
        {currentStep === 'error' && (
           <div className="bg-red-50 p-4 rounded-md border border-red-200 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <div>
                <h4 className="font-semibold text-red-900">Research Failed</h4>
                <p className="text-sm text-red-700">{statusMessage}</p>
              </div>
            </div>
        )}

        <DialogFooter>
          {/* Only show Start button when manually entering topic (not source-triggered) */}
          {!isResearching && !report && !isSourceTriggered && (
            <Button onClick={handleStart} disabled={!topic.trim()}>
              Start Research
            </Button>
          )}
          {report && (
             <Button onClick={() => {
               closeDialog();
               reset();
             }}>
               Done
             </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({ step, current, label }: { step: ResearchStep, current: ResearchStep, label: string }) {
  const stepsOrder = ['planning', 'researching', 'writing', 'completed'];
  const currentIndex = stepsOrder.indexOf(current);
  const stepIndex = stepsOrder.indexOf(step);
  
  const isActive = current === step;
  const isCompleted = currentIndex > stepIndex || current === 'completed';
  
  return (
    <div className={`flex flex-col items-center gap-1 ${isActive ? 'text-purple-600 font-bold' : isCompleted ? 'text-green-600' : 'text-gray-400'}`}>
      <div className={`h-8 w-8 rounded-full flex items-center justify-center border-2 
        ${isActive ? 'border-purple-600 bg-purple-50' : isCompleted ? 'border-green-600 bg-green-50' : 'border-gray-200'}`}>
        {isActive && <Loader2 className="h-4 w-4 animate-spin" />}
        {isCompleted && <CheckCircle className="h-4 w-4" />}
        {!isActive && !isCompleted && <div className="h-2 w-2 rounded-full bg-gray-300" />}
      </div>
      <span>{label}</span>
    </div>
  );
}
