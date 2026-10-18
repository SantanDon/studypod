import { useTasks } from '@/hooks/useTasks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Circle } from 'lucide-react';

const TaskPulse = ({ notebookId }: { notebookId?: string }) => {
  const { tasks, isLoading, isAuthenticated, isError, refetch } = useTasks(notebookId);
  const pending = tasks?.filter(task => task.status === 'pending').length || 0;
  return (
    <section aria-label="Saved tasks" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Saved tasks</h3>
        {tasks && <Badge variant="outline">{pending} pending</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">Keep a chat response here with Save response as task.</p>
      {isLoading ? <p role="status" className="text-xs text-muted-foreground">Loading saved tasks…</p>
        : !isAuthenticated ? <p className="text-xs text-muted-foreground">Sign in to save and revisit tasks.</p>
        : !notebookId ? <p className="text-xs text-muted-foreground">Choose a notebook to see its saved tasks.</p>
        : isError ? <div className="space-y-2">
          <p role="alert" className="text-xs text-destructive">Saved tasks could not be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>Retry saved tasks</Button>
        </div>
        : !tasks?.length ? <p className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">No saved tasks yet.</p>
        : <ul className="space-y-2">{tasks.map(task => (
          <li key={task.id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-start gap-2">
              {task.status === 'completed'
                ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                : <Circle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{task.content}</p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{task.status === 'completed' ? 'Completed' : 'Pending'}</span><span>{task.priority} priority</span>
              {Number.isFinite(Date.parse(task.createdAt)) && <time dateTime={task.createdAt}>{new Date(task.createdAt).toLocaleDateString()}</time>}
            </div>
          </li>
        ))}</ul>}
    </section>
  );
};
export default TaskPulse;
