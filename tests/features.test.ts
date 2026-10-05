import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { input, setup } from './helpers.js';
import { codexArguments, verifyCodexPolicy, disabledFeatures } from '../src/adapters/codex.js';
import { RpcConnection, type JsonConnection } from '../src/adapters/process.js';

describe('complete discussion workflows', () => {
 it('requires debate approval and summarizes with two separate fresh sessions',async()=>{
  const context=await setup(); const id=randomUUID();
  try {
   await context.controller.create(id,input({kind:'debate'}));
   await expect(context.controller.start(id,randomUUID())).rejects.toMatchObject({code:'ROLES_REQUIRED'});
   await context.controller.start(id,randomUUID(),'roles'); await context.controller.wait(id);
   const roles=context.controller.get(id).roles; expect(roles.codex).not.toBe('');
   await context.controller.configure(id,{roles}); await context.controller.start(id,randomUUID()); await context.controller.wait(id);
   const sessions=context.controller.get(id).sessions;
   await context.controller.start(id,randomUUID(),'summary'); await context.controller.wait(id);
   expect(context.controller.get(id).sessions).toEqual(sessions);
   expect(context.controller.get(id).messages.filter(m=>m.purpose==='summary')).toHaveLength(2);
   await context.controller.stop(id);
   const next=await context.controller.fork(id,randomUUID()); expect(next.sessions).toEqual({}); expect(next.status).toBe('ready'); expect(next.rolesConfirmed).toBe(true);
  }finally{await context.cleanup()}
 });
 it('does not load inherited MCP transports in the final Codex process',()=>{
  const args=codexArguments(false,undefined,['production-db','global-other']);
  expect(args).toContain('mcp_servers.production-db.enabled=false'); expect(args).toContain('mcp_servers.global-other.enabled=false');
  expect(()=>codexArguments(false,undefined,['invalid.name'])).toThrow();
 });
 it('refuses a policy with inherited active tools before any AI turn',async()=>{
  const connection:JsonConnection={send(){},endInput(){},async finish(){},async close(){},async next(){return{id:1,result:{config:{approval_policy:'never',sandbox_mode:'read-only',web_search:'disabled',features:Object.fromEntries(disabledFeatures.map(f=>[f,false])),mcp_servers:{unsafe:{enabled:true}}}}}}};
  await expect(verifyCodexPolicy(new RpcConnection(connection),false)).rejects.toMatchObject({code:'POLICY_MISMATCH'});
 });
});
