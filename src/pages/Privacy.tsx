import { Link } from "react-router-dom";
import { Shield, BarChart3, Bot, Database } from "lucide-react";

const Privacy = () => {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          Back to StudyPodLM
        </Link>

        <header className="mt-8 space-y-3">
          <div className="flex items-center gap-3">
            <Shield className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Privacy Policy</h1>
          </div>
          <p className="text-sm text-muted-foreground">Last updated May 27, 2026</p>
        </header>

        <section className="mt-8 space-y-5 text-sm leading-7 text-muted-foreground">
          <p>
            StudyPodLM is built for private study and human-agent collaboration. Local and guest
            mode data is stored in your browser. Cloud features store account, notebook, source,
            note, chat, sync, and agent-access records needed to run the service.
          </p>

          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-2 flex items-center gap-2 font-semibold text-foreground">
              <Database className="h-4 w-4" />
              Study Data
            </h2>
            <p>
              Uploaded documents, pasted text, website content, YouTube transcript data, notes,
              chat messages, generated study artifacts, and agent activity may be processed by
              StudyPodLM services so the app can extract, search, summarize, and answer questions.
              Encrypted sync data is stored as encrypted payloads when you use encrypted cloud sync.
            </p>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-2 flex items-center gap-2 font-semibold text-foreground">
              <Bot className="h-4 w-4" />
              Agent Access
            </h2>
            <p>
              Agents connect through pairing codes or generated <code>spm_</code> API keys. Those
              keys can be scoped and revoked. Agents can read or write notebook data only through
              the permissions granted to their token.
            </p>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-2 flex items-center gap-2 font-semibold text-foreground">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </h2>
            <p>
              StudyPodLM uses Vercel Web Analytics to understand basic traffic and page usage. The
              app does not intentionally send notebook content, source text, chat messages, API
              keys, or verification tokens as analytics events.
            </p>
          </div>

          <p>
            StudyPodLM no longer accepts bring-your-own provider keys. External agents should use
            pairing codes or generated StudyPodLM API keys instead of storing AI provider keys in
            the app.
          </p>

          <p>
            You can export your data from the app settings. You can revoke agent keys from developer
            settings and delete local browser data from data management tools.
          </p>
        </section>
      </div>
    </main>
  );
};

export default Privacy;
