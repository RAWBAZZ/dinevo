const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html','utf8');
function extract(name){
 const start = html.indexOf(`function ${name}(`);
 const asyncStart = html.slice(start-6,start)==='async ' ? start-6 : start;
 const next = html.indexOf('\n}',start)+2;
 return html.slice(asyncStart,next);
}
function context(extra={}){
 const ctx = vm.createContext({console:{error(){}},Date, state:{date:'Custom',customDateValue:'2026-12-31',time:'20:30',meal:'dinner',adults:2,kids:0,bill:'₹500',cuisines:[]},dinevoAuth:{getUser:()=>({id:'customer-1'})},showToast(){},renderOffers(){},_offersSig:null,...extra});
 for(const name of ['localDateISO','bookingDateISO','formatTime','pushRequestsToStorage','updateOfferStatus','cancelBooking','readOffers','openPayment']) vm.runInContext(extract(name),ctx);
 return ctx;
}
test('all inline JavaScript parses',()=>{
 for(const page of ['index.html','dashboard.html']){
  for(const match of fs.readFileSync(page,'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
 }
});
test('local calendar date does not shift to UTC',()=>{
 const c=context();
 assert.equal(c.localDateISO(new Date(2026,0,1,0,15)), '2026-01-01');
 assert.equal(c.bookingDateISO(),'2026-12-31');
});
test('request saves date and rejects database failure',async()=>{
 let saved;
 const c=context({validateStep:()=>null,selectedRests:new Set(['Restaurant']),restaurantData:[],mealLabels:{dinner:'Dinner'},foodLabels:{},sb:{from:()=>({insert:async rows=>{saved=rows;return {error:null};}})}});
 await c.pushRequestsToStorage();
 assert.match(saved[0].meal,/2026-12-31/);
 assert.equal(saved[0].customer_id,'customer-1');
 c.sb.from=()=>({insert:async()=>({error:new Error('offline')})});
 await assert.rejects(c.pushRequestsToStorage(),/offline/);
 c.dinevoAuth.getUser=()=>null;
 await assert.rejects(c.pushRequestsToStorage(),/sign in/);
});
test('offer reads are scoped to signed-in customer',async()=>{
 const filters=[];
 const query={select(){return this},eq(...args){filters.push(args);return this},async order(){return {data:[],error:null}}};
 const c=context({sb:{from:()=>query}});
 await c.readOffers();
 assert.deepEqual(filters,[['customer_id','customer-1']]);
 c.dinevoAuth.getUser=()=>null;
 c.sb.from=()=>{throw Error('must not query')};
 assert.equal((await c.readOffers()).length,0);
});
test('failed or invisible cancellation never removes booking or claims success',async()=>{
 let saved=false;const messages=[];
 const query={update(){return this},eq(){return this},select(){return this},async single(){return {data:null,error:null}}};
 const tracked=new Set(['Restaurant']);
 const c=context({sb:{from:()=>query},confirm:()=>true,trackedRests:tracked,saveTrackedRests(){saved=true},showToast:m=>messages.push(m),renderStatusTracker(){}});
 await c.cancelBooking('offer-1','Restaurant');
 assert.equal(tracked.has('Restaurant'),true);
 assert.equal(saved,false);
 assert.equal(messages.some(m=>m.includes('Booking cancelled')),false);
 assert.equal(await c.updateOfferStatus('offer-1','confirmed'),false);
});
test('payment preview cannot confirm or collect payment',()=>{
 const elements={paymentOverlay:{classList:{add(){},remove(){}}},paymentSheet:{querySelectorAll:()=>[]},paymentClose:{}};
 const c=context({document:{getElementById:id=>elements[id]}});
 c.openPayment({bill:'₹500',discount:'10%',restaurant:'Restaurant',guests:'2 Adults',meal:'Dinner'});
 assert.match(elements.paymentSheet.innerHTML,/id="payNowBtn" disabled/);
 assert.match(elements.paymentSheet.innerHTML,/will not confirm a booking/);
});
