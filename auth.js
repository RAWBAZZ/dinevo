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
      #authGate .linklike{background:none!important;border:none!important;width:auto!important;padding:0!important;color:#9a9686!important;font-size:11.5px!important;text-decoration:underline;text-transform:none!important;font-weight:400!important;letter-spacing:0!important;margin-top:14px!important;cursor:pointer;}
      #authGate .backlink{background:none!important;border:none!important;width:auto!important;padding:0!important;color:#9a9686!important;font-size:11.5px!important;text-decoration:underline;text-transform:none!important;font-weight:400!important;letter-spacing:0!important;margin-bottom:16px!important;}
      #authAvatarWrap{position:fixed;top:78px;right:16px;z-index:1500;font-family:'Manrope',sans-serif;}
      #authAvatarBtn{width:38px;height:38px;border-radius:50%;background:linear-gradient(120deg,#8a6f22,#f1d68c);color:#0b0904;font-weight:800;font-size:14px;border:none;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.45);}
      #authDropdown{position:absolute;top:46px;right:0;width:210px;background:#15130d;border:1px solid #2a251a;border-radius:14px;padding:10px;display:none;flex-direction:column;gap:6px;box-shadow:0 20px 44px rgba(0,0,0,.55);}
      #authDropdown.show{display:flex;}
      #authDropdown .ad-email{font-size:10.5px;color:#9a9686;padding:6px 8px 10px;border-bottom:1px solid #2a251a;margin-bottom:2px;word-break:break-all;}
      #authDropdown button{background:none;border:1px solid #2a251a;color:#eae6da;border-radius:100px;padding:9px 12px;font-size:12px;text-align:left;cursor:pointer;font-family:inherit;}
      #authDropdown button:hover{border-color:#8a6f22;color:#f1d68c;}
      @media(max-width:480px){ #authAvatarWrap{ top:72px; } }
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
      <button class="linklike" id="authForgotBtn">Forgot password?</button>
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
    const forgotBtn = document.getElementById('authForgotBtn');
    const msg = document.getElementById('authMsg');

    function setMode(m){
      mode = m;
      tabs.forEach(t=> t.classList.toggle('active', t.dataset.mode === m));
      msg.textContent = '';
      forgotBtn.style.display = m === 'login' ? 'inline-block' : 'none';
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

    forgotBtn.onclick = async ()=>{
      const email = document.getElementById('authEmail').value.trim();
      if(!email || !email.includes('@')){ msg.textContent = 'Enter your email above first, then tap "Forgot password?" again.'; return; }
      msg.textContent = 'Sending reset link…';
      try{
        const redirectTo = window.location.origin + window.location.pathname;
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
        msg.textContent = error ? ('Could not send reset link: ' + error.message) : '✓ Check your email for a password reset link.';
      }catch(e){ msg.textContent = 'Network error — please try again.'; }
    };

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

  function showResetPasswordForm(){
    injectStyles();
    const existing = document.getElementById('authGate');
    if(existing) existing.remove();
    const gate = el(`<div id="authGate">
      <div class="authIcon">🔑</div>
      <h2>Set a new password</h2>
      <p>You tapped a reset link — choose a new password for your account below.</p>
      <input type="password" id="resetPassword" placeholder="New password" autocomplete="new-password" />
      <input type="password" id="resetPassword2" placeholder="Confirm new password" autocomplete="new-password" />
      <button id="resetSubmitBtn">Set New Password</button>
      <div class="msg" id="resetMsg"></div>
    </div>`);
    document.body.appendChild(gate);
    document.getElementById('resetSubmitBtn').onclick = async ()=>{
      const p1 = document.getElementById('resetPassword').value;
      const p2 = document.getElementById('resetPassword2').value;
      const msg = document.getElementById('resetMsg');
      if(!p1 || p1.length < 6){ msg.textContent = 'Password must be at least 6 characters.'; return; }
      if(p1 !== p2){ msg.textContent = 'Passwords don\'t match.'; return; }
      msg.textContent = 'Updating…';
      try{
        const { data, error } = await sb.auth.updateUser({ password: p1 });
        if(error){ msg.textContent = error.message; return; }
        msg.textContent = '✓ Password updated!';
        setTimeout(()=> onAuthed(data.user), 700);
      }catch(e){ msg.textContent = 'Network error — please try again.'; }
    };
  }

  let profileClickHandler = null;
  function onProfileClick(fn){
    profileClickHandler = fn;
    const existingBtn = document.getElementById('authProfileBtn');
    if(existingBtn) existingBtn.style.display = 'block';
  }

  function showTopbar(email){
    injectStyles();
    if(document.getElementById('authAvatarWrap')) return;
    const initial = (email || '?').charAt(0).toUpperCase();
    const wrap = el(`<div id="authAvatarWrap">
      <button id="authAvatarBtn">${initial}</button>
      <div id="authDropdown">
        <div class="ad-email">${email}</div>
        <button id="authProfileBtn" style="display:${profileClickHandler ? 'block' : 'none'};">👤 Profile</button>
        <button id="authSignOut">Sign out</button>
      </div>
    </div>`);
    document.body.appendChild(wrap);
    document.getElementById('authAvatarBtn').onclick = (e)=>{
      e.stopPropagation();
      document.getElementById('authDropdown').classList.toggle('show');
    };
    document.addEventListener('click', (e)=>{
      if(!wrap.contains(e.target)) document.getElementById('authDropdown').classList.remove('show');
    });
    document.getElementById('authProfileBtn').onclick = ()=>{
      document.getElementById('authDropdown').classList.remove('show');
      if(profileClickHandler) profileClickHandler();
    };
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
    const isRecovery = window.location.hash.includes('type=recovery');
    if(isRecovery){
      showResetPasswordForm();
      sb.auth.onAuthStateChange((event, sess)=>{
        if(event === 'SIGNED_IN' && sess && !currentUser){ /* wait for password form submit */ }
        if(event === 'SIGNED_OUT'){ location.reload(); }
      });
      return;
    }
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
      if(event === 'PASSWORD_RECOVERY'){ showResetPasswordForm(); return; }
      if(event === 'SIGNED_IN' && sess && !currentUser){ onAuthed(sess.user); }
      if(event === 'SIGNED_OUT'){ location.reload(); }
    });
  }

  return { init, ready, getUser: ()=> currentUser, onProfileClick };
})();
