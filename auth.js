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

// supabase-js only sets a generic "non-2xx status code" message on invoke()
// errors - the actual reason is in the response body, on error.context.
async function getInvokeErrorMessage(error){
  if(!error) return '알 수 없는 오류';
  if(error.context && typeof error.context.json === 'function'){
    try {
      const body = await error.context.clone().json();
      if(body && body.error) return body.error;
    } catch(e){}
  }
  return error.message || '알 수 없는 오류';
}
