let S=null,lastKey='',effectKey='';
const screen=document.getElementById('screen');
const bgMusic=document.getElementById('bgMusic');
const drumRoll=document.getElementById('drumRoll');
const championsMusic=document.getElementById('championsMusic');
const audioGate=document.getElementById('audioGate');

const PLAYER_JOIN_URL='https://quiz-sipat-2026.automazoom.workers.dev';
const qrToggle=document.getElementById('qrToggle');
const qrMini=document.getElementById('qrMini');
let qrVisible=localStorage.getItem('sipathostQrVisible')!=='0';
function applyQrVisibility(){
  document.body.classList.toggle('qr-hidden',!qrVisible);
  if(qrToggle){qrToggle.textContent=qrVisible?'▦ Ocultar QR':'▦ Mostrar QR';qrToggle.classList.toggle('active',qrVisible)}
  if(qrMini){
    const showMini=qrVisible && S && !['lobby','suspense','final'].includes(S.phase);
    qrMini.classList.toggle('show',!!showMini);
  }
}
if(qrToggle)qrToggle.onclick=()=>{qrVisible=!qrVisible;localStorage.setItem('sipathostQrVisible',qrVisible?'1':'0');applyQrVisibility()};
applyQrVisibility();

let audioUnlocked=false,lastAudioPhase='';
function clampAudio(v){return Math.max(0,Math.min(1,Number(v)||0))}
function showAudioGate(show){if(audioGate)audioGate.style.display=show?'inline-flex':'none'}
function applyAudioSettings(a){if(!a||!S)return;a.volume=clampAudio((S.settings?.musicVolume??35)/100);a.muted=!!S.settings?.musicMuted}
function stopAudio(a,reset=false){if(!a)return;a.pause();if(reset){try{a.currentTime=0}catch{}}}
async function safePlay(a){if(!a)return;applyAudioSettings(a);try{await a.play();audioUnlocked=true;showAudioGate(false)}catch(e){showAudioGate(true)}}
async function syncAudio(force=false){
  if(!S)return;
  [bgMusic,drumRoll,championsMusic].forEach(applyAudioSettings);
  const phase=S.phase;
  if(phase==='suspense'){
    stopAudio(bgMusic,true);stopAudio(championsMusic,true);
    if(force||lastAudioPhase!=='suspense'){lastAudioPhase='suspense';stopAudio(drumRoll,true);await safePlay(drumRoll)}
    return;
  }
  if(phase==='final'){
    stopAudio(bgMusic,true);stopAudio(drumRoll,true);
    if(force||lastAudioPhase!=='final'){lastAudioPhase='final';stopAudio(championsMusic,true);await safePlay(championsMusic)}
    return;
  }
  stopAudio(drumRoll,true);stopAudio(championsMusic,true);
  if(force||lastAudioPhase!=='quiz'){lastAudioPhase='quiz';await safePlay(bgMusic)}else if(bgMusic&&bgMusic.paused)await safePlay(bgMusic);
}
async function unlockAudio(){audioUnlocked=true;await syncAudio(true)}
if(audioGate)audioGate.onclick=unlockAudio;
document.addEventListener('pointerdown',()=>{if(!audioUnlocked)unlockAudio()},{once:true});
document.addEventListener('keydown',()=>{if(!audioUnlocked)unlockAudio()},{once:true});
if(drumRoll)drumRoll.addEventListener('ended',()=>{if(S?.phase==='suspense')api('/api/host/show-final',{}).catch(()=>{})});

connect('public',s=>{
  S=s;
  document.getElementById('roomSmall').textContent=`Sala única • ${s.players.length}/${s.maxPlayers}`;
  const qc=document.getElementById('questionCounter');
  if(qc)qc.textContent=s.totalQuestions?`${Math.max(0,s.currentQuestion+1)}/${s.totalQuestions}`:'0/0';
  syncAudio();render();applyQrVisibility();
});
function timerHtml(){const q=S.question||{};const total=(q.time||8)*1000;const rem=Math.max(0,S.remainingMs||0);const sec=Math.ceil(rem/1000);const p=Math.max(0,Math.min(100,rem/total*100));return `<div class="timer ${sec<=3?'urgent':''}" style="--p:${p}%"><strong>${sec}</strong></div>`}
function rankRows(limit=6){return S.players.slice(0,limit).map(p=>`<div class="rank-row"><div class="rank-num">${p.rank}º</div><div class="avatar-circle">${avatarSvg(p.avatar)}</div><div><strong>${esc(p.name)}</strong>${p.isBot?'<div class="muted bot-label">BOT</div>':''}</div><div class="score">${fmtScore(p.score)}</div></div>`).join('')||'<div class="muted empty-state">Aguardando participantes...</div>'}
function lobbyPlayerTiles(){return S.players.map(p=>`<div class="player-tile pop-in" data-player-id="${esc(p.id)}"><div class="avatar-circle">${avatarSvg(p.avatar)}</div><strong>${esc(p.name)}</strong><span class="muted player-state">${p.isBot?'BOT':'Pronto'}</span></div>`).join('')||'<div class="empty-lobby"><strong>Aguardando jogadores...</strong><span>Abra o endereço acima no celular.</span></div>'}
function answeredCount(){return S.players.filter(p=>p.answered).length}
function render(){if(!S)return;const key=`${S.phase}-${S.currentQuestion}`;if(key!==lastKey){lastKey=key;build();runPhaseEffect(key);}else updateLive()}
function runPhaseEffect(key){if(effectKey===key)return;effectKey=key;if(S.phase==='reveal'&&(S.stats?.correct||0)>0)setTimeout(()=>confettiBurst(42,'normal'),250);if(S.phase==='final')setTimeout(()=>confettiBurst(150,'big'),250)}
function build(){let r;if(S.phase==='lobby')r=lobby();else if(S.phase==='countdown')r=countdown();else if(S.phase==='question')r=question();else if(S.phase==='reveal')r=reveal();else if(S.phase==='ranking')r=ranking();else if(S.phase==='loading')r=loading();else if(S.phase==='suspense')r=suspense();else if(S.phase==='final')r=final();applyQrVisibility();return r}
function updateLive(){
  const t=document.getElementById('liveTimer');if(t)t.innerHTML=timerHtml();
  const c=document.getElementById('liveCount');if(c)c.textContent=`${S.players.length}/${S.maxPlayers}`;
  // No lobby, a lista precisa acompanhar entradas/saídas sem recarregar a página.
  if(S.phase==='lobby'){
    const grid=document.getElementById('lobbyPlayerGrid');
    if(grid){
      const signature=S.players.map(p=>`${p.id}:${p.avatar}:${p.name}:${p.isBot?1:0}`).join('|');
      if(grid.dataset.signature!==signature){
        grid.dataset.signature=signature;
        grid.innerHTML=lobbyPlayerTiles();
      }
    }
  }
  const r=document.getElementById('sideRankRows');if(r)r.innerHTML=rankRows(5);
  const ac=document.getElementById('answeredCount');if(ac)ac.textContent=`${answeredCount()}/${S.players.length} responderam`;
  const ap=document.getElementById('answerProgress');if(ap)ap.style.width=`${S.players.length?answeredCount()/S.players.length*100:0}%`;
  if(S.phase==='countdown'){const n=document.getElementById('countNumber');if(n)n.textContent=Math.max(1,Math.ceil((S.remainingMs||0)/1000))}
}
function lobby(){
  screen.innerHTML=`<div class="screen-content lobby enter-anim"><section class="card lobby-hero"><div><span class="badge">QUIZ CORPORATIVO</span><h1 class="host-title">Quiz <span class="accent">SIPAT 2026</span><br>Automazoom</h1><p class="host-sub">Conhecimento que conecta. Segurança que se pratica.</p></div><div class="join-box qr-join-box"><div class="qr-lobby-copy"><div class="muted">ENTRE PELO CELULAR</div><div class="join-url">${esc(PLAYER_JOIN_URL)}</div><div class="muted room-label">Sala única</div><div class="join-note">Aponte a câmera do celular para o QR Code ou acesse o endereço acima.</div></div><div class="qr-lobby"><div class="qr-frame"><img src="/assets/join_qr.png" alt="QR Code para entrar no Quiz SIPAT 2026"></div><strong>Escaneie para entrar</strong></div></div><div class="safety-note"><img src="/assets/cipa.png" class="cipa-logo"><div><strong>Segurança é compromisso de todos.</strong><div class="muted">Escolha seu avatar e aguarde o início.</div></div></div></section><section class="card players-card"><div class="players-head"><div><h2>Jogadores conectados</h2><div class="muted">Até 31 participantes.</div></div><span class="badge"><span class="dot"></span><span id="liveCount">${S.players.length}/${S.maxPlayers}</span></span></div><div id="lobbyPlayerGrid" class="player-grid" data-signature="${S.players.map(p=>`${p.id}:${p.avatar}:${p.name}:${p.isBot?1:0}`).join('|')}">${lobbyPlayerTiles()}</div></section></div>`;
}
function countdown(){screen.innerHTML=`<div class="screen-content countdown enter-anim"><div><div class="eyebrow large">TODO MUNDO PRONTO?</div><div id="countNumber" class="count-number">${Math.max(1,Math.ceil((S.remainingMs||0)/1000))}</div><h2>O quiz vai começar</h2></div></div>`}
function question(){
  const q=S.question,answered=answeredCount(),pct=S.players.length?answered/S.players.length*100:0;
  screen.innerHTML=`<div class="screen-content question-layout enter-anim"><section class="card q-main"><div class="q-meta"><div class="q-progress-wrap"><div class="q-topline"><strong>Pergunta ${S.currentQuestion+1} de ${S.totalQuestions}</strong><span class="category-pill">${esc(q.category)}</span></div><div class="progress"><span style="width:${((S.currentQuestion+1)/S.totalQuestions)*100}%"></span></div></div><div id="liveTimer">${timerHtml()}</div></div><div class="q-text">${esc(q.question)}</div><div class="answer-grid">${q.answers.map((a,i)=>`<div class="answer-card q-answer-${i}" style="--answer:${answerColor(i)}"><div class="answer-letter">${answerLetter(i)}</div><div>${esc(a)}</div></div>`).join('')}</div></section><aside class="card side-rank"><div class="side-title"><div><div class="eyebrow">PLACAR</div><h3>Antes da rodada</h3></div><span class="lock-icon">🔒</span></div><div id="sideRankRows">${rankRows(5)}</div><div class="response-status"><div class="response-line"><strong id="answeredCount">${answered}/${S.players.length} responderam</strong><span class="muted">Pontuação só atualiza no fim.</span></div><div class="response-progress"><span id="answerProgress" style="width:${pct}%"></span></div></div></aside></div>`;
}
function reveal(){
  const q=S.question,st=S.stats||{counts:[0,0,0,0],total:0,correct:0},max=Math.max(1,...st.counts);
  screen.innerHTML=`<div class="screen-content reveal enter-anim"><section class="card result-card"><div class="result-head"><div><div class="eyebrow">RODADA ENCERRADA</div><h1>Resultado da pergunta</h1><div class="muted">${st.total} resposta${st.total===1?'':'s'} • ${st.correct||0} acerto${st.correct===1?'':'s'}</div></div><span class="badge">${S.currentQuestion+1}/${S.totalQuestions}</span></div><div class="bars">${st.counts.map((n,i)=>`<div class="bar-wrap ${i===q.correct?'correct-bar':''}"><strong>${n}</strong><div class="bar" style="--barh:${Math.max(10,n/max*238)}px;--barcolor:${answerColor(i)}"></div><div class="letter">${answerLetter(i)}</div><div class="muted">${st.total?Math.round(n/st.total*100):0}%</div></div>`).join('')}</div><div class="correct-box"><span class="answer-dot" style="background:${answerColor(q.correct)}">${answerLetter(q.correct)}</span><div><strong>Resposta correta</strong><span>${esc(q.answers[q.correct])}</span></div></div></section><aside class="card side-rank updated-rank"><div class="eyebrow">PLACAR ATUALIZADO</div><h3>Top 5</h3>${rankRows(5)}${S.lastFastest?`<div class="fastest"><span>⚡</span><div><div class="muted">MAIS RÁPIDO</div><strong>${esc(S.lastFastest.name)}</strong><small>${(S.lastFastest.elapsedMs/1000).toFixed(1)} s</small></div></div>`:''}</aside></div>`;
}
function ranking(){screen.innerHTML=`<div class="screen-content ranking-screen enter-anim"><div class="ranking-heading"><div class="eyebrow">APÓS ${S.currentQuestion+1} DE ${S.totalQuestions}</div><h1>Ranking parcial</h1><p class="muted">Quem estará no pódio no final?</p></div><div class="ranking-list">${S.players.slice(0,10).map((p,i)=>`<div class="rank-row rank-big ${i<3?'top-rank':''}"><div class="rank-num">${p.rank}º</div><div class="avatar-circle">${avatarSvg(p.avatar)}</div><strong>${esc(p.name)}</strong><div class="score">${fmtScore(p.score)} pts</div></div>`).join('')}</div></div>`}
function loading(){screen.innerHTML=`<div class="screen-content loading-screen enter-anim"><div class="loading-clean"><img src="/assets/loading.png" class="loading-logo"><h1>Preparando a próxima pergunta...</h1><p class="muted">Respire fundo. Em instantes, mais um desafio.</p><div class="loading-dots"><i></i><i></i><i></i></div></div></div>`}
function suspense(){screen.innerHTML=`<div class="screen-content suspense-screen enter-anim"><div class="suspense-card card"><div class="drum-rings"><span></span><span></span><span></span><div class="drum-main">🥁</div></div><div class="eyebrow large">O QUIZ TERMINOU</div><h1>Que rufem os tambores...</h1><p>Preparando o pódio do <strong>Quiz SIPAT 2026</strong></p><div class="suspense-dots"><i></i><i></i><i></i></div></div></div>`}
function splitRest(players){const size=Math.max(1,Math.ceil(players.length/3));return [players.slice(0,size),players.slice(size,size*2),players.slice(size*2)]}
function final(){
  const top=S.players.slice(0,3),rest=S.players.slice(3),order=[top[1],top[0],top[2]].filter(Boolean),cols=splitRest(rest);
  screen.innerHTML=`<div class="screen-content final-wrap enter-anim"><div class="final-head"><div><div class="eyebrow">QUIZ CONCLUÍDO</div><h1>Resultado <span class="green">Final</span></h1><div class="muted">Parabéns a todos os participantes.</div></div><div class="final-question-count">${S.totalQuestions} perguntas</div></div><div class="final-podium card">${order.map(p=>`<div class="podium-card ${p.rank===1?'first':p.rank===2?'second':'third'}"><div class="trophy-wrap">${trophySvg(p.rank)}</div><div class="avatar-circle">${avatarSvg(p.avatar)}</div><div class="podium-place">${p.rank}º lugar</div><h2>${esc(p.name)}</h2><div class="score">${fmtScore(p.score)} pts</div></div>`).join('')}</div><div class="card full-scoreboard"><div class="scoreboard-title"><h2>Classificação completa</h2><span>${S.players.length} participante${S.players.length===1?'':'s'}</span></div><div class="score-columns">${cols.map(col=>`<div>${col.map(p=>`<div class="compact-rank"><span class="compact-pos">${p.rank}º</span><div class="avatar-circle">${avatarSvg(p.avatar)}</div><strong>${esc(p.name)}</strong><span class="score">${fmtScore(p.score)}</span></div>`).join('')}</div>`).join('')}</div></div></div>`;
}
