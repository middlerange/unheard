import { createHash } from 'node:crypto';
import { evaluateQualificationCache } from './qualification-cache';

const args = process.argv.slice(2);
function argument(name: string) { const index = args.indexOf('--' + name); if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Missing --' + name); return args[index + 1]; }
const inputPaths = { replay: argument('replay'), benchmark: argument('benchmark'), ideas: argument('ideas') };
const inputs = Object.fromEntries(await Promise.all(Object.entries(inputPaths).map(async ([name, path]) => [name, await Bun.file(path).text()])));
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const benchmark = JSON.parse(inputs.benchmark), ideas = JSON.parse(inputs.ideas);
if (benchmark.replaySha256 !== hash(inputs.replay)) throw new Error('Joined benchmark does not match the saved replay bytes');
const hashes = ideas.inputHashes as Record<string, { sha256: string }>;
if (!hashes || !Object.values(hashes).some(x => x.sha256 === hash(inputs.replay))) throw new Error('Human idea review does not match the saved replay bytes');
const at = args.indexOf('--thresholds');
const thresholds = at >= 0 ? args[at + 1].split(',').map(Number) : undefined;
const result = { evaluatedAt: new Date().toISOString(), inputHashes: Object.fromEntries(Object.entries(inputs).map(([name, text]) => [name, hash(text)])),
  ...evaluateQualificationCache(JSON.parse(inputs.replay), benchmark, ideas, thresholds) };
await Bun.write(argument('out'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ mode: result.mode, modelCalls: 0, networkCalls: 0, baseline: result.sweep.find(x => x.threshold === 70), output: argument('out') }));
