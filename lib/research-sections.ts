export const RESEARCH_SECTION_INVENTORY_VERSION = "research-sections-v1";

export type ResearchSourceSection = {
  id: string;
  title: string;
  start: number;
  bodyStart: number;
  end: number;
};

const label = "(?:insight|finding|lesson|result|takeaway|recommendation|observation|principle)s?";
const heading = new RegExp(`^(?:(?:key\\s+)?${label}\\s*#?\\d+|\\d+[.)]\\s*(?:key\\s+)?${label})(?:\\s*[:.–—-]\\s*.+|\\s*)$`, "i");

/** Offsets refer to the supplied text, never a rewritten or extended source. */
export function researchSectionInventory(content: string): ResearchSourceSection[] {
  const headings: Array<Omit<ResearchSourceSection, "end">> = [];
  for (const match of content.matchAll(/[^\r\n]+/g)) {
    const title = match[0].trim().replace(/^#{1,6}\s+/, "").replace(/^(\*\*|__)(.*)\1$/, "$2");
    if (!heading.test(title)) continue;
    const start = match.index;
    headings.push({ id: `section-${start}`, title, start, bodyStart: start + match[0].length });
  }
  const sections = headings.map((section, index) => {
    let bodyStart = section.bodyStart, end = headings[index + 1]?.start ?? content.length;
    while (bodyStart < end && /\s/.test(content[bodyStart])) bodyStart++;
    while (end > bodyStart && /\s/.test(content[end - 1])) end--;
    return { ...section, bodyStart, end };
  }).filter(section => content.slice(section.bodyStart, section.end).trim().length >= 80);
  return sections.length >= 2 ? sections : [];
}

export function researchSourceSections<T extends { content: string | null }>(item: T) {
  return { ...item, sourceSections: researchSectionInventory(item.content || "") };
}
