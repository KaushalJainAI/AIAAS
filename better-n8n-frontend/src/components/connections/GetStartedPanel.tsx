/**
 * "Get started" for one connector: what the user needs and the exact steps,
 * shown before they connect. Props only, no fetching.
 *
 * Each part is drawn only when it has something in it, so a guide with just
 * steps is just steps.
 */
import { ExternalLink, Info, ShieldAlert } from 'lucide-react';
import type { SetupGuide } from '@/api/mcp';
import { isSafeExternalUrl } from '@/lib/safeUrl';

interface GetStartedPanelProps {
  guide: SetupGuide;
}

const SECTION_TITLE = 'text-[13px] font-semibold text-foreground mb-1.5';
const LIST = 'list-disc pl-5 space-y-1 text-[13px] text-foreground/90';

export default function GetStartedPanel({ guide }: GetStartedPanelProps) {
  const youNeed = guide.you_need.filter((item) => item.trim() !== '');
  const limits = guide.limits.filter((item) => item.trim() !== '');
  const admin = guide.admin_needed?.trim() ? guide.admin_needed : null;
  const facts = [
    guide.cost.trim() && `Cost: ${guide.cost}`,
    guide.time.trim() && `Time: ${guide.time}`,
  ].filter(Boolean) as string[];

  return (
    <section
      aria-label="Get started"
      className="min-w-0 space-y-4 rounded-md border border-border/60 bg-muted/30 p-4"
    >
      {youNeed.length > 0 && (
        <div className="min-w-0">
          <h3 className={SECTION_TITLE}>You need</h3>
          <ul className={LIST}>
            {youNeed.map((item) => (
              <li key={item} className="break-words">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {admin && (
        <div className="flex min-w-0 items-start gap-2 rounded-md border border-warning/40 bg-warning-subtle p-2.5 text-[13px] text-foreground/90">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 break-words">
            <span className="font-semibold text-foreground">Admin approval: </span>
            {admin}
          </div>
        </div>
      )}

      {facts.length > 0 && (
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground break-words">
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </p>
      )}

      {guide.steps.length > 0 && (
        <div className="min-w-0">
          <h3 className={SECTION_TITLE}>Steps</h3>
          <ol className="list-decimal space-y-2 pl-5 text-[13px] text-foreground/90 marker:text-muted-foreground">
            {guide.steps.map((step, index) => (
              <li key={`${index}-${step.text}`} className="break-words pl-1">
                <span>{step.text}</span>
                {step.url && isSafeExternalUrl(step.url) && (
                  <>
                    {' '}
                    <a
                      href={step.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 whitespace-nowrap text-primary hover:underline"
                    >
                      Open page
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {limits.length > 0 && (
        <div className="min-w-0">
          <h3 className={`${SECTION_TITLE} flex items-center gap-1.5`}>
            <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            Good to know
          </h3>
          <ul className={LIST}>
            {limits.map((item) => (
              <li key={item} className="break-words">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
