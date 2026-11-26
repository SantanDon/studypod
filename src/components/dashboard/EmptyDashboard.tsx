import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, FileText, MessageCircle, Headphones } from "lucide-react";
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
import { revisionGuide } from '@/lib/chat/guestPassage';

const EmptyDashboard = () => {
  const navigate = useNavigate();
  const { createNotebookAsync, isCreating, joinNotebookAsync, isJoining } = useNotebooks();
  const { canCreateNotebook, showAuthPrompt, isGuest } = useGuest();
  const { toast } = useToast();

  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');

  const handleCreateNotebook = async (revisionPlanner = false) => {
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

    try {
      const notebook = await createNotebookAsync({
        title: revisionPlanner ? revisionGuide.title : title,
        description: revisionPlanner ? revisionGuide.description : "Add sources and start exploring",
        revisionPlanner,
      });
      navigate(`/notebook/${notebook.id}`);
    } catch (error) {
      toast({
        title: "Error creating notebook",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
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
    <section className="overflow-hidden rounded-3xl border border-indigo-200 bg-indigo-50/60 dark:border-border dark:bg-card">
      <div className="grid lg:grid-cols-[1.2fr_1fr]">
        <div className="self-center px-6 py-9 sm:px-10 sm:py-14">
          <h1 className="max-w-lg text-4xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-5xl dark:text-foreground">
            Start your first notebook
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-slate-700 dark:text-muted-foreground">
            Bring a reading, lecture transcript or set of notes. Ask a question and follow the answer back to your source.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => handleCreateNotebook()} size="lg" className="rounded-full bg-indigo-800 px-6 text-white hover:bg-indigo-900 dark:bg-indigo-700 dark:hover:bg-indigo-600" disabled={isCreating}>
              <Plus aria-hidden="true" className="mr-2 h-5 w-5" />
              {isCreating ? "Creating..." : "Create notebook"}
            </Button>
            {isGuest && <Button onClick={() => handleCreateNotebook(true)} disabled={isCreating} size="lg" variant="outline" className="rounded-full">Try the revision planner</Button>}
            {!isGuest && <Button onClick={() => setIsJoinOpen(true)} size="lg" variant="outline" className="rounded-full" disabled={isJoining}>Join notebook</Button>}
          </div>
          {isGuest && <p className="mt-4 text-sm text-slate-600 dark:text-muted-foreground">Guest notebooks stay in this browser.</p>}
        </div>
        <div className="border-t border-indigo-100 bg-white/80 px-6 py-7 sm:px-10 lg:border-l lg:border-t-0 dark:border-border dark:bg-background">
          <h2 className="mb-4 font-semibold text-foreground">Inside a notebook</h2>
          <ul className="divide-y divide-slate-200 dark:divide-border">
            {[
              { icon: FileText, title: 'Sources', body: 'Collect files, links and pasted text.' },
              { icon: MessageCircle, title: 'Chat', body: 'Ask questions about the sources you choose.' },
              { icon: Headphones, title: 'Studio', body: 'Create podcasts, audiobooks, quizzes and flashcards from your sources.' },
            ].map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex items-start gap-3 py-3">
                <Icon className="mt-1 h-5 w-5 shrink-0 text-indigo-800 dark:text-indigo-300" aria-hidden="true" />
                <div><h3 className="font-medium text-foreground">{title}</h3><p className="text-sm leading-relaxed text-muted-foreground">{body}</p></div>
              </li>
            ))}
          </ul>
        </div>
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
            <label htmlFor="empty-join-code" className="block text-sm font-medium">Join code</label>
            <Input id="empty-join-code"
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
