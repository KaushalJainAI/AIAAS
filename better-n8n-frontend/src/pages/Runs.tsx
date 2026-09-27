/**
 * Activity — what needs you, what's live, what's scheduled, what happened.
 *
 * Layout + header only. Every section owns its data and lives in
 * `components/activity/`: the approval inbox first (the only place a paused
 * run can be answered), then every live process of any kind, missions,
 * schedules, recent outcomes, recent files, and the run history with delete.
 * Fleet analytics (trends, tool mix, repeat failures, per-agent spend) live
 * in Settings → Insights, not here.
 */
import { Activity } from 'lucide-react';
import { useHitlPending } from '../hooks/useHitlPending';
import { useActivityLive } from '../hooks/useActivityLive';
import PageHeader from '../components/layout/PageHeader';
import NeedsYou from '../components/activity/NeedsYou';
import LiveList from '../components/activity/LiveList';
import MissionsSection from '../components/activity/MissionsSection';
import ScheduledSection from '../components/activity/ScheduledSection';
import RecentlyDone from '../components/activity/RecentlyDone';
import FileActivity from '../components/activity/FileActivity';
import HistoryList from '../components/activity/HistoryList';

export default function Runs() {
  // Same queries the sections read (and the nav badges): header subscribes
  // without its own timer — LiveList polls while live, the badge polls slow.
  const { data: pending = [] } = useHitlPending();
  const { items: live } = useActivityLive();

  const subtitle = pending.length
    ? `${pending.length} need${pending.length === 1 ? 's' : ''} you · ${live.length} live`
    : live.length > 0
      ? `${live.length} live`
      : 'Nothing needs you right now';

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        icon={Activity}
        title="Activity"
        subtitle={subtitle}
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {/* Blocked work first: a run waiting on an approval is the only
            state that costs time while producing nothing. */}
        <NeedsYou />
        {/* Every live process of any kind — runs, code tasks, eval sweeps,
            world generation, chat turns. */}
        <LiveList />
        {/* Goals before executions: a mission is the chain, History rows are
            its links (badged with the mission id). Read-only + Cancel/Delete:
            missions don't advance in production yet. */}
        <MissionsSection />
        {/* Upcoming schedules, waiting missions, scheduler health. */}
        <ScheduledSection />
        {/* What schedules did lately, and whether it worked. */}
        <RecentlyDone />
        {/* What changed in files and workspaces. */}
        <FileActivity />
        {/* Finished runs with per-row Delete and bulk clearing. */}
        <HistoryList pendingCount={pending.length} />
      </div>
    </div>
  );
}
