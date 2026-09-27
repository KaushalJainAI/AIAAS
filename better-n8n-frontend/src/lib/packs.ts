/**
 * Pack availability, derived from the members' server-computed flags.
 *
 * Each template carries `available` / `unavailable_reason` from
 * `agents/views/gallery.py` (one predicate on the backend, read here and on
 * the install path). A pack is unavailable only when *every* member is —
 * a pack that is mostly installable (the web pack without its browser scout)
 * still installs what can run, skipping the rest with the reason.
 */
export interface PackMemberAvailability {
  slug: string;
  available?: boolean;
  unavailable_reason?: string;
}

export interface PackAvailability {
  available: boolean;
  /** Distinct member reasons, in pack order. Empty when available. */
  reasons: string[];
}

export function isUnavailable(
  member: Pick<PackMemberAvailability, 'available'>,
): boolean {
  /* Absent means an older server that predates the flag: available. */
  return member.available === false;
}

export function packAvailability(members: PackMemberAvailability[]): PackAvailability {
  const blocked = members.filter(isUnavailable);
  if (blocked.length === 0 || blocked.length < members.length) {
    return { available: true, reasons: [] };
  }
  const reasons: string[] = [];
  for (const m of blocked) {
    const reason = m.unavailable_reason ?? `${m.slug} cannot run on this server.`;
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  return { available: false, reasons };
}
