/* Ownership claims never trust a selected restaurant or user-editable metadata. */
window.DinevoPartner=(()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let selected='',section,claimedOnce=false;
 const emit=()=>window.dispatchEvent(new Event('dinevo-partner-selection'));
 function update(members,restaurants){
  if(!section){
   section=document.createElement('section');section.className='card';section.id='partner-ownership';
   section.innerHTML='<div class="card-top"><h2>My restaurants</h2></div><p id="claim-intro"></p><label>Manage restaurant<select id="partner-restaurant"><option value="">All my restaurants</option></select></label><div id="owned-restaurants" class="dim"></div><details id="claim-details"><summary>Claim restaurant ownership</summary><p>Ask your Dinevo administrator for the restaurant’s unique code. You can claim more than one restaurant with this account.</p><form id="claim-restaurant-form"><label>Unique claim code<input id="restaurant-claim-code" name="code" required maxlength="64" placeholder="DINEVO-…" autocomplete="off" autocapitalize="characters" spellcheck="false"></label><button class="primary" id="claim-submit">Claim restaurant</button><p id="claim-result" role="status" aria-live="polite"></p></form></details>';
   document.querySelector('#tabs').before(section);
   document.querySelector('#partner-restaurant').onchange=e=>{selected=e.target.value;emit();};
   document.querySelector('#claim-restaurant-form').onsubmit=async e=>{
    e.preventDefault();const btn=document.querySelector('#claim-submit'),msg=document.querySelector('#claim-result');if(btn.disabled)return;
    btn.disabled=true;msg.textContent='Checking code…';
    try{const {data,error}=await sb.rpc('d2_claim_restaurant',{p_code:document.querySelector('#restaurant-claim-code').value.trim()});if(error)throw error;if(!data?.ok)throw new Error(data?.error||'Claim could not be completed');selected=data.restaurant_id;claimedOnce=true;document.querySelector('#restaurant-claim-code').value='';msg.textContent=data.name+' is now linked to your account. You can claim another restaurant below.';window.dispatchEvent(new Event('dinevo-membership-changed'));}
    catch(error){msg.textContent=error.message;}finally{btn.disabled=false;}
   };
  }
  const owned=restaurants.filter(r=>members.some(m=>m.restaurant_id===r.id));
  if(selected&&!owned.some(r=>r.id===selected))selected='';
  document.querySelector('#claim-intro').textContent=owned.length?`You manage ${owned.length} restaurant${owned.length===1?'':'s'}. Use another code to add more.`:'Welcome. Claim your first restaurant to start receiving requests and managing bookings.';
  document.querySelector('#owned-restaurants').textContent=owned.map(r=>r.name).join(' · ');
  document.querySelector('#partner-restaurant').innerHTML='<option value="">All my restaurants</option>'+owned.map(r=>`<option value="${esc(r.id)}" ${r.id===selected?'selected':''}>${esc(r.name)}</option>`).join('');
  if(!owned.length||claimedOnce)document.querySelector('#claim-details').open=true;
 }
 return {update,get selected(){return selected;}};
})();
