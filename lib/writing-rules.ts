// ABOUTME: Writing style rules to remove AI-generated prose tells from content.
// ABOUTME: Loaded from data/writing-prompts/no-slop.md and appended to all AI system prompts.

import { readFileSync } from 'fs';
import { join } from 'path';

let noSlopRules: string;
try {
  // Try to read at runtime for build compatibility
  noSlopRules = readFileSync(join(process.cwd(), 'data/writing-prompts/no-slop.md'), 'utf-8');
} catch {
  // Fallback content if file read fails
  noSlopRules = `# No Slop Writing Rules

Avoid these AI-generated prose tells:
1. Generic enthusiasm without specifics
2. Overuse of em dashes
3. Bullet point overload
4. Fake urgency phrases
5. Vague intensifiers
6. Corporate buzzwords
7. Generic transitions
8. Perfect parallelism
9. False intimacy
10. Over-explaining`;
}

export { noSlopRules };
