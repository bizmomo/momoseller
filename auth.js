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

function goBack(){
  window.history.back();
}

async function sharePage(){
  const url = new URL(window.location.href);
  url.searchParams.set('momo_ref', 'share');
  const shareUrl = url.toString();
  const shareData = { title: document.title, url: shareUrl };
  if(navigator.share){
    try { await navigator.share(shareData); } catch(e){}
  } else {
    try {
      await navigator.clipboard.writeText(shareUrl);
      alert('링크가 복사됐어요.');
    } catch(e){
      alert('이 브라우저에서는 공유하기를 지원하지 않아요.');
    }
  }
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

// auth.js는 모든 페이지가 로드하므로 여기 한 곳에만 방문 계측을 붙이면
// 전체 사이트에 자동으로 적용된다. 실패해도 사이트 이용에는 영향 없어야
// 하므로 전부 try/catch로 감싼다.
(function trackVisit(){
  try {
    const KEY = 'momo_visit_logged'; // 탭(세션) 하나당 1회만 기록
    if(sessionStorage.getItem(KEY)) return;

    const params = new URLSearchParams(window.location.search);
    const isShare = params.get('momo_ref') === 'share';

    const SEARCH_HOSTS = ['google.', 'naver.', 'daum.', 'bing.', 'yahoo.'];
    let refBucket = 'site';
    if(isShare){
      refBucket = 'share';
    } else if(document.referrer){
      try {
        const refHost = new URL(document.referrer).hostname;
        if(SEARCH_HOSTS.some(h => refHost.includes(h))) refBucket = 'search';
      } catch(e){}
    }

    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

    sb.auth.getSession().then(({ data: { session } }) => {
      sb.from('site_visits').insert({
        user_id: session ? session.user.id : null,
        page: window.location.pathname.replace(/^\//, '') || 'index.html',
        referrer: document.referrer || null,
        device_type: isMobile ? 'mobile' : 'pc',
        ref_bucket: refBucket,
      }).then(() => {}, () => {});
    });

    sessionStorage.setItem(KEY, '1');
  } catch(e){ /* 방문 기록 실패는 사이트 이용에 영향 주지 않는다 */ }
})();
