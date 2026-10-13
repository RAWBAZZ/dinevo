const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
(async()=>{
 const keys=[];
 for(const [file,portal] of [['index.html','customer'],['booking-centre.html','customer'],['dashboard.html','partner'],['admin.html','admin']]){
  const dom=new JSDOM(read(file),{url:'https://dinevo.test/'+file,runScripts:'outside-only'}),w=dom.window;
  let config;w.supabase={createClient:(url,key,options)=>{config=options;return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}}};}};
  w.eval(read('auth.js'));await w.dinevoAuth.init('wrong');keys.push(config.auth.storageKey);
  assert.equal(config.auth.storageKey,'dinevo-'+portal+'-session');assert.match(w.document.querySelector('#authGate h2').textContent,new RegExp(portal,'i'));
  if(portal==='admin')assert.equal(w.document.querySelector('[data-mode=signup]'),null);
  if(portal==='customer')assert.equal(w.document.querySelector('a[href*="dashboard"],a[href*="admin"],a[href*="partner="]'),null);
  if(portal==='partner')assert.equal(w.document.querySelector('a[href*="admin"],a[href*="index"],a[href*="booking-centre"]'),null);
  dom.window.close();
 }
 assert.equal(new Set(keys).size,3);
 const html=read('index.html'),dom=new JSDOM(html,{url:'https://dinevo.test/',runScripts:'outside-only'}),w=dom.window;
 const rows=Array.from({length:10},(_,i)=>({id:'id-'+i,name:i===0?'<script>bad</script>':'Indian restaurant '+i,city:'',cuisines:['Indian'],is_test:true}));let activeFilter;
 w.dinevoAuth={ready:Promise.resolve()};w.sb={from:t=>{assert.equal(t,'d2_restaurants');return {select(){return this},eq(k,v){activeFilter=[k,v];return this},order:async()=>({data:rows})};}};
 w.eval('let restaurantData=[],statusMap={};const favorites=new Set();const selectedRests=new Set();function buildRestaurants(){}function renderFavorites(){}function renderEvents(){}function syncRequestSelection(){}');
 w.eval(html.slice(html.indexOf('async function loadStatuses(){'),html.indexOf('function waitBadge')));
 w.favorites=new w.Set();w.selectedRests=new w.Set();
 w.eval(html.slice(html.indexOf('function miniCard(r,i){'),html.indexOf('function syncRequestSelection()')));
 await w.loadStatuses();assert.deepEqual(activeFilter,['active',true]);assert.equal(w.eval('restaurantData.length'),10);
 w.document.querySelector('#resultsGrid').innerHTML=w.eval('restaurantData.map(miniCard).join(\'\')');assert.equal(w.document.querySelectorAll('#resultsGrid article').length,10);assert.equal(w.document.querySelector('#resultsGrid script'),null);assert.equal(w.document.querySelectorAll('#resultsGrid .select-btn-sm').length,10);
 assert.ok(!html.includes('OBAMA MAMA'));assert.ok(!html.includes("name:'Copper & Clove'"));dom.window.close();
 console.log('Portal tests passed: separate sessions/logins, no cross-portal links, active-only catalogue, 10 cards, escaped names and live booking links.');
})().catch(e=>{console.error(e);process.exitCode=1});
