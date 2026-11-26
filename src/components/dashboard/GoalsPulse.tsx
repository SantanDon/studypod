import React from 'react';
import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ApiService } from '@/services/apiService';
import type { ResearchGoal } from '@/hooks/useResearchGoals';

interface GoalSummary {
  notebookId: string;
  notebookTitle: string;
  total: number;
  active: number;
  completed: number;
  recentTitles: { id: string; title: string; status: string; progressPct: number }[];
}

interface GoalsPulseProps {
  notebooks: readonly { id: string; title?: string | null }[];
}

const GoalsPulse: React.FC<GoalsPulseProps> = ({ notebooks }) => {
  const { user, session, isAuthenticated } = useAuth();
  const canLoadGoals = isAuthenticated && user?.account_type !== 'guest';
  const accountId = canLoadGoals ? user?.id : undefined;
  const token = session?.access_token;
  const selectedNotebooks = accountId && token ? notebooks.slice(0, 6) : [];
  const goalQueries = useQueries({
    queries: selectedNotebooks.map((notebook) => ({
      queryKey: ['dashboard-goals-pulse', accountId, notebook.id],
      queryFn: async ({ signal }): Promise<ResearchGoal[]> => {
        if (!token) throw new Error('Sign in to load research goals.');
        const result = await ApiService.fetchResearchGoals(notebook.id, token, { signal });
        return result.goals || [];
      },
      staleTime: 60_000,
      retry: false,
    })),
  });

  const failedQueries = goalQueries.filter((query) => query.isError);
  const goalError = failedQueries.length > 0 && (
    <div role="alert" className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
      <p>{failedQueries.length === goalQueries.length
        ? 'Research goals could not be loaded.'
        : 'Some research goals could not be loaded.'}</p>
      <button
        type="button"
        className="font-semibold text-foreground underline"
        onClick={() => failedQueries.forEach((query) => void query.refetch())}
      >
        Retry loading goals
      </button>
    </div>
  );

  const summaries = selectedNotebooks.flatMap((notebook, index): GoalSummary[] => {
    const goals = goalQueries[index].data;
    if (!goals?.length) return [];
    return [{
      notebookId: notebook.id,
      notebookTitle: notebook.title || 'Untitled notebook',
      total: goals.length,
      active: goals.filter((goal) => !goal.status || goal.status === 'active').length,
      completed: goals.filter((goal) => goal.status === 'completed').length,
      recentTitles: goals.slice(0, 3).map((goal) => ({
        id: goal.id,
        title: goal.title,
        status: goal.status || 'active',
        progressPct: goal.progress_pct || 0,
      })),
    }];
  });
  const loadingGoals = goalQueries.some((query) => query.isLoading);
  if (loadingGoals && summaries.length === 0) {
    return (
      <div role="status" className="bg-white dark:bg-card border border-gray-100 dark:border-border rounded-2xl p-5 shadow-sm space-y-4">
        <span className="sr-only">Loading research goals…</span>
        <div className="h-4 bg-gray-100 dark:bg-muted animate-pulse rounded w-1/3" />
        <div className="space-y-2">
          <div className="h-10 bg-gray-100 dark:bg-muted animate-pulse rounded-xl" />
          <div className="h-10 bg-gray-100 dark:bg-muted animate-pulse rounded-xl" />
        </div>
      </div>
    );
  }

  const totals = summaries.reduce(
    (acc, s) => ({
      active: acc.active + s.active,
      completed: acc.completed + s.completed,
    }),
    { active: 0, completed: 0 }
  );

  if (summaries.length === 0) {
    return (
      <div className="bg-white dark:bg-card border border-gray-100 dark:border-border rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-50 dark:border-border/30 pb-3 mb-4">
          <h3 className="font-bold text-gray-900 dark:text-foreground text-sm flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-center">
              <i className="fi fi-rr-bullseye text-indigo-600 dark:text-indigo-400 text-[10px]"></i>
            </span>
            <span>Research Goals</span>
          </h3>
        </div>
        {goalError || <div className="space-y-1 pt-3 text-sm leading-6">
          <p className="font-semibold text-foreground">No goals yet</p>
          <p className="text-slate-600 dark:text-slate-300">
            {canLoadGoals
              ? 'Open Studio in a notebook, then choose Research Goals to add a question.'
              : 'Sign in to save research questions and track them here.'}
          </p>
        </div>}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-card border border-gray-100 dark:border-border rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-gray-50 dark:border-border/30 pb-3">
        <h3 className="font-bold text-gray-900 dark:text-foreground text-sm flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-center">
            <i className="fi fi-rr-bullseye text-indigo-600 dark:text-indigo-400 text-[10px]"></i>
          </span>
          <span>Research Goals</span>
        </h3>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400">
          <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{totals.active} active</span>
          {totals.completed > 0 && (
            <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">{totals.completed} done</span>
          )}
        </div>
      </div>

      {goalError}
      {loadingGoals && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">Loading more research goals…</p>}
      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
        {summaries.map((s) => (
          <div key={s.notebookId} className="border border-gray-100 dark:border-border rounded-xl p-3 hover:border-indigo-100 dark:hover:border-indigo-900/50 transition-all">
            <div className="flex items-center justify-between mb-2">
              <Link
                to={`/notebook/${s.notebookId}`}
                className="text-xs font-bold text-gray-800 dark:text-foreground hover:text-indigo-600 dark:hover:text-indigo-400 truncate flex-1 min-w-0"
              >
                {s.notebookTitle}
              </Link>
              <span className="text-[10px] text-gray-400 font-mono flex-shrink-0 ml-2">
                {s.active}/{s.total}
              </span>
            </div>
            <div className="space-y-1.5">
              {s.recentTitles.map((g) => (
                <div key={g.id} className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    g.status === 'completed' ? 'bg-emerald-500' :
                    g.status === 'paused' ? 'bg-amber-500' : 'bg-indigo-500'
                  }`} />
                  <span className={`text-[11px] truncate flex-1 min-w-0 ${
                    g.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-700 dark:text-muted-foreground'
                  }`}>
                    {g.title}
                  </span>
                  {g.progressPct > 0 && g.progressPct < 100 && (
                    <span className="text-[9px] text-gray-400 font-mono flex-shrink-0">{g.progressPct}%</span>
                  )}
                </div>
              ))}
            </div>
            {s.total > 0 && s.active > 0 && (
              <div className="mt-2 h-1 bg-gray-100 dark:bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400 rounded-full transition-all"
                  style={{ width: `${Math.round(((s.total - s.active) / s.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default GoalsPulse;
