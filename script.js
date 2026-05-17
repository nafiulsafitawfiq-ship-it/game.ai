// ══════════════════════════════════════════════════════════
//  NAFIUL SHOOTER 3D — game.js
//  Multiplayer uses BroadcastChannel (works cross-tab / cross-window)
//  as a peer-to-peer mesh: every tab listens + broadcasts state.
//  One tab becomes "host" (first to join) and manages the player list.
// ══════════════════════════════════════════════════════════

const MAX_PLAYERS = 5;
const TICK_RATE   = 50; // ms between network state broadcasts
const CHANNEL_NAME = 'nafiul_shooter_v1';

// ── STATE ─────────────────────────────────────────────────
let score=0, kills=0, wave=1, health=100, ammo=30, maxAmmo=30;
let reloading=false, gameRunning=false, gameMode='single'; // 'single' | 'multi'
let enemies=[], bullets=[], particles=[], nameTags=[];
let keys={}, yaw=0, pitch=0;
let joyActive=false, joyId=null, joyDx=0, joyDy=0;
let lookId=null, lookLastX=0, lookLastY=0;
let myName = '';
let myId   = Math.random().toString(36).slice(2,10);
let isHost = false;

// ── MULTIPLAYER STATE ──────────────────────────────────────
let channel = null;       // BroadcastChannel
let players = {};         // { id: { name, x, y, z, yaw, score, kills, health, mesh, nameTag } }
let tickInterval = null;
let lastBroadcast = 0;

// ══════════════════════════════════════════════════════════
//  THREE.JS SETUP
// ══════════════════════════════════════════════════════════
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.insertBefore(renderer.domElement, document.getElementById('mainmenu'));

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 40, 130);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 300);
camera.position.set(0, 1.7, 0);

// ── LIGHTS ────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffeedd, 0.65));
const sun = new THREE.DirectionalLight(0xfff5e0, 1.3);
sun.position.set(40,60,20); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.near=0.5; sun.shadow.camera.far=200;
['left','right','top','bottom'].forEach((k,i)=>sun.shadow.camera[k]=[-60,60,60,-60][i]);
scene.add(sun);

// ── SUN VISUAL ────────────────────────────────────────────
const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(5,32,32), new THREE.MeshBasicMaterial({color:0xFFDD44}));
sunMesh.position.set(80,70,40); scene.add(sunMesh);
const glowMesh = new THREE.Mesh(new THREE.SphereGeometry(7,32,32), new THREE.MeshBasicMaterial({color:0xFFAA00,transparent:true,opacity:0.18,side:THREE.BackSide}));
glowMesh.position.copy(sunMesh.position); scene.add(glowMesh);
for(let i=0;i<8;i++){
  const g=new THREE.PlaneGeometry(14+Math.random()*6,0.4);
  const m=new THREE.MeshBasicMaterial({color:0xFFDD44,transparent:true,opacity:0.11,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(g,m); mesh.position.copy(sunMesh.position); mesh.rotation.z=(i/8)*Math.PI*2; scene.add(mesh);
}

// ── SKY ───────────────────────────────────────────────────
scene.add(new THREE.Mesh(new THREE.SphereGeometry(200,16,16), new THREE.MeshBasicMaterial({color:0x87CEEB,side:THREE.BackSide})));

// ── GROUND ────────────────────────────────────────────────
const floor = new THREE.Mesh(new THREE.PlaneGeometry(160,160,30,30), new THREE.MeshLambertMaterial({color:0x3a7a2a}));
floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);

const arena = new THREE.Mesh(new THREE.PlaneGeometry(82,82), new THREE.MeshLambertMaterial({color:0x444455}));
arena.rotation.x=-Math.PI/2; arena.position.y=0.01; arena.receiveShadow=true; scene.add(arena);
const grid = new THREE.GridHelper(80,40,0x666677,0x333344);
grid.position.y=0.02; scene.add(grid);

// ── WALLS ─────────────────────────────────────────────────
function makeWall(w,h,d,x,y,z){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d), new THREE.MeshLambertMaterial({color:0x8B7355}));
  m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; scene.add(m);
}
makeWall(82,6,1.2,0,3,-41); makeWall(82,6,1.2,0,3,41);
makeWall(1.2,6,82,-41,3,0); makeWall(1.2,6,82,41,3,0);

// ── PILLARS ───────────────────────────────────────────────
[[-14,14],[14,14],[-14,-14],[14,-14],[-22,0],[22,0],[0,22],[0,-22]].forEach(([x,z])=>{
  const m=new THREE.Mesh(new THREE.BoxGeometry(2.5,6,2.5), new THREE.MeshLambertMaterial({color:0x9B8865}));
  m.position.set(x,3,z); m.castShadow=true; m.receiveShadow=true; scene.add(m);
});

// ── TREES ─────────────────────────────────────────────────
function makeTree(x,z){
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.4,3,8), new THREE.MeshLambertMaterial({color:0x5C3A1E}));
  trunk.position.set(x,1.5,z); trunk.castShadow=true; scene.add(trunk);
  const top=new THREE.Mesh(new THREE.ConeGeometry(2.2,4,8), new THREE.MeshLambertMaterial({color:0x2D5A27}));
  top.position.set(x,5,z); top.castShadow=true; scene.add(top);
}
[[-50,30],[-50,-30],[50,30],[50,-30],[-35,50],[35,50],[-35,-50],[35,-50],[0,60],[60,0],[-60,0],[0,-60]].forEach(([x,z])=>makeTree(x,z));

// ── GUN MODEL ─────────────────────────────────────────────
const gunGroup = new THREE.Group();
gunGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.12,0.1,0.5), new THREE.MeshLambertMaterial({color:0x333344})));
const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,0.4,8), new THREE.MeshLambertMaterial({color:0x222233}));
barrel.rotation.x=Math.PI/2; barrel.position.set(0,0,-0.45); gunGroup.add(barrel);
gunGroup.position.set(0.22,-0.2,-0.4);
camera.add(gunGroup); scene.add(camera);

// ══════════════════════════════════════════════════════════
//  PLAYER MESH FACTORY (for remote players)
// ══════════════════════════════════════════════════════════
function createPlayerMesh(name) {
  const g = new THREE.Group();

  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7,1.2,0.4), new THREE.MeshLambertMaterial({color:0x0044cc}));
  body.position.y=0.6; body.castShadow=true; g.add(body);

  // Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55,0.55,0.55), new THREE.MeshLambertMaterial({color:0xffcc99}));
  head.position.y=1.5; g.add(head);

  // Eyes
  const eyeM = new THREE.MeshBasicMaterial({color:0x003399});
  [-0.13,0.13].forEach(ex=>{
    const e=new THREE.Mesh(new THREE.SphereGeometry(0.06,6,6),eyeM);
    e.position.set(ex,1.55,0.28); g.add(e);
  });

  // Gun arm
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.08,0.35), new THREE.MeshLambertMaterial({color:0x333344}));
  arm.position.set(0.3,0.7,-0.4); g.add(arm);

  return g;
}

// ══════════════════════════════════════════════════════════
//  NAME TAG (CSS2D-style via canvas texture on plane)
// ══════════════════════════════════════════════════════════
function createNameTag(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // BG pill
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  roundRect(ctx, 4, 14, 248, 42, 10);

  // Name text
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.substring(0,12), 128, 35);

  // Arrow
  ctx.fillStyle = 'rgba(255,140,0,0.9)';
  ctx.beginPath();
  ctx.moveTo(122,56); ctx.lineTo(134,56); ctx.lineTo(128,63); ctx.closePath();
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({map:texture, transparent:true, depthTest:false, side:THREE.DoubleSide});
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.6,0.4), mat);
  plane.renderOrder = 999;
  return plane;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath(); ctx.fill();
}

// ══════════════════════════════════════════════════════════
//  ENEMIES (single player)
// ══════════════════════════════════════════════════════════
function spawnEnemy() {
  const a = Math.random()*Math.PI*2, d = 22+Math.random()*14;
  const g = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8,1.2,0.5), new THREE.MeshLambertMaterial({color:0xcc2200}));
  body.position.y=0.6; body.castShadow=true; g.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.6,0.6), new THREE.MeshLambertMaterial({color:0xff4422}));
  head.position.y=1.5; g.add(head);

  const eyeM = new THREE.MeshBasicMaterial({color:0xffff00});
  [-0.15,0.15].forEach(ex=>{
    const e=new THREE.Mesh(new THREE.SphereGeometry(0.07,6,6),eyeM);
    e.position.set(ex,1.55,0.31); g.add(e);
  });

  g.position.set(Math.sin(a)*d, 0, Math.cos(a)*d);
  scene.add(g);
  enemies.push({mesh:g, hp:30+wave*10, speed:2.5+wave*0.3+Math.random()*0.5, shootTimer:Math.random()*3});
}

// ══════════════════════════════════════════════════════════
//  SHOOTING
// ══════════════════════════════════════════════════════════
function fireBullet() {
  if(ammo<=0 || reloading) return;
  ammo--; updateHUD();
  if(ammo===0) startReload();

  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.07,6,6), new THREE.MeshBasicMaterial({color:0xffee00}));
  b.position.copy(camera.position).add(dir.clone().multiplyScalar(0.6));
  scene.add(b);
  bullets.push({mesh:b, dir:dir.clone(), speed:45, life:1.5, enemy:false, owner:myId});

  // Flash
  const sf = document.getElementById('shootflash');
  sf.style.opacity='1'; setTimeout(()=>sf.style.opacity='0', 55);
  gunGroup.position.z+=0.06; setTimeout(()=>gunGroup.position.z-=0.06, 80);

  // Instant raycast
  const ray = new THREE.Raycaster(camera.position, dir, 0, 70);

  // vs bots
  if(gameMode==='single') {
    for(let i=enemies.length-1;i>=0;i--){
      const hits = ray.intersectObject(enemies[i].mesh, true);
      if(hits.length>0){
        enemies[i].hp -= 25+Math.floor(Math.random()*10);
        spawnParticles(hits[0].point, 0xff4400);
        if(enemies[i].hp<=0) killEnemy(i);
        break;
      }
    }
  }

  // vs players (multiplayer)
  if(gameMode==='multi') {
    for(const [pid, p] of Object.entries(players)) {
      if(!p.mesh || p.health<=0) continue;
      const hits = ray.intersectObject(p.mesh, true);
      if(hits.length>0){
        spawnParticles(hits[0].point, 0x4466ff);
        // Tell them they were hit
        broadcast({ type:'HIT', target:pid, from:myId, dmg:25+Math.floor(Math.random()*10) });
        break;
      }
    }
  }

  // Broadcast shot for visual on other clients
  if(gameMode==='multi') {
    broadcast({ type:'SHOT', id:myId, ox:camera.position.x, oy:camera.position.y, oz:camera.position.z, dx:dir.x, dy:dir.y, dz:dir.z });
  }
}

function killEnemy(i) {
  spawnParticles(enemies[i].mesh.position.clone().add(new THREE.Vector3(0,1,0)), 0xff2200, 20);
  scene.remove(enemies[i].mesh); enemies.splice(i,1);
  kills++; score+=100*wave; addMsg(`+${100*wave} KILL`); updateHUD();
  if(enemies.length===0) nextWave();
}

function spawnParticles(pos, color, count=8) {
  for(let i=0;i<count;i++){
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.05,4,4), new THREE.MeshBasicMaterial({color,transparent:true}));
    p.position.copy(pos); scene.add(p);
    particles.push({mesh:p, vel:new THREE.Vector3((Math.random()-.5)*7, Math.random()*6, (Math.random()-.5)*7), life:0.6});
  }
}

function enemyShoot(e) {
  const dir = camera.position.clone().sub(e.mesh.position).normalize();
  dir.x+=(Math.random()-.5)*0.3; dir.z+=(Math.random()-.5)*0.3;
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.08,6,6), new THREE.MeshBasicMaterial({color:0xff0000}));
  b.position.copy(e.mesh.position).add(new THREE.Vector3(0,1.5,0));
  scene.add(b);
  bullets.push({mesh:b, dir:dir.normalize(), speed:18, life:2.2, enemy:true, owner:'bot'});
}

function nextWave() {
  wave++; updateHUD();
  const ann = document.getElementById('waveannounce');
  ann.textContent=`WAVE ${wave}`; ann.style.opacity='1';
  setTimeout(()=>ann.style.opacity='0', 2000);
  setTimeout(()=>{ for(let i=0;i<Math.min(4+wave*2,16);i++) spawnEnemy(); }, 2600);
}

function startReload() {
  if(reloading || ammo===maxAmmo) return;
  reloading=true;
  const hint = document.getElementById('reload-hint');
  const bar  = document.getElementById('reload-bar');
  hint.style.display='flex'; bar.style.width='0%';
  bar.style.transition='width 1.8s linear';
  setTimeout(()=>bar.style.width='100%', 30);
  addMsg('RELOADING…');
  setTimeout(()=>{ ammo=maxAmmo; reloading=false; updateHUD(); hint.style.display='none'; bar.style.transition=''; bar.style.width='0%'; }, 1800);
}

// ══════════════════════════════════════════════════════════
//  HUD
// ══════════════════════════════════════════════════════════
function updateHUD() {
  document.getElementById('score-v').textContent  = score;
  document.getElementById('wave-v').textContent   = wave;
  document.getElementById('kills-v').textContent  = kills;
  document.getElementById('hp-v').textContent     = health;
  document.getElementById('ammo-v').textContent   = ammo;
  document.getElementById('health-fill').style.width = health+'%';
  document.getElementById('health-fill').style.background = health<30 ? '#ff0000' : 'linear-gradient(90deg,#ff2200,#ff8c00)';
  if(gameMode==='multi') {
    document.getElementById('players-v').textContent = Object.keys(players).length+1;
    updateScoreboard();
  }
}

function addMsg(msg, type='') {
  const kf = document.getElementById('killfeed');
  const div = document.createElement('div');
  div.className = 'kill-msg '+(type||'');
  div.textContent = msg;
  kf.appendChild(div);
  setTimeout(()=>div.remove(), 3200);
}

function takeDamage(amt) {
  health = Math.max(0, health-amt); updateHUD();
  const hf = document.getElementById('hitflash'); hf.style.opacity='1';
  setTimeout(()=>hf.style.opacity='0', 150);
  if(health<=0) endGame();
}

function updateScoreboard() {
  const list = document.getElementById('scoreboard-list');
  list.innerHTML='';

  // Me first
  const me = document.createElement('div');
  me.className='scoreboard-row me';
  me.innerHTML=`<span class="sb-name">★ ${myName}</span><span class="sb-score">${score}</span><span class="sb-kills">${kills}K</span>`;
  list.appendChild(me);

  // Others
  for(const [pid, p] of Object.entries(players)){
    const row=document.createElement('div');
    row.className='scoreboard-row';
    const dead = p.health<=0 ? ' 💀' : '';
    row.innerHTML=`<span class="sb-name">${p.name}${dead}</span><span class="sb-score">${p.score||0}</span><span class="sb-kills">${p.kills||0}K</span>`;
    list.appendChild(row);
  }
}

// ══════════════════════════════════════════════════════════
//  MULTIPLAYER — BroadcastChannel mesh
// ══════════════════════════════════════════════════════════
function broadcast(msg) {
  if(!channel) return;
  try { channel.postMessage(JSON.stringify({...msg, senderId:myId})); } catch(e){}
}

function initChannel() {
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch{ return; }
    if(msg.senderId===myId) return;
    handleNetMsg(msg);
  };
}

function handleNetMsg(msg) {
  switch(msg.type) {

    case 'JOIN': {
      // Someone joined: if we're host, validate name and reply with player list
      const taken = Object.values(players).some(p=>p.name===msg.name) || (myName===msg.name);
      if(isHost) {
        const count = Object.keys(players).length+1; // +1 for us
        broadcast({ type:'JOIN_REPLY', to:msg.id, taken, count, names:getNameList(), hostId:myId });
      }
      break;
    }

    case 'JOIN_REPLY': {
      if(msg.to !== myId) return;
      // Handled in joinMultiplayer() promise
      window._joinReplyHandler && window._joinReplyHandler(msg);
      break;
    }

    case 'PLAYER_LIST': {
      // Host sends full list when someone new joins
      (msg.list||[]).forEach(p=>{
        if(p.id===myId) return;
        if(!players[p.id]) addRemotePlayer(p.id, p.name, p.x, p.y, p.z);
        else updateRemotePos(p.id, p.x, p.y, p.z, p.yaw, p.score, p.kills, p.health);
      });
      break;
    }

    case 'ANNOUNCE': {
      // New player tells everyone they exist
      if(msg.id===myId) return;
      if(!players[msg.id]) {
        addRemotePlayer(msg.id, msg.name, msg.x||0, 0, msg.z||0);
        addMsg(`${msg.name} joined`, 'info');
        updateHUD();
      }
      // If we're host, broadcast updated full list
      if(isHost) broadcastPlayerList();
      break;
    }

    case 'STATE': {
      if(msg.id===myId) return;
      if(!players[msg.id]) {
        addRemotePlayer(msg.id, msg.name, msg.x, msg.y, msg.z);
      } else {
        updateRemotePos(msg.id, msg.x, msg.y, msg.z, msg.yaw, msg.score, msg.kills, msg.health);
      }
      break;
    }

    case 'LEAVE': {
      if(players[msg.id]) {
        addMsg(`${players[msg.id].name} left`, 'warn');
        removeRemotePlayer(msg.id);
        updateHUD();
        if(isHost) broadcastPlayerList();
      }
      break;
    }

    case 'HIT': {
      if(msg.target===myId) {
        takeDamage(msg.dmg);
        // Tell attacker they scored
        broadcast({ type:'SCORED', by:msg.from, victim:myId, dmg:msg.dmg });
      }
      break;
    }

    case 'SCORED': {
      if(msg.by===myId) {
        score+=50; kills++;
        addMsg(`+50 PLAYER HIT!`); updateHUD();
      }
      break;
    }

    case 'SHOT': {
      // Visual bullet from another player
      if(msg.id===myId) return;
      const dir2 = new THREE.Vector3(msg.dx,msg.dy,msg.dz).normalize();
      const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.07,6,6), new THREE.MeshBasicMaterial({color:0x44aaff}));
      b2.position.set(msg.ox,msg.oy,msg.oz);
      scene.add(b2);
      bullets.push({mesh:b2, dir:dir2, speed:45, life:1.5, enemy:false, visual:true, owner:msg.id});
      break;
    }

    case 'NAME_CHECK': {
      // Pre-join name validation
      if(msg.to!=='all') return;
      const taken2 = Object.values(players).some(p=>p.name===msg.name) || (myName===msg.name && msg.askerId!==myId);
      if(taken2) {
        broadcast({ type:'NAME_TAKEN', name:msg.name, askerId:msg.askerId });
      }
      break;
    }

    case 'NAME_TAKEN': {
      window._nameTakenHandler && window._nameTakenHandler(msg.name, msg.askerId);
      break;
    }
  }
}

function addRemotePlayer(id, name, x=0, y=0, z=0) {
  if(players[id]) return;
  const mesh = createPlayerMesh(name);
  mesh.position.set(x,0,z);
  scene.add(mesh);

  const tag = createNameTag(name);
  tag.position.set(x, 3.0, z);
  scene.add(tag);

  players[id] = { name, x, y:0, z, yaw:0, score:0, kills:0, health:100, mesh, nameTag:tag };
  updateHUD();
}

function updateRemotePos(id, x, y, z, ryaw=0, sc=0, kl=0, hp=100) {
  const p = players[id];
  if(!p) return;
  p.x=x; p.y=y; p.z=z; p.yaw=ryaw; p.score=sc; p.kills=kl; p.health=hp;
  if(p.mesh) {
    p.mesh.position.set(x,0,z);
    p.mesh.rotation.y = ryaw;
  }
  if(p.nameTag) {
    p.nameTag.position.set(x, 3.0, z);
    // Billboard: face camera
    p.nameTag.lookAt(camera.position);
  }
}

function removeRemotePlayer(id) {
  const p = players[id];
  if(!p) return;
  if(p.mesh) scene.remove(p.mesh);
  if(p.nameTag) scene.remove(p.nameTag);
  delete players[id];
}

function broadcastPlayerList() {
  const list = Object.entries(players).map(([id,p])=>({id,name:p.name,x:p.x,y:p.y,z:p.z,score:p.score,kills:p.kills,health:p.health}));
  // Add self
  list.push({id:myId,name:myName,x:camera.position.x,y:camera.position.y,z:camera.position.z,score,kills,health});
  broadcast({type:'PLAYER_LIST', list});
}

function getNameList() {
  return [myName, ...Object.values(players).map(p=>p.name)];
}

function broadcastState() {
  broadcast({
    type:'STATE', id:myId, name:myName,
    x:camera.position.x, y:camera.position.y, z:camera.position.z,
    yaw, score, kills, health
  });
  // Keep name tags facing camera
  for(const p of Object.values(players)) {
    if(p.nameTag) p.nameTag.lookAt(camera.position);
  }
}

// ══════════════════════════════════════════════════════════
//  GAME LOOP
// ══════════════════════════════════════════════════════════
const clock = new THREE.Clock();

function loop() {
  if(!gameRunning) return;
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  // ── Movement
  const speed = (keys['ShiftLeft']||keys['ShiftRight']) ? 8 : 5;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const rgt = new THREE.Vector3(Math.cos(yaw),  0, -Math.sin(yaw));
  const mv  = new THREE.Vector3();

  if(keys['KeyW']||keys['ArrowUp'])    mv.add(fwd);
  if(keys['KeyS']||keys['ArrowDown'])  mv.sub(fwd);
  if(keys['KeyA']||keys['ArrowLeft'])  mv.sub(rgt);
  if(keys['KeyD']||keys['ArrowRight']) mv.add(rgt);

  if(joyActive && (Math.abs(joyDx)>0.05||Math.abs(joyDy)>0.05)){
    mv.add(fwd.clone().multiplyScalar(-joyDy));
    mv.add(rgt.clone().multiplyScalar(joyDx));
  }

  if(mv.length()>0){
    mv.normalize().multiplyScalar(speed*dt);
    camera.position.x = Math.max(-38, Math.min(38, camera.position.x+mv.x));
    camera.position.z = Math.max(-38, Math.min(38, camera.position.z+mv.z));
    gunGroup.position.y = -0.2+Math.sin(Date.now()*0.008)*0.015;
  }

  camera.rotation.order='YXZ'; camera.rotation.y=yaw; camera.rotation.x=pitch;

  // ── Sun animation
  const t = Date.now()*0.0001;
  sunMesh.position.set(Math.cos(t)*100, 50+Math.sin(t)*40, Math.sin(t)*100);
  glowMesh.position.copy(sunMesh.position);
  sun.position.copy(sunMesh.position);

  // ── Bullets
  for(let i=bullets.length-1;i>=0;i--){
    const b=bullets[i]; b.life-=dt;
    b.mesh.position.addScaledVector(b.dir, b.speed*dt);
    if(b.enemy && !b.visual && b.mesh.position.distanceTo(camera.position)<0.9){
      takeDamage(8); scene.remove(b.mesh); bullets.splice(i,1); continue;
    }
    if(b.life<=0){ scene.remove(b.mesh); bullets.splice(i,1); }
  }

  // ── Enemies (single player only)
  if(gameMode==='single'){
    for(let i=enemies.length-1;i>=0;i--){
      const e=enemies[i];
      const dir2=camera.position.clone().sub(e.mesh.position); dir2.y=0;
      const dist=dir2.length();
      if(dist>0.1){ dir2.normalize(); e.mesh.position.addScaledVector(dir2, e.speed*dt); e.mesh.lookAt(camera.position.x, e.mesh.position.y, camera.position.z); }
      if(dist<1.2) takeDamage(12*dt);
      e.shootTimer-=dt;
      if(e.shootTimer<=0&&dist<28){ enemyShoot(e); e.shootTimer=1.5+Math.random()*2; }
    }
  }

  // ── Particles
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i]; p.life-=dt; p.vel.y-=14*dt;
    p.mesh.position.addScaledVector(p.vel,dt);
    p.mesh.material.opacity=p.life*2;
    if(p.life<=0){ scene.remove(p.mesh); particles.splice(i,1); }
  }

  // ── Network broadcast (50ms tick)
  if(gameMode==='multi' && now-lastBroadcast>TICK_RATE){
    broadcastState(); lastBroadcast=now;
  }

  renderer.render(scene, camera);
}

// ══════════════════════════════════════════════════════════
//  MENU ACTIONS
// ══════════════════════════════════════════════════════════
function selectMode(mode) {
  if(mode==='single'){
    document.getElementById('mainmenu').style.display='none';
    startSinglePlayer();
  } else {
    document.getElementById('mainmenu').style.display='none';
    document.getElementById('namescreen').style.display='flex';
    initChannelForNameCheck();
    pollServerCount();
  }
}

function backToMenu() {
  if(gameRunning) stopGame();
  document.getElementById('gameover').style.display='none';
  document.getElementById('namescreen').style.display='none';
  document.getElementById('ui').style.display='none';
  document.getElementById('mainmenu').style.display='flex';
  if(channel){ channel.close(); channel=null; }
}

// ── Name check helpers
let nameCheckDebounce=null;
let pendingNameOk=false;

function initChannelForNameCheck(){
  if(channel) channel.close();
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage=(e)=>{
    let msg; try{ msg=JSON.parse(e.data); }catch{return;}
    if(msg.senderId===myId) return;

    // While on name screen, we care about NAME_TAKEN and server info
    if(msg.type==='NAME_TAKEN' && msg.askerId===myId){
      setNameStatus('That name is already taken!','err'); pendingNameOk=false;
      document.getElementById('join-btn').disabled=true;
    }
    if(msg.type==='STATE'||msg.type==='ANNOUNCE'){
      // Someone's online — count them
      if(!players[msg.id] && msg.id!==myId) players[msg.id]={name:msg.name};
      updateServerCount();
    }
    if(msg.type==='LEAVE' && players[msg.id]){ delete players[msg.id]; updateServerCount(); }
  };
}

function pollServerCount(){
  // Ping the channel to see who's there
  players={};
  broadcast({type:'PING', id:myId});
  setTimeout(updateServerCount, 600);
}

function updateServerCount(){
  const count=Object.keys(players).length; // others
  const el=document.getElementById('player-count-text');
  if(count===0) el.textContent='Server is empty — you\'ll be first in!';
  else if(count>=MAX_PLAYERS-1) el.textContent=`Server full! (${count+1}/${MAX_PLAYERS}) — wait for a slot`;
  else el.textContent=`${count+1}/${MAX_PLAYERS} players online`;
}

function setNameStatus(msg, cls=''){
  const el=document.getElementById('name-status');
  el.textContent=msg; el.className='name-status '+cls;
}

// Name input live validation
document.addEventListener('DOMContentLoaded',()=>{
  const input=document.getElementById('name-input');
  if(!input) return;
  input.addEventListener('input',()=>{
    clearTimeout(nameCheckDebounce);
    const v=input.value.trim();
    if(!v||v.length<2){ setNameStatus('Min 2 characters','err'); pendingNameOk=false; document.getElementById('join-btn').disabled=true; return; }
    if(!/^[A-Za-z0-9_]+$/.test(v)){ setNameStatus('Letters, numbers, _ only','err'); pendingNameOk=false; document.getElementById('join-btn').disabled=true; return; }
    setNameStatus('Checking…','checking');
    pendingNameOk=false; document.getElementById('join-btn').disabled=true;

    nameCheckDebounce=setTimeout(()=>{
      // Broadcast name check; others reply if taken
      broadcast({type:'NAME_CHECK', name:v, askerId:myId, to:'all'});
      // Give 600ms for replies
      setTimeout(()=>{
        // If no NAME_TAKEN received, it's free
        if(document.getElementById('name-input').value.trim()===v){
          setNameStatus('✓ Name available','ok');
          pendingNameOk=true; document.getElementById('join-btn').disabled=false;
          // If nobody's online (no channel replies), also allow
        }
      },600);
    },400);
  });
});

async function joinMultiplayer(){
  const name=document.getElementById('name-input').value.trim();
  if(!name || name.length<2) return;
  if(!pendingNameOk){
    // If server empty, allow anyway
    const count=Object.keys(players).length;
    if(count>0){ setNameStatus('Please wait for name check','err'); return; }
  }
  const count=Object.keys(players).length;
  if(count>=MAX_PLAYERS){ addMsg('Server is full!','warn'); return; }

  myName=name;
  document.getElementById('namescreen').style.display='none';
  players={}; // will repopulate from ANNOUNCE replies

  // Determine if host (first player = no one broadcasting)
  isHost=(Object.keys(players).length===0);

  startMultiPlayer();
}

// ══════════════════════════════════════════════════════════
//  START GAME
// ══════════════════════════════════════════════════════════
function startSinglePlayer(){
  gameMode='single'; gameRunning=true;
  resetGameState();
  document.getElementById('ui').style.display='block';
  document.getElementById('wave-box').style.display='block';
  document.getElementById('players-box').style.display='none';
  document.getElementById('multi-scoreboard').style.display='none';
  document.getElementById('mode-v').textContent='SOLO';
  for(let i=0;i<5;i++) spawnEnemy();
  updateHUD(); clock.start(); requestPointerLock(); loop();
}

function startMultiPlayer(){
  gameMode='multi'; gameRunning=true;
  resetGameState();
  document.getElementById('ui').style.display='block';
  document.getElementById('wave-box').style.display='none';
  document.getElementById('players-box').style.display='block';
  document.getElementById('multi-scoreboard').style.display='block';
  document.getElementById('mode-v').textContent='MULTI';

  // Re-init channel for game
  if(channel) channel.close();
  initChannel();

  updateHUD(); clock.start(); requestPointerLock();

  // Announce ourselves
  broadcast({
    type:'ANNOUNCE', id:myId, name:myName,
    x:camera.position.x, y:0, z:camera.position.z
  });

  // If host, send player list after a beat
  setTimeout(()=>{ if(isHost) broadcastPlayerList(); }, 500);

  loop();

  // Cleanup on page unload
  window.addEventListener('beforeunload',()=>{
    broadcast({type:'LEAVE', id:myId});
  });
}

function resetGameState(){
  score=0; kills=0; wave=1; health=100; ammo=maxAmmo; reloading=false; yaw=0; pitch=0;
  enemies.forEach(e=>scene.remove(e.mesh)); enemies=[];
  bullets.forEach(b=>scene.remove(b.mesh)); bullets=[];
  particles.forEach(p=>scene.remove(p.mesh)); particles=[];
  // Remove old remote players
  for(const id of Object.keys(players)) removeRemotePlayer(id);
  // camera.position.set(0,1.7,0); // Keep position? No, reset.
  const angle=Math.random()*Math.PI*2;
  camera.position.set(Math.sin(angle)*8, 1.7, Math.cos(angle)*8);
}

function stopGame(){
  gameRunning=false;
  enemies.forEach(e=>scene.remove(e.mesh)); enemies=[];
  bullets.forEach(b=>scene.remove(b.mesh)); bullets=[];
  particles.forEach(p=>scene.remove(p.mesh)); particles=[];
  for(const id of Object.keys(players)) removeRemotePlayer(id);
  players={};
}

function endGame(){
  gameRunning=false;
  if(gameMode==='multi') broadcast({type:'LEAVE', id:myId});
  if(document.exitPointerLock) document.exitPointerLock();
  const go=document.getElementById('gameover');
  go.style.display='flex';
  document.getElementById('go-title').textContent = gameMode==='multi' ? 'YOU WERE ELIMINATED' : 'YOU DIED';
  document.getElementById('go-stats').innerHTML=
    `Score: <b>${score}</b><br>Wave: <b>${wave}</b><br>Kills: <b>${kills}</b>`;
}

function restartGame(){
  document.getElementById('gameover').style.display='none';
  document.getElementById('killfeed').innerHTML='';
  if(gameMode==='single') startSinglePlayer();
  else {
    // Re-announce in multiplayer
    document.getElementById('namescreen').style.display='none';
    startMultiPlayer();
  }
}

// ══════════════════════════════════════════════════════════
//  INPUT
// ══════════════════════════════════════════════════════════
document.addEventListener('keydown',e=>{
  keys[e.code]=true;
  if(e.code==='KeyR' && gameRunning) startReload();
  if(e.code==='Escape' && gameRunning) endGame();
});
document.addEventListener('keyup',e=>keys[e.code]=false);
document.addEventListener('click',()=>{ if(gameRunning) fireBullet(); });
document.addEventListener('mousemove',e=>{
  if(!gameRunning) return;
  yaw  -=e.movementX*0.0018;
  pitch -=e.movementY*0.0018;
  pitch = Math.max(-Math.PI/3, Math.min(Math.PI/3, pitch));
});

function requestPointerLock(){
  try{ renderer.domElement.requestPointerLock(); }catch(e){}
}
renderer.domElement.addEventListener('click',()=>{ if(gameRunning) requestPointerLock(); });

// ── Mobile joystick ────────────────────────────────────────
const jBase  = document.getElementById('joystick-base');
const jThumb = document.getElementById('joystick-thumb');
const jZone  = document.getElementById('joystick-zone');
const jRadius= 50;

jZone.addEventListener('touchstart',e=>{ e.preventDefault(); joyId=e.changedTouches[0].identifier; joyActive=true; },{passive:false});

document.addEventListener('touchmove',e=>{
  e.preventDefault();
  for(const t of e.changedTouches){
    if(t.identifier===joyId){
      const rect=jBase.getBoundingClientRect();
      const cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
      let dx=t.clientX-cx, dy=t.clientY-cy;
      const dist=Math.sqrt(dx*dx+dy*dy);
      if(dist>jRadius){dx=dx/dist*jRadius;dy=dy/dist*jRadius;}
      joyDx=dx/jRadius; joyDy=dy/jRadius;
      jThumb.style.transform=`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`;
    }
    if(t.identifier===lookId){
      const dx=(t.clientX-lookLastX)*0.004, dy=(t.clientY-lookLastY)*0.004;
      yaw-=dx; pitch-=dy; pitch=Math.max(-Math.PI/3,Math.min(Math.PI/3,pitch));
      lookLastX=t.clientX; lookLastY=t.clientY;
    }
  }
},{passive:false});

document.addEventListener('touchend',e=>{
  for(const t of e.changedTouches){
    if(t.identifier===joyId){joyActive=false;joyDx=0;joyDy=0;joyId=null;jThumb.style.transform='translate(-50%,-50%)';}
    if(t.identifier===lookId) lookId=null;
  }
});

const lookZone=document.getElementById('look-zone');
lookZone.addEventListener('touchstart',e=>{
  e.preventDefault();
  const t=e.changedTouches[0];
  lookId=t.identifier; lookLastX=t.clientX; lookLastY=t.clientY;
},{passive:false});

document.getElementById('fire-btn').addEventListener('touchstart',e=>{
  e.preventDefault(); e.stopPropagation();
  if(gameRunning) fireBullet();
},{passive:false});

document.getElementById('reload-btn').addEventListener('touchstart',e=>{
  e.preventDefault(); e.stopPropagation();
  if(gameRunning) startReload();
},{passive:false});

// ── Resize ────────────────────────────────────────────────
window.addEventListener('resize',()=>{
  camera.aspect=window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth,window.innerHeight);
});

// Expose to HTML onclick
window.selectMode  = selectMode;
window.backToMenu  = backToMenu;
window.joinMultiplayer = joinMultiplayer;
window.restartGame = restartGame;