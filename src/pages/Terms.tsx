import { Link } from "react-router-dom";
import { FileText } from "lucide-react";

const Terms = () => {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          Back to StudyPodLM
        </Link>

        <header className="mt-8 space-y-3">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Terms of Service</h1>
          </div>
          <p className="text-sm text-muted-foreground">Last updated May 27, 2026</p>
        </header>

        <section className="mt-8 space-y-5 text-sm leading-7 text-muted-foreground">
          <p>
            StudyPodLM is a study workspace for notebooks, sources, notes, AI-generated learning
            aids, and human-agent collaboration. Use it only with content you have the right to
            upload, process, or analyze.
          </p>

          <p>
            AI and agent outputs can be incomplete or inaccurate. You are responsible for reviewing
            generated answers, citations, notes, quizzes, flashcards, podcasts, and agent-written
            content before relying on them.
          </p>

          <p>
            Keep your account credentials, recovery material, and generated <code>spm_</code> API
            keys secure. You are responsible for activity performed through keys you create until
            those keys are revoked.
          </p>

          <p>
            Do not use StudyPodLM to attack systems, exfiltrate data, upload malware, violate
            privacy rights, or bypass access controls. Agent and automation features must respect
            the same boundaries as direct human use.
          </p>

          <p>
            The service may change as the project develops. Features can be updated, limited, or
            removed to improve security, privacy, reliability, or product quality.
          </p>
        </section>
      </div>
    </main>
  );
};

export default Terms;
