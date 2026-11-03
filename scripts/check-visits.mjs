import {readFileSync} from 'node:fs';
const token = readFileSync(new URL('../.tracking-secret', import.meta.url), 'utf8').trim();
const response = await fetch('https://datafog-lance-context.sid-5af.workers.dev/api/visits', {headers: {Authorization: `Bearer ${token}`}});
if (!response.ok) throw new Error(`Visit report failed: ${response.status}`);
console.log(JSON.stringify(await response.json(), null, 2));
