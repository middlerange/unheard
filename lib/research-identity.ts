export type ResearchIdentityProfile = {
  id: string;
  platform: string;
  name?: string;
  groupName?: string | null;
};

export type ResearchIdentityGroup<T extends ResearchIdentityProfile = ResearchIdentityProfile> = {
  id: string;
  name: string;
  profiles: T[];
};

export class ResearchIdentityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchIdentityValidationError";
  }
}

export function researchIdentityKey(profile: ResearchIdentityProfile): string {
  const group = profile.groupName?.trim().toLowerCase();
  return !group || group === "default" || group === "ungrouped"
    ? `channel:${profile.id}`
    : `group:${group}`;
}

export function groupResearchIdentities<T extends ResearchIdentityProfile>(profiles: T[]): ResearchIdentityGroup<T>[] {
  const groups = new Map<string, ResearchIdentityGroup<T>>();
  for (const profile of profiles) {
    const id = researchIdentityKey(profile);
    let group = groups.get(id);
    if (!group) {
      group = { id, name: id.startsWith("group:") ? profile.groupName!.trim() : profile.name || profile.id, profiles: [] };
      groups.set(id, group);
    }
    group.profiles.push(profile);
  }
  return [...groups.values()];
}

// Profiles must already be filtered to the enabled, supported publishing set.
export function assertResearchIdentityTargets(
  targets: ReadonlyArray<{ channelId: string; platform: string }>,
  profiles: ResearchIdentityProfile[],
  requireCompleteGroup = true,
): string {
  if (!targets.length)
    throw new ResearchIdentityValidationError("Draft must select one account identity and include every eligible profile in that identity");
  const selected = new Set<string>();
  const identities = new Set<string>();
  for (const target of targets) {
    const profile = profiles.find(profile => profile.id === target.channelId && profile.platform === target.platform);
    if (!profile || selected.has(target.channelId))
      throw new ResearchIdentityValidationError("Draft contains an unknown or duplicate destination");
    selected.add(target.channelId);
    identities.add(researchIdentityKey(profile));
  }
  if (identities.size !== 1)
    throw new ResearchIdentityValidationError("Draft must belong to one account identity; company and personal profiles, or other configured groups, cannot be mixed");
  const identity = [...identities][0];
  if (requireCompleteGroup) {
    const missing = profiles.filter(profile => researchIdentityKey(profile) === identity && !selected.has(profile.id));
    if (missing.length)
      throw new ResearchIdentityValidationError(`Draft must include every eligible profile in its selected identity; missing: ${missing.map(profile => profile.name || profile.id).join(", ")}`);
  }
  return identity;
}
