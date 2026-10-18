import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, FileText, MessageCircle, Headphones, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useNotebooks } from "@/hooks/useNotebooks";
import { useGuest } from "@/hooks/useGuest";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
const EmptyDashboard = () => {
  const navigate = useNavigate();
  const { createNotebook, isCreating, joinNotebookAsync, isJoining } = useNotebooks();
  const { canCreateNotebook, showAuthPrompt, isGuest } = useGuest();
  const { toast } = useToast();

  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');

  const handleCreateNotebook = () => {
    console.log("Create notebook button clicked");
    console.log("isCreating:", isCreating);

    // Check guest limit
    if (isGuest && !canCreateNotebook) {
      showAuthPrompt('create notebook');
      return;
    }

    // Generate a better default title with date
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const title = `New Notebook - ${dateStr}`;

    createNotebook(
      {
        title: title,
        description: "Add sources and start exploring",
      },
      {
        onSuccess: (data) => {
          console.log("Navigating to notebook:", data.id);
          navigate(`/notebook/${data.id}`);
        },
        onError: (error) => {
          console.error(
            "Failed to create notebook:",
            JSON.stringify(error, null, 2),
          );
          toast({
            title: "Error creating notebook",
            description: error instanceof Error ? error.message : "Unknown error",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleJoinNotebook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) return;

    try {
      const data = await joinNotebookAsync(joinCodeInput.trim());
      toast({
        title: "Joined notebook!",
        description: `Successfully joined "${data.title || 'shared notebook'}"`,
      });
      setIsJoinOpen(false);
      setJoinCodeInput('');
      navigate(`/notebook/${data.id}`);
    } catch (err: unknown) {
      console.error(err);
      toast({
        title: "Failed to join",
        description: err instanceof Error ? err.message : "Invalid or expired join code",
        variant: "destructive",
      });
    }
  };
  return (
    <section className="rounded-3xl border border-slate-200 bg-white px-6 py-10 sm:px-10 sm:py-14 dark:border-border dark:bg-card">
      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div className="max-w-xl">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-800 dark:text-indigo-300">Your material. Your pace.</p>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-5xl dark:text-foreground">
            Make room for<br />a little understanding.
          </h2>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-600 dark:text-muted-foreground">
            Bring your reading into a notebook. Explore it with questions, then turn selected sources into a podcast you can take with you.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button onClick={handleCreateNotebook} size="lg" className="rounded-full bg-indigo-800 px-6 text-white hover:bg-indigo-900 dark:bg-indigo-700 dark:hover:bg-indigo-600" disabled={isCreating}>
              <Plus className="mr-2 h-5 w-5" />
              {isCreating ? "Creating..." : "Create notebook"}
              <ArrowRight className="ml-3 h-4 w-4" />
            </Button>
            {!isGuest && (
              <Button onClick={() => setIsJoinOpen(true)} size="lg" variant="outline" className="rounded-full border-slate-300 dark:border-border" disabled={isJoining}>
                Join notebook
              </Button>
            )}
          </div>
          {isGuest && <p className="mt-3 text-xs text-slate-500 dark:text-muted-foreground">Guest notebooks stay in this browser. Sign up when you want to sync.</p>}
        </div>
        <ol className="space-y-3" aria-label="How to study with StudyPod">
          {[
            { icon: FileText, title: 'Bring your sources', body: 'Start with a PDF, pasted text, or a web page. Keep the material that matters together.' },
            { icon: MessageCircle, title: 'Follow your questions', body: 'Ask about your sources and check the references as you build your understanding.' },
            { icon: Headphones, title: 'Give your reading a voice', body: 'Choose sources for a podcast discussion or solo explanation. Read-aloud availability depends on your setup.' },
          ].map(({ icon: Icon, title, body }, index) => (
            <li key={title} className="flex gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-border dark:bg-background">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"><Icon className="h-5 w-5" aria-hidden="true" /></div>
              <div><p className="mb-1 text-xs font-medium text-slate-500 dark:text-muted-foreground">0{index + 1}</p><h3 className="font-semibold text-slate-900 dark:text-foreground">{title}</h3><p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-muted-foreground">{body}</p></div>
            </li>
          ))}
        </ol>
      </div>
      <Dialog open={isJoinOpen} onOpenChange={setIsJoinOpen}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-card border border-border rounded-2xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-medium text-foreground">Join shared notebook</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Enter the 6-character shared join code to access your teammate's research package.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleJoinNotebook} className="space-y-4 pt-2">
            <Input
              placeholder="e.g. A4K9B2"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
              maxLength={6}
              className="font-mono text-center text-lg tracking-widest uppercase h-12 rounded-xl"
              disabled={isJoining}
              autoFocus
            />
            <div className="flex justify-end space-x-3">
              <Button type="button" variant="ghost" onClick={() => setIsJoinOpen(false)} disabled={isJoining} className="rounded-xl">
                Cancel
              </Button>
              <Button type="submit" disabled={isJoining || joinCodeInput.length < 6} className="bg-black hover:bg-gray-800 text-white rounded-xl px-6">
                {isJoining ? 'Joining...' : 'Join'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
};
export default EmptyDashboard;
