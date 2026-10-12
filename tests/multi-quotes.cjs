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
 for(const file of ['202610100001_booking_centre.sql','20261010200450_test_token_flow.sql','20261011035628_restaurant_claims.sql','20261012171249_multi_restaurant_quotes.sql'])await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
 await q('insert into auth.users values($1,now()),($2,now()),($3,now())',[admin,partner,other]);
 const restaurants=(await q("insert into d2_restaurants(name,is_test) values('Kesar Aangan',true),('Amrit Rasoi',true),('Unselected',true) returning id")).rows;
 const [one,two,three]=restaurants.map(r=>r.id);
 await q('insert into d2_members values($1,$2)',[one,partner]);
 const args={p_restaurants:[one,two],p_start:new Date(Date.now()+86400000).toISOString(),p_party:4,p_bill:100000,p_preferences:{food:'Jain',adults:2,kids:2,meal:'Dinner'},p_batch:'00000000-0000-0000-0000-000000000099'};
 const ids=await call(admin,'d2_request_quotes',args);ok(ids.length===2,'One submission creates requests for two selected restaurants');
 ok((await q('select count(*)::int n from d2_slots')).rows[0].n===0,'Quotes need no invented availability slots');
 ok((await call(admin,'d2_request_quotes',args)).length===2&&(await q('select count(*)::int n from d2_bookings')).rows[0].n===2,'Network retry does not duplicate requests');
 await assert.rejects(call(admin,'d2_request_quotes',{...args,p_party:5}));checks++;
 ok((await as(partner,'select * from d2_bookings')).rows.length===1,'Partner sees only its selected restaurant request');
 ok((await as(other,'select * from d2_bookings')).rows.length===0,'Unrelated account cannot read requests');
 const first=(await q('select * from d2_bookings where restaurant_id=$1',[one])).rows[0],second=(await q('select * from d2_bookings where restaurant_id=$1',[two])).rows[0];
 ok(first.preferences.food==='Jain'&&first.preferences.kids===2,'Food preference and children reach partner');
 ok((await as(partner,'select * from d2_notices')).rows.length===1,'Claimed partner receives in-app request notification');
 await assert.rejects(call(other,'d2_quote_offer',{p_booking:first.id,p_discount:20,p_minimum:100000,p_terms:'No drinks'}));checks++;
 const board=app('dashboard.html',partner);await settled(()=>board.d.querySelector('[data-action="quote-offer"]'));
 board.d.querySelector('[data-action="quote-offer"]').click();board.d.querySelector('[name=discount]').value='25';board.d.querySelector('[name=minimum]').value='1000';board.submit('#dialog-form');await settled(()=>!board.d.querySelector('#dialog').open);
 const offered=(await q('select * from d2_bookings where id=$1',[first.id])).rows[0];ok(offered.status==='offered'&&offered.discount===25,'Partner offer form sends discount to customer');
 ok(Date.parse(offered.expires_at)-Date.now()<=300000,'Offer has a five-minute response window');
 const msg={p_booking:first.id,p_body:'Can you confirm Jain food?',p_id:'00000000-0000-0000-0000-000000000090'};
 await call(admin,'d2_send_message',msg);await call(admin,'d2_send_message',msg);ok((await as(partner,'select * from d2_messages')).rows.length===1,'Private customer message delivered once');
 await assert.rejects(call(other,'d2_send_message',{...msg,p_id:'00000000-0000-0000-0000-000000000091'}));checks++;
 ok((await as(other,'select * from d2_messages')).rows.length===0,'Other restaurants cannot read messages');
 await call(admin,'d2_test_token',{p_booking:first.id,p_bill_paise:100000,p_accept_test:true});
 await call(partner,'d2_action',{p_booking:first.id,p_action:'confirm'});
 const confirmed=(await q('select * from d2_bookings where id=$1',[first.id])).rows[0];ok(confirmed.status==='confirmed'&&confirmed.test_token_paise===2000&&confirmed.paid_paise===0,'Quote continues through 2% test token and partner confirmation');
 await q('insert into d2_members values($1,$2)',[two,other]);ok((await as(other,'select * from d2_bookings')).rows.length===1,'Later restaurant claim receives its queued request');
 await q('update d2_restaurants set active=false where id=$1',[three]);
 await assert.rejects(call(admin,'d2_request_quotes',{...args,p_batch:'00000000-0000-0000-0000-000000000098',p_restaurants:[one,three]}));checks++;
 ok((await q('select count(*)::int n from d2_bookings')).rows[0].n===2,'Inactive selection rejects whole batch without partial delivery');
 await assert.rejects(as(admin,"insert into d2_messages(booking_id,sender,body) values($1,$2,'direct write')",[first.id,admin]));checks++;
 console.log(checks+' multi-restaurant quote assertions passed.');
 }finally{windows.forEach(w=>w.window.close());await queue;await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
