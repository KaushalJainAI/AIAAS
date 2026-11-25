/**
 * The /code page: a placeholder until the Code tab exists.
 *
 * The `/code` slash command navigates here. The real tab needs a workspace
 * engine (Backend/workspaces/engine.py), and that engine is still a stub, so
 * this page says so and links back to chat instead of landing on NotFound.
 * It deliberately reads no status endpoint: the capabilities endpoint only
 * reports whether WORKSPACE_ENGINE is set, not whether the engine works.
 */
import { Link } from 'react-router-dom';
import { Code2 } from 'lucide-react';
import PageHeader from '../components/layout/PageHeader';

export default function Code() {
  return (
    <div className="min-h-full bg-background text-foreground">
      <PageHeader title="Code" subtitle="Coding workspace" icon={Code2} />
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="w-14 h-14 mx-auto mb-5 bg-secondary rounded-md flex items-center justify-center">
            <Code2 className="w-7 h-7 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-bold mb-2">The coding workspace is not available yet</h2>
          <p className="text-sm text-muted-foreground mb-6">
            This server has no working workspace to run code or keep a project&apos;s files
            in. Chat still works for questions about code.
          </p>
          <Link
            to="/ai-chat"
            className="inline-block px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
          >
            Back to chat
          </Link>
        </div>
      </div>
    </div>
  );
}
