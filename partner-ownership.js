/* Restaurant claims are validated by the server-side d2_claim_restaurant RPC. */
window.DinevoPartner=(()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let selected='',owned=[];
 const emit=()=>window.dispatchEvent(new Event('dinevo-partner-selection'));
 function update(members,restaurants){
  owned=restaurants.filter(r=>members.some(m=>m.restaurant_id===r.id));
  if(selected&&!owned.some(r=>r.id===selected))selected='';
 }
 function profileMarkup(members,restaurants,email){
  const list=restaurants.filter(r=>members.some(m=>m.restaurant_id===r.id));
  const options='<option value="">All my restaurants</option>'+list.map(r=>'<option value="'+esc(r.id)+'" '+(r.id===selected?'selected':'')+'>'+esc(r.name)+'</option>').join('');
  const restaurantsMarkup=list.length?'<div class="profile-restaurant-list">'+list.map(r=>'<div class="profile-restaurant"><span>'+esc(r.name)+'</span><span class="badge">Linked</span></div>').join('')+'</div>':'<p class="dim">No restaurants linked yet. Claim a listed restaurant to start receiving requests.</p>';
  return '<section class="card partner-profile"><div class="card-top"><div><p class="eyebrow">PARTNER ACCOUNT</p><h2>Profile</h2></div><span class="badge">Restaurant partner</span></div>'+
   '<dl class="profile-account"><div><dt>Signed in as</dt><dd>'+esc(email||'Partner account')+'</dd></div><div><dt>Restaurants linked</dt><dd>'+list.length+'</dd></div></dl>'+
   '<h3>My restaurants</h3>'+restaurantsMarkup+
   '<label>Dashboard restaurant filter<select id="partner-restaurant">'+options+'</select></label><p class="dim">Choose a restaurant to scope bookings, availability and auto-accept settings. “All my restaurants” shows activity across your linked locations.</p>'+
   '<details id="claim-details"><summary>Claim another restaurant</summary><p>Only restaurants listed in the customer app can be claimed. Ask the Dinevo administrator for that restaurant’s unique claim code. You can link multiple restaurants to this account.</p><form id="claim-restaurant-form"><label>Unique restaurant claim code<input id="restaurant-claim-code" name="code" required maxlength="64" placeholder="Enter code from Dinevo admin" autocomplete="off" autocapitalize="characters" spellcheck="false"></label><button class="primary" id="claim-submit">Claim restaurant</button><p id="claim-result" role="status" aria-live="polite"></p></form></details>'+
   '<div class="profile-help"><h3>Partner tools</h3><p><strong>Incoming:</strong> review customer requests and send offers.</p><p><strong>Counter offers:</strong> respond to a customer’s requested discount.</p><p><strong>Bookings:</strong> confirm accepted offers, then verify guests with their booking QR or five-digit ID.</p><div class="profile-actions"><button type="button" data-action="tab" data-id="Availability">Update availability</button><button type="button" data-action="tab" data-id="Auto-accept">Auto-accept rules</button></div></div></section>';
 }
 function bindProfile(){
  const select=document.querySelector('#partner-restaurant');
  if(select)select.onchange=e=>{selected=e.target.value;emit();};
  const form=document.querySelector('#claim-restaurant-form');
  if(!form)return;
  form.onsubmit=async e=>{
   e.preventDefault();const btn=document.querySelector('#claim-submit'),msg=document.querySelector('#claim-result'),input=document.querySelector('#restaurant-claim-code');
   if(!btn||btn.disabled)return;
   btn.disabled=true;msg.textContent='Checking code…';
   try{const {data,error}=await sb.rpc('d2_claim_restaurant',{p_code:input.value.trim()});if(error)throw error;if(!data?.ok)throw new Error(data?.error||'Claim could not be completed');selected=data.restaurant_id;input.value='';msg.textContent=data.name+' is now linked to your account.';window.dispatchEvent(new Event('dinevo-membership-changed'));}
   catch(error){msg.textContent=error.message||'Could not verify this claim code.';}
   finally{btn.disabled=false;}
  };
 }
 return {update,profileMarkup,bindProfile,get selected(){return selected;}};
})();