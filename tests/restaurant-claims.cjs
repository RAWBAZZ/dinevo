const {PGlite}=require('@electric-sql/pglite'),{JSDOM}=require('jsdom');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const root=path.join(__dirname,'..');
(async()=>{const db=new PGlite(),windows=[];let queue=Promise.resolve(),checks=0;const admin='00000000-0000-0000-0000-000000000001',partner='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003',unverified='00000000-0000-0000-0000-000000000004';
 const q=(sql,args=[])=>db.query(sql,args);const ok=(v,s)=>{assert.ok(v,s);checks++;console.log('PASS '+s);};
 const as=(uid,sql,args=[])=>{const job=queue.then(async()=>{await db.exec(`reset role;select set_config('request.jwt.claim.sub','${uid}',false);set role authenticated;`);try{return await q(sql,args);}finally{await db.exec('reset role');}});queue=job.catch(()=>{});return job;};
 const call=async(uid,name,args={})=>{if(name==='d2_available')return (await as(uid,'select * from public.d2_available()')).rows;const keys=Object.keys(args);const r=await as(uid,`select public.${name}(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) as result`,Object.values(args));return r.rows[0].result;};
 async function settled(test){for(let i=0;i<150;i++){await queue;await new Promise(r=>setTimeout(r,15));if(test())return;}throw Error('UI timed out');}
 function app(file,uid){const dom=new JSDOM(fs.readFileSync(path.join(root,file),'utf8'),{url:'https://dinevo.test/'+file,runScripts:'outside-only',pretendToBeVisual:true});windows.push(dom);const w=dom.window,d=w.document;w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};w.setInterval=()=>1;w.clearInterval=()=>{};
 w.dinevoAuth={init(){},ready:Promise.resolve(),getUser:()=>({id:uid})};w.QRCode={toCanvas(){}};w.sb={async rpc(name,args={}){try{return {data:await call(uid,name,args)};}catch(e){return {error:{message:e.message}};}},from(table){return {select(){return this;},order(c){this.c=c;return this;},async limit(n){try{return {data:(await as(uid,`select * from public.${table}${this.c?' order by '+this.c+' desc':''} limit $1`,[n])).rows};}catch(e){return {error:{message:e.message}};}}};}};
 for(const f of file==='admin.html'?['admin.js']:['partner-ownership.js','booking-centre.js'])w.eval(fs.readFileSync(path.join(root,f),'utf8'));
 return {w,d,submit(selector){d.querySelector(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}};}
 try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;");
 for(const file of ['202610100001_booking_centre.sql','20261010200450_test_token_flow.sql','20261011035628_restaurant_claims.sql'])await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
 await q('insert into auth.users values($1,now()),($2,now()),($3,now()),($4,null)',[admin,partner,other,unverified]);await q('insert into d2_admins values($1)',[admin]);
 await assert.rejects(call(partner,'d2_admin_restaurants'));checks++;
 await assert.rejects(as(partner,'insert into d2_admins values($1)',[partner]));checks++;
 const adminApp=app('admin.html',admin),partnerApp=app('dashboard.html',partner),deniedApp=app('admin.html',other);
 await settled(()=>!adminApp.d.querySelector('#admin-content').hidden);await settled(()=>partnerApp.d.querySelector('#claim-details')?.open);await settled(()=>deniedApp.d.querySelector('#admin-status').textContent.includes('no administrator access'));
 ok(deniedApp.d.querySelector('#admin-content').hidden,'Non-admin UI stays closed');
 ok(partnerApp.d.querySelector('#claim-details').open,'Partner is asked to claim after sign-in');
 const create=async(name)=>{const d=adminApp.d;d.querySelector('[name=name]').value=name;d.querySelector('[name=city]').value='Mumbai';d.querySelector('[name=cuisines]').value='Italian, Indian';d.querySelector('[name=test]').checked=true;adminApp.submit('#create-restaurant');await settled(()=>!d.querySelector('#create-button').disabled);if(!d.querySelector('#new-code').textContent.startsWith('DINEVO-'))throw Error(d.querySelector('#admin-status').textContent);return d.querySelector('#new-code').textContent;};
 const code1=await create('OBAMA MAMA <test>');ok(/^DINEVO-[0-9A-F]{32}$/.test(code1),'Admin creates listing and random code atomically');
 let records=(await q('select * from d2_restaurants')).rows;const first=records[0].id;
 const stored=(await q('select * from d2_claim_codes')).rows[0];ok(stored.code_hash!==code1&&stored.code_hash.length===64,'Only code hash is stored');
 await assert.rejects(as(partner,'select * from d2_claim_codes'));checks++;
 ok(!(await call(unverified,'d2_claim_restaurant',{p_code:code1})).ok,'Unverified email cannot claim');
 partnerApp.d.querySelector('#restaurant-claim-code').value=code1;partnerApp.submit('#claim-restaurant-form');await settled(()=>partnerApp.d.querySelector('#claim-result').textContent.includes('linked'));await settled(()=>partnerApp.d.querySelector('#owned-restaurants').textContent.includes('OBAMA MAMA'));
 ok(partnerApp.d.querySelector('#owned-restaurants').textContent.includes('OBAMA MAMA <test>'),'Claimed restaurant appears in main dashboard');ok(!partnerApp.d.querySelector('#owned-restaurants test'),'Restaurant names are escaped');
 ok((await call(partner,'d2_claim_restaurant',{p_code:code1})).ok,'Same-owner retry is idempotent');
 ok(!(await call(other,'d2_claim_restaurant',{p_code:code1})).ok,'Used code cannot be claimed by another account');
 const code2=await create('Second restaurant');partnerApp.d.querySelector('#restaurant-claim-code').value=code2;partnerApp.submit('#claim-restaurant-form');await settled(()=>partnerApp.d.querySelector('#owned-restaurants').textContent.includes('Second restaurant'));
 ok((await as(partner,'select * from d2_members')).rows.length===2,'One partner can claim multiple restaurants');
 ok(partnerApp.d.querySelectorAll('#partner-restaurant option').length===3,'Restaurant switcher includes both plus All');
 ok((await as(other,'select * from d2_members')).rows.length===0,'Other account cannot read memberships');
 await assert.rejects(as(other,'insert into d2_members values($1,$2)',[first,other]));checks++;
 const third=await call(admin,'d2_admin_create_restaurant',{p_name:'Third',p_city:'Mumbai',p_cuisines:[],p_is_test:true,p_request:'00000000-0000-0000-0000-000000000099'});
 const retry=await call(admin,'d2_admin_create_restaurant',{p_name:'Third',p_city:'Mumbai',p_cuisines:[],p_is_test:true,p_request:'00000000-0000-0000-0000-000000000099'});ok(retry.already_created&&retry.restaurant_id===third.restaurant_id&&retry.code===null,'Create retry does not duplicate restaurant or rotate code');
 await q('update d2_restaurants set active=false where id=$1',[third.restaurant_id]);ok(!(await call(other,'d2_claim_restaurant',{p_code:third.code})).ok,'Unlisted restaurant cannot be claimed');await q('update d2_restaurants set active=true where id=$1',[third.restaurant_id]);
 const replacement=await call(admin,'d2_issue_claim_code',{p_restaurant:third.restaurant_id});ok(!(await call(other,'d2_claim_restaurant',{p_code:third.code})).ok,'Replacement invalidates previous code');
 await q("update d2_claim_codes set expires_at=now()-interval '1 second' where restaurant_id=$1",[third.restaurant_id]);ok(!(await call(other,'d2_claim_restaurant',{p_code:replacement.code})).ok,'Expired code rejected');
 const valid=await call(admin,'d2_issue_claim_code',{p_restaurant:third.restaurant_id});for(let i=0;i<10;i++)await call(other,'d2_claim_restaurant',{p_code:'wrong'});
 ok((await call(other,'d2_claim_restaurant',{p_code:valid.code})).error.includes('Too many'),'Invalid-attempt rate limit persists');
 await q("update d2_claim_attempts set window_start=now()-interval '11 minutes' where user_id=$1",[other]);ok((await call(other,'d2_claim_restaurant',{p_code:valid.code})).ok,'Claim succeeds after retry window resets');
 const list=await call(admin,'d2_admin_restaurants');ok(list.length===3&&!JSON.stringify(list).includes('code_hash')&&!JSON.stringify(list).includes(code1),'Admin listing omits secrets');
 await assert.rejects(call(partner,'d2_issue_claim_code',{p_restaurant:first}));checks++;
 console.log(`${checks} ownership/admin assertions passed.`);
 }finally{windows.forEach(w=>w.window.close());await queue;await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
