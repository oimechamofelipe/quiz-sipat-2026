
import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_QUESTION_SLOTS } from './defaults.js';

const MAX_PLAYERS = 31;
const AVATAR_COUNT = 31;
const QUESTION_SLOT_COUNT = 50;
const BOT_NAMES = ['Alex','Bia','Caio','Dani','Eli','Fê','Gabi','Hugo','Iara','João','Kika','Léo','Maya','Nando','Olívia','Paulo','Quésia','Rafa','Sofia','Theo','Uli','Vivi','Will','Xande','Yara','Zeca','Nina','Davi','Luna','Enzo','Gui'];
const COOKIE_NAME = 'sip_admin_session';
const SESSION_SECONDS = 12 * 60 * 60;

function json(data, status=200, headers={}) {
  return new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
}
function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
function blankQuestionSlot(){return {category:'SIPAT',question:'',answers:['','','',''],correct:0,time:15};}
function normalizeQuestionSlot(raw={}){
  const answers=Array.from({length:4},(_,i)=>String((raw.answers||[])[i]||'').slice(0,250));
  return {category:String(raw.category||'SIPAT').slice(0,40),question:String(raw.question||'').slice(0,500),answers,correct:clamp(Number(raw.correct)||0,0,3),time:clamp(Number(raw.time)||15,5,120)};
}
function slotStatus(slot){
  const q=String(slot?.question||'').trim();
  const answers=(slot?.answers||[]).map(x=>String(x||'').trim());
  if(!q && answers.every(x=>!x)) return 'empty';
  const filled=answers.map((x,i)=>x?i:-1).filter(i=>i>=0);
  if(!q || filled.length<2 || !filled.includes(clamp(Number(slot.correct)||0,0,3))) return 'incomplete';
  return 'active';
}
function rebalanceCorrectPositions(qs){
  const counts=[0,0,0,0]; let prev=-1;
  return qs.map(q=>{
    const copy={...q,answers:[...(q.answers||[])]};
    const max=Math.max(0,copy.answers.length-1); const old=clamp(Number(copy.correct)||0,0,max); let target=old;
    if(old===prev && copy.answers.length>1){
      const candidates=Array.from({length:copy.answers.length},(_,i)=>i).filter(i=>i!==prev).sort((a,b)=>counts[a]-counts[b]||a-b);
      target=candidates[0] ?? old;
    }
    if(target!==old){const t=copy.answers[target];copy.answers[target]=copy.answers[old];copy.answers[old]=t;copy.correct=target;} else copy.correct=old;
    counts[copy.correct]++; prev=copy.correct; return copy;
  });
}
function compileQuestionSlots(slots){
  const active=[];
  slots.forEach((raw,slotIndex)=>{
    const slot=normalizeQuestionSlot(raw); if(slotStatus(slot)!=='active')return;
    const indexes=slot.answers.map((x,i)=>String(x).trim()?i:-1).filter(i=>i>=0);
    const answers=indexes.map(i=>String(slot.answers[i]).trim());
    active.push({_slotIndex:slotIndex,category:slot.category||'SIPAT',question:slot.question.trim(),answers,correct:indexes.indexOf(slot.correct),time:slot.time});
  });
  return rebalanceCorrectPositions(active);
}
function freshState(){
  return {phase:'lobby',phaseStartedAt:Date.now(),phaseEndAt:null,paused:false,pausedRemaining:null,currentQuestion:-1,players:[],settings:{autoFlow:true,showRanking:true,defaultTime:15,revealSeconds:4,rankingSeconds:5,loadingSeconds:3,musicVolume:35,musicMuted:false},lastFastest:null,baseUrl:'',botPlans:[],earlyRevealAt:null};
}
function bytesToB64url(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function strToB64url(s){return bytesToB64url(new TextEncoder().encode(s));}
function b64urlToBytes(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const bin=atob(s);return Uint8Array.from(bin,c=>c.charCodeAt(0));}
function cookieMap(header=''){return Object.fromEntries(header.split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));}
function safeEqual(a,b){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a[i]^b[i];return x===0;}
async function passwordHash(password,saltB64){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const salt=b64urlToBytes(saltB64);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256);
  return bytesToB64url(new Uint8Array(bits));
}
async function newPasswordRecord(password){const salt=crypto.getRandomValues(new Uint8Array(16));const saltB64=bytesToB64url(salt);return {salt:saltB64,hash:await passwordHash(password,saltB64)};}

export class QuizRoom extends DurableObject {
  constructor(ctx, env){
    super(ctx, env); this.ctx=ctx; this.env=env;
    this.ctx.blockConcurrencyWhile(async()=>{
      this.questionSlots=(await this.ctx.storage.get('questionSlots')) || DEFAULT_QUESTION_SLOTS.map(normalizeQuestionSlot);
      this.refreshQuestions(false);
      this.state=(await this.ctx.storage.get('quizState')) || freshState();
      this.state.botPlans=this.state.botPlans||[]; this.state.earlyRevealAt=this.state.earlyRevealAt||null;
      this.admins=(await this.ctx.storage.get('admins')) || [];
      if(!this.admins.length && env.BOOTSTRAP_ADMIN_USER && env.BOOTSTRAP_ADMIN_PASSWORD){
        const rec=await newPasswordRecord(env.BOOTSTRAP_ADMIN_PASSWORD);
        this.admins=[{id:crypto.randomUUID(),username:String(env.BOOTSTRAP_ADMIN_USER).trim().toLowerCase(),displayName:'Administrador principal',active:true,...rec,createdAt:Date.now(),updatedAt:Date.now()}];
        await this.ctx.storage.put('admins',this.admins);
      }
      await this.persistState();
      await this.scheduleNextAlarm();
    });
  }

  refreshQuestions(syncSlots=true){
    const compiled=compileQuestionSlots(this.questionSlots);
    if(syncSlots){for(const q of compiled){const idx=q._slotIndex;const slot=normalizeQuestionSlot(this.questionSlots[idx]);slot.answers=[...q.answers,'','','',''].slice(0,4);slot.correct=q.correct;this.questionSlots[idx]=slot;}}
    this.questions=compiled.map(({_slotIndex,...q})=>q);
  }
  activePlayers(){return this.state.players.filter(p=>!p.removed);}
  sortedPlayers(){return [...this.activePlayers()].sort((a,b)=>b.score-a.score||a.joinedAt-b.joinedAt);}
  publicQuestion(){
    if(this.state.currentQuestion<0||this.state.currentQuestion>=this.questions.length)return null;
    const q=this.questions[this.state.currentQuestion]; const reveal=['reveal','ranking','loading','suspense','final'].includes(this.state.phase);
    return {category:q.category||'Quiz',question:q.question,answers:q.answers,time:this.state.settings.defaultTime,...(reveal?{correct:q.correct}:{})};
  }
  answerCounts(){
    const q=this.questions[this.state.currentQuestion];const counts=Array.from({length:q?.answers?.length||4},()=>0);let total=0,correct=0;if(!q)return {counts,total,correct};
    for(const p of this.activePlayers()){if(p.answer&&p.answer.q===this.state.currentQuestion){counts[p.answer.choice]=(counts[p.answer.choice]||0)+1;total++;if(p.answer.choice===q.correct)correct++;}}
    return {counts,total,correct};
  }
  serialize(role='public'){
    const now=Date.now();const remainingMs=this.state.phaseEndAt&&!this.state.paused?Math.max(0,this.state.phaseEndAt-now):this.state.pausedRemaining;
    const players=this.sortedPlayers().map((p,i)=>({id:p.id,name:p.name,avatar:p.avatar,score:p.score,rank:i+1,isBot:p.isBot,connected:p.connected!==false,answered:!!(p.answer&&p.answer.q===this.state.currentQuestion)}));
    const payload={baseUrl:this.state.baseUrl,phase:this.state.phase,phaseStartedAt:this.state.phaseStartedAt,phaseEndAt:this.state.phaseEndAt,remainingMs,paused:this.state.paused,currentQuestion:this.state.currentQuestion,totalQuestions:this.questions.length,question:this.publicQuestion(),players,maxPlayers:MAX_PLAYERS,settings:this.state.settings,stats:['reveal','ranking','loading','suspense','final'].includes(this.state.phase)?this.answerCounts():null,lastFastest:this.state.lastFastest};
    if(role==='admin'){payload.questions=this.questions;payload.questionSlots=this.questionSlots;payload.questionSlotCount=QUESTION_SLOT_COUNT;}
    return payload;
  }
  async persistState(){await this.ctx.storage.put('quizState',this.state);}
  async persistQuestions(){await this.ctx.storage.put('questionSlots',this.questionSlots);}
  broadcast(){
    for(const ws of this.ctx.getWebSockets()){
      try{const a=ws.deserializeAttachment()||{};ws.send(JSON.stringify(this.serialize(a.role==='admin'?'admin':'public')));}catch{}
    }
  }
  async scheduleNextAlarm(){
    const now=Date.now();const times=[];
    if(this.state.phaseEndAt&&!this.state.paused&&this.state.phaseEndAt>now)times.push(this.state.phaseEndAt);
    if(this.state.earlyRevealAt&&this.state.earlyRevealAt>now)times.push(this.state.earlyRevealAt);
    for(const p of this.state.botPlans||[])if(p.at>now)times.push(p.at);
    if(times.length) await this.ctx.storage.setAlarm(Math.min(...times)); else await this.ctx.storage.deleteAlarm().catch(()=>{});
  }
  async setPhase(phase,seconds=null){this.state.phase=phase;this.state.phaseStartedAt=Date.now();this.state.phaseEndAt=seconds!=null?Date.now()+seconds*1000:null;this.state.paused=false;this.state.pausedRemaining=null;await this.persistState();this.broadcast();await this.scheduleNextAlarm();}
  resetAnswers(){for(const p of this.activePlayers())p.answer=null;this.state.lastFastest=null;this.state.earlyRevealAt=null;this.state.botPlans=[];}
  async startGame(){if(!this.questions.length||!this.activePlayers().length)return;this.state.currentQuestion=0;this.resetAnswers();await this.setPhase('countdown',3);}
  planBots(durationSec){
    const diffCfg={easy:{p:.48,min:.45,max:.95},medium:{p:.68,min:.30,max:.82},hard:{p:.86,min:.16,max:.62},expert:{p:.96,min:.10,max:.44}};const q=this.questions[this.state.currentQuestion];this.state.botPlans=[];
    for(const p of this.activePlayers().filter(x=>x.isBot)){const cfg=diffCfg[p.difficulty]||diffCfg.medium;const frac=cfg.min+Math.random()*(cfg.max-cfg.min);const delay=Math.max(700,Math.round(durationSec*1000*frac));let choice;if(Math.random()<cfg.p)choice=q.correct;else{const wrong=Array.from({length:q.answers.length},(_,i)=>i).filter(x=>x!==q.correct);choice=wrong[Math.floor(Math.random()*wrong.length)];}this.state.botPlans.push({playerId:p.id,at:Date.now()+delay,choice});}
  }
  async startQuestion(index=this.state.currentQuestion){if(index>=this.questions.length)return this.finalScreen();this.state.currentQuestion=index;this.resetAnswers();const sec=Number(this.state.settings.defaultTime||15);this.planBots(sec);await this.setPhase('question',sec);}
  commitRoundScores(){for(const p of this.activePlayers()){if(!p.answer||p.answer.q!==this.state.currentQuestion||p.answer.awarded)continue;if(p.answer.correct)p.score+=Number(p.answer.points||0);p.answer.awarded=true;}}
  async revealQuestion(){if(this.state.phase!=='question'&&this.state.phase!=='countdown')return;this.commitRoundScores();const q=this.questions[this.state.currentQuestion];const correct=this.activePlayers().filter(p=>p.answer&&p.answer.q===this.state.currentQuestion&&p.answer.choice===q.correct).sort((a,b)=>a.answer.elapsedMs-b.answer.elapsedMs);this.state.lastFastest=correct[0]?{name:correct[0].name,avatar:correct[0].avatar,elapsedMs:correct[0].answer.elapsedMs}:null;this.state.earlyRevealAt=null;await this.setPhase('reveal',this.state.settings.autoFlow?this.state.settings.revealSeconds:null);}
  async rankingScreen(){if(this.state.currentQuestion>=this.questions.length-1)return this.suspenseScreen();if(!this.state.settings.showRanking)return this.loadingScreen();await this.setPhase('ranking',this.state.settings.autoFlow?this.state.settings.rankingSeconds:null);}
  async loadingScreen(){await this.setPhase('loading',this.state.settings.autoFlow?this.state.settings.loadingSeconds:null);}
  async nextQuestion(){await this.startQuestion(this.state.currentQuestion+1);}
  async suspenseScreen(){await this.setPhase('suspense',this.state.settings.autoFlow?9:null);}
  async finalScreen(){await this.setPhase('final',null);}
  scoreAnswer(p,choice){
    if(this.state.phase!=='question'||this.state.paused)return {ok:false,error:'Pergunta não está recebendo respostas.'};const q=this.questions[this.state.currentQuestion];if(!q)return {ok:false,error:'Pergunta não encontrada.'};if(!Number.isInteger(choice)||choice<0||choice>=q.answers.length)return {ok:false,error:'Resposta inválida.'};if(p.answer&&p.answer.q===this.state.currentQuestion)return {ok:false,error:'Resposta já registrada.'};const duration=Number(this.state.settings.defaultTime||15)*1000;const elapsed=Math.min(duration,Date.now()-this.state.phaseStartedAt);const correct=choice===q.correct;let points=0;if(correct){const ratio=Math.max(0,1-elapsed/duration);points=Math.round(300+700*ratio);}p.answer={q:this.state.currentQuestion,choice,correct,points,elapsedMs:elapsed,answeredAt:Date.now(),awarded:false};const playing=this.activePlayers();if(playing.length&&playing.every(x=>x.answer&&x.answer.q===this.state.currentQuestion))this.state.earlyRevealAt=Date.now()+650;return {ok:true,correct,points};
  }
  async processDue(){
    const now=Date.now();let changed=false;
    if(this.state.phase==='question'&&!this.state.paused){
      const keep=[];for(const plan of this.state.botPlans||[]){if(now>=plan.at){const p=this.state.players.find(x=>x.id===plan.playerId&&!x.removed);if(p)this.scoreAnswer(p,plan.choice);changed=true;}else keep.push(plan);}this.state.botPlans=keep;
    }
    if(!this.state.paused&&this.state.phase==='question'&&this.state.earlyRevealAt&&now>=this.state.earlyRevealAt){await this.revealQuestion();return;}
    if(!this.state.paused&&this.state.phaseEndAt&&now>=this.state.phaseEndAt){if(this.state.phase==='countdown')await this.startQuestion(this.state.currentQuestion);else if(this.state.phase==='question')await this.revealQuestion();else if(this.state.phase==='reveal')await this.rankingScreen();else if(this.state.phase==='ranking')await this.loadingScreen();else if(this.state.phase==='loading')await this.nextQuestion();else if(this.state.phase==='suspense')await this.finalScreen();return;}
    if(changed){await this.persistState();this.broadcast();}
    await this.scheduleNextAlarm();
  }
  async alarm(){await this.processDue();}

  async signSession(payload){
    if(!this.env.SESSION_SECRET)throw new Error('SESSION_SECRET não configurado.');
    const body=strToB64url(JSON.stringify(payload));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(this.env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)));return body+'.'+bytesToB64url(sig);
  }
  async readSession(request){
    try{const token=cookieMap(request.headers.get('Cookie')||'')[COOKIE_NAME];if(!token||!this.env.SESSION_SECRET)return null;const [body,sigText]=token.split('.');if(!body||!sigText)return null;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(this.env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const expected=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body)));if(!safeEqual(expected,b64urlToBytes(sigText)))return null;const data=JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));if(!data.exp||Date.now()>data.exp)return null;const user=this.admins.find(x=>x.id===data.uid&&x.active);return user?{user,data}:null;}catch{return null;}
  }
  adminPublic(u){return {id:u.id,username:u.username,displayName:u.displayName||u.username,active:!!u.active,createdAt:u.createdAt,updatedAt:u.updatedAt};}
  async login(request){
    if(!this.admins.length)return json({ok:false,error:'Nenhum administrador foi configurado. Defina BOOTSTRAP_ADMIN_USER e BOOTSTRAP_ADMIN_PASSWORD nos Secrets do Cloudflare e faça um novo deploy.'},503);
    const b=await request.json().catch(()=>({}));const username=String(b.username||'').trim().toLowerCase();const password=String(b.password||'');const user=this.admins.find(x=>x.username===username&&x.active);if(!user)return json({ok:false,error:'Usuário ou senha inválidos.'},401);const hash=await passwordHash(password,user.salt);if(hash!==user.hash)return json({ok:false,error:'Usuário ou senha inválidos.'},401);const token=await this.signSession({uid:user.id,username:user.username,exp:Date.now()+SESSION_SECONDS*1000});const secure=new URL(request.url).protocol==='https:'?'; Secure':'';return json({ok:true,user:this.adminPublic(user)},200,{'Set-Cookie':`${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`});
  }
  async requireAdmin(request){const s=await this.readSession(request);return s;}
  logout(request){const secure=new URL(request.url).protocol==='https:'?'; Secure':'';return json({ok:true},200,{'Set-Cookie':`${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`});}

  async handleUsers(request,session,url){
    if(request.method==='GET')return json({ok:true,me:this.adminPublic(session.user),users:this.admins.map(u=>this.adminPublic(u))});
    const b=await request.json().catch(()=>({}));
    if(request.method==='POST'&&url.pathname==='/api/admin/users'){
      const username=String(b.username||'').trim().toLowerCase();const displayName=String(b.displayName||username).trim().slice(0,60);const password=String(b.password||'');
      if(!/^[a-z0-9._-]{3,32}$/.test(username))return json({ok:false,error:'Usuário deve ter 3 a 32 caracteres: letras minúsculas, números, ponto, hífen ou underline.'},400);
      if(password.length<8)return json({ok:false,error:'A senha deve ter pelo menos 8 caracteres.'},400);
      if(this.admins.some(x=>x.username===username))return json({ok:false,error:'Este usuário já existe.'},409);
      const rec=await newPasswordRecord(password);const u={id:crypto.randomUUID(),username,displayName,active:true,...rec,createdAt:Date.now(),updatedAt:Date.now()};this.admins.push(u);await this.ctx.storage.put('admins',this.admins);return json({ok:true,user:this.adminPublic(u)});
    }
    if(request.method==='POST'&&url.pathname==='/api/admin/users/action'){
      const target=this.admins.find(x=>x.id===String(b.id||''));if(!target)return json({ok:false,error:'Administrador não encontrado.'},404);const action=String(b.action||'');
      if(action==='password'){const password=String(b.password||'');if(password.length<8)return json({ok:false,error:'A senha deve ter pelo menos 8 caracteres.'},400);Object.assign(target,await newPasswordRecord(password),{updatedAt:Date.now()});}
      else if(action==='toggle'){const next=!!b.active;if(target.id===session.user.id&&!next)return json({ok:false,error:'Você não pode desativar a própria conta enquanto está conectado.'},400);if(!next&&this.admins.filter(x=>x.active).length<=1)return json({ok:false,error:'Não é possível desativar o último administrador ativo.'},400);target.active=next;target.updatedAt=Date.now();}
      else if(action==='delete'){if(target.id===session.user.id)return json({ok:false,error:'Você não pode excluir a própria conta enquanto está conectado.'},400);if(target.active&&this.admins.filter(x=>x.active).length<=1)return json({ok:false,error:'Não é possível excluir o último administrador ativo.'},400);this.admins=this.admins.filter(x=>x.id!==target.id);}
      else if(action==='rename'){const dn=String(b.displayName||'').trim().slice(0,60);if(!dn)return json({ok:false,error:'Informe o nome de exibição.'},400);target.displayName=dn;target.updatedAt=Date.now();}
      else return json({ok:false,error:'Ação inválida.'},400);
      await this.ctx.storage.put('admins',this.admins);return json({ok:true,users:this.admins.map(u=>this.adminPublic(u))});
    }
    return json({ok:false,error:'Rota inválida.'},404);
  }

  async fetch(request){
    const url=new URL(request.url);this.state.baseUrl=url.origin;
    if(url.pathname==='/api/auth/login'&&request.method==='POST')return this.login(request);
    if(url.pathname==='/api/auth/logout'&&request.method==='POST')return this.logout(request);
    if(url.pathname==='/api/auth/me'){
      const s=await this.readSession(request);return s?json({ok:true,user:this.adminPublic(s.user)}):json({ok:false},401);
    }
    if(url.pathname==='/ws'){
      if(request.headers.get('Upgrade')!=='websocket')return new Response('Expected WebSocket',{status:426});
      const role=url.searchParams.get('role')==='admin'?'admin':'public';if(role==='admin'&&!await this.readSession(request))return new Response('Unauthorized',{status:401});
      const pair=new WebSocketPair();const [client,server]=Object.values(pair);this.ctx.acceptWebSocket(server);server.serializeAttachment({role});server.send(JSON.stringify(this.serialize(role)));return new Response(null,{status:101,webSocket:client});
    }
    if(url.pathname==='/api/state'){
      const role=url.searchParams.get('role')==='admin'?'admin':'public';if(role==='admin'&&!await this.readSession(request))return json({ok:false,error:'Não autorizado.'},401);return json(this.serialize(role));
    }
    if(request.method==='POST'&&url.pathname==='/api/join'){
      const b=await request.json().catch(()=>({}));const name=String(b.name||'').trim().slice(0,24);const avatar=Number(b.avatar);if(!name)return json({ok:false,error:'Digite seu nome.'},400);if(!Number.isInteger(avatar)||avatar<0||avatar>=AVATAR_COUNT)return json({ok:false,error:'Escolha um avatar.'},400);if(!['lobby','countdown'].includes(this.state.phase))return json({ok:false,error:'A partida já começou.'},400);let p=b.playerId?this.state.players.find(x=>x.id===b.playerId&&!x.removed):null;const avatarUsed=this.activePlayers().some(x=>x.avatar===avatar&&(!p||x.id!==p.id));if(avatarUsed)return json({ok:false,error:'Este avatar já foi escolhido. Selecione outro.'},409);if(!p&&this.activePlayers().length>=MAX_PLAYERS)return json({ok:false,error:'Sala lotada.'},400);if(!p){p={id:'p_'+crypto.randomUUID(),name,avatar,score:0,isBot:false,difficulty:null,joinedAt:Date.now(),connected:true,answer:null};this.state.players.push(p);}else{p.name=name;p.avatar=avatar;p.connected=true;}await this.persistState();this.broadcast();return json({ok:true,playerId:p.id});
    }
    if(request.method==='POST'&&url.pathname==='/api/answer'){
      const b=await request.json().catch(()=>({}));const p=this.state.players.find(x=>x.id===b.playerId&&!x.removed);if(!p)return json({ok:false,error:'Jogador não encontrado.'},404);const r=this.scoreAnswer(p,Number(b.choice));await this.persistState();this.broadcast();await this.scheduleNextAlarm();return json(r,r.ok?200:400);
    }
    if(request.method==='POST'&&url.pathname==='/api/leave'){
      const b=await request.json().catch(()=>({}));const p=this.state.players.find(x=>x.id===b.playerId&&!x.removed&&!x.isBot);if(p){p.removed=true;p.connected=false;}await this.persistState();this.broadcast();return json({ok:true});
    }
    if(request.method==='POST'&&url.pathname==='/api/host/show-final'){
      if(this.state.phase==='suspense')await this.finalScreen();return json({ok:true});
    }

    if(url.pathname.startsWith('/api/admin/')){
      const session=await this.requireAdmin(request);if(!session)return json({ok:false,error:'Sessão administrativa expirada. Entre novamente.'},401);
      if(url.pathname==='/api/admin/users'||url.pathname==='/api/admin/users/action')return this.handleUsers(request,session,url);
      const b=request.method==='POST'?await request.json().catch(()=>({})):{};
      if(request.method==='POST'&&url.pathname==='/api/admin/action'){
        const a=b.action;if(a==='start')await this.startGame();else if(a==='pause'&&this.state.phaseEndAt&&!this.state.paused){this.state.pausedRemaining=Math.max(0,this.state.phaseEndAt-Date.now());this.state.phaseEndAt=null;this.state.paused=true;await this.persistState();this.broadcast();await this.scheduleNextAlarm();}else if(a==='resume'&&this.state.paused){this.state.phaseEndAt=Date.now()+(this.state.pausedRemaining||0);this.state.paused=false;this.state.pausedRemaining=null;await this.persistState();this.broadcast();await this.scheduleNextAlarm();}else if(a==='reveal')await this.revealQuestion();else if(a==='next'){if(this.state.phase==='reveal')await this.rankingScreen();else if(this.state.phase==='ranking')await this.loadingScreen();else if(this.state.phase==='loading')await this.nextQuestion();else if(this.state.phase==='suspense')await this.finalScreen();else if(this.state.phase==='question')await this.revealQuestion();}else if(a==='final')await this.suspenseScreen();else if(a==='showfinal'&&this.state.phase==='suspense')await this.finalScreen();else if(a==='reset'){const keep=this.activePlayers().filter(p=>!p.isBot).map(p=>({...p,score:0,answer:null}));const oldSettings={...this.state.settings},base=this.state.baseUrl;this.state=freshState();this.state.settings=oldSettings;this.state.baseUrl=base;this.state.players=keep;await this.persistState();this.broadcast();await this.scheduleNextAlarm();}return json({ok:true});
      }
      if(request.method==='POST'&&url.pathname==='/api/admin/settings'){
        if(typeof b.autoFlow==='boolean')this.state.settings.autoFlow=b.autoFlow;if(typeof b.showRanking==='boolean')this.state.settings.showRanking=b.showRanking;if(Number.isFinite(Number(b.defaultTime)))this.state.settings.defaultTime=clamp(Number(b.defaultTime),5,120);if(Number.isFinite(Number(b.musicVolume)))this.state.settings.musicVolume=clamp(Number(b.musicVolume),0,100);if(typeof b.musicMuted==='boolean')this.state.settings.musicMuted=b.musicMuted;await this.persistState();this.broadcast();return json({ok:true});
      }
      if(request.method==='POST'&&url.pathname==='/api/admin/add-bots'){
        const count=clamp(Number(b.count)||1,1,MAX_PLAYERS),difficulty=['easy','medium','hard','expert'].includes(b.difficulty)?b.difficulty:'medium';if(!['lobby','countdown'].includes(this.state.phase))return json({ok:false,error:'Adicione bots antes da partida.'},400);let added=0;for(let i=0;i<count&&this.activePlayers().length<MAX_PLAYERS;i++){const used=new Set(this.activePlayers().map(p=>p.avatar));const avatar=Array.from({length:AVATAR_COUNT},(_,n)=>n).find(n=>!used.has(n));if(avatar===undefined)break;const usedNames=new Set(this.activePlayers().map(p=>p.name));const name=BOT_NAMES.find(n=>!usedNames.has(n))||`Bot ${this.activePlayers().length+1}`;this.state.players.push({id:'bot_'+crypto.randomUUID(),name,avatar,score:0,isBot:true,difficulty,joinedAt:Date.now()+i,connected:true,answer:null});added++;}await this.persistState();this.broadcast();return json({ok:true,added});
      }
      if(request.method==='POST'&&url.pathname==='/api/admin/remove-player'){
        const p=this.state.players.find(x=>x.id===b.id&&!x.removed);if(!p)return json({ok:false,error:'Participante não encontrado ou já removido.'},404);p.removed=true;p.connected=false;this.state.botPlans=(this.state.botPlans||[]).filter(x=>x.playerId!==p.id);await this.persistState();this.broadcast();return json({ok:true,name:p.name,avatar:p.avatar});
      }
      if(request.method==='POST'&&url.pathname==='/api/admin/clear-bots'){
        for(const p of this.state.players)if(p.isBot)p.removed=true;this.state.botPlans=[];await this.persistState();this.broadcast();return json({ok:true});
      }
      if(request.method==='POST'&&url.pathname==='/api/admin/questions'){
        if(!Array.isArray(b.slots))return json({ok:false,error:'Lista inválida.'},400);const incoming=Array.from({length:QUESTION_SLOT_COUNT},(_,i)=>normalizeQuestionSlot(b.slots[i]||blankQuestionSlot()));const incomplete=[];let activeCount=0;incoming.forEach((slot,i)=>{const st=slotStatus(slot);if(st==='active')activeCount++;else if(st==='incomplete')incomplete.push(i+1);});if(incomplete.length)return json({ok:false,error:`Revise ${incomplete.length===1?'a pergunta':'as perguntas'} ${incomplete.slice(0,8).join(', ')}${incomplete.length>8?'...':''}: há campos incompletos.`},400);if(activeCount<1)return json({ok:false,error:'O quiz precisa ter pelo menos 1 pergunta completa.'},400);this.questionSlots=incoming;this.refreshQuestions(true);if(this.state.currentQuestion>=this.questions.length)this.state.currentQuestion=-1;await this.persistQuestions();await this.persistState();this.broadcast();return json({ok:true,count:this.questions.length});
      }
      return json({ok:false,error:'Rota administrativa inválida.'},404);
    }
    return json({ok:false,error:'Rota não encontrada.'},404);
  }

  async webSocketMessage(ws,message){
    if(message==='ping'){try{ws.send('pong')}catch{}};
  }
  async webSocketClose(ws,code,reason){try{ws.close(code,reason)}catch{}}
}
