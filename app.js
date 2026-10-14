// SomRápido — PWA leve inspirada na interface do Spotifast (MIT, github.com/crmne/spotifast).
// Usa a Web API oficial com OAuth Authorization Code + PKCE. Nenhum segredo no código.
const $=s=>document.querySelector(s), V=$('#view');
const SCOPES='user-read-private user-read-email user-library-read user-library-modify playlist-read-private playlist-read-collaborative user-read-recently-played user-read-playback-state user-modify-playback-state user-read-currently-playing streaming';
const REDIRECT=location.origin+location.pathname.replace(/index\.html$/,'');
const LS=localStorage;
const cid=()=>LS.sr_client_id||(window.SOMRAPIDO_CONFIG||{}).clientId||'';
let me=null, tab='home', poll=null, sdkDevice=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast=m=>{const t=$('#toast');t.textContent=m;t.classList.remove('hidden');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.add('hidden'),3200)};
const fmt=ms=>{ms=Math.max(0,ms|0);const s=Math.floor(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const img=(a,i=0)=>a&&a.length?(a[Math.min(i,a.length-1)]||a[0]).url:'';
const openLink=uri=>{const [,type,id]=(uri||'').split(':');return 'https://open.spotify.com/'+type+'/'+id};

// ---------- OAuth PKCE ----------
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function login(){
  if(!cid()){toast('Cole o Client ID em Ajustes primeiro');return settings()}
  const v=b64(crypto.getRandomValues(new Uint8Array(64)));
  const ch=b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));
  const st=b64(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.sr_v=v;sessionStorage.sr_st=st;
  location.href='https://accounts.spotify.com/authorize?'+new URLSearchParams({client_id:cid(),response_type:'code',redirect_uri:REDIRECT,code_challenge_method:'S256',code_challenge:ch,scope:SCOPES,state:st});
}
async function tokenReq(body){
  const r=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cid(),...body})});
  const j=await r.json(); if(!r.ok) throw new Error(j.error_description||j.error||'falha no login');
  LS.sr_at=j.access_token; if(j.refresh_token) LS.sr_rt=j.refresh_token; LS.sr_exp=Date.now()+(j.expires_in-60)*1000;
}
async function handleCallback(){
  const p=new URLSearchParams(location.search);
  if(p.get('error')){toast('Login cancelado');history.replaceState(0,'',REDIRECT);return}
  if(!p.get('code'))return;
  history.replaceState(0,'',REDIRECT);
  if(p.get('state')!==sessionStorage.sr_st){toast('Login inválido, tente de novo');return}
  try{await tokenReq({grant_type:'authorization_code',code:p.get('code'),redirect_uri:REDIRECT,code_verifier:sessionStorage.sr_v})}catch(e){toast('Erro no login: '+e.message)}
}
async function token(){
  if(!LS.sr_at)return null;
  if(Date.now()>+LS.sr_exp&&LS.sr_rt){try{await tokenReq({grant_type:'refresh_token',refresh_token:LS.sr_rt})}catch(e){logout();return null}}
  return LS.sr_at;
}
function logout(){['sr_at','sr_rt','sr_exp'].forEach(k=>LS.removeItem(k));me=null;render()}

// ---------- API ----------
async function api(path,opt={}){
  const t=await token(); if(!t) throw new Error('auth');
  const r=await fetch('https://api.spotify.com/v1'+path,{...opt,headers:{Authorization:'Bearer '+t,'Content-Type':'application/json',...(opt.headers||{})}});
  if(r.status===401){logout();throw new Error('auth')}
  if(r.status===204||r.status===202)return null;
  const txt=await r.text(); const j=txt?JSON.parse(txt):null;
  if(!r.ok){const e=new Error(j?.error?.message||('Erro '+r.status));e.status=r.status;e.reason=j?.error?.reason;throw e}
  return j;
}
const isPremium=()=>me&&me.product==='premium';
const FREE_MSG='O controle de reprodução só funciona com conta Premium. Na conta grátis você pode buscar e ver sua biblioteca, e tocar abrindo no app oficial.';
async function ctl(path,method='PUT',body){
  if(!isPremium()){toast('Precisa de Premium pra controlar a reprodução');return false}
  try{await api('/me/player'+path,{method,body:body?JSON.stringify(body):undefined});setTimeout(refreshPlayer,350);return true}
  catch(e){
    if(e.status===404||e.reason==='NO_ACTIVE_DEVICE'){toast('Nenhum aparelho ativo. Abra o app em algum aparelho ou escolha um em "Tocando".')}
    else if(e.status===403||e.reason==='PREMIUM_REQUIRED'){toast('Precisa de Premium pra isso')}
    else toast(e.message); return false}
}
async function playUri(uri,ctx){
  if(!isPremium()){location.href=openLink(uri);return}
  const body=ctx?{context_uri:ctx,offset:uri&&uri.includes(':track:')?{uri}:undefined}:(uri.includes(':track:')?{uris:[uri]}:{context_uri:uri});
  const q=sdkDevice&&!LS.sr_last_dev?'?device_id='+sdkDevice:'';
  await ctl('/play'+q,'PUT',body);
}

// ---------- UI pieces ----------
const row=(o)=>`<div class="row" data-play="${esc(o.uri)}" ${o.ctx?`data-ctx="${esc(o.ctx)}"`:''}>${o.img?`<img loading="lazy" src="${esc(o.img)}" alt="">`:'<div class="ph"></div>'}<div class="t"><b>${esc(o.title)}</b><div>${esc(o.sub)}</div></div><a class="icon" href="${openLink(o.uri)}" target="_blank" rel="noopener" aria-label="Abrir no Spotify" onclick="event.stopPropagation()">↗</a></div>`;
const trackRow=(t,ctx)=>row({uri:t.uri,ctx,img:img(t.album?.images,2),title:t.name,sub:(t.artists||[]).map(a=>a.name).join(', ')+(t.duration_ms?' · '+fmt(t.duration_ms):'')});
const tile=(o)=>`<div class="tile" data-open="${esc(o.uri)}"><img loading="lazy" src="${esc(o.img)}" alt=""><b>${esc(o.title)}</b><div class="mut small">${esc(o.sub||'')}</div></div>`;
const freeBanner=()=>me&&!isPremium()?`<div class="warn">⚠️ ${FREE_MSG}</div>`:'';
const loading=()=>V.innerHTML='<p class="mut">Carregando…</p>';

function welcome(){
  V.innerHTML=`<div class="hero"><h1>Sua música, leve e rápida</h1><p>Busque, veja sua biblioteca e controle o que toca no celular, PC ou caixinha de som.</p>
  ${cid()?'<button class="btn green" id="go">Entrar com Spotify</button>':'<button class="btn" id="cfg">Configurar (colar Client ID)</button>'}</div>
  <div class="card"><b>Como funciona</b><p class="mut">Você entra pelo site oficial do Spotify. O SomRápido nunca vê sua senha. Buscar e navegar funciona em qualquer conta; controlar a reprodução precisa de Premium.</p></div>
  <p class="mut small">Interface inspirada no <a href="https://github.com/crmne/spotifast" style="color:var(--acc2)">Spotifast</a> (MIT). Projeto independente, sem ligação com o Spotify.</p>`;
  $('#go')&&($('#go').onclick=login); $('#cfg')&&($('#cfg').onclick=settings);
}
function settings(){
  tab='settings';setTabs();
  V.innerHTML=`<h2>Ajustes</h2><div class="card"><label><b>Client ID do Spotify</b></label><p class="mut small">Crie um app grátis em developer.spotify.com e cole o Client ID aqui. Ele fica salvo só neste aparelho.</p>
  <input id="cid" placeholder="ex.: 1a2b3c4d..." value="${esc(cid())}" autocomplete="off"><p class="small mut">Redirect URI para cadastrar no painel:</p><p><code id="ru">${esc(REDIRECT)}</code></p>
  <button class="btn" id="save">Salvar</button> <button class="btn sec" id="copy">Copiar Redirect URI</button></div>
  ${me?`<div class="card"><b>${esc(me.display_name||me.id)}</b><div class="mut">Conta ${isPremium()?'Premium ✨':'grátis'}</div><br><button class="btn sec" id="out">Sair</button></div>`:''}
  <p class="mut small">SomRápido · inspirado no Spotifast de crmne (MIT). Spotify é marca da Spotify AB.</p>`;
  $('#save').onclick=()=>{LS.sr_client_id=$('#cid').value.trim();toast('Salvo!');render()};
  $('#copy').onclick=()=>navigator.clipboard?.writeText(REDIRECT).then(()=>toast('Copiado'));
  $('#out')&&($('#out').onclick=logout);
}
async function home(){
  loading();
  const [rec,pl]=await Promise.all([api('/me/player/recently-played?limit=10').catch(()=>({items:[]})),api('/me/playlists?limit=6').catch(()=>({items:[]}))]);
  const seen=new Set();
  V.innerHTML=`<h2>Olá, ${esc((me.display_name||'').split(' ')[0]||'você')} 👋</h2>${freeBanner()}
  <h3>Suas playlists</h3><div class="grid">${(pl.items||[]).filter(Boolean).map(p=>tile({uri:p.uri,img:img(p.images),title:p.name,sub:(p.tracks?.total??p.items?.total??'')+' músicas'})).join('')}</div>
  <h3>Tocadas recentemente</h3>${(rec.items||[]).filter(i=>!seen.has(i.track.id)&&seen.add(i.track.id)).map(i=>trackRow(i.track)).join('')||'<p class="mut">Nada por aqui ainda.</p>'}`;
}
let sType='track', sQ='';
function search(){
  V.innerHTML=`<h2>Buscar</h2><input id="q" type="search" placeholder="Músicas, artistas, álbuns…" value="${esc(sQ)}" enterkeyhint="search">
  <div class="chips">${[['track','Músicas'],['artist','Artistas'],['album','Álbuns'],['playlist','Playlists']].map(([k,l])=>`<button class="chip ${k===sType?'on':''}" data-t="${k}">${l}</button>`).join('')}</div><div id="res"></div>`;
  let h; $('#q').oninput=e=>{sQ=e.target.value;clearTimeout(h);h=setTimeout(doSearch,350)};
  document.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{sType=c.dataset.t;search()});
  if(sQ)doSearch();
}
async function doSearch(){
  const R=$('#res'); if(!sQ.trim()){R.innerHTML='';return}
  R.innerHTML='<p class="mut">Buscando…</p>';
  try{const j=await api('/search?'+new URLSearchParams({q:sQ,type:sType,limit:20}));
    const it=(j[sType+'s']?.items||[]).filter(Boolean);
    R.innerHTML=it.length?(sType==='track'?it.map(t=>trackRow(t)).join(''):sType==='artist'?it.map(a=>row({uri:a.uri,img:img(a.images,2),title:a.name,sub:'Artista'})).join(''):
      '<div class="grid">'+it.map(a=>tile({uri:a.uri,img:img(a.images),title:a.name,sub:sType==='album'?(a.artists||[]).map(x=>x.name).join(', '):'de '+(a.owner?.display_name||'')})).join('')+'</div>'):'<p class="mut">Nada encontrado.</p>';
  }catch(e){R.innerHTML='<p class="mut">Erro na busca: '+esc(e.message)+'</p>'}
}
let lType='tracks';
async function library(){
  V.innerHTML=`<h2>Biblioteca</h2><div class="chips">${[['tracks','Curtidas'],['playlists','Playlists'],['recent','Recentes']].map(([k,l])=>`<button class="chip ${k===lType?'on':''}" data-l="${k}">${l}</button>`).join('')}</div><div id="lib"><p class="mut">Carregando…</p></div>`;
  document.querySelectorAll('[data-l]').forEach(c=>c.onclick=()=>{lType=c.dataset.l;library()});
  const L=$('#lib');
  try{
    if(lType==='tracks'){const j=await api('/me/tracks?limit=50');L.innerHTML=(j.items||[]).map(i=>trackRow(i.track)).join('')||'<p class="mut">Nenhuma música curtida.</p>'}
    else if(lType==='playlists'){const j=await api('/me/playlists?limit=50');L.innerHTML='<div class="grid">'+(j.items||[]).filter(Boolean).map(p=>tile({uri:p.uri,img:img(p.images),title:p.name,sub:'de '+(p.owner?.display_name||'')})).join('')+'</div>'}
    else{const j=await api('/me/player/recently-played?limit=50');L.innerHTML=(j.items||[]).map(i=>trackRow(i.track)).join('')}
  }catch(e){L.innerHTML='<p class="mut">Erro: '+esc(e.message)+'</p>'}
}
async function openCollection(uri){
  const [,type,id]=uri.split(':'); loading();
  try{
    if(type==='artist'){const [a,t]=await Promise.all([api('/artists/'+id),api('/artists/'+id+'/top-tracks?market=from_token')]);
      V.innerHTML=`<div class="np"><img src="${esc(img(a.images))}" alt=""><h1>${esc(a.name)}</h1></div><button class="btn green" data-play="${a.uri}">▶ Tocar</button> <a class="btn sec" href="${openLink(a.uri)}" target="_blank">Abrir no Spotify</a><h3>Populares</h3>${(t.tracks||[]).map(x=>trackRow(x)).join('')}`;return}
    const c=await api('/'+type+'s/'+id); const items=type==='album'?(c.tracks.items||[]).map(t=>({...t,album:{images:c.images}})):(c.tracks?.items||c.items?.items||[]).map(i=>i.track||i.item).filter(Boolean);
    V.innerHTML=`<div class="np"><img src="${esc(img(c.images))}" alt=""><h1>${esc(c.name)}</h1><div class="mut">${esc(type==='album'?(c.artists||[]).map(a=>a.name).join(', '):'de '+(c.owner?.display_name||''))}</div></div>
    <p><button class="btn green" data-play="${c.uri}">▶ Tocar</button> <a class="btn sec" href="${openLink(c.uri)}" target="_blank">Abrir no Spotify</a></p>${items.map(t=>trackRow(t,c.uri)).join('')}`;
  }catch(e){V.innerHTML='<p class="mut">Não deu pra abrir: '+esc(e.message)+'</p>'}
}
let state=null;
async function refreshPlayer(){
  try{state=await api('/me/player?additional_types=episode')}catch(e){state=null}
  drawMini(); if(tab==='player')drawPlayer();
}
function drawMini(){
  const m=$('#mini'),it=state?.item; if(!it||tab==='player'){m.classList.add('hidden');return}
  m.classList.remove('hidden');
  m.innerHTML=`<img src="${esc(img(it.album?.images||it.images,2))}" alt=""><div class="t"><b>${esc(it.name)}</b><span class="mut">${esc((it.artists||[]).map(a=>a.name).join(', '))}</span></div><button class="icon" id="mpp">${state.is_playing?'⏸':'▶'}</button>`;
  m.querySelector('.t').onclick=()=>go('player');
  $('#mpp').onclick=()=>ctl(state.is_playing?'/pause':'/play');
}
async function player(){ drawPlayer(); await refreshPlayer(); }
async function drawPlayer(){
  const it=state?.item;
  let devs=[]; try{devs=(await api('/me/player/devices')).devices||[]}catch(e){}
  if(tab!=='player')return;
  V.innerHTML=`${freeBanner()}${it?`<div class="np"><img src="${esc(img(it.album?.images||it.images))}" alt=""><h1>${esc(it.name)}</h1><div class="mut">${esc((it.artists||[]).map(a=>a.name).join(', '))}</div></div>
  <input type="range" id="seek" min="0" max="${it.duration_ms}" value="${state.progress_ms||0}"><div class="times"><span>${fmt(state.progress_ms)}</span><span>${fmt(it.duration_ms)}</span></div>
  <div class="ctrl"><button id="prev" aria-label="Anterior">⏮</button><button class="pp" id="pp" aria-label="Tocar/pausar">${state.is_playing?'⏸':'▶'}</button><button id="next" aria-label="Próxima">⏭</button></div>
  <div class="card">🔊 <input type="range" id="vol" min="0" max="100" value="${state.device?.volume_percent??50}" style="width:80%"></div>
  <p><a class="btn sec" href="${openLink(it.uri)}" target="_blank">Abrir no Spotify</a></p>`:`<h2>Nada tocando</h2><p class="mut">Comece a tocar em algum aparelho, ou escolha um abaixo e toque uma música pela busca.</p>`}
  <h3>Aparelhos (Spotify Connect)</h3>${devs.map(d=>`<div class="card dev ${d.is_active?'act':''}"><span>${{Smartphone:'📱',Computer:'💻',Speaker:'🔈',TV:'📺'}[d.type]||'🎵'} ${esc(d.name)}</span>${d.is_active?'<span>tocando aqui</span>':`<button class="btn sec" data-dev="${esc(d.id)}">Tocar aqui</button>`}</div>`).join('')||'<p class="mut">Nenhum aparelho encontrado. Abra o app oficial do Spotify em algum aparelho.</p>'}`;
  if(it){$('#pp').onclick=()=>ctl(state.is_playing?'/pause':'/play');$('#next').onclick=()=>ctl('/next','POST');$('#prev').onclick=()=>ctl('/previous','POST');
    $('#seek').onchange=e=>ctl('/seek?position_ms='+e.target.value);$('#vol').onchange=e=>ctl('/volume?volume_percent='+e.target.value);}
  document.querySelectorAll('[data-dev]').forEach(b=>b.onclick=()=>ctl('','PUT',{device_ids:[b.dataset.dev],play:true}));
}
// Web Playback SDK (só PC com Premium; no celular o navegador não suporta bem)
function maybeSDK(){
  if(!isPremium()||/Android|iPhone|iPad/i.test(navigator.userAgent))return;
  window.onSpotifyWebPlaybackSDKReady=()=>{const p=new Spotify.Player({name:'SomRápido (navegador)',getOAuthToken:async cb=>cb(await token()),volume:.7});
    p.addListener('ready',({device_id})=>{sdkDevice=device_id}); p.connect()};
  const s=document.createElement('script');s.src='https://sdk.scdn.co/spotify-player.js';document.head.appendChild(s);
}

// ---------- routing ----------
function setTabs(){document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab))}
function go(t){tab=t;setTabs();render()}
async function render(){
  if(tab==='settings')return settings();
  if(!(await token())){$('#mini').classList.add('hidden');return welcome()}
  if(!me){try{me=await api('/me')}catch(e){return welcome()} maybeSDK()}
  ({home,search,library,player}[tab]||home)().catch(e=>V.innerHTML='<p class="mut">Erro: '+esc(e.message)+'</p>');
  drawMini();
}
document.querySelector('.tabs').onclick=e=>{const b=e.target.closest('button');if(b)go(b.dataset.tab)};
$('#btnSettings').onclick=settings;
V.addEventListener('click',e=>{
  if(e.target.closest('a'))return;
  const o=e.target.closest('[data-open]'); if(o)return openCollection(o.dataset.open);
  const p=e.target.closest('[data-play]'); if(p)playUri(p.dataset.play,p.dataset.ctx);
});
(async()=>{await handleCallback();await render();if(LS.sr_at){refreshPlayer();poll=setInterval(()=>{if(!document.hidden&&me)refreshPlayer()},5000)}})();
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js');
