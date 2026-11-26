/**
 * Activity — what needs you, what's live, what's planned, what happened.
 *
 * Layout, header and tabs only (`lib/activityTabs.ts` names them). Every
 * section owns its data and lives in `components/activity/`; only the open
 * tab's sections are mounted, so a closed tab costs no requests.
 *   Now      — the approval inbox (the only place a paused run can be
 *              answered) and every live process of any kind
 *   Planned  — missions, then upcoming schedules and scheduler health
 *   History  — what schedules did lately, then the run history with delete
 *   Files    — what changed in files and workspaces
 * Fleet analytics (trends, tool mix, repeat failures, per-agent spend) live
 * in Settings → Insights, not here.
 */
import { Activity } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useHitlPending } from '../hooks/useHitlPending';
import { useActivityLive } from '../hooks/useActivityLive';
import { ACTIVITY_TABS, ACTIVITY_TAB_LABELS, parseActivityTab, type ActivityTab } from '../lib/activityTabs';
import PageHeader from '../components/layout/PageHeader';
import PageTabs from '../components/layout/PageTabs';
import NeedsYou from '../components/activity/NeedsYou';
import LiveList from '../components/activity/LiveList';
import MissionsSection from '../components/activity/MissionsSection';
import ScheduledSection from '../components/activity/ScheduledSection';
import RecentlyDone from '../components/activity/RecentlyDone';
import FileActivity from '../components/activity/FileActivity';
import HistoryList from '../components/activity/HistoryList';

export default function Runs() {
  // Same queries the sections read (and the nav badges): the Now tab's count
  // subscribes without its own timer — LiveList polls while live, the badge
  // polls slow.
  const { data: pending = [] } = useHitlPending();
  const { items: live } = useActivityLive();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseActivityTab(searchParams.get('tab'));

  const pick = (next: ActivityTab) => {
    const params = new URLSearchParams(searchParams);
    // `now` is the default, so its link stays the bare /runs.
    if (next === 'now') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const tabs = ACTIVITY_TABS.map((id) => ({
    id,
    label: ACTIVITY_TAB_LABELS[id],
    // Only Now carries a count: it is the one tab that can be waiting on you.
    count: id === 'now' ? pending.length + live.length : undefined,
  }));

  return (
    <div className="h-full flex flex-col">
      {/* One row: the tabs sit where the title would be. */}
      <PageHeader
        icon={Activity}
        title="Activity"
        subtitle=""
        tabs={<PageTabs inline tabs={tabs} value={tab} onChange={pick} label="Activity sections" idPrefix="activity" />}
      />

      <div
        id="activity-panel"
        role="tabpanel"
        aria-labelledby={`activity-tab-${tab}`}
        className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6"
      >
        {tab === 'now' && (
          <>
            {/* Blocked work first: a run waiting on an approval is the only
                state that costs time while producing nothing. */}
            <NeedsYou />
            {/* Every live process of any kind — runs, code tasks, eval sweeps,
                world generation, chat turns. */}
            <LiveList />
            {/* Both sections hide themselves when empty, so a quiet Now tab
                says so and points at the other tabs instead of going blank. */}
            {pending.length === 0 && live.length === 0 && (
              <div className="mx-auto max-w-md py-16 text-center">
                <p className="text-sm font-medium text-foreground">All clear</p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Nothing needs you and nothing is running.
                </p>
                {/* Buttons, not inline links: 44px tall on a phone. */}
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => pick('planned')} className="inline-flex min-h-11 items-center px-3 text-[13px] text-primary hover:underline">
                    See what&apos;s planned
                  </button>
                  <button type="button" onClick={() => pick('history')} className="inline-flex min-h-11 items-center px-3 text-[13px] text-primary hover:underline">
                    See what already ran
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {tab === 'planned' && (
          <>
            {/* Goals before executions: a mission is the chain, History rows
                are its links (badged with the mission id). */}
            <MissionsSection />
            {/* Upcoming schedules, waiting missions, scheduler health. */}
            <ScheduledSection />
          </>
        )}
        {tab === 'history' && (
          <>
            {/* What schedules did lately, and whether it worked. */}
            <RecentlyDone />
            {/* Finished runs with per-row Delete and bulk clearing. */}
            <HistoryList pendingCount={pending.length} />
          </>
        )}
        {tab === 'files' && <FileActivity />}
      </div>
    </div>
  );
}
