import { diagnose } from './environment.js';
console.log(JSON.stringify(await diagnose(), null, 2));
