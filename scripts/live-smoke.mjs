import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CodexAdapter } from '../dist/adapters/codex.js';
import { ClaudeAdapter } from '../dist/adapters/claude.js';
import { executablePaths, requireLiveReady } from '../dist/environment.js';
const cwd = path.resolve('.cache/agents/smoke'); await mkdir(cwd,{recursive:true});
await requireLiveReady();
const paths = executablePaths();
const authorization = {messagesAuthorized:true,toolPolicyVerified:true};
const adapters = [new CodexAdapter(paths.codex,cwd,authorization),new ClaudeAdapter(paths.claude,cwd,authorization)];
const previous = process.argv.includes('--codex-only') ? JSON.parse(await readFile(path.resolve('.cache/live-smoke-report.json'),'utf8')) : null;
const marker = previous?.marker ?? randomUUID(); const report = {marker,at:new Date().toISOString(),research:false,results:previous ? previous.results.filter(r=>r.agent!=='codex') : []};
for(const adapter of adapters) {
 if(previous && adapter.id!=='codex') continue;
 try {
  const request={messageId:randomUUID(),topic:`Harmless connection test ${marker}. Reply with this identifier and a short acknowledgement only. Do not read files, search, or call tools.`,round:1,settings:{model:adapter.id==='codex'?'gpt-6-luna':'sonnet',effort:'low'},context:[],session:undefined,signal:AbortSignal.timeout(90000),research:false,roots:[]};
  let session; let answer;
  for await(const event of adapter.run(request)){if(event.type==='session')session=event.session;if(event.type==='completed')answer=event;}
  report.results.push({agent:adapter.id,status:answer?.text.includes(marker)?'passed':'unexpected',model:answer?.model,sessionId:session?.id,text:answer?.text});
 }catch(error){report.results.push({agent:adapter.id,status:'failed',code:error.code??'ERROR',message:error.message});}
 console.log(JSON.stringify(report.results.at(-1)));
}
await writeFile(path.resolve('.cache/live-smoke-report.json'),JSON.stringify(report,null,2));
process.exitCode=report.results.every(r=>r.status==='passed')?0:1;
