/* ===================== DINEVO SHARED AUTH ===================== */
const SUPABASE_URL = 'https://nvvmkuyimymigcazjobv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_7bJT1ZvXzpQy6akNvyKCcA_Gbh_d0S6';
window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

window.dinevoAuth = (function(){
  let resolveReady;
  const ready = new Promise(res => resolveReady = res);
  let currentUser = null;

  function el(html){ const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }

  function injectStyles(){
    if(document.getElementById('authStyles')) return;
    const style = document.createElement('style');
    style.id = 'authStyles';
    style.textContent = `
      #authGate{position:fixed;inset:0;z-index:2000;background:#080705;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:24px;font-family:'Manrope',sans-serif;color:#eae6da;text-align:center;}
      #authGate .authIcon{width:56px;height:56px;border-radius:16px;background:#15130d;border:1px solid #2a251a;display:flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:20px;}
      #authGate h2{font-family:'Michroma',sans-serif;font-size:18px;margin-bottom:10px;letter-spacing:.03em;}
      #authGate p{font-size:13px;color:#9a9686;max-width:320px;line-height:1.65;margin-bottom:26px;}
      #authGate input{width:100%;max-width:320px;background:#15130d;border:1px solid #2a251a;border-radius:100px;padding:14px 20px;color:#eae6da;font-size:14px;text-align:center;margin-bottom:14px;font-family:inherit;}
      #authGate input:focus{outline:2px solid #8a6f22;outline-offset:2px;}
      #authGate button{width:100%;max-width:320px;padding:14px;border-radius:100px;background:linear-gradient(120deg,#8a6f22,#f1d68c);color:#0b0904;font-weight:700;font-size:12.5px;text-transform:uppercase;letter-spacing:.05em;border:none;cursor:pointer;font-family:inherit;}
      #authGate .msg{margin-top:16px;font-size:12.5px;color:#f1d68c;min-height:18px;max-width:320px;}
      #authGate .faceBtn{margin-top:12px;background:none;border:1px solid #2a251a;color:#f1d68c;}
      #authGate .authTabs{display:flex;gap:6px;background:#15130d;border:1px solid #2a251a;border-radius:100px;padding:4px;margin-bottom:22px;width:100%;max-width:320px;}
      #authGate .authTab{flex:1;padding:9px 0;border-radius:100px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9a9686;cursor:pointer;background:none;border:none;font-family:inherit;}
      #authGate .authTab.active{background:linear-gradient(120deg,#8a6f22,#f1d68c);color:#0b0904;font-weight:700;}
      #authGate .authHint{font-size:10.5px;color:#6b6858;margin-top:-6px;margin-bottom:14px;max-width:320px;}
      #authTopbar{position:fixed;top:14px;right:14px;z-index:1500;padding:8px 8px 8px 16px;font-size:10.5px;color:#9a9686;display:flex;align-items:center;gap:10px;background:rgba(8,7,5,.85);backdrop-filter:blur(8px);border:1px solid #2a251a;border-radius:100px;font-family:'JetBrains Mono',monospace;}
      #authTopbar button{background:none;border:1px solid #2a251a;color:#9a9686;border-radius:100px;padding:6px 13px;font-size:10px;cursor:pointer;font-family:inherit;}
      #authTopbar span{max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    `;
    document.head.appendChild(style);
  }

  function showGate(appName, icon){
    injectStyles();
    if(document.getElementById('authGate')) return;
    const gate = el(`<div id="authGate">
      <div class="authIcon">${icon || '🔐'}</div>
      <h2>DINEVO ${appName}</h2>
      <div class="authTabs">
        <button class="authTab active" data-mode="login">Log In</button>
        <button class="authTab" data-mode="signup">Sign Up</button>
      </div>
      <p id="authSubtitle">Welcome back — log in with your email and password.</p>
      <input type="email" id="authEmail" placeholder="you@example.com" autocomplete="email" />
      <input type="password" id="authPassword" placeholder="Password" autocomplete="current-password" />
      <input type="password" id="authPassword2" placeholder="Confirm password" autocomplete="new-password" style="display:none;" />
      <button id="authSubmitBtn">Log In</button>
      <div class="msg" id="authMsg"></div>
      <button class="faceBtn" id="authFaceBtn" style="display:none;">👁 Unlock with Face ID / Touch ID</button>
    </div>`);
    document.body.appendChild(gate);
    maybeOfferFaceUnlock();

    let mode = 'login';
    const tabs = gate.querySelectorAll('.authTab');
    const pw2 = document.getElementById('authPassword2');
    const subtitle = document.getElementById('authSubtitle');
    const submitBtn = document.getElementById('authSubmitBtn');
    const msg = document.getElementById('authMsg');

    function setMode(m){
      mode = m;
      tabs.forEach(t=> t.classList.toggle('active', t.dataset.mode === m));
      msg.textContent = '';
      if(m === 'signup'){
        pw2.style.display = 'block';
        subtitle.textContent = 'Create an account — we\'ll email you a link to verify it, then you can log in.';
        submitBtn.textContent = 'Create Account';
        document.getElementById('authPassword').autocomplete = 'new-password';
      } else {
        pw2.style.display = 'none';
        subtitle.textContent = 'Welcome back — log in with your email and password.';
        submitBtn.textContent = 'Log In';
        document.getElementById('authPassword').autocomplete = 'current-password';
      }
    }
    tabs.forEach(t=> t.onclick = ()=> setMode(t.dataset.mode));

    submitBtn.onclick = async ()=>{
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;
      if(!email || !email.includes('@')){ msg.textContent = 'Enter a valid email address.'; return; }
      if(!password || password.length < 6){ msg.textContent = 'Password must be at least 6 characters.'; return; }

      if(mode === 'signup'){
        const password2 = pw2.value;
        if(password !== password2){ msg.textContent = 'Passwords don\'t match.'; return; }
        msg.textContent = 'Creating account…';
        try{
          const redirectTo = window.location.origin + window.location.pathname;
          const { data, error } = await sb.auth.signUp({ email, password, options:{ emailRedirectTo: redirectTo } });
          if(error){ msg.textContent = error.message; return; }
          if(data && data.session){
            // email confirmation is off in the project — signed in immediately
            onAuthed(data.session.user);
          } else {
            msg.textContent = '✓ Account created — check your email to verify it, then log in here.';
            setMode('login');
          }
        }catch(e){ msg.textContent = 'Network error — please try again.'; }
      } else {
        msg.textContent = 'Logging in…';
        try{
          const { data, error } = await sb.auth.signInWithPassword({ email, password });
          if(error){
            msg.textContent = error.message.toLowerCase().includes('confirm')
              ? 'Please verify your email first — check your inbox for the link.'
              : error.message;
            return;
          }
          onAuthed(data.user);
        }catch(e){ msg.textContent = 'Network error — please try again.'; }
      }
    };
  }

  function hideGate(){
    const gate = document.getElementById('authGate');
    if(gate) gate.remove();
  }

  function showTopbar(email){
    injectStyles();
    if(document.getElementById('authTopbar')) return;
    const bar = el(`<div id="authTopbar"><span>${email}</span><button id="authSignOut">Sign out</button></div>`);
    document.body.appendChild(bar);
    document.getElementById('authSignOut').onclick = async ()=>{
      await sb.auth.signOut();
      localStorage.removeItem('dinevoFaceCred');
      location.reload();
    };
  }

  /* ---- Face ID / Touch ID: a device-local convenience unlock, not a server-verified factor.
     The real security boundary is still the Supabase session; this just re-gates the UI
     on this device using the phone's own biometric prompt. ---- */
  async function enableFaceUnlock(){
    if(!window.PublicKeyCredential || !currentUser) return false;
    try{
      const cred = await navigator.credentials.create({
        publicKey:{
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp:{ name:'Dinevo' },
          user:{ id: crypto.getRandomValues(new Uint8Array(16)), name: currentUser.email, displayName: currentUser.email },
          pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
          authenticatorSelection:{ authenticatorAttachment:'platform', userVerification:'required' },
          timeout:60000
        }
      });
      const id = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
      localStorage.setItem('dinevoFaceCred', id);
      return true;
    }catch(e){ console.error('Face ID setup failed:', e); return false; }
  }
  async function tryFaceUnlock(){
    const id = localStorage.getItem('dinevoFaceCred');
    if(!id || !window.PublicKeyCredential) return false;
    try{
      const rawId = Uint8Array.from(atob(id), c=>c.charCodeAt(0));
      await navigator.credentials.get({
        publicKey:{
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials:[{ id: rawId, type:'public-key' }],
          userVerification:'required',
          timeout:60000
        }
      });
      return true;
    }catch(e){ return false; }
  }
  async function maybeOfferFaceUnlock(){
    const id = localStorage.getItem('dinevoFaceCred');
    const { data } = await sb.auth.getSession();
    const session = data && data.session;
    const btn = document.getElementById('authFaceBtn');
    if(id && session && btn){
      btn.style.display = 'block';
      btn.onclick = async ()=>{
        const ok = await tryFaceUnlock();
        if(ok){ onAuthed(session.user); }
        else{ const m = document.getElementById('authMsg'); if(m) m.textContent = 'Face ID unlock failed — try email instead.'; }
      };
    }
  }

  function onAuthed(user){
    currentUser = user;
    hideGate();
    showTopbar(user.email);
    resolveReady(user);
  }

  async function init(appName, icon){
    const { data } = await sb.auth.getSession();
    const session = data && data.session;
    if(session){
      onAuthed(session.user);
      if(!localStorage.getItem('dinevoFaceCred') && window.PublicKeyCredential){
        setTimeout(async ()=>{
          if(confirm('Enable Face ID / Touch ID for faster sign-in next time on this device?')){
            await enableFaceUnlock();
          }
        }, 900);
      }
    } else {
      showGate(appName, icon);
    }
    sb.auth.onAuthStateChange((event, sess)=>{
      if(event === 'SIGNED_IN' && sess && !currentUser){ onAuthed(sess.user); }
      if(event === 'SIGNED_OUT'){ location.reload(); }
    });
  }

  return { init, ready, getUser: ()=> currentUser };
})();
