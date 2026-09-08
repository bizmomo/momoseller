const SUPABASE_URL = 'https://aangpllxztgyoflioqai.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ay-HMiHrtPqZpYEfzsXFAA_AOgVwOT_';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function requireAuth(onUser){
  sb.auth.getSession().then(({ data: { session } }) => {
    if(session){
      onUser(session.user);
    } else {
      window.location.href = 'index.html';
    }
  });
  sb.auth.onAuthStateChange((event) => {
    if(event === 'SIGNED_OUT'){
      window.location.href = 'index.html';
    }
  });
}

function renderUserChip(user){
  const emailEl = document.getElementById('userEmail');
  const chipEl = document.getElementById('userChip');
  if(emailEl) emailEl.textContent = user.email;
  if(chipEl) chipEl.style.display = 'block';
}

async function signOut(){
  await sb.auth.signOut();
}
