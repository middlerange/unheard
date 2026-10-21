// ABOUTME: Writing prompts and style guides bundled from the Content Hub.
// ABOUTME: Includes brand voices, writing rules, and style patterns for AI generation.

export interface WritingPrompt {
  id: string;
  name: string;
  description: string;
  content: string;
}

export const writingPrompts: WritingPrompt[] = [
  {
    id: 'no-slop',
    name: 'No Slop (Anti-AI Rules)',
    description: 'Avoid AI-generated prose tells — generic enthusiasm, buzzwords, over-explaining',
    content: `Avoid these AI-generated prose tells:
1. Generic enthusiasm: "Exciting", "thrilled", "passionate" without specifics
2. Overuse of em dashes: More than 1-2 per paragraph feels artificial
3. Bullet point overload: Lists within lists scream AI formatting
4. Fake urgency: "Now more than ever", "In today's world"
5. Vague intensifiers: "Very", "really", "truly", "incredibly"
6. Corporate buzzwords: "Leverage", "synergy", "paradigm", "ecosystem"
7. Generic transitions: "Furthermore", "Moreover", "Additionally" at paragraph starts
8. Perfect parallelism: Every bullet starting with the same word pattern
9. False intimacy: "Let's be honest", "Here's the truth", "Spoiler alert"
10. Over-explaining: Defining obvious terms, excessive context

Write like a human who actually cares about the topic.`,
  },
  {
    id: 'dan-shipper',
    name: "Dan Shipper's Writing Voice",
    description: 'Short sentences, lowercase, specific details, no hashtags. Founder/engineering voice.',
    content: `Write in this voice:
- Short, punchy sentences. Most under 15 words.
- Lowercase aesthetic — avoid ALL CAPS and Title Case for effect.
- Specific details over generalizations. Use numbers, dates, real examples.
- No hashtags. Ever.
- No emojis. Let the words do the work.
- 1-2 paragraph posts. Get to the point fast.
- Use contrast: "most people think X. here's what actually happens."
- Be contrarian but backed by evidence.
- Name specific people, products, companies when relevant.
- End with a clear takeaway or question.`,
  },
  {
    id: 'professional',
    name: 'Professional / Business',
    description: 'Clear, authoritative business writing for LinkedIn and company communications',
    content: `Write in a professional but approachable voice:
- Clear, direct sentences. No jargon unless it's domain-appropriate.
- Data-backed claims. Cite sources or numbers when possible.
- Structure: Problem → Insight → Solution → Impact.
- Respect the reader's time — lead with the most important point.
- Use specific industry examples rather than generic scenarios.
- End with an actionable takeaway or open-ended question.`,
  },
  {
    id: 'casual',
    name: 'Casual / Conversational',
    description: 'Relaxed, friendly tone for social media and community posts',
    content: `Write in a casual, conversational voice:
- Talk like you're explaining to a smart friend over coffee.
- Use contractions and everyday language.
- Humor is welcome but keep it natural — don't force it.
- Short paragraphs. 2-3 sentences max.
- Ask questions to engage the reader.
- Share personal experience when relevant.
- Avoid corporate language entirely.`,
  },
  {
    id: 'witty',
    name: 'Witty / Sharp',
    description: 'Clever, punchy writing with humor and sharp observations',
    content: `Write with wit and sharpness:
- Open with a hook that makes people stop scrolling.
- Use irony and unexpected comparisons.
- Punchy one-liners between longer points.
- Don't explain the joke — trust the reader.
- Subvert expectations: set up one thing, deliver another.
- Be self-deprecating when appropriate.
- Every sentence should earn its place. Cut ruthlessly.`,
  },
  {
    id: 'twitter-thread',
    name: 'Twitter/X Thread',
    description: 'Structured for Twitter/X thread format with hooks and engagement',
    content: `Write as a Twitter/X thread:
1. Tweet 1: Strong hook — question, bold claim, or surprising fact
2. Tweet 2-3: Context — why this matters
3. Tweet 4-6: Key points — one per tweet, each tweet can standalone
4. Tweet 7-8: Evidence or examples
5. Final tweet: Clear CTA — ask a question or suggest an action

Rules:
- Each tweet under 280 characters (make every character count)
- Number tweets if it's a thread: 1/7, 2/7, etc.
- No hashtags. No emojis.
- First tweet is everything — make it impossible to scroll past.
- Each tweet should make sense if seen in isolation.`,
  },
];

export const getPromptById = (id: string) => writingPrompts.find((p) => p.id === id);

export const DEFAULT_FREE_FORM_ID = 'free-form';
