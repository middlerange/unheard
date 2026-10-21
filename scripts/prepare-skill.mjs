import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('public/skills', { recursive: true });
cpSync('skills/content-hub', 'public/skills/content-hub', { recursive: true });
