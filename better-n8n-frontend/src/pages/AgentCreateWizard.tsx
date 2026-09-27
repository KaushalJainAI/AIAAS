/**
 * Agent creation wizard — orchestrator-driven, no chat pane.
 *
 * Describe → Questions → Proposal → Approve → Install → Eval.
 * Both wizard endpoints are read-only; creation goes through the ordinary
 * POST agents endpoint so grants/scopes pass the same serializer and the
 * same consent step as a hand-built agent.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Bot, Check, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import agentsService from '../api/agents';
import evalsService from '../api/evals';
import PageHeader from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';

type Question = { id: string; text: string; why: string; multi: boolean; options?: string[] };
type Step = 'describe' | 'questions' | 'proposal' | 'done';

export default function AgentCreateWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('describe');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [memoryHints, setMemoryHints] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [proposal, setProposal] = useState<{
    config: Record<string, unknown>; explanations: string[]; warnings: string[];
  } | null>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);

  const ask = useMutation({
    mutationFn: () => agentsService.wizardQuestions(description),
    onSuccess: (data) => {
      setQuestions(data.questions);
      setMemoryHints(data.memory_hints);
      setStep('questions');
    },
    onError: () => toast.error('Could not load questions.'),
  });

  const propose = useMutation({
    mutationFn: () => agentsService.wizardPropose(description, answers),
    onSuccess: (data) => {
      setProposal(data);
      setStep('proposal');
    },
    onError: () => toast.error('Could not build a proposal.'),
  });

  const create = useMutation({
    mutationFn: () => agentsService.create({
      name: String(answers.name || (proposal?.config as { name?: string })?.name || description.slice(0, 60)),
      ...(proposal?.config as object),
    } as never),
    onSuccess: (agent) => {
      setCreatedId(agent.id);
      setStep('done');
      toast.success(`Created ${agent.name}.`);
    },
    onError: () => toast.error('Creation was refused. Check the proposal.'),
  });

  const cloneEval = useMutation({
    mutationFn: (template: string) =>
      evalsService.cloneStarter({ template, agent_id: createdId ?? undefined }),
    onSuccess: (suite) => {
      toast.success(`Starter eval "${suite.name}" created.`);
      navigate('/evals');
    },
    onError: () => toast.error('Could not clone the starter eval.'),
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Link to="/agents" className="text-xs text-muted-foreground inline-flex items-center gap-1 mb-3">
        <ArrowLeft className="w-3 h-3" /> All agents
      </Link>
      <PageHeader
        title="Create an agent"
        subtitle="Describe the job. The orchestrator asks what it needs, proposes the config, and you approve before anything exists."
        icon={Bot}
      />

      {step === 'describe' && (
        <section className="border border-border rounded bg-card p-4 space-y-3">
          <label className="text-[13px] font-semibold">What should this agent do?</label>
          <textarea
            className="w-full min-h-28 border border-border rounded p-2 text-sm bg-background"
            placeholder="e.g. Read invoices from Gmail every Monday and chase anything overdue by 30 days"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button onClick={() => ask.mutate()} disabled={!description.trim() || ask.isPending}>
            {ask.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Ask me what it needs
          </Button>
        </section>
      )}

      {step === 'questions' && (
        <section className="border border-border rounded bg-card p-4 space-y-4">
          {memoryHints.length > 0 && (
            <p className="text-xs text-muted-foreground">{memoryHints.join(' · ')}</p>
          )}
          {questions.map((q) => (
            <div key={q.id} className="space-y-1">
              <label className="text-[13px] font-semibold">{q.text}</label>
              {q.why && <p className="text-xs text-muted-foreground">{q.why}</p>}
              {q.options ? (
                <select
                  className="w-full border border-border rounded p-2 text-sm bg-background"
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  className="w-full border border-border rounded p-2 text-sm bg-background"
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                  placeholder="Type your answer"
                />
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep('describe')}>Back</Button>
            <Button onClick={() => propose.mutate()} disabled={propose.isPending}>
              {propose.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              Propose the agent
            </Button>
          </div>
        </section>
      )}

      {step === 'proposal' && proposal && (
        <section className="border border-border rounded bg-card p-4 space-y-3">
          <h3 className="text-[13px] font-semibold">Proposal — approve before anything exists</h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            {proposal.explanations.map((e) => <li key={e}>· {e}</li>)}
          </ul>
          {proposal.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-600 dark:text-amber-400">⚠ {w}</p>
          ))}
          <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-64">
            {JSON.stringify(proposal.config, null, 2)}
          </pre>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep('questions')}>Back</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Approve and create
            </Button>
          </div>
        </section>
      )}

      {step === 'done' && (
        <section className="border border-border rounded bg-card p-4 space-y-3">
          <h3 className="text-[13px] font-semibold">Installed. Now prove it works.</h3>
          <p className="text-xs text-muted-foreground">
            Clone the starter eval for this agent and run it for a 0–100 scorecard.
            Giving up scores 0; hallucinations and out-of-scope tools score minus.
          </p>
          <div className="flex gap-2 flex-wrap">
            {['research', 'analyst', 'files', 'support', 'code'].map((t) => (
              <Button key={t} variant="ghost" onClick={() => cloneEval.mutate(t)} disabled={cloneEval.isPending}>
                Clone {t} starter
              </Button>
            ))}
          </div>
          {createdId && (
            <Link to={`/agents/${createdId}`} className="text-xs underline">Open the agent</Link>
          )}
        </section>
      )}
    </div>
  );
}
