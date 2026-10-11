// DOM → Supabase-shaped adapter → real disposable PostgreSQL → both dashboards.
// No production users, bookings, wallet balances or payments are changed.
const {PGlite}=require('@electric-sql/pglite');
const {JSDOM}=require('jsdom');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const ids={customer:'00000000-0000-0000-0000-000000000001',partner:'00000000-0000-0000-0000-000000000002',outsider:'00000000-0000-0000-0000-000000000003'};
const delay=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
 const db=new PGlite();let checks=0,queue=Promise.resolve();const windows=[];
 const ok=(v,label)=>{assert.ok(v,label);checks++;console.log('PASS '+label);};
 const query=(sql,args=[])=>db.query(sql,args);
 const as=(uid,sql,args=[])=>{const job=queue.then(async()=>{await db.exec(`reset role;select set_config('request.jwt.claim.sub','${uid}',false);set role authenticated;`);try{return await query(sql,args);}finally{await db.exec('reset role');}});queue=job.catch(()=>{});return job;};
 const fail=async(uid,sql,args,label)=>{await assert.rejects(as(uid,sql,args));checks++;console.log('PASS '+label);};
 async function settle(predicate,label){for(let i=0;i<100;i++){await queue;await delay();if(predicate())return;}throw Error('Timed out: '+label);}
 function app(partner){
  const dom=new JSDOM(fs.readFileSync(path.join(root,'booking-centre.html'),'utf8'),{url:'https://test.dinevo/booking-centre.html'+(partner?'?partner=1':''),runScripts:'outside-only',pretendToBeVisual:true});windows.push(dom);
  const w=dom.window,d=w.document,uid=partner?ids.partner:ids.customer;let refresh;
  w.setInterval=(fn,ms)=>{if(ms===15000)refresh=fn;return 1;};w.clearInterval=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};w.HTMLElement.prototype.scrollIntoView=function(){};
  w.QRCode={toCanvas(){}};w.dinevoAuth={init(){},ready:Promise.resolve(),getUser:()=>({id:uid})};
  w.sb={from(table){assert.match(table,/^d2_[a-z_]+$/);return {select(){return this;},order(col){assert.match(col,/^[a-z_]+$/);this.col=col;return this;},async limit(n){try{return {data:(await as(uid,`select * from public.${table}${this.col?' order by '+this.col+' desc':''} limit $1`,[n])).rows};}catch(e){return {error:{message:e.message}};}}};},async rpc(name,args={}){assert.match(name,/^d2_[a-z_]+$/);const keys=Object.keys(args);try{const r=await as(uid,`select * from public.${name}(${keys.map((k,i)=>{assert.match(k,/^[a-z_]+$/);return k+'=>$'+(i+1);}).join(',')})`,Object.values(args));return {data:name==='d2_available'?r.rows:r.rows[0]?.[name]};}catch(e){return {error:{message:e.message}};}}};
  w.eval(fs.readFileSync(path.join(root,'booking-centre.js'),'utf8'));
  return {w,d,async refresh(){await settle(()=>!!refresh,'initial load');refresh();await queue;await delay();},click(action,id){const e=[...d.querySelectorAll('[data-action]')].find(e=>e.dataset.action===action&&(!id||e.dataset.id===id));assert.ok(e,'Control '+action);e.click();},async submit(){d.querySelector('#dialog-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle(()=>!d.querySelector('#dialog-submit').disabled,'submit completed');const error=d.querySelector('#dialog-error').textContent;if(error)throw Error(error);await queue;await delay();}};
 }
 try{
  await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;");
  for(const f of ['202610100001_booking_centre.sql','20261010200450_test_token_flow.sql'])await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8'));
  await query('insert into auth.users values($1),($2),($3)',Object.values(ids));
  const restaurant=(await query("insert into d2_restaurants(name) values('Test <script>restaurant</script>') returning id")).rows[0].id;
  await query('insert into d2_members values($1,$2)',[restaurant,ids.partner]);
  const staff=app(true),guest=app(false);await staff.refresh();await guest.refresh();
  staff.click('tab','Availability');staff.click('publish');staff.d.querySelector('[name=start]').value='2099-10-10T20:30';staff.d.querySelector('[name=capacity]').value='2';await staff.submit();
  ok((await query('select * from d2_slots')).rows.length===1,'Partner publishes availability from the UI');
  await guest.refresh();ok(guest.d.querySelectorAll('#content script').length===0,'Restaurant text is escaped');guest.click('request');guest.d.querySelector('[name=dietary]').value='Peanut allergy';await guest.submit();
  ok(!guest.d.querySelector('#dialog').open,'Request form disappears after successful submission');
  let b=(await query('select * from d2_bookings')).rows[0];const booking=b.id;
  await fail(ids.outsider,'select d2_test_token($1,100000,true)',[booking],'Another customer cannot simulate this token');
  await fail(ids.customer,'select d2_test_token($1,100000,true)',[booking],'Cannot skip restaurant acceptance');
  await staff.refresh();staff.click('tab','Upcoming');staff.click('offer',booking);await staff.submit();
  b=(await query('select * from d2_bookings where id=$1',[booking])).rows[0];ok(b.status==='offered'&&Date.parse(b.expires_at)>Date.now(),'Restaurant acceptance starts confirmation hold');
  staff.click('preferences',booking);await staff.submit();await guest.refresh();guest.click('accept',booking);
  guest.d.querySelector('[name=bill]').value='1250';guest.d.querySelector('[name=bill]').dispatchEvent(new guest.w.Event('input'));
  ok(guest.d.querySelector('#test-amount').textContent.includes('25.00'),'2% of ₹1,250 is ₹25');
  guest.d.querySelector('[name=test_ack]').checked=true;await guest.submit();
  b=(await query('select * from d2_bookings where id=$1',[booking])).rows[0];
  ok(b.is_test&&b.status==='token_verified'&&Number(b.test_token_paise)===2500,'Test token advances to partner review');
  ok(Number(b.paid_paise)===0&&b.payment_ref===null,'No real payment or provider reference is fabricated');
  await as(ids.customer,'select d2_test_token($1,125000,true)',[booking]);
  ok((await query("select * from d2_events where booking_id=$1 and kind='test_token_submitted'",[booking])).rows.length===1,'Retry does not duplicate token or event');
  ok((await as(ids.customer,'select * from d2_available()')).rows[0].remaining===2,'Test booking releases real seat capacity');
  await staff.refresh();staff.click('tab','Updates');ok(staff.d.body.textContent.includes('TEST · Token simulated'),'Partner receives clearly labelled test-token notification');
  staff.click('tab','Upcoming');ok(staff.d.body.textContent.includes('₹25.00')&&staff.d.body.textContent.includes('20%'),'Partner sees exact test token and agreed discount');staff.click('confirm',booking);await staff.submit();
  ok(staff.d.querySelector('#dialog-title').textContent==='Test booking confirmed','Partner gets test confirmation animation');staff.d.querySelector('#close-dialog').click();
  await guest.refresh();ok(guest.d.querySelector('#dialog-title').textContent==='Test booking confirmed','Customer gets test confirmation animation');guest.d.querySelector('#close-dialog').click();
  staff.click('test-arrival',booking);await staff.submit();staff.click('tab','Arrived');ok(staff.d.body.textContent.includes('TEST · Arrived'),'Test guest arrives without waiting for future date');staff.click('seated',booking);await staff.submit();staff.click('tab','Seated');ok(staff.d.body.textContent.includes('TEST · Seated'),'Active seated section updates');staff.click('completed',booking);await staff.submit();staff.click('tab','Completed');ok(staff.d.body.textContent.includes('TEST · Completed'),'Completed section updates');
  await guest.refresh();guest.click('review',booking);guest.d.querySelector('[name=body]').value='Test visit feedback';await guest.submit();ok((await query('select * from d2_reviews where booking_id=$1',[booking])).rows.length===1,'Customer can submit feedback after completion');ok(guest.d.body.textContent.includes('Test visit feedback · 5/5'),'Test feedback is not labelled a verified real visit');
  await fail(ids.customer,'select d2_verify_payment($1,\'fake\',2500)',[booking],'Browser cannot verify a real payment');
  await assert.rejects(query('select d2_verify_payment($1,\'provider-ref\',2500)',[booking]));checks++;
  const realSlot=(await as(ids.partner,"select d2_publish_slot($1,'2099-10-11T15:00:00Z',2,2,20,100000,2000,24,'Drinks excluded') as id",[restaurant])).rows[0].id;
  const realBooking=(await as(ids.customer,'select d2_request($1,2) as id',[realSlot])).rows[0].id;
  await as(ids.partner,"select d2_action($1,'offer')",[realBooking]);
  await fail(ids.customer,'select d2_test_token($1,100000,false)',[realBooking],'Explicit acknowledgement required');
  await fail(ids.customer,'select d2_test_token($1,1,true)',[realBooking],'Below-minimum bill rejected');
  await as(ids.customer,"select d2_action($1,'accept')",[realBooking]);await query("select d2_verify_payment($1,'provider-real',2000)",[realBooking]);
  await fail(ids.customer,'select d2_test_token($1,100000,true)',[realBooking],'Real paid booking cannot be converted to a test');
  await as(ids.partner,"select d2_action($1,'confirm')",[realBooking]);const real=(await query('select * from d2_bookings where id=$1',[realBooking])).rows[0];
  await fail(ids.partner,'select d2_checkin($1,$2)',[realBooking,real.checkin_code],'Real booking still enforces arrival time');
  console.log(`${checks} full-flow assertions passed.`);
 }finally{windows.forEach(w=>w.window.close());await queue;await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
