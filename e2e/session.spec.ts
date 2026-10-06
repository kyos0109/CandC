import { test, expect } from './fixtures';
for (const rejectFirst of [false, true]) test(`session bootstrap and SSE renewal (reject first: ${rejectFirst})`, async ({page}) => {
 const id='11111111-1111-4111-8111-111111111111'; let sessionReady=false; let events=0; let unauthorized=0; let sessions=0;
 const state={id,topic:'Session race fixture',backend:'fake',kind:'discussion',mode:'auto',flow:'free',status:'ready',roles:{codex:'',claude:''},rolesConfirmed:true,activity:null,agents:{codex:{model:'fixture',effort:'medium'},claude:{model:'fixture',effort:'medium'}},messages:[],evidence:[],roots:[],research:false,limits:{maxRounds:50,maxDurationMs:14400000,turnTimeoutMs:600000},elapsedMs:0,createdAt:new Date().toISOString(),completedInRound:[],nextSpeaker:'codex',pauseReason:null};
 await page.addInitScript(id=>localStorage.setItem('candc-discussion',id),id);
 await page.route('**/api/session',async route=>{await new Promise(r=>setTimeout(r,500));sessionReady=true;sessions++;await route.fulfill({json:{}});});
 await page.route('**/api/discussion-index?*',route=>route.fulfill({json:{items:[{...state,folder:'active',lastActivityAt:state.createdAt,participants:[],moderator:false,outcome:null}],total:1,page:1,limit:50,counts:{active:1,archived:0,trash:0},runningIds:state.status==='running'?[id]:[],pendingDeletions:[]}}));
 await page.route('**/api/discussions/'+id,route=>route.fulfill({json:state}));
 await page.route('**/api/storage-issues',route=>route.fulfill({json:[]}));
 await page.route('**/api/environment',route=>route.fulfill({json:{ready:false,codex:{ready:false},claude:{ready:false}}}));
 await page.route('**/api/models',route=>route.fulfill({json:{codex:[],claude:[],error:null}}));
 await page.route('**/events',route=>{events++; if (!sessionReady) unauthorized++; const accepted=sessionReady && !(rejectFirst && events===1); return route.fulfill({status:accepted?200:401,contentType:accepted?'text/event-stream':'application/json',body:accepted?': connected\n\n':'{}'});});
 await page.route('**/start',route=>{state.status='running';return route.fulfill({json:state});});
 await page.goto('/');
 await expect(page.getByRole('button',{name:'開始討論',exact:true})).toBeVisible();
 await expect.poll(() => events).toBeGreaterThan(0);
 expect(unauthorized).toBe(0);
 expect(sessionReady).toBe(true);
 if (rejectFirst) { await expect.poll(() => sessions).toBe(2); await expect.poll(() => events).toBeGreaterThan(1); }
 await page.getByRole('button',{name:'開始討論',exact:true}).click();
 await expect(page.locator('.status')).toContainText('討論中');
 expect(unauthorized).toBe(0);

});
