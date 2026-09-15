let S=null;
let selectedAvatar=Number(localStorage.getItem('quizAvatar')||0);
let joinedId=localStorage.getItem('quizPlayerId')||'';
let joinName=localStorage.getItem('quizPlayerName')||'';
let lastChoice=null,lastChoiceQ=-1,lastRendered='';
let currentView='';
let confirmedJoined=!!joinedId;
let kickedMessage='';
let hasSeenFinal=false,finalExitSent=false;
const stage=document.getElementById('stage'),mini=document.getElementById('miniScore');

connect('public',s=>{
  S=s;
  const p=joinedId?S?.players.find(x=>x.id===joinedId):null;
  // Se o Admin removeu este jogador, o servidor deixa de enviá-lo na lista ativa.
  // Limpamos a sessão local imediatamente para permitir nova entrada no mesmo aparelho.
  if(joinedId && confirmedJoined && !p && !['final','suspense'].includes(S?.phase)){
    joinedId='';
    confirmedJoined=false;
    lastChoice=null; lastChoiceQ=-1;
    localStorage.removeItem('quizPlayerId');
    kickedMessage='Você foi removido pelo administrador. Escolha novamente seu nome e avatar para entrar.';
  }
  render();
});
function me(){return S?.players.find(p=>p.id===joinedId)}
function availableAvatar(){selectedAvatar=((Number(selectedAvatar)||0)%AVATAR_COUNT+AVATAR_COUNT)%AVATAR_COUNT;const used=new Set((S?.players||[]).map(p=>p.avatar));if(!used.has(selectedAvatar))return selectedAvatar;return Array.from({length:AVATAR_COUNT},(_,i)=>i).find(i=>!used.has(i))??0}
function render(){
  if(!S)return;
  const p=me();
  mini.style.display=p?'block':'none';
  if(p)mini.textContent=`${fmtScore(p.score)} pts`;
  if(!p){joinScreen();return;}
  if(S.phase==='lobby'||S.phase==='countdown'){waiting(p);return;}
  if(S.phase==='question'){question(p);return;}
  if(S.phase==='reveal'){reveal(p);return;}
  if(S.phase==='ranking'){ranking(p);return;}
  if(S.phase==='loading'){loading(p);return;}
  if(S.phase==='suspense'){suspense(p);return;}
  if(S.phase==='final'){final(p);return;}
}
function joinScreen(){
  currentView='join';
  mini.style.display='none';
  selectedAvatar=availableAvatar();
  const used=new Set(S.players.map(p=>p.avatar));
  stage.innerHTML=`<div class="card join-card enter-anim">
    <div class="join-brand"><img src="/assets/cipa.png" class="cipa-logo"><div><div class="eyebrow">QUIZ SIPAT 2026</div><h1>Entre no jogo</h1><p class="muted">Escolha um avatar e aguarde a partida começar.</p></div></div>
    <div class="field"><label>SEU NOME</label><input id="name" class="input" maxlength="24" autocomplete="name" placeholder="Digite seu nome" value="${esc(joinName)}"></div>
    <div class="field"><div class="field-line"><label>ESCOLHA SEU AVATAR</label><span class="muted small">31 opções</span></div><div class="avatar-list">${Array.from({length:AVATAR_COUNT},(_,i)=>`<button type="button" title="Avatar ${i+1}" class="av-opt ${i===selectedAvatar?'sel':''} ${used.has(i)?'used':''}" data-i="${i}">${avatarSvg(i)}</button>`).join('')}</div></div>
    <button id="join" class="btn btn-primary join-btn">ENTRAR NO QUIZ</button>
    <div id="err" class="form-error">${esc(kickedMessage)}</div>
  </div>`;
  const nameEl=document.getElementById('name');
  nameEl.addEventListener('input',e=>joinName=e.target.value);
  stage.querySelectorAll('.av-opt:not(.used)').forEach(b=>b.onclick=()=>{
    selectedAvatar=Number(b.dataset.i);
    localStorage.setItem('quizAvatar',String(selectedAvatar));
    stage.querySelectorAll('.av-opt').forEach(x=>x.classList.toggle('sel',Number(x.dataset.i)===selectedAvatar));
  });
  const doJoin=async()=>{
    const name=nameEl.value.trim(),btn=document.getElementById('join'),err=document.getElementById('err');
    err.textContent='';
    if(!name){err.textContent='Digite seu nome para entrar.';nameEl.focus();return;}
    btn.disabled=true;btn.textContent='ENTRANDO...';
    try{
      const r=await api('/api/join',{name,avatar:selectedAvatar,playerId:joinedId});
      joinedId=r.playerId;joinName=name;confirmedJoined=true;kickedMessage='';
      localStorage.setItem('quizPlayerId',joinedId);localStorage.setItem('quizPlayerName',joinName);localStorage.setItem('quizAvatar',String(selectedAvatar));
      // O broadcast pode chegar antes do retorno da API. Renderizar aqui corrige o antigo bug de voltar à tela de nome.
      render();
    }catch(e){err.textContent=e.message;btn.disabled=false;btn.textContent='ENTRAR NO QUIZ';}
  };
  document.getElementById('join').onclick=doJoin;
  nameEl.addEventListener('keydown',e=>{if(e.key==='Enter')doJoin()});
}
function waiting(p){
  const countdown=S.phase==='countdown';
  const key=`${p.id}|${countdown?1:0}`;
  if(currentView==='waiting' && stage.dataset.waitkey===key){
    const score=stage.querySelector('.hero-score');
    if(score) score.textContent=`${fmtScore(p.score)} pts`;
    const c=stage.querySelector('.mobile-count');
    if(c && countdown) c.textContent=String(Math.max(1,Math.ceil((S.remainingMs||0)/1000)));
    return;
  }
  currentView='waiting';
  stage.dataset.waitkey=key;
  stage.innerHTML=`<div class="card player-status waiting enter-anim">
    <div class="status-chip good"><span class="dot"></span> VOCÊ ESTÁ NO JOGO</div>
    <div class="big-avatar avatar-glow">${avatarSvg(p.avatar)}</div>
    <h1>${esc(p.name)}</h1><div class="score hero-score">${fmtScore(p.score)} pts</div>
    <div class="lobby-divider"></div>
    <h2>${countdown?'Prepare-se!':'Aguardando o administrador iniciar...'}</h2>
    ${countdown?`<div class="mobile-count">${Math.max(1,Math.ceil((S.remainingMs||0)/1000))}</div>`:`<div class="loading-dots"><i></i><i></i><i></i></div><p class="muted">Mantenha esta tela aberta.</p>`}
  </div>`;
}
function question(p){
  const q=S.question,already=p.answered,sec=Math.ceil((S.remainingMs||0)/1000),ratio=Math.max(0,Math.min(100,(S.remainingMs||0)/(q.time*1000)*100));
  const key=`${S.currentQuestion}|${already?1:0}|${lastChoiceQ===S.currentQuestion?lastChoice:'x'}`;
  if(currentView==='question' && stage.dataset.qkey===key){
    const timer=stage.querySelector('.timer');
    if(timer){
      timer.style.setProperty('--p',`${ratio}%`);
      timer.classList.toggle('urgent',sec<=3);
      const strong=timer.querySelector('strong');
      if(strong) strong.textContent=String(sec);
    }
    const prompt=stage.querySelector('.mobile-prompt');
    if(prompt) prompt.textContent=already?'Resposta enviada!':'Escolha sua resposta';
    const helper=stage.querySelector('.mobile-helper');
    if(helper) helper.textContent=already?'Agora aguarde os demais participantes.':'Toque em A, B, C ou D.';
    return;
  }
  currentView='question';
  stage.dataset.qkey=key;
  stage.innerHTML=`<div class="card player-status enter-anim">
    <div class="mobile-q-head"><div><div class="eyebrow">PERGUNTA ${S.currentQuestion+1}/${S.totalQuestions}</div><strong>${esc(q.category)}</strong></div><div class="timer ${sec<=3?'urgent':''}" style="width:72px;height:72px;--p:${ratio}%"><strong style="font-size:24px">${sec}</strong></div></div>
    <div class="mobile-progress"><span style="width:${((S.currentQuestion+1)/S.totalQuestions)*100}%"></span></div>
    <h2 class="mobile-prompt">${already?'Resposta enviada!':'Escolha sua resposta'}</h2>
    <p class="muted mobile-helper">${already?'Agora aguarde os demais participantes.':'Toque em A, B, C ou D.'}</p>
    <div class="choice-grid choices-${q.answers.length}">${q.answers.map((_,i)=>`<button class="choice ${already&&lastChoiceQ===S.currentQuestion&&lastChoice===i?'picked':''}" data-c="${i}" ${already?'disabled':''} style="--choice:${answerColor(i)}"><span>${answerLetter(i)}</span></button>`).join('')}</div>
    ${already?'<div class="answer-confirm">✓ Resposta registrada</div>':''}
  </div>`;
  if(!already)stage.querySelectorAll('.choice').forEach(b=>b.onclick=async()=>{
    const choice=Number(b.dataset.c);lastChoice=choice;lastChoiceQ=S.currentQuestion;
    stage.querySelectorAll('.choice').forEach(x=>x.disabled=true);b.classList.add('picked');
    try{await api('/api/answer',{playerId:joinedId,choice});render();}catch(e){toast(e.message);stage.querySelectorAll('.choice').forEach(x=>x.disabled=false);}
  });
}
function reveal(p){
  currentView='reveal';
  const q=S.question;
  stage.innerHTML=`<div class="card player-status reveal-mobile enter-anim">
    <div class="eyebrow">RESULTADO DA RODADA</div><div class="big-avatar">${avatarSvg(p.avatar)}</div>
    <h1>${p.answered?'Rodada concluída':'Tempo encerrado'}</h1>
    <div class="correct-box mobile-correct"><strong>Resposta correta</strong><span class="answer-dot" style="background:${answerColor(q.correct)}">${answerLetter(q.correct)}</span><span>${esc(q.answers[q.correct])}</span></div>
    <div class="mobile-total"><span class="muted">Sua pontuação total</span><strong>${fmtScore(p.score)} pts</strong></div>
  </div>`;
}
function ranking(p){
  currentView='ranking';
  stage.innerHTML=`<div class="card player-status enter-anim"><div class="rank-me"><div class="eyebrow">RANKING PARCIAL</div><div class="big-avatar">${avatarSvg(p.avatar)}</div><h1>Você está em ${p.rank}º</h1><div class="score hero-score">${fmtScore(p.score)} pts</div></div><div class="small-rank">${S.players.slice(0,5).map(x=>`<div class="rank-row ${x.id===p.id?'me-row':''}"><div class="rank-num">${x.rank}º</div><div class="avatar-circle">${avatarSvg(x.avatar)}</div><strong>${esc(x.name)}</strong><div class="score">${fmtScore(x.score)}</div></div>`).join('')}</div></div>`;
}
function loading(){currentView='loading';stage.innerHTML=`<div class="card player-status waiting enter-anim"><img src="/assets/loading.png" class="loading-logo"><h1>Próxima pergunta...</h1><div class="muted">Fique atento.</div><div class="loading-dots"><i></i><i></i><i></i></div></div>`}
function suspense(p){
  currentView='suspense';
  stage.innerHTML=`<div class="card player-status waiting enter-anim suspense-mobile"><div class="drum-icon">🥁</div><div class="eyebrow">RESULTADO FINAL</div><h1>Que rufem os tambores...</h1><p class="muted">O pódio será revelado em instantes.</p><div class="loading-dots"><i></i><i></i><i></i></div></div>`;
}
function final(p){
  currentView='final';
  hasSeenFinal=true;
  localStorage.removeItem('quizPlayerId');
  const top=S.players.slice(0,3);
  stage.innerHTML=`<div class="card final-me enter-anim"><div class="eyebrow">RESULTADO FINAL</div><div class="big-avatar avatar-glow">${avatarSvg(p.avatar)}</div><h1>${p.rank}º lugar</h1><div class="score final-score">${fmtScore(p.score)} pts</div>${p.rank<=3?`<div class="my-trophy">${trophySvg(p.rank)}<strong>Top ${p.rank}!</strong></div>`:'<p class="muted">Obrigado por participar!</p>'}<div class="small-rank podium-mini">${top.map(x=>`<div class="rank-row"><div>${trophySvg(x.rank,'mini-trophy')}</div><div class="avatar-circle">${avatarSvg(x.avatar)}</div><strong>${esc(x.name)}</strong><div class="score">${fmtScore(x.score)}</div></div>`).join('')}</div></div>`;
}
function leaveFinishedSession(){
  if(!hasSeenFinal||!joinedId||finalExitSent)return;
  finalExitSent=true;
  localStorage.removeItem('quizPlayerId');
  const payload=JSON.stringify({playerId:joinedId});
  try{
    if(navigator.sendBeacon){navigator.sendBeacon('/api/leave',new Blob([payload],{type:'application/json'}));}
    else fetch('/api/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true});
  }catch{}
}
window.addEventListener('pagehide',leaveFinishedSession);
window.addEventListener('beforeunload',leaveFinishedSession);
function toast(t){const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),2400)}
