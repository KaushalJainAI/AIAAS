import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/** Terms of Service and Privacy Policy.
 *
 *  Written to describe what the backend actually does with data, not a generic
 *  template: every claim here should be checkable against the code. When a
 *  data flow changes (a new provider, a new stored field), change this page in
 *  the same change. Google's OAuth verification also requires a reachable
 *  privacy policy, which is why the connectors need this page to exist.
 */

const UPDATED = '17 September 2026';
const CONTACT_URL = 'https://github.com/KaushalJainAI';

type Doc = 'terms' | 'privacy';

const PRIVACY: { heading: string; body: string[] }[] = [
  {
    heading: 'What we store',
    body: [
      'Your account: name, email address and a hashed password, or your Google identity if you sign in with Google.',
      'What you create: chat conversations, agents and their settings, schedules, run history, and files you upload or that an agent writes into your file space.',
      'Short facts the assistant saves about you (for example your preferred language), which you can ask it in chat to forget.',
      'API keys and connection tokens you add. These are encrypted at rest with AES and are never sent back to the browser.',
    ],
  },
  {
    heading: 'Who else sees it',
    body: [
      'To answer a message, its text and the relevant context are sent to the AI model provider you picked (for example OpenRouter or NVIDIA). Their own policies apply to that request.',
      'When you connect Gmail, Google Drive, Sheets or Calendar, we read or change that data only when you or one of your agents calls a tool that needs it. Actions that send, delete or change something ask for your approval first unless you have configured the agent otherwise.',
      'We do not sell your data and do not use it to train models.',
    ],
  },
  {
    heading: 'Deleting your data',
    body: [
      'Deleted files go to a recycle bin and are permanently removed after 30 days.',
      'To delete your account and everything attached to it, contact us using the link below.',
    ],
  },
];

const TERMS: { heading: string; body: string[] }[] = [
  {
    heading: 'Early access',
    body: [
      'This service is in early access. It is provided as is, may change or be unavailable without notice, and is not suitable for critical work.',
      'Each account has a usage allowance. We may limit or suspend accounts that abuse the service or its model providers.',
    ],
  },
  {
    heading: 'Your responsibilities',
    body: [
      'You are responsible for what your agents do with the accounts you connect, including messages they send on your behalf after you approve them.',
      'Do not use the service for anything illegal, to send spam, or to attack other systems.',
    ],
  },
  {
    heading: 'AI output',
    body: [
      'AI answers can be wrong. Check anything important before relying on it.',
    ],
  },
];

export default function Legal({ doc }: { doc: Doc }) {
  const title = doc === 'terms' ? 'Terms of Service' : 'Privacy Policy';
  const sections = doc === 'terms' ? TERMS : PRIVACY;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <article className="max-w-2xl mx-auto px-4 py-10">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Last updated {UPDATED}</p>

        {sections.map((s) => (
          <section key={s.heading} className="mt-8">
            <h2 className="text-lg font-semibold">{s.heading}</h2>
            <ul className="mt-3 space-y-2 list-disc pl-5 text-sm leading-relaxed text-muted-foreground">
              {s.body.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </section>
        ))}

        <p className="mt-10 text-sm text-muted-foreground">
          Questions: <a href={CONTACT_URL} className="underline hover:text-foreground" target="_blank" rel="noreferrer">contact the maintainer</a>.
          {' '}See also the <Link to={doc === 'terms' ? '/privacy' : '/terms'} className="underline hover:text-foreground">
            {doc === 'terms' ? 'Privacy Policy' : 'Terms of Service'}
          </Link>.
        </p>
      </article>
    </div>
  );
}
