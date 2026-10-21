// ABOUTME: Writing templates bundled from the Content Hub template library.
// ABOUTME: Each template has an id, name, type, and the template structure text.

export interface WritingTemplate {
  id: string;
  name: string;
  type: string;
  platforms: string[];
  content: string;
}

export const templates: WritingTemplate[] = [
  {
    id: '006',
    name: 'Problem + Solution',
    type: 'Problem-Solution',
    platforms: ['LinkedIn', 'Twitter', 'Reddit'],
    content: `[HEADLINE]: The [PROBLEM] — Why [SPECIFIC SITUATION] fails

[HOOK — Empathy]: If you're dealing with this, you know the feeling:
- [Specific problem statement]
- [What it feels like]
- [The result]

Most people don't solve this — they just accept it.

[PROBLEM — Root Causes]:
1. [Root cause + explanation with example]
2. [Root cause + explanation with example]
3. [Root cause + explanation with example]

[SOLUTION]:
1. [Actionable step + reasoning]
2. [Actionable step + reasoning]
3. [Actionable step + reasoning]

[IMPACT]: Teams that implement this see:
- [Metric change]
- [Metric change]
- [Metric change]`,
  },
  {
    id: '007',
    name: 'Positioning / Differentiation',
    type: 'Positioning',
    platforms: ['LinkedIn', 'Twitter', 'Reddit'],
    content: `[HOOK — Common Belief]: Everyone thinks [COMMON APPROACH] is the way. Here's why it's not.

[COMPETITOR PLAYBOOK]: Most [competitors/teams] do this:
- [Approach 1 with flaw]
- [Approach 2 with flaw]
- [Approach 3 with flaw]

[YOUR DIFFERENT APPROACH]:
- [Counter-intuitive approach 1 + why it works]
- [Counter-intuitive approach 2 + why it works]
- [Counter-intuitive approach 3 + why it works]

[PROOF]: [Real data or example showing results]

[CTA]: [What to try next]`,
  },
  {
    id: '009',
    name: 'Founder Wisdom / Contrarian Take',
    type: 'Contrarian Wisdom',
    platforms: ['LinkedIn', 'Twitter', 'Reddit'],
    content: `[CONTRARIAN TAKE]: Unpopular opinion — [bold statement that goes against common wisdom]

[EVIDENCE — 3 Points]:
1. [Point that challenges conventional thinking]
2. [Real-world example that proves the contrarian take]
3. [Data or observation that supports it]

[CONSEQUENCE]: If this is true, then [implication for the industry/role]

[REAL EXAMPLE]: At [company/context], we did [X] instead of [Y]. Here's what happened:
- [Result 1]
- [Result 2]
- [Result 3]

[REFRAME]: The real lesson is [one-line wisdom]`,
  },
  {
    id: '010',
    name: 'Myth-Busting',
    type: 'Myth-Busting',
    platforms: ['LinkedIn', 'Twitter', 'Reddit'],
    content: `[MYTH]: "[Common belief or misconception]"

[WHY PEOPLE BELIEVE IT]: [Reasonable explanation — shows empathy]

[REALITY]: [What's actually true, with evidence]

[EVIDENCE — 3 Points]:
1. [Data point or research]
2. [Real example]
3. [Counter-example that disproves the myth]

[CASE STUDY]: [Real situation showing the reality in action]

[TAKEAWAY]: [What to do differently now that you know the truth]`,
  },
  {
    id: '011',
    name: 'Story / Narrative',
    type: 'Storytelling',
    platforms: ['LinkedIn', 'Twitter', 'Reddit'],
    content: `[ACT 1 — Problem]: [Setup — the challenge or situation]

[ACT 2 — Attempt]: We tried [X]. It didn't work. We tried [Y]. Same result.

[ACT 3 — Breakthrough]: Then we [discovered/tried/built something different].

[ACT 4 — Results]:
- [Specific metric or outcome]
- [What we learned]
- [What we'd do differently]

[REFLECTION]: [One insight that others can apply]`,
  },
  {
    id: '015',
    name: 'Announcement / Product Update',
    type: 'Announcement',
    platforms: ['LinkedIn', 'Twitter', 'Reddit'],
    content: `[PROBLEM SOLVED]: [What pain point this addresses]

[WHAT IT IS]: [One-line description of the announcement/feature]

[WHO IT'S FOR]: [Specific audience or use case]

[HOW IT WORKS — 3 Steps]:
1. [Step 1]
2. [Step 2]
3. [Step 3]

[REAL EXAMPLE]: [Concrete before/after scenario]

[HOW TO ACCESS]: [Link or instructions]

[WHAT'S NEXT]: [Teaser or roadmap hint]`,
  },
  {
    id: '016',
    name: 'Quick Insight / One-Liner',
    type: 'Quick Insight',
    platforms: ['Twitter', 'LinkedIn', 'Reddit'],
    content: `[ONE-LINE INSIGHT]: [Surprising or memorable observation]

[WHY IT MATTERS]: [Brief explanation — 1-2 sentences]

[CONTEXT]: [Optional — how you came to this realization]

[APPLICATION]: [How others can use this insight]`,
  },
  {
    id: '017',
    name: 'Industry Trend',
    type: 'Trend Analysis',
    platforms: ['LinkedIn', 'Twitter', 'Reddit'],
    content: `[OBSERVATION]: [Something shifting in the industry]

[TREND]: [Name the emerging pattern]

[3 FORCES driving it]:
1. [Force 1 — market/tech/cultural]
2. [Force 2 — market/tech/cultural]
3. [Force 3 — market/tech/cultural]

[EARLY MOVERS]: [Who's already adapting — examples]

[FORECAST]: [Where this is heading in 6-12 months]

[ADVICE]: [What to do about it now]`,
  },
  {
    id: '018',
    name: 'Behind-the-Scenes',
    type: 'Behind-the-Scenes',
    platforms: ['LinkedIn', 'Twitter', 'Reddit'],
    content: `[CONTEXT]: [What we were building/doing]

✅ WHAT WORKED:
- [Win 1]
- [Win 2]
- [Win 3]

❌ WHAT DIDN'T:
- [Failure 1 + what we learned]
- [Failure 2 + what we learned]

📊 NUMBERS:
- [Specific metrics]

🔮 WHAT'S NEXT:
- [Plan or direction]`,
  },
  {
    id: '020',
    name: 'Step-by-Step Tutorial',
    type: 'Tutorial',
    platforms: ['Twitter', 'LinkedIn'],
    content: `[PROBLEM]: [What this solves]

[STEP 1]: [Action + why]
[STEP 2]: [Action + why]
[STEP 3]: [Action + why]

[RESULT]: [What you get after completing the steps]

[TIP]: [Pro tip or common mistake to avoid]`,
  },
  {
    id: '022',
    name: 'Meme / Cultural Juxtaposition',
    type: 'Meme / Cultural',
    platforms: ['Twitter', 'LinkedIn'],
    content: `[SETUP]: [Description of two contrasting groups or situations]

[CONTRAST]:
Group A: [How one group thinks/acts]
Group B: [How the other group thinks/acts]

[PUNCHLINE]: [The ironic or funny truth revealed by the contrast]

[REAL TALK]: [Serious takeaway underneath the humor]`,
  },
  {
    id: '024',
    name: 'Milestone / Celebration',
    type: 'Milestone',
    platforms: ['Twitter', 'LinkedIn'],
    content: `[NUMBER]: [Specific metric or milestone]

[REFLECTION]: [What this means — 1-2 sentences]

[GRATITUDE]: [Thank specific people or groups]

[WHAT'S NEXT]: [Where we're heading]

[ADVICE]: [One thing we learned that others can use]`,
  },
];

export const getTemplateById = (id: string) => templates.find((t) => t.id === id);
