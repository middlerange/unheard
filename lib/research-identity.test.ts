import { describe, expect, it } from "vitest";
import { assertResearchIdentityTargets, groupResearchIdentities, researchIdentityKey } from "./research-identity";
const profiles = [
  { id: "company-li", platform: "linkedin", groupName: "Company" },
  { id: "company-x", platform: "twitter", groupName: " company " },
  { id: "personal-li", platform: "linkedin", groupName: "Personal" },
  { id: "personal-x", platform: "twitter", groupName: "Personal" },
];
const targets = profiles.map(profile => ({ channelId: profile.id, platform: profile.platform }));
describe("one research identity per approval", () => {
  it("groups configured cross-platform identities without hardcoded account names", () => {
    expect(groupResearchIdentities(profiles).map(group => [group.id, group.profiles.length])).toEqual([["group:company", 2], ["group:personal", 2]]);
    expect(assertResearchIdentityTargets(targets.slice(0, 2), profiles)).toBe("group:company");
    expect(assertResearchIdentityTargets(targets.slice(2), profiles)).toBe("group:personal");
    expect(researchIdentityKey({ id: "custom", platform: "discord", groupName: " ProductLab " })).toBe("group:productlab");
  });
  it("rejects mixed identities and incomplete chosen identities", () => {
    expect(() => assertResearchIdentityTargets(targets, profiles)).toThrow("cannot be mixed");
    expect(() => assertResearchIdentityTargets([targets[0]], profiles)).toThrow("missing: company-x");
    expect(assertResearchIdentityTargets([targets[0]], profiles, false)).toBe("group:company");
    expect(() => assertResearchIdentityTargets([targets[0], targets[2]], profiles, false)).toThrow("cannot be mixed");
  });
  it("keeps ungrouped channels separate instead of inferring identity from names or account type", () => {
    for (const groupName of [null, "", "default", " Ungrouped "]) {
      const accounts = [{ id: "one", platform: "linkedin", name: "Same", groupName }, { id: "two", platform: "twitter", name: "Same", groupName }];
      expect(groupResearchIdentities(accounts)).toHaveLength(2);
      expect(() => assertResearchIdentityTargets([{ channelId: "one", platform: "linkedin" }, { channelId: "two", platform: "twitter" }], accounts)).toThrow("cannot be mixed");
    }
  });
  it("rejects duplicate, unknown, platform-mismatched and empty destination sets", () => {
    for (const selected of [[], [targets[0], targets[0]], [{ channelId: "outside", platform: "linkedin" }], [{ ...targets[0], platform: "twitter" }]]) {
      expect(() => assertResearchIdentityTargets(selected, profiles)).toThrow();
    }
  });
});
