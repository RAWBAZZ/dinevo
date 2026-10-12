const {JSDOM,VirtualConsole}=require('jsdom'),fs=require('fs'),assert=require('assert/strict'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
(async()=>{
 const dom=new JSDOM(html,{url:'https://dinevo.test/',runScripts:'outside-only',virtualConsole:new VirtualConsole()}),w=dom.window,d=w.document;
 const calls=[];w.sb={rpc:async(name,args)=>{calls.push([name,args]);return {data:['request-1','request-2']};}};
 w.dinevoAuth={getUser:()=>({id:'customer'})};w.showToast=()=>{};
 const cards=html.slice(html.indexOf('function miniCard('),html.indexOf('/* ================= RESULTS PAGE',html.indexOf('function miniCard(')));
 const send=html.slice(html.indexOf('let quoteAttempt=null;'),html.indexOf('/* ================= STATUS TRACKER'));
 w.eval(`const state={adults:2,kids:1,meal:'dinner',foodType:'jain',time:'20:30',bill:'₹1,000',cuisines:['Indian']};const foodLabels={jain:'Jain Food'},mealLabels={dinner:'Dinner'};function validateStep(){return null;}function bookingDateISO(){return new Date(Date.now()+86400000).toISOString().slice(0,10);}const selectedRests=new Set(),favorites=new Set();const restaurantData=[{id:'a',name:'Kesar Aangan',cuisine:'Indian',is_test:true},{id:'b',name:'Amrit Rasoi',cuisine:'Indian',is_test:true}];function toggleFavorite(){}function openProfile(){};`+cards+send+`document.querySelector('#resultsGrid').innerHTML=restaurantData.map(miniCard).join('');wireCardButtons(document.querySelector('#resultsGrid'));`);
 d.querySelectorAll('.select-btn-sm').forEach(b=>b.click());assert.equal(d.querySelector('#selCount').textContent,'2');assert.notEqual(d.querySelector('#sendRequestBar').style.display,'none');
 await d.querySelector('#sendReqBtn').onclick();
 assert.equal(calls.length,1);assert.equal(calls[0][0],'d2_request_quotes');assert.equal(calls[0][1].p_restaurants.length,2);assert.equal(calls[0][1].p_party,3);assert.equal(calls[0][1].p_preferences.food,'Jain Food');assert.equal(calls[0][1].p_bill,100000);
 assert.equal(d.querySelector('#sendRequestBar').style.display,'none');assert.equal(d.querySelector('#selCount').textContent,'0');assert.ok(d.querySelector('#statusTracker').textContent.includes('Requests sent'));
 dom.window.close();console.log('10 customer selection assertions passed: multi-select, one batch, preferences/budget, success clears request bar.');
})().catch(e=>{console.error(e);process.exitCode=1});
