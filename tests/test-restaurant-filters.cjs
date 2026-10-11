const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(match[1].trim())new vm.Script(match[1]);
const start=html.indexOf("const resultsState ="),end=html.indexOf('\nbuildRestaurants();',start);
assert.ok(start>0&&end>start);const grid={innerHTML:''};
const ctx=vm.createContext({restaurantData:[{name:'Regular restaurant',type:'both',cuisine:'Italian',rating:4.5,cost:'₹1000',disc:'20%'}],matchesFilter:()=>true,document:{getElementById:()=>grid},miniCard:()=>'<div>Regular restaurant</div>',wireCardButtons(){},syncRequestSelection(){}});
vm.runInContext(html.slice(start,end),ctx);let count=0;
for(const cuisine of ['North Indian','Italian','Chinese','Jain','Unknown cuisine'])for(const food of ['veg','nonveg','pureveg','jain','vegan']){
 vm.runInContext(`resultsState.cuisine=${JSON.stringify(cuisine)};resultsState.foodFilter=${JSON.stringify(food)};buildRestaurants();`,ctx);
 assert.ok(grid.innerHTML.includes('OBAMA MAMA'));
 assert.ok(grid.innerHTML.includes('TEST RESTAURANT'));
 assert.ok(grid.innerHTML.includes('booking-centre.html?restaurant=39ba8eb1-872a-432a-b019-2bbc68f9b34c'));
 count++;
}
console.log(`${count} cuisine/dietary combinations passed; inline scripts parse.`);
