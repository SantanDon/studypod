import { Link } from "react-router-dom";
import { useRecentSavedPodcast } from "@/hooks/usePodcastHistory";
import { getResumableTime, loadPlaybackCheckpoint } from "@/lib/audio/playbackProgress";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import NotebookGrid from "@/components/dashboard/NotebookGrid";
import EmptyDashboard from "@/components/dashboard/EmptyDashboard";
import WhatsHappening from "@/components/dashboard/WhatsHappening";
import GoalsPulse from "@/components/dashboard/GoalsPulse";
import { useNotebooks } from "@/hooks/useNotebooks";
import { useAuth } from "@/hooks/useAuth";
import { useVisualEffectsStore } from "@/stores/visualEffectsStore";
import { FEATURE_FLAGS } from "@/config/featureFlags";

const Dashboard = () => {
  const { user, loading: authLoading, error: authError } = useAuth();
  const { notebooks, isLoading, error, isError } = useNotebooks();
  const { useCustomFonts } = useVisualEffectsStore();
  const hasNotebooks = notebooks && notebooks.length > 0;
  const recentAudio = useRecentSavedPodcast(isLoading || isError ? [] : notebooks.map((notebook: { id: string }) => notebook.id));
  const episodeNotebook = notebooks.find((notebook: { id: string }) => notebook.id === recentAudio.episode?.notebook_id);
  const ownedEpisode = episodeNotebook ? recentAudio.episode : null;
  const checkpoint = ownedEpisode ? loadPlaybackCheckpoint(ownedEpisode.id) : null;
  const resumeAt = checkpoint?.kind === "podcast" ? getResumableTime(checkpoint, ownedEpisode?.duration) : 0;

  // Show loading while auth is initializing
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background">
        <DashboardHeader userEmail={user?.email} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="text-4xl font-medium text-gray-900 dark:text-foreground mb-2">
              Welcome to StudyPod
            </h1>
          </div>
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-muted-foreground">Initializing...</p>
          </div>
        </main>
      </div>
    );
  }

  // Show auth error if present
  if (authError) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background">
        <DashboardHeader userEmail={user?.email} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="text-4xl font-medium text-gray-900 dark:text-foreground mb-2">
              Welcome to StudyPod
            </h1>
          </div>
          <div className="text-center py-16">
            <p className="text-red-600 dark:text-red-400">Authentication error: {authError}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Show notebooks loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background">
        <DashboardHeader userEmail={user?.email} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="text-4xl font-medium text-gray-900 dark:text-foreground mb-2">
              Welcome to StudyPod
            </h1>
          </div>
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-muted-foreground">Loading your notebooks...</p>
          </div>
        </main>
      </div>
    );
  }

  // Show notebooks error if present
  if (isError && error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background">
        <DashboardHeader userEmail={user?.email} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="text-4xl font-medium text-gray-900 dark:text-foreground mb-2">
              Welcome to StudyPod
            </h1>
          </div>
          <div className="text-center py-16">
            <p className="text-red-600 dark:text-red-400">Error loading notebooks: {error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-background">
      <DashboardHeader userEmail={user?.email} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 border-b border-border/70 pb-5">
          <h1 className={`font-medium bg-gradient-to-r from-indigo-600 to-violet-300 bg-clip-text text-transparent text-3xl ${useCustomFonts ? 'font-heading' : ''}`}>Your research workspace
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Pick up where you left off, or bring something new to learn.</p>
        </div>

        {hasNotebooks ? (
          <>
            <section aria-labelledby="saved-audio-heading" className="mb-7 rounded-2xl border border-indigo-200 bg-white p-4 sm:p-5 dark:border-indigo-900 dark:bg-card">
              <h2 id="saved-audio-heading" className="text-sm font-semibold uppercase tracking-[0.12em] text-indigo-800 dark:text-indigo-300">{resumeAt > 0 ? "Continue listening" : "Saved audio"}</h2>
              {recentAudio.isLoading ? <p role="status" className="mt-2 text-sm text-muted-foreground">Checking your saved audio...</p> : recentAudio.error ? (
                <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-red-700 dark:text-red-400">
                  <span>Could not check saved audio.</span>
                  <button type="button" onClick={() => void recentAudio.retry()} disabled={recentAudio.isRefreshing} className="min-h-11 rounded-lg px-3 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">Retry</button>
                </div>
              ) : episodeNotebook && ownedEpisode ? (
                <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium text-slate-900 dark:text-foreground">{ownedEpisode.title}</p>
                    <p className="break-words text-sm text-muted-foreground">Saved in {episodeNotebook.title}.{resumeAt > 0 ? ` Continue from ${Math.floor(resumeAt / 60)}:${Math.floor(resumeAt % 60).toString().padStart(2, "0")} on this device.` : " Open this episode in Studio to listen."}</p>
                  </div>
                  <Link to={`/notebook/${encodeURIComponent(episodeNotebook.id)}?view=studio&episode=${encodeURIComponent(ownedEpisode.id)}`} className="inline-flex min-h-11 items-center rounded-lg bg-indigo-800 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 dark:bg-indigo-700 dark:hover:bg-indigo-600" aria-label={`${resumeAt > 0 ? "Resume" : "Open"} ${ownedEpisode.title} in ${episodeNotebook.title}`}>{resumeAt > 0 ? "Resume in Studio" : "Open episode"}</Link>
                </div>
              ) : <p className="mt-2 text-sm text-muted-foreground">No saved audio yet. Open a notebook's Studio to create an audio overview.</p>}
            </section>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
            <div className="lg:col-span-3">
              <NotebookGrid />
            </div>
            <div className="lg:col-span-1 space-y-6">
              <GoalsPulse />
              {FEATURE_FLAGS.SIGNAL_QUEUE_VISIBLE && <WhatsHappening />}
            </div>
            </div>
          </>
        ) : (
          <EmptyDashboard />
        )}
      </main>
    </div>
  );
};

export default Dashboard;
