
const AVATAR_COUNT=31;
const NAMES=['Ari','Bia','Caio','Dani','Eli','Fê','Gabi','Hugo','Iara','João','Kika','Léo','Maya','Nando','Olívia','Paulo','Quésia','Rafa','Sofia','Theo','Uli','Vivi','Will','Xande','Yara','Zeca','Nina','Davi','Luna','Enzo'];
function avatarSvg(i,cls='avatar-img'){
  const idx=((Number(i)||0)%AVATAR_COUNT+AVATAR_COUNT)%AVATAR_COUNT;
  const file=String(idx+1).padStart(2,'0');
  return `<img class="${cls}" src="/assets/avatars/${file}.jpg" alt="Avatar ${idx+1}" draggable="false">`;
}
function trophySvg(place,cls='trophy-svg'){
  const metal=place===1?'#F5C542':place===2?'#C9D4DF':'#C9824B';
  const dark=place===1?'#B8840A':place===2?'#8293A3':'#8E4E28';
  return `<svg class="${cls}" viewBox="0 0 80 80" aria-hidden="true"><path d="M24 10h32v13c0 14-6 24-16 28-10-4-16-14-16-28V10Z" fill="${metal}"/><path d="M24 16H12v8c0 11 6 18 17 20" fill="none" stroke="${metal}" stroke-width="7" stroke-linecap="round"/><path d="M56 16h12v8c0 11-6 18-17 20" fill="none" stroke="${metal}" stroke-width="7" stroke-linecap="round"/><path d="M35 51h10v10H35z" fill="${dark}"/><path d="M27 61h26l5 9H22l5-9Z" fill="${metal}"/><circle cx="40" cy="30" r="10" fill="#fff" opacity=".18"/><text x="40" y="35" text-anchor="middle" font-size="16" font-weight="900" fill="#fff">${place}</text></svg>`;
}
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function fmtScore(n){return Number(n||0).toLocaleString('pt-BR');}
function api(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Erro');return j;});}
function connect(role,onState){
  let ws=null,closed=false,lastState=null,retry=null;
  const open=()=>{
    if(closed)return;
    const proto=location.protocol==='https:'?'wss':'ws';
    ws=new WebSocket(`${proto}://${location.host}/ws?role=${encodeURIComponent(role)}`);
    ws.onmessage=e=>{try{const data=JSON.parse(e.data);lastState=data;onState({...data});}catch{}};
    ws.onclose=()=>{if(!closed){clearTimeout(retry);retry=setTimeout(open,1200)}};
    ws.onerror=()=>{try{ws.close()}catch{}};
  };
  open();
  const tick=setInterval(()=>{
    if(!lastState||!lastState.phaseEndAt||lastState.paused)return;
    if(!['countdown','question'].includes(lastState.phase))return;
    const rem=Math.max(0,lastState.phaseEndAt-Date.now());
    if(Math.abs((lastState.remainingMs||0)-rem)>100){lastState={...lastState,remainingMs:rem};onState({...lastState});}
  },250);
  return {close(){closed=true;clearInterval(tick);clearTimeout(retry);try{ws?.close()}catch{}}};
}
function answerColor(i){return ['#E44955','#2D78E8','#DCA61E','#22A96A'][i]}
function answerLetter(i){return ['A','B','C','D'][i]||''}
function confettiBurst(count=70,intensity='normal'){
  const layer=document.createElement('div');layer.className='confetti-layer';document.body.appendChild(layer);
  const colors=['#18BDF2','#25C879','#F5C542','#F06A78','#8A6DF0','#FFFFFF'];
  const total=Math.max(12,Math.min(180,count));
  for(let i=0;i<total;i++){
    const piece=document.createElement('i');
    const left=Math.random()*100, drift=(Math.random()-.5)*(intensity==='big'?520:300), spin=360+Math.random()*1080;
    const dur=(intensity==='big'?2.8:2.0)+Math.random()*1.7, delay=Math.random()*.55;
    piece.style.cssText=`--x:${left}vw;--d:${drift}px;--r:${spin}deg;--dur:${dur}s;--delay:${delay}s;--c:${colors[i%colors.length]};--w:${6+Math.random()*7}px;--h:${9+Math.random()*10}px`;
    layer.appendChild(piece);
  }
  setTimeout(()=>layer.remove(),5000);
}
