import { roomProviderStatuses } from './environment.js';
console.log(JSON.stringify({ node: process.version, demo: { ready: true, requiresLogin: false },
  providers: await roomProviderStatuses(), note: 'Provider readiness is separate from installation health. No model turn was started.' }, null, 2));
