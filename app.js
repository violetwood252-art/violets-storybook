const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const KEY='violets-storybook-v1';
// Keep the currently applied theme in its own storage slot. This lets the theme
// survive a reload even if the main collection data is too large to save.
const ACTIVE_THEME_KEY='violets-storybook-active-theme-v1';
const seed={settings:{layout:'cover',autoPlay:false,loop:true,preview:'manual',fontSize:17,lineHeight:1.95,bodyFont:'Georgia',signature:'Violet196'},series:[{id:'ser-hogwarts',name:'霍格沃茨日常',themeId:''},{id:'ser-finn',name:'小狐狸的故事',themeId:''}],characters:[{id:'char-fin',name:'芬利·奥格尔维',description:'格拉斯哥的小狐狸',storyIds:[]}],stories:[{id:'story-welcome',title:'欢迎来到 Violet 的故事宇宙',seriesId:'ser-hogwarts',characterIds:['char-fin'],summary:'这是你的私人故事收藏馆。你可以导入自己的番外、整理角色与系列，并为每个故事安排专属配乐。',tags:['收藏馆指南','示例'],raw:'欢迎来到 Violet\'s Storybook！\n\n这里是一个本地原型示例。你可以通过右上角的 + 导入自己的番外。\n\n**提示：** 当前版本是功能原型，不是已编译的 Android APK。',body:'欢迎来到 Violet\'s Storybook！\n\n这里是一个本地原型示例。你可以通过右上角的 + 导入自己的番外。\n\n**提示：** 当前版本是功能原型，不是已编译的 Android APK。',createdAt:Date.now(),updatedAt:Date.now(),readProgress:0,cover:'',history:[],music:{mode:'fixed',playlistId:'',trackIds:[],loop:'list',disabled:false}}],tracks:[],playlists:[{id:'pl-rain',name:'雨夜氛围',description:'适合雨夜、独处与未寄出的信',trackIds:[]},{id:'pl-letters',name:'未寄出的信',description:'温柔、遗憾与克制的思念',trackIds:[]},{id:'pl-hogwarts',name:'霍格沃茨日常',description:'学院、魔法与古典氛围',trackIds:[]}],themes:[{id:'theme-default',name:'月光纸页',type:'combined',css:':root {\n  --paper: #fbf8f1;\n  --ink: #26394e;\n  --gold: #c6a45c;\n  --lav: #b19ad9;\n}\n.story-title { font-family: Georgia, serif; }\n.story-header { text-align: center; }',active:true}],activePage:'home',activeStoryId:'story-welcome',player:{trackId:'',playlistId:'',storyId:'',isPlaying:false,position:0}};
let state;try{state=JSON.parse(localStorage.getItem(KEY))||structuredClone(seed)}catch{state=structuredClone(seed)}
let currentPage='home',readerId=null,editingId=null,selectedFileText='',selectedAudioUrl='',audioObjectUrl='',audio=new Audio(),dragTrackId=null,toastTimer,readerProgressTimer=null;
const PLAYER_DOCK_KEY=KEY+'-player-dock-v1';
let playerFabWasDragged=false,playerPointerDrag=null;
const playerLayerOrigins=new WeakMap();
const MEDIA_DB_NAME='violets-storybook-media-v1';
const MEDIA_STORE_NAME='audio-files';
let mediaDbPromise=null;
const localTrackUrls=new Map();
const titles={home:'给故事一个温柔的家',stories:'每一篇故事，都值得被珍藏',characters:'那些住进故事里的人',series:'为不同的故事宇宙建立秩序',music:'让每个故事拥有自己的旋律',themes:'设计属于你的阅读世界',settings:'让收藏安心留在身边'};
function stateForStorage(source=state){
  // Keep media bytes in IndexedDB, never in localStorage. Also strip stale
  // File references and blob: URLs left by older versions of this app.
  return {
    ...source,
    tracks:(source.tracks||[]).map(track=>{
      const {file,blobUrl,...metadata}=track;
      return metadata;
    })
  };
}
function persist(msg='已自动保存'){
  try{
    localStorage.setItem(KEY,JSON.stringify(stateForStorage()));
    if(msg)toast(msg);
    return true;
  }catch(e){
    console.error('收藏数据保存失败：',e);
    toast('本地收藏数据保存失败，请导出备份并检查设备存储空间。');
    return false;
  }
}

// Local audio bytes are stored in IndexedDB so they survive page reloads and
// app restarts. localStorage is reserved for lightweight library metadata.
function openMediaDB(){
  if(mediaDbPromise)return mediaDbPromise;
  if(!window.indexedDB)return Promise.reject(new Error('当前运行环境不支持 IndexedDB，无法持久保存本地音频。'));
  let request;
  try{request=window.indexedDB.open(MEDIA_DB_NAME,1)}
  catch(error){return Promise.reject(error)}
  mediaDbPromise=new Promise((resolve,reject)=>{
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(MEDIA_STORE_NAME))db.createObjectStore(MEDIA_STORE_NAME,{keyPath:'id'});
    };
    request.onsuccess=()=>{
      const db=request.result;
      db.onversionchange=()=>{db.close();mediaDbPromise=null};
      resolve(db);
    };
    request.onerror=()=>{const error=request.error||new Error('无法打开本地音频数据库。');mediaDbPromise=null;reject(error)};
    request.onblocked=()=>console.warn('本地音频数据库升级被其他页面阻塞，请关闭其他收藏馆页面后重试。');
  });
  return mediaDbPromise;
}
function saveAudioRecord(id,file){
  return openMediaDB().then(db=>new Promise((resolve,reject)=>{
    let tx;
    try{
      tx=db.transaction(MEDIA_STORE_NAME,'readwrite');
      tx.objectStore(MEDIA_STORE_NAME).put({
        id,
        blob:file.slice(0,file.size,file.type||'application/octet-stream'),
        name:file.name||'audio',
        type:file.type||'application/octet-stream',
        size:file.size||0,
        lastModified:file.lastModified||Date.now(),
        savedAt:Date.now()
      });
    }catch(error){reject(error);return}
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error||new Error('本地音频写入失败。'));
    tx.onabort=()=>reject(tx.error||new Error('本地音频写入被中止。'));
  }));
}
function getAudioRecord(id){
  return openMediaDB().then(db=>new Promise((resolve,reject)=>{
    let request;
    try{request=db.transaction(MEDIA_STORE_NAME,'readonly').objectStore(MEDIA_STORE_NAME).get(id)}
    catch(error){reject(error);return}
    request.onsuccess=()=>resolve(request.result||null);
    request.onerror=()=>reject(request.error||new Error('读取本地音频失败。'));
  }));
}
function getAudioRecordKeys(){
  return openMediaDB().then(db=>new Promise((resolve,reject)=>{
    let request;
    try{request=db.transaction(MEDIA_STORE_NAME,'readonly').objectStore(MEDIA_STORE_NAME).getAllKeys()}
    catch(error){reject(error);return}
    request.onsuccess=()=>resolve(request.result||[]);
    request.onerror=()=>reject(request.error||new Error('读取本地音频列表失败。'));
  }));
}
function deleteAudioRecord(id){
  return openMediaDB().then(db=>new Promise((resolve,reject)=>{
    let tx;
    try{tx=db.transaction(MEDIA_STORE_NAME,'readwrite');tx.objectStore(MEDIA_STORE_NAME).delete(id)}
    catch(error){reject(error);return}
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error||new Error('删除本地音频失败。'));
    tx.onabort=()=>reject(tx.error||new Error('删除本地音频操作被中止。'));
  }));
}
function clearAudioRecords(){
  return openMediaDB().then(db=>new Promise((resolve,reject)=>{
    let tx;
    try{tx=db.transaction(MEDIA_STORE_NAME,'readwrite');tx.objectStore(MEDIA_STORE_NAME).clear()}
    catch(error){reject(error);return}
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error||new Error('清理本地音频失败。'));
    tx.onabort=()=>reject(tx.error||new Error('清理本地音频操作被中止。'));
  }));
}
async function pruneAudioRecords(keepIds=[]){
  const keep=new Set(keepIds);
  const keys=await getAudioRecordKeys();
  const obsolete=keys.filter(id=>!keep.has(id));
  if(!obsolete.length)return;
  const db=await openMediaDB();
  await new Promise((resolve,reject)=>{
    let tx;
    try{
      tx=db.transaction(MEDIA_STORE_NAME,'readwrite');
      const store=tx.objectStore(MEDIA_STORE_NAME);
      obsolete.forEach(id=>store.delete(id));
    }catch(error){reject(error);return}
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error||new Error('清理旧音频失败。'));
    tx.onabort=()=>reject(tx.error||new Error('清理旧音频被中止。'));
  });
}
async function askForPersistentStorage(){
  try{
    if(navigator.storage?.persist)await navigator.storage.persist();
  }catch(error){console.warn('无法申请持久化站点存储权限：',error)}
}
async function initializePersistentAudio(){
  try{
    const savedIds=new Set((await getAudioRecordKeys()).map(String));
    let changed=false;
    for(const track of state.tracks||[]){
      if(track.kind==='file'){
        const available=savedIds.has(String(track.id));
        if(track.audioStored!==available){track.audioStored=available;changed=true}
        if('file' in track){delete track.file;changed=true}
        if('blobUrl' in track){delete track.blobUrl;changed=true}
      }else if('audioStored' in track){delete track.audioStored;changed=true}
    }
    // A no-message save also migrates old metadata away from serialized File/blob URLs.
    if(changed)persist(null);
    if(changed&&currentPage==='music')render();
  }catch(error){
    console.warn('本地音频数据库暂不可用：',error);
    if((state.tracks||[]).some(track=>track.kind==='file')){
      toast('无法访问本地音频存储。请检查应用 WebView 的 IndexedDB 支持后再添加音频。');
    }
  }
}
function readActiveThemeSnapshot(){
  try{
    const raw=localStorage.getItem(ACTIVE_THEME_KEY);
    if(!raw)return null;
    const theme=JSON.parse(raw);
    return theme&&typeof theme.id==='string'&&typeof theme.css==='string'?theme:null;
  }catch(e){return null;}
}
function writeActiveThemeSnapshot(theme){
  if(!theme||typeof theme.id!=='string'||typeof theme.css!=='string')return false;
  try{
    localStorage.setItem(ACTIVE_THEME_KEY,JSON.stringify({
      id:theme.id,
      name:theme.name||'我的主题',
      type:theme.type||'combined',
      css:theme.css,
      active:true
    }));
    return true;
  }catch(e){return false;}
}
// Restore the last explicitly applied theme independently from the rest of the library state.
function getActiveTheme(){
  const snapshot=readActiveThemeSnapshot();
  if(snapshot){
    if(!Array.isArray(state.themes))state.themes=[];
    let theme=state.themes.find(t=>t.id===snapshot.id);
    if(!theme){
      theme={...snapshot,active:true};
      state.themes.unshift(theme);
    }else{
      theme.name=snapshot.name||theme.name;
      theme.type=snapshot.type||theme.type;
      theme.css=snapshot.css;
    }
    state.themes.forEach(t=>t.active=t.id===snapshot.id);
    state.activeThemeId=snapshot.id;
    return theme;
  }
  const theme=state.themes?.find(t=>t.id===state.activeThemeId)
    || state.themes?.find(t=>t.active)
    || state.themes?.[0]
    || null;
  if(theme&&state.activeThemeId!==theme.id)state.activeThemeId=theme.id;
  return theme;
}
function applyActiveTheme(theme=getActiveTheme()){
  document.getElementById('previewThemeStyle')?.remove();
  let style=document.getElementById('activeThemeStyle');
  if(!style){style=document.createElement('style');style.id='activeThemeStyle';document.head.appendChild(style);}
  style.textContent=theme?.css||'';
  style.dataset.themeId=theme?.id||'';
  ensureModalProtectionStyles();
  protectOpenModalControls();
  ensureFloatingPlayerStyles();
}
function ensureFloatingPlayerStyles(){
  let style=document.getElementById('floatingPlayerDockStyle');
  if(!style){style=document.createElement('style');style.id='floatingPlayerDockStyle';}
  style.textContent=`
    #playerFab{touch-action:none!important;-webkit-user-select:none!important;user-select:none!important;cursor:grab!important;}
    #playerFab:active{cursor:grabbing!important;}
    #readerDialog #playerFab{position:fixed!important;z-index:2147483600!important;}
    #playerPanel{box-sizing:border-box!important;max-width:calc(100vw - 24px)!important;max-height:72vh!important;overflow:auto!important;z-index:2147483599!important;overscroll-behavior:contain;}
    #readerDialog #playerPanel{position:fixed!important;z-index:2147483599!important;}
    #playerPanel .player-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;}
    #playerPanel .player-panel-head h3{margin:0;min-width:0;overflow-wrap:anywhere;}
    #playerPanel .player-panel-close{min-width:32px;min-height:32px;padding:3px 8px;flex-shrink:0;}
    #playerPanel .player-panel-selectors{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin:10px 0;}
    #playerPanel .player-panel-selectors label{display:block;min-width:0;font-size:.9em;}
    #playerPanel .player-panel-selectors select{display:block;box-sizing:border-box;width:100%;max-width:100%;min-width:0;margin-top:4px;}
    #playerPanel .player-controls{display:flex;align-items:center;gap:8px;}
    #playerPanel .player-controls button{min-width:38px;min-height:36px;}
    #playerPanel .player-repeat{display:block;width:100%;box-sizing:border-box;margin:9px 0;padding:8px 10px;border:1px solid currentColor;border-radius:8px;background:transparent;color:inherit;cursor:pointer;}
    #playerPanel .player-repeat.active{font-weight:700;border-width:2px;background:rgba(127,127,127,.12);}
    #playerPanel .player-repeat:disabled{opacity:.5;cursor:not-allowed;}
    #playerPanel #playerSeek{display:block;width:100%;max-width:100%;}
    #playerPanel #exitReaderFromPlayer{display:block;width:100%;margin-top:8px;}
    @media(max-width:480px){
      #playerPanel{width:min(320px,calc(100vw - 20px))!important;padding:12px!important;font-size:14px;}
      #playerPanel .player-controls{justify-content:space-between;}
      #playerPanel .player-panel-selectors{gap:6px;}
    }
  `;
  document.head.appendChild(style);
}
function ensureModalProtectionStyles(){
  let style=document.getElementById('modalControlProtectionStyle');
  if(!style){style=document.createElement('style');style.id='modalControlProtectionStyle';}
  style.textContent=`
    dialog.modal[open]{display:block!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;isolation:isolate!important;}
    dialog.modal:not([open]){display:none!important;pointer-events:none!important;}
    dialog.modal::before,dialog.modal::after,dialog.modal .modal-head::before,dialog.modal .modal-head::after,dialog.modal .modal-actions::before,dialog.modal .modal-actions::after{pointer-events:none!important;}
    dialog.modal[open] .modal-head,dialog.modal[open] .modal-actions{position:relative!important;z-index:2147483000!important;pointer-events:auto!important;visibility:visible!important;opacity:1!important;overflow:visible!important;}
    dialog.modal[open] .modal-head button.icon-btn,dialog.modal[open] form[method="dialog"] button[value="cancel"],dialog.modal[open] .modal-actions button[value="cancel"],dialog.modal[open] button#closeReader,dialog.modal[open] button#readerDone,dialog.modal[open] button#closeSource,dialog.modal[open] button[data-close-dialog],dialog.modal[open] button[data-dialog-close]{display:inline-flex!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;position:relative!important;z-index:2147483647!important;transform:none!important;clip:auto!important;clip-path:none!important;min-width:38px!important;min-height:38px!important;flex-shrink:0!important;cursor:pointer!important;touch-action:manipulation!important;}
  `;
  /* Re-append after current theme/live-preview CSS. */
  document.head.appendChild(style);
  document.querySelectorAll('dialog.modal').forEach(dlg=>{
    if(dlg.dataset.modalCleanupBound==='1')return;
    dlg.dataset.modalCleanupBound='1';
    dlg.addEventListener('close',()=>releaseModalProtection(dlg));
  });
}
function releaseModalProtection(dlg){
  if(!dlg)return;
  ['display','visibility','opacity','pointer-events','isolation'].forEach(prop=>dlg.style.removeProperty(prop));
  const properties=['display','position','z-index','pointer-events','visibility','opacity','overflow','transform','clip','clip-path','min-width','min-height','flex-shrink','cursor','touch-action'];
  dlg.querySelectorAll('.modal-head,.modal-actions,form,.modal-head button.icon-btn,form[method="dialog"] button[value="cancel"],.modal-actions button[value="cancel"],#closeReader,#readerDone,#closeSource,button[data-close-dialog],button[data-dialog-close]').forEach(el=>properties.forEach(prop=>el.style.removeProperty(prop)));
}
function protectOpenModalControls(dialog){
  const dialogs=dialog?[dialog]:document.querySelectorAll('dialog.modal[open]');
  const setImportant=(el,prop,value)=>el.style.setProperty(prop,value,'important');
  dialogs.forEach(dlg=>{
    if(!(dlg instanceof HTMLDialogElement)||!dlg.open)return;
    /* Critical: remove any stale inline display that would keep a closed dialog visible. */
    setImportant(dlg,'display','block');
    [['pointer-events','auto'],['visibility','visible'],['opacity','1'],['isolation','isolate']].forEach(([prop,value])=>setImportant(dlg,prop,value));
    const head=dlg.querySelector('.modal-head');
    if(head){[['display','flex'],['position','relative'],['z-index','2147483000'],['pointer-events','auto'],['visibility','visible'],['opacity','1'],['overflow','visible']].forEach(([prop,value])=>setImportant(head,prop,value));}
    const form=dlg.querySelector('form');
    if(form)[['display','block'],['pointer-events','auto'],['visibility','visible'],['opacity','1']].forEach(([prop,value])=>setImportant(form,prop,value));
    const actions=dlg.querySelector('.modal-actions');
    if(actions)[['display','flex'],['position','relative'],['z-index','2147483000'],['pointer-events','auto'],['visibility','visible'],['opacity','1'],['overflow','visible']].forEach(([prop,value])=>setImportant(actions,prop,value));
    dlg.querySelectorAll('.modal-head button.icon-btn,form[method="dialog"] button[value="cancel"],.modal-actions button[value="cancel"],#closeReader,#readerDone,#closeSource,button[data-close-dialog],button[data-dialog-close]').forEach(button=>{
      [['display','inline-flex'],['visibility','visible'],['opacity','1'],['pointer-events','auto'],['position','relative'],['z-index','2147483647'],['transform','none'],['clip','auto'],['clip-path','none'],['min-width','38px'],['min-height','38px'],['flex-shrink','0'],['cursor','pointer'],['touch-action','manipulation']].forEach(([prop,value])=>setImportant(button,prop,value));
    });
  });
}
function installModalControlProtection(){
  ensureModalProtectionStyles();
  if(typeof HTMLDialogElement!=='undefined'&&!HTMLDialogElement.prototype.showModal.__violetModalProtection){
    const nativeShowModal=HTMLDialogElement.prototype.showModal;
    const wrappedShowModal=function(...args){const result=nativeShowModal.apply(this,args);ensureModalProtectionStyles();protectOpenModalControls(this);return result};
    wrappedShowModal.__violetModalProtection=true;HTMLDialogElement.prototype.showModal=wrappedShowModal;
  }
  if(typeof HTMLDialogElement!=='undefined'&&!HTMLDialogElement.prototype.close.__violetModalProtection){
    const nativeClose=HTMLDialogElement.prototype.close;
    const wrappedClose=function(...args){const result=nativeClose.apply(this,args);releaseModalProtection(this);return result};
    wrappedClose.__violetModalProtection=true;HTMLDialogElement.prototype.close=wrappedClose;
  }
  protectOpenModalControls();
}
function uid(prefix='id'){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7)}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(s){const el=$('#toast');el.textContent=s;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2400)}
function dateLabel(t){return new Date(t||Date.now()).toLocaleDateString('zh-CN',{year:'numeric',month:'short',day:'numeric'})}
function seriesName(id){return state.series.find(s=>s.id===id)?.name||'未分类'}
function storyOrderValue(story){const order=story?.order;return order!==undefined&&order!==null&&Number.isFinite(Number(order))?Number(order):(Number(story?.createdAt)||0)}
function sortedSeriesStories(seriesId){return state.stories.filter(s=>s.seriesId===seriesId).slice().sort((a,b)=>storyOrderValue(a)-storyOrderValue(b))}
function storyNo(story){const list=sortedSeriesStories(story.seriesId);return Math.max(1,list.findIndex(s=>s.id===story.id)+1)}
function tagsHTML(tags=[]){return `<div class="tags">${tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`}
function safeImageSource(value){
  const src=String(value||'').trim();
  if(!src)return '';
  if(/^data:image\/(?:jpeg|png|gif|webp|avif);base64,/i.test(src))return src;
  try{const url=new URL(src,document.baseURI);return ['http:','https:'].includes(url.protocol)?src:''}catch{return ''}
}
function card(story){const n=String(storyNo(story)).padStart(2,'0');const coverUrl=safeImageSource(story.coverUrl||story.cover||'');return `<article class="story-card ${state.settings.layout==='text'?'text-card':''}"><div class="cover" style="position:relative;overflow:hidden">${coverUrl?`<img class="story-cover-image" src="${esc(coverUrl)}" alt="${esc(story.title)}封面" loading="lazy" style="display:block!important;width:100%!important;height:100%!important;object-fit:cover!important;position:absolute!important;inset:0!important;z-index:0!important;pointer-events:none!important;visibility:visible!important;opacity:1!important" onerror="this.onerror=null;this.style.display='none'">`:''}<span class="cover-number" style="position:relative;z-index:1">${esc(seriesName(story.seriesId))} · ${n}</span></div><div class="story-info"><div class="series">${esc(seriesName(story.seriesId))} · 第 ${storyNo(story)} 章</div><h3>${esc(story.title)}</h3><p class="summary">${esc(String(story.summary??'').trim()||'尚未添加简介。打开故事，开始阅读。')}</p>${tagsHTML(story.tags||[])}<div class="card-footer"><div style="flex:1"><span class="muted">阅读进度 ${story.readProgress||0}%</span><div class="progress"><span style="width:${story.readProgress||0}%"></span></div></div><div class="small-actions"><button data-action="read" data-id="${story.id}" title="阅读">阅读 ↗</button><button data-action="edit" data-id="${story.id}" title="编辑">编辑</button><button data-action="music" data-id="${story.id}" title="配乐">♫</button><button data-action="delete-story" data-id="${story.id}" title="删除番外">删除</button></div></div></div></article>`}
function headerSection(title,sub,action=''){return `<div class="section-head"><div><h2>${title}</h2><p>${sub}</p></div>${action}</div>`}
function render(){const content=$('#pageContent');$('#pageTitle').textContent=titles[currentPage]||titles.home;$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===currentPage));if(currentPage==='home')content.innerHTML=renderHome();if(currentPage==='stories')content.innerHTML=renderStories();if(currentPage==='characters')content.innerHTML=renderCharacters();if(currentPage==='series')content.innerHTML=renderSeries();if(currentPage==='music')content.innerHTML=renderMusic();if(currentPage==='themes')content.innerHTML=renderThemes();if(currentPage==='settings')content.innerHTML=renderSettings();bindContent();bindActionButtons(content)}
function renderHome(){return `<section class="hero"><div class="hero-copy"><div class="eyebrow">A LITTLE UNIVERSE OF STORIES</div><h2>把喜欢的故事，<br>好好收藏起来。</h2><p>番外、角色、故事系列、专属配乐与阅读主题，都可以在这里找到自己的位置。你的收藏，属于你自己的宇宙。</p><button class="button primary" data-action="new-story">＋ 收藏一篇番外</button> <button class="button secondary" data-action="goto-music">♫ 整理音乐</button></div><img class="hero-art" src="celestial-book-icon.jpg" alt="书本与星辰"></section><div class="stats"><div class="stat"><span>珍藏番外</span><strong>${state.stories.length}</strong></div><div class="stat"><span>故事系列</span><strong>${state.series.length}</strong></div><div class="stat"><span>角色档案</span><strong>${state.characters.length}</strong></div><div class="stat"><span>音乐收藏</span><strong>${state.tracks.length}</strong></div></div>${headerSection('最近收藏','继续阅读，或为故事安排新的配乐。',`<button class="text-button" data-action="goto-stories">查看全部 →</button>`)}<div class="story-grid">${state.stories.slice().sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,3).map(card).join('')}</div><div class="module-grid" style="margin-top:20px"><div class="panel"><h3>✧ 私人签名</h3><div class="signature-big">Violet196</div><p style="text-align:center">A little universe of stories</p></div><div class="panel"><h3>♫ 今日的故事配乐</h3><p>建立你的第一份歌单，把旋律与故事情绪一起珍藏。</p><button class="button secondary" data-action="goto-music">打开音乐馆</button></div></div>`}
function renderStories(){return `${headerSection('番外收藏','支持 HTML、Markdown、TXT 文件导入与文本粘贴。',`<button class="button primary" data-action="new-story">＋ 导入番外</button>`)}<div class="toolbar"><div class="search"><input id="storySearch" placeholder="搜索标题、简介或标签……"></div><select id="seriesFilter" class="select"><option value="">全部系列</option>${state.series.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select><select id="sortStories" class="select"><option value="recent">最近更新</option><option value="series">按系列编号</option><option value="title">按标题</option></select><button class="pill ${state.settings.layout==='cover'?'active':''}" data-action="layout-cover">封面卡片</button><button class="pill ${state.settings.layout==='text'?'active':''}" data-action="layout-text">文字卡片</button></div><div id="storyGrid" class="story-grid">${state.stories.map(card).join('')||`<div class="empty"><strong>这里还空着呢</strong>导入第一篇番外，让你的故事有一个家。</div>`}</div>`}
function renderCharacters(){return `${headerSection('角色档案','角色、故事系列与番外独立管理，可以多对多关联。',`<button class="button primary" data-action="new-character">＋ 新建角色</button>`)}<div class="module-grid">${state.characters.map(c=>`<div class="panel"><div class="list-row"><div class="list-icon">♙</div><div class="list-main"><strong>${esc(c.name)}</strong><small>${esc(c.description||'还没有角色简介')}</small></div><button data-action="edit-character" data-id="${c.id}">编辑</button></div><p>关联番外：${state.stories.filter(s=>(s.characterIds||[]).includes(c.id)).length} 篇</p><button class="button secondary" data-action="character-stories" data-id="${c.id}">查看关联故事</button></div>`).join('')}<div class="panel"><h3>角色关联规则</h3><p>同一角色可以拥有多篇番外；一篇番外也可以关联多个角色。角色主题音乐可作为默认配乐，并允许单篇番外覆盖。</p></div></div>`}
function renderSeries(){return `${headerSection('故事系列','每个系列独立从第 1 章编号，重新排序后自动更新。',`<button class="button primary" data-action="new-series">＋ 新建系列</button>`)}<div class="module-grid">${state.series.map(s=>{const stories=sortedSeriesStories(s.id);return `<div class="panel"><div class="list-row"><div class="list-icon">❖</div><div class="list-main"><strong>${esc(s.name)}</strong><small>${stories.length} 篇番外 · 独立编号</small></div><button data-action="edit-series" data-id="${s.id}">编辑</button></div>${stories.map((st,i)=>`<div class="list-row"><div class="list-icon">${String(i+1).padStart(2,'0')}</div><div class="list-main"><strong>${esc(st.title)}</strong><small>第 ${i+1} 章 · ${dateLabel(st.updatedAt)}</small></div><button data-action="read" data-id="${st.id}">阅读</button></div>`).join('')}<div class="toolbar"><button class="pill" data-action="move-up-series-story" data-id="${stories[1]?.id||''}">示例：上移第二篇</button></div></div>`}).join('')}<div class="panel"><h3>编号说明</h3><p>编号属于收藏馆元数据，不覆盖正文原有标题。移动到其他系列时，按新系列重新编号；未归类的故事可以稍后再整理。</p></div></div>`}
function renderMusic(){return `${headerSection('音乐馆','管理本地音乐、可播放的网络直链、自定义歌单与故事配乐。',`<button class="button primary" data-action="new-music">＋ 添加音乐</button>`)}<div class="toolbar"><div class="search"><input id="musicSearch" placeholder="搜索音乐名称或标签……"></div><button class="pill" data-action="new-playlist">＋ 新建歌单</button></div><div class="module-grid"><div class="panel"><h3>♫ 全部音乐 <span class="muted">${state.tracks.length} 首</span></h3>${state.tracks.length?state.tracks.map(t=>trackRow(t)).join(''):`<div class="empty"><strong>音乐馆还在等待第一首歌</strong>可以添加本地音频，或可直接播放的网络音频链接。</div>`}</div><div class="panel"><h3>自定义歌单</h3>${state.playlists.map(p=>`<div class="list-row"><div class="list-icon">♫</div><div class="list-main"><strong>${esc(p.name)}</strong><small>${(p.trackIds||[]).length} 首 · ${esc(p.description||'自定义歌单')}</small></div><button data-action="open-playlist" data-id="${p.id}">整理</button></div>`).join('')}<p>支持固定曲目清单与动态关联歌单。同一首音乐可被多个歌单重复引用。</p></div></div><div class="panel" style="margin-top:16px"><h3>番外配乐</h3><p>每篇番外可以关联多首音乐。默认按列表顺序自动播放，列表循环；切换番外时按单篇 → 系列 → 角色 → 全局的优先级查找配乐。明确设置不播放时，不继承上级配乐。</p>${state.stories.map(s=>`<div class="list-row"><div class="list-icon">▤</div><div class="list-main"><strong>${esc(s.title)}</strong><small>${s.music?.disabled?'已设置不播放':s.music?.playlistId?`关联歌单：${esc(state.playlists.find(p=>p.id===s.music.playlistId)?.name||'已删除歌单')}`:'尚未设置专属配乐'}</small></div><button data-action="music" data-id="${s.id}">设置配乐</button></div>`).join('')}</div>`}
function trackRow(t){const sourceLabel=t.kind==='file'?(t.audioStored?'本地音频 · 已保存在本机':'本地音频 · 需要重新添加一次'):'网络直链';return `<div class="list-row sortable" draggable="true" data-track="${t.id}"><div class="list-icon">⠿</div><div class="list-main"><strong>${esc(t.title)}</strong><small>${esc(sourceLabel)} · ${esc((t.tags||[]).join('、')||'未分类')}</small></div><button data-action="play-track" data-id="${t.id}">试听</button><button data-action="add-to-playlist" data-id="${t.id}">加入歌单</button><button data-action="delete-track" data-id="${t.id}">删除</button></div>`}
function renderThemes(){const theme=state.themes.find(t=>t.id===state.activeThemeId)||state.themes.find(t=>t.active)||state.themes[0];return `${headerSection('主题设计工作室','全局 APP 主题与番外阅读主题分开管理，支持 CSS 编辑与预览。',`<button class="button secondary" data-action="new-theme">＋ 新建主题</button>`)}<div class="module-grid"><div class="panel"><h3>主题列表</h3>${state.themes.map(t=>`<div class="list-row"><div class="list-icon">✧</div><div class="list-main"><strong>${esc(t.name)}</strong><small>${esc(t.type)} · ${t.active?'当前应用':'未应用'}</small></div><button data-action="edit-theme" data-id="${t.id}">编辑</button><button data-action="apply-theme" data-id="${t.id}">应用</button></div>`).join('')}<p>优先级：单篇阅读主题 ＞ 系列主题 ＞ 全局阅读主题。APP 全局主题独立于阅读主题。</p></div><div class="panel"><h3>CSS 编辑器</h3><label>选择主题<select id="themeSelect">${state.themes.map(t=>`<option value="${t.id}" ${t.id===theme.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label>主题名称<input id="themeName" value="${esc(theme.name)}"></label><textarea id="themeCSS" class="theme-editor" spellcheck="false">${esc(theme.css)}</textarea><div class="toolbar"><button class="button secondary" data-action="validate-css">检查语法</button><button class="button secondary" data-action="preview-css">预览</button><button class="button primary" data-action="save-theme">保存并应用</button><label class="pill" style="display:flex;align-items:center;gap:7px;margin:0"><input type="checkbox" id="livePreview" ${state.settings.preview==='live'?'checked':''}> 实时预览</label></div><div class="preview-box" id="themePreview"><h3 class="story-title">月光纸页 · 预览</h3><p>这是阅读主题预览。CSS 可控制标题、段落、引用、卡片、按钮与阅读容器等预设样式接口。</p><blockquote>每一个故事，都值得被好好珍藏。</blockquote></div><p class="muted">样式命名空间示例：app-*、card-*、reader-*、story-*、code-*。CSS 只控制外观，不改变收藏、删除、导出等业务逻辑，也不应隐藏必要操作。</p></div></div>`}
function renderSettings(){return `${headerSection('设置与备份','优先保存在本地，支持离线阅读、导出与恢复。')}<div class="module-grid"><div class="panel"><h3>阅读偏好</h3><div class="setting-row"><div><strong>首页卡片布局</strong><small>封面卡片或只显示版头的文字卡片</small></div><select id="settingLayout" class="select"><option value="cover" ${state.settings.layout==='cover'?'selected':''}>封面卡片</option><option value="text" ${state.settings.layout==='text'?'selected':''}>文字卡片</option></select></div><div class="setting-row"><div><strong>默认自动播放</strong><small>单篇、系列和角色可以覆盖全局默认值</small></div><input type="checkbox" class="switch" id="settingAutoPlay" ${state.settings.autoPlay?'checked':''}></div><div class="setting-row"><div><strong>全局默认循环</strong><small>按当前番外的音乐列表循环</small></div><input type="checkbox" class="switch" id="settingLoop" ${state.settings.loop?'checked':''}></div><div class="setting-row"><div><strong>CSS 预览模式</strong><small>实时预览或手动预览</small></div><select id="settingPreview" class="select"><option value="manual" ${state.settings.preview==='manual'?'selected':''}>手动预览</option><option value="live" ${state.settings.preview==='live'?'selected':''}>实时预览</option></select></div><div class="setting-row"><div><strong>正文默认字号</strong><small>阅读页可单独调整字号与行距</small></div><select id="settingFontSize" class="select"><option value="15">15</option><option value="17" selected>17</option><option value="19">19</option><option value="21">21</option></select></div></div><div class="panel"><h3>数据与备份</h3><p>备份建议包含原始内容、阅读版本、系列/角色/标签、封面与图片资源、主题配置；字体和音频媒体可选择是否完整打包，以控制体积。</p><div class="toolbar"><button class="button primary" data-action="export-json">导出 JSON 备份</button><button class="button secondary" data-action="import-json">导入 JSON 备份</button><button class="button secondary" data-action="export-story">导出单篇番外</button><button class="button secondary" data-action="export-css">导出 CSS</button></div><input id="restoreFile" type="file" accept=".json,application/json" hidden><p class="muted">导入备份会替换当前收藏数据。建议先导出备份。当前版本支持 JSON，不支持 ZIP 媒体包恢复。</p><div class="setting-row"><div><strong>本地数据</strong><small>数据保存在当前浏览器的本地存储中</small></div><button class="pill" data-action="clear-data">清空数据</button></div></div></div><div class="panel" style="margin-top:16px"><h3>关于 Violet's Storybook</h3><div class="signature-big">Violet196</div><p style="text-align:center">A little universe of stories</p><p>当前交付为可运行的网页原型源项目。真正的 Android APK 仍需在具备 Android SDK 的构建环境中打包，并测试本地文件、媒体后台播放、存储权限与设备适配。</p></div>`}
function bindContent(){const search=$('#storySearch');if(search)search.addEventListener('input',filterStories);const ms=$('#musicSearch');if(ms)ms.addEventListener('input',()=>{$$('.list-row[data-track]').forEach(el=>el.classList.toggle('hidden',!el.textContent.toLowerCase().includes(ms.value.toLowerCase()))) });const sf=$('#seriesFilter');if(sf)sf.addEventListener('change',filterStories);const sort=$('#sortStories');if(sort)sort.addEventListener('change',filterStories);const ts=$('#themeSelect');if(ts)ts.addEventListener('change',()=>{const t=state.themes.find(t=>t.id===ts.value);$('#themeName').value=t.name;$('#themeCSS').value=t.css});const live=$('#livePreview');if(live)live.addEventListener('change',()=>{state.settings.preview=live.checked?'live':'manual';persist('预览设置已保存')});const css=$('#themeCSS');if(css)css.addEventListener('input',()=>{if($('#livePreview')?.checked)previewCSS()});const lay=$('#settingLayout');if(lay)lay.addEventListener('change',()=>{state.settings.layout=lay.value;persist();render()});const ap=$('#settingAutoPlay');if(ap)ap.addEventListener('change',()=>{state.settings.autoPlay=ap.checked;persist()});const loop=$('#settingLoop');if(loop)loop.addEventListener('change',()=>{state.settings.loop=loop.checked;persist()});const prev=$('#settingPreview');if(prev)prev.addEventListener('change',()=>{state.settings.preview=prev.value;persist()});const fs=$('#settingFontSize');if(fs)fs.addEventListener('change',()=>{state.settings.fontSize=+fs.value;persist()});const restore=$('#restoreFile');if(restore)restore.addEventListener('change',restoreBackup);const grid=$('#pageContent');grid.querySelectorAll('[data-track]').forEach(el=>{el.addEventListener('dragstart',e=>{dragTrackId=el.dataset.track;el.classList.add('dragging');e.dataTransfer.setData('text/plain',dragTrackId)});el.addEventListener('dragend',()=>el.classList.remove('dragging'));el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('drop-target')});el.addEventListener('dragleave',()=>el.classList.remove('drop-target'));el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('drop-target');if(!dragTrackId||dragTrackId===el.dataset.track)return;const from=state.tracks.findIndex(t=>t.id===dragTrackId),to=state.tracks.findIndex(t=>t.id===el.dataset.track);const [item]=state.tracks.splice(from,1);state.tracks.splice(to,0,item);persist('排序已自动保存');render()})})}
function filterStories(){const q=($('#storySearch')?.value||'').toLowerCase(),sid=$('#seriesFilter')?.value||'',sort=$('#sortStories')?.value||'recent';let arr=state.stories.filter(s=>{if(sid&&s.seriesId!==sid)return false;const characterNames=state.characters.filter(c=>(s.characterIds||[]).includes(c.id)).map(c=>c.name);const haystack=[s.title,s.summary,s.raw,s.body,seriesName(s.seriesId),...(s.tags||[]),...characterNames].join(' ').toLowerCase();return haystack.includes(q)});if(sort==='title')arr.sort((a,b)=>(a.title||'').localeCompare(b.title||''));else if(sort==='series')arr.sort((a,b)=>(a.seriesId||'').localeCompare(b.seriesId||'')||storyNo(a)-storyNo(b));else arr.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));$('#storyGrid').innerHTML=arr.map(card).join('')||'<div class="empty"><strong>没有找到匹配的故事</strong>试试其他关键词或系列。</div>';bindActionButtons($('#storyGrid'))}
function bindActionButtons(root=document){root.querySelectorAll('[data-action]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',()=>action(b.dataset.action,b.dataset.id,b))})}
function action(name,id,button){const st=state.stories.find(s=>s.id===id);if(name==='new-story')openStory();if(name==='goto-stories')go('stories');if(name==='goto-music')go('music');if(name==='read'&&st)openReader(st);if(name==='delete-story'&&st){if(confirm(`确定删除番外「${st.title}」吗？此操作不可撤销，建议先导出 JSON 备份。`)){const previousStories=state.stories;const previousActiveStoryId=state.activeStoryId;state.stories=state.stories.filter(item=>item.id!==id);if(state.activeStoryId===id)state.activeStoryId=state.stories[0]?.id||'';if(!persist(null)){state.stories=previousStories;state.activeStoryId=previousActiveStoryId;return}try{localStorage.removeItem(KEY+'-draft-'+id)}catch{};if(readerId===id){['sourceDialog','readerDialog','editDialog','associationDialog'].forEach(dialogId=>{const dlg=$('#'+dialogId);if(dlg?.open)dlg.close()});readerId=null}toast('番外已删除');render()}}if(name==='edit'&&st)openEdit(st);if(name==='music'&&st)openAssociation(st);if(name==='layout-cover'||name==='layout-text'){state.settings.layout=name==='layout-cover'?'cover':'text';persist('卡片布局已保存');render()}if(name==='new-character')editCharacter();if(name==='edit-character')editCharacter(state.characters.find(c=>c.id===id));if(name==='character-stories'){const c=state.characters.find(c=>c.id===id);go('stories');setTimeout(()=>{const inp=$('#storySearch');if(inp){inp.value=c?.name||'';filterStories()}},20)}if(name==='new-series')editSeries();if(name==='edit-series')editSeries(state.series.find(s=>s.id===id));if(name==='move-up-series-story'){const target=state.stories.find(s=>s.id===id);if(target){const list=sortedSeriesStories(target.seriesId),idx=list.findIndex(s=>s.id===id);if(idx>0){const a=list[idx-1],b=list[idx];const temp=a.order??a.createdAt;a.order=b.order??b.createdAt;b.order=temp;persist('系列顺序已保存');render()}else if(idx===0)toast('这已经是本系列的第一篇了')}}if(name==='new-music')$('#musicDialog').showModal();if(name==='new-playlist')editPlaylist();if(name==='open-playlist')editPlaylist(state.playlists.find(p=>p.id===id));if(name==='play-track')playTrack(id);if(name==='delete-track'){if(confirm('删除这首音乐？歌单中的引用也会移除。'))deleteTrackAndMedia(id)}if(name==='add-to-playlist')choosePlaylistForTrack(id);if(name==='new-theme')editTheme();if(name==='edit-theme')editTheme(state.themes.find(t=>t.id===id));if(name==='apply-theme'){const chosen=state.themes.find(t=>t.id===id);if(chosen){state.themes.forEach(t=>t.active=t.id===id);state.activeThemeId=id;const themeSaved=writeActiveThemeSnapshot(chosen);const stateSaved=persist(null);applyActiveTheme(chosen);render();toast(themeSaved||stateSaved?'主题已应用并保存，重新进入也会保留。':'主题已应用到当前页面，但浏览器存储失败；请检查存储空间。')}}if(name==='save-theme')saveTheme();if(name==='preview-css')previewCSS();if(name==='validate-css')validateCSS();if(name==='export-json')exportJSON();if(name==='import-json'){const input=$('#restoreFile');if(input)input.click()}if(name==='export-story')exportStory();if(name==='export-css')exportCSS();if(name==='clear-data')clearData();if(name==='reader-music')openAssociation(st);if(name==='reader-edit'&&st)openEdit(st)}
function go(page){currentPage=page;render();window.scrollTo({top:0,behavior:'smooth'})}
function ensureStoryCoverFields(form){
  if(!form||form.querySelector('[data-cover-fields]'))return;
  const box=document.createElement('div');box.dataset.coverFields='1';
  box.innerHTML='<label>封面图片（可选）<input name="coverFile" type="file" accept="image/*"></label><label>或填写封面图片 URL<input name="coverUrl" type="url" placeholder="https://..."></label><div class="muted">本地图片会压缩后保存在收藏数据中；URL 封面会随番外一起保存。</div>';
  const anchor=form.querySelector(':scope > .modal-actions');
  if(anchor)form.insertBefore(box,anchor);else form.appendChild(box);
}
function imageFileToDataURL(file,maxSide=1200,quality=.82){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('读取封面图片失败。'));reader.onload=()=>{const img=new Image();img.onerror=()=>reject(new Error('无法解码这张封面图片。'));img.onload=()=>{const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);try{resolve(canvas.toDataURL('image/jpeg',quality))}catch(e){reject(new Error('封面图片无法压缩保存，可能是图片格式或尺寸不受支持。'))}};img.src=reader.result};reader.readAsDataURL(file)})}
function openStory(){selectedFileText='';$('#storyForm').reset();ensureStoryCoverFields($('#storyForm'));$('#storyForm').querySelector('[name="coverUrl"]').value='';$('#storyForm').querySelector('[name="coverFile"]').value='';$('#storySeries').innerHTML='<option value="">未分类</option>'+state.series.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');$('#pastePane').hidden=false;$('#filePane').hidden=true;$$('[data-import-tab]').forEach(b=>b.classList.toggle('active',b.dataset.importTab==='paste'));$('#storyDialog').showModal()}
$$('[data-import-tab]').forEach(b=>b.addEventListener('click',()=>{const file=b.dataset.importTab==='file';$('#pastePane').hidden=file;$('#filePane').hidden=!file;$$('[data-import-tab]').forEach(x=>x.classList.toggle('active',x===b))}));$('#storyFile').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;selectedFileText=await f.text();$('#storyForm').elements.body.value=selectedFileText;toast(`已读取 ${f.name}，保存时保留原始内容。`)});
$('#storyForm').addEventListener('submit',async e=>{
  e.preventDefault();const f=e.currentTarget;if(!f.reportValidity())return;
  const fd=new FormData(f),body=String(fd.get('body')||selectedFileText||''),title=String(fd.get('title')||'').trim();
  if(!title){toast('请填写番外标题');return}
  const coverFile=f.querySelector('[name="coverFile"]')?.files?.[0];
  const rawCoverUrl=String(f.querySelector('[name="coverUrl"]')?.value||'').trim();
  let cover='',coverUrl='';
  try{
    if(coverFile){cover=await imageFileToDataURL(coverFile);coverUrl=''}
    else if(rawCoverUrl){if(!/^https?:\/\//i.test(rawCoverUrl))throw new Error('封面 URL 请以 http:// 或 https:// 开头。');cover=rawCoverUrl;coverUrl=rawCoverUrl}
  }catch(error){toast(error.message||'封面图片处理失败');return}
  const st={id:uid('story'),title,seriesId:String(fd.get('seriesId')||''),characterIds:[],summary:String(fd.get('summary')||'').trim(),tags:String(fd.get('tags')||'').split(/[,，]/).map(s=>s.trim()).filter(Boolean),raw:selectedFileText||body,body,createdAt:Date.now(),updatedAt:Date.now(),readProgress:0,cover,coverUrl,history:[],music:{mode:'fixed',playlistId:'',trackIds:[],loop:'list',disabled:false}};
  const previousStories=state.stories.slice(),previousCharacters=state.characters.slice(),previousActiveStoryId=state.activeStoryId;
  String(fd.get('characters')||'').split(/[,，]/).map(x=>x.trim()).filter(Boolean).forEach(name=>{let c=state.characters.find(c=>c.name===name);if(!c){c={id:uid('char'),name,description:'',storyIds:[]};state.characters.push(c)}st.characterIds.push(c.id)});
  state.stories=[st,...state.stories];state.activeStoryId=st.id;
  if(!persist(null)){state.stories=previousStories;state.characters=previousCharacters;state.activeStoryId=previousActiveStoryId;return}
  toast('番外已收藏');$('#storyDialog').close();go('stories');
});
function renderInlineMarkdown(text){
  const tokens=[];
  const protect=html=>{const marker=`VIOLETMDTOKEN${tokens.length}END`;tokens.push([marker,html]);return marker};
  let source=String(text??'');
  source=source.replace(/`([^`\n]+)`/g,(_,code)=>protect(`<code>${esc(code)}</code>`));
  source=source.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g,(_,alt,url,title)=>{
    const allowed=/^(?:https?:\/\/|\/|\.\.?\/|data:image\/(?:png|jpe?g|gif|webp|avif);base64,)/i.test(url)&&!/^data:image\/svg/i.test(url);
    if(!allowed)return protect(esc(`![${alt}](${url})`));
    return protect(`<img src="${esc(url)}" alt="${esc(alt)}"${title?` title="${esc(title)}"`:''} loading="lazy" style="max-width:100%;height:auto">`);
  });
  source=source.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g,(_,label,url,title)=>{
    const allowed=/^(?:https?:\/\/|mailto:|tel:|#|\/|\.\.?\/)/i.test(url)&&! /^(?:javascript|vbscript|data):/i.test(url);
    if(!allowed)return protect(esc(`[${label}](${url})`));
    return protect(`<a href="${esc(url)}"${title?` title="${esc(title)}"`:''}${/^https?:\/\//i.test(url)?' target="_blank" rel="noopener noreferrer"':''}>${renderInlineMarkdown(label)}</a>`);
  });
  let out=esc(source);
  out=out.replace(/\*\*(.+?)\*\*/gs,'<strong>$1</strong>')
    .replace(/__(.+?)__/gs,'<strong>$1</strong>')
    .replace(/~~(.+?)~~/gs,'<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g,'$1<em>$2</em>');
  out=out.replace(/VIOLETMDTOKEN(\d+)END/g,(_,n)=>tokens[Number(n)]?.[1]||'');
  return out;
}
function markdownCells(line){
  let value=String(line||'').trim();
  if(value.startsWith('|'))value=value.slice(1);
  if(value.endsWith('|'))value=value.slice(0,-1);
  const cells=[];let part='',escaped=false;
  for(const ch of value){if(escaped){part+=ch;escaped=false;continue}if(ch==='\\'){escaped=true;continue}if(ch==='|'){cells.push(part.trim());part=''}else part+=ch}
  cells.push(part.trim());return cells;
}
function isMarkdownRule(line){return /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)}
function isMarkdownBlockStart(lines,index){
  const line=lines[index]||'';
  if(/^\s{0,3}(#{1,6})\s+/.test(line)||/^\s{0,3}>/.test(line)||/^\s{0,3}(?:```|~~~)/.test(line)||isMarkdownRule(line))return true;
  if(/^\s{0,3}(?:[-+*])\s+/.test(line)||/^\s{0,3}\d+[.)]\s+/.test(line))return true;
  if(index+1<lines.length&&/^\s*(?:=+|-{3,})\s*$/.test(lines[index+1])&&line.trim())return true;
  if(index+1<lines.length&&line.includes('|')&&/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index+1]))return true;
  return false;
}
function renderMarkdown(text){
  const lines=String(text??'').replace(/\r\n?/g,'\n').split('\n');
  const out=[];let i=0,paragraph=[];
  const flushParagraph=()=>{if(!paragraph.length)return;const content=paragraph.join('\n').trim();if(content)out.push(`<p>${renderInlineMarkdown(content).replace(/\n/g,'<br>\n')}</p>`);paragraph=[]};
  while(i<lines.length){
    const line=lines[i];
    if(!line.trim()){flushParagraph();i++;continue}
    const fence=line.match(/^\s{0,3}(```+|~~~+)([\w+-]*)\s*$/);
    if(fence){flushParagraph();const marker=fence[1][0],lang=fence[2]||'';i++;const code=[];while(i<lines.length&&!new RegExp(`^\\s{0,3}${marker}{3,}\\s*$`).test(lines[i]))code.push(lines[i++]);if(i<lines.length)i++;out.push(`<pre><code${lang?` class="language-${esc(lang)}"`:''}>${esc(code.join('\n'))}</code></pre>`);continue}
    const heading=line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if(heading){flushParagraph();const level=heading[1].length;out.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);i++;continue}
    if(i+1<lines.length&&/^\s*(?:=+|-{3,})\s*$/.test(lines[i+1])){flushParagraph();const level=lines[i+1].trim().startsWith('=')?1:2;out.push(`<h${level}>${renderInlineMarkdown(line.trim())}</h${level}>`);i+=2;continue}
    if(isMarkdownRule(line)){flushParagraph();out.push('<hr>');i++;continue}
    if(/^\s{0,3}>/.test(line)){flushParagraph();const quote=[];while(i<lines.length&&/^\s{0,3}>/.test(lines[i]))quote.push(lines[i++].replace(/^\s{0,3}>\s?/,''));out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);continue}
    if(i+1<lines.length&&line.includes('|')&&/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i+1])){
      flushParagraph();const headers=markdownCells(line),alignments=markdownCells(lines[i+1]).map(cell=>cell.startsWith(':')&&cell.endsWith(':')?'center':cell.startsWith(':')?'left':cell.endsWith(':')?'right':'');i+=2;const rows=[];
      while(i<lines.length&&lines[i].includes('|')&&lines[i].trim())rows.push(markdownCells(lines[i++]));
      const renderRow=(cells,tag)=>`<tr>${headers.map((_,col)=>`<${tag}${alignments[col]?` style="text-align:${alignments[col]}"`:''}>${renderInlineMarkdown(cells[col]||'')}</${tag}>`).join('')}</tr>`;
      out.push(`<table><thead>${renderRow(headers,'th')}</thead><tbody>${rows.map(row=>renderRow(row,'td')).join('')}</tbody></table>`);continue;
    }
    const unordered=line.match(/^\s{0,3}([-+*])\s+(.+)$/),ordered=line.match(/^\s{0,3}(\d+)[.)]\s+(.+)$/);
    if(unordered||ordered){
      flushParagraph();const kind=unordered?'ul':'ol',items=[];
      while(i<lines.length){const match=kind==='ul'?lines[i].match(/^\s{0,3}[-+*]\s+(.+)$/):lines[i].match(/^\s{0,3}\d+[.)]\s+(.+)$/);if(!match)break;items.push(`<li>${renderInlineMarkdown(match[1])}</li>`);i++}
      out.push(`<${kind}>${items.join('')}</${kind}>`);continue;
    }
    paragraph.push(line);i++;
    if(i<lines.length&&isMarkdownBlockStart(lines,i))flushParagraph();
  }
  flushParagraph();
  return out.join('\n');
}
function splitCssSelectorList(text){const result=[];let start=0,depth=0,quote='',escaped=false;for(let i=0;i<text.length;i++){const c=text[i];if(escaped){escaped=false;continue}if(c==='\\'){escaped=true;continue}if(quote){if(c===quote)quote='';continue}if(c==='"'||c==="'"){quote=c;continue}if(c==='('||c==='[')depth++;else if(c===')'||c===']')depth=Math.max(0,depth-1);else if(c===','&&depth===0){result.push(text.slice(start,i));start=i+1}}result.push(text.slice(start));return result}
function scopeStoryCss(css){
  const out=[];let i=0;const source=String(css||'').replace(/@import[^;]*;?/gi,'');
  while(i<source.length){const open=source.indexOf('{',i);if(open<0)break;const selector=source.slice(i,open).trim();let depth=1,j=open+1,quote='',escaped=false;for(;j<source.length&&depth;j++){const c=source[j];if(escaped){escaped=false;continue}if(c==='\\'){escaped=true;continue}if(quote){if(c===quote)quote='';continue}if(c==='"'||c==="'"){quote=c;continue}if(c==='{')depth++;else if(c==='}')depth--}if(depth!==0)break;const body=source.slice(open+1,j-1).trim();i=j;if(!selector||!body)continue;
    if(/^@(media|supports)\b/i.test(selector)){const nested=scopeStoryCss(body);if(nested)out.push(`${selector}{${nested}}`);continue}
    if(selector.startsWith('@'))continue;
    const declarations=body.split(';').map(x=>x.trim()).filter(Boolean).filter(decl=>!/(?:position\s*:\s*fixed|z-index\s*:|pointer-events\s*:\s*none|behavior\s*:|expression\s*\(|javascript\s*:|vbscript\s*:)/i.test(decl)&&!/(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0\s*!important)/i.test(decl));
    if(!declarations.length)continue;
    const selectors=splitCssSelectorList(selector).map(sel=>{let x=sel.trim();if(!x)return '';x=x.replace(/^(?:html|body|:root)\b/i,'.reader-body');return x.startsWith('.reader-body')?x:`.reader-body ${x}`}).filter(Boolean);
    if(selectors.length)out.push(`${selectors.join(',')}{${declarations.join(';')}}`)
  }
  return out.join('\n');
}
function safeHtml(source){
  const doc=new DOMParser().parseFromString(String(source||''),'text/html');
  const storyStyles=[...doc.querySelectorAll('style')].map(node=>node.textContent||'');
  doc.querySelectorAll('script,iframe,object,embed,form,base,meta[http-equiv],link[rel="import"],link[rel="stylesheet"]').forEach(node=>node.remove());
  doc.querySelectorAll('style').forEach(node=>node.remove());
  doc.querySelectorAll('*').forEach(el=>{[...el.attributes].forEach(a=>{
    const name=a.name.toLowerCase(),value=a.value||'';
    if(name.startsWith('on')||name==='srcdoc'){el.removeAttribute(a.name);return}
    if(['href','src','xlink:href','poster'].includes(name)){
      const trimmed=value.trim();
      const imageData=name!=='href'&&/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(trimmed);
      if(!imageData&&!/^(?:https?:|mailto:|tel:|#|\/|\.\.?\/)/i.test(trimmed))el.removeAttribute(a.name);
    }
    if(name==='srcset'){
      const kept=value.split(',').map(part=>part.trim()).filter(part=>/^(?:https?:|\/|\.\.?\/)/i.test(part));
      if(kept.length)el.setAttribute(a.name,kept.join(', '));else el.removeAttribute(a.name);
    }
    if(name==='style'&&/(?:expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|position\s*:\s*fixed|z-index\s*:)/i.test(value))el.removeAttribute(a.name);
  })});
  const scoped=storyStyles.map(scopeStoryCss).filter(Boolean).join('\n');
  if(scoped){const style=doc.createElement('style');style.dataset.storyScoped='1';style.textContent=scoped;doc.body.insertBefore(style,doc.body.firstChild)}
  return doc.body.innerHTML;
}
function bodyHTML(st){
  const raw=String(st.body??'').replace(/\r\n?/g,'\n');
  if(!raw.trim())return '';
  const hasHtml=/<!doctype\s+html|<\s*\/?\s*[a-z][a-z0-9:-]*(?:\s+[^<>]*?)?\s*\/?\s*>/i.test(raw);
  if(!hasHtml)return renderMarkdown(raw);

  // First sanitize actual HTML and retain its safe, story-scoped styling. Then
  // render Markdown markers found in text nodes as well, so mixed HTML/Markdown
  // from SillyTavern does not disable Markdown for the whole story.
  const sanitized=safeHtml(raw);
  const parsed=new DOMParser().parseFromString(`<div id="violet-story-root">${sanitized}</div>`,'text/html');
  const root=parsed.getElementById('violet-story-root');
  if(!root)return renderMarkdown(raw);
  const walker=parsed.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const textNodes=[];
  while(walker.nextNode())textNodes.push(walker.currentNode);
  for(const node of textNodes){
    const value=node.nodeValue||'';
    if(!value.trim())continue;
    const parent=node.parentElement;
    if(!parent||parent.closest('script,style,pre,code,textarea,svg,math,noscript'))continue;
    const tag=parent.tagName;
    let html;
    const blockContainer=['DIV','SECTION','ARTICLE','MAIN','BODY','BLOCKQUOTE'];
    const hasBlockMarkdown=/^\s{0,3}(?:#{1,6}\s+|>|```|~~~|[-+*]\s+|\d+[.)]\s+|(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})/m.test(value)||/\n\s*\n/.test(value);
    const onlyTextChildren=[...parent.childNodes].every(child=>child.nodeType===Node.TEXT_NODE);
    if(blockContainer.includes(tag)&&(hasBlockMarkdown||onlyTextChildren)){
      html=renderMarkdown(value);
    }else{
      html=renderInlineMarkdown(value).replace(/\n/g,'<br>\n');
    }
    const template=parsed.createElement('template');
    template.innerHTML=html;
    node.parentNode.replaceChild(template.content,node);
  }
  return root.innerHTML;
}
function ensureNarrowScreenReaderStyles(){
  if(document.getElementById('narrowScreenReaderStyle'))return;
  const style=document.createElement('style');
  style.id='narrowScreenReaderStyle';
  style.textContent=`
    /* 只修正阅读窗口：避免应用自己的 .story-card 手机两列规则误伤导入的 HTML 正文。 */
    @media screen and (max-width: 600px){
      #readerBody{box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere;}
      #readerBody > *{min-width:0;max-width:100%;}
      #readerBody .container{display:block!important;width:100%!important;min-width:0!important;max-width:480px!important;margin-left:auto!important;margin-right:auto!important;box-sizing:border-box!important;}
      #readerBody .story-card{display:block!important;float:none!important;width:100%!important;min-width:0!important;max-width:100%!important;grid-template-columns:none!important;grid-template-rows:none!important;grid-auto-flow:row!important;box-sizing:border-box!important;}
      #readerBody .story-card > *{min-width:0;max-width:100%;box-sizing:border-box;}
      #readerBody img,#readerBody picture,#readerBody video,#readerBody canvas,#readerBody svg{max-width:100%!important;height:auto!important;box-sizing:border-box;}
      #readerBody table{display:block;width:100%;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;}
      #readerBody pre{max-width:100%;overflow-x:auto;white-space:pre;-webkit-overflow-scrolling:touch;}
      #readerBody p,#readerBody li,#readerBody blockquote,#readerBody h1,#readerBody h2,#readerBody h3,#readerBody h4,#readerBody h5,#readerBody h6{max-width:100%;overflow-wrap:anywhere;word-break:normal;}
      #readerBody blockquote{box-sizing:border-box;margin-left:0;margin-right:0;}
    }
  `;
  document.head.appendChild(style);
}
function openReader(st){ensureNarrowScreenReaderStyles();readerId=st.id;state.activeStoryId=st.id;$('#readerMeta').textContent=`${seriesName(st.seriesId)} · 第 ${storyNo(st)} 章`;$('#readerTitle').textContent=st.title;const readerBody=$('#readerBody');readerBody.innerHTML=bodyHTML(st);readerBody.scrollTop=0;$('#readProgress').textContent=`阅读进度 ${st.readProgress||0}%`;$('#readerDialog').showModal();enterReaderPlayerLayer();readerBody.onscroll=()=>{const height=Math.max(readerBody.scrollHeight,1);const ratio=Math.min(100,Math.round((readerBody.scrollTop+readerBody.clientHeight)/height*100));const previous=Number(st.readProgress)||0;if(ratio>previous){st.readProgress=ratio;st.updatedAt=Date.now();$('#readProgress').textContent=`阅读进度 ${ratio}%`;clearTimeout(readerProgressTimer);readerProgressTimer=setTimeout(()=>{persist(null);readerProgressTimer=null},400)}};}
$('#closeReader').onclick=$('#readerDone').onclick=()=>$('#readerDialog').close();$('#markRead').onclick=()=>{const st=state.stories.find(s=>s.id===readerId);if(st){st.readProgress=100;st.updatedAt=Date.now();persist('已标记读完');$('#readProgress').textContent='阅读进度 100%'}};$('#readerSource').onclick=()=>{const st=state.stories.find(s=>s.id===readerId);$('#sourceText').textContent=st?.raw||'';$('#sourceDialog').showModal()};$('#closeSource').onclick=()=>$('#sourceDialog').close();$('#readerEdit').onclick=()=>{const st=state.stories.find(s=>s.id===readerId);if(st)openEdit(st)};$('#readerMusic').onclick=()=>{const st=state.stories.find(s=>s.id===readerId);if(st)openAssociation(st)};
function openEdit(st){editingId=st.id;const f=$('#editForm');ensureStoryCoverFields(f);if(!f.querySelector('[name="summary"]')){const label=document.createElement('label');label.innerHTML='简介（可选）<textarea name="summary" rows="2"></textarea>';f.insertBefore(label,f.querySelector('[name="body"]')?.closest('label')||f.querySelector('.modal-actions')||null)}f.elements.title.value=st.title;f.elements.body.value=st.body;f.querySelector('[name="summary"]').value=st.summary||'';f.elements.tags.value=(st.tags||[]).join(', ');f.querySelector('[name="coverFile"]').value='';const existingCover=String(st.coverUrl||st.cover||'');f.querySelector('[name="coverUrl"]').value=/^https?:\/\//i.test(existingCover)?existingCover:'';f.elements.mode.value='text';f.elements.seriesId.innerHTML='<option value="">未分类</option>'+state.series.map(s=>`<option value="${s.id}" ${s.id===st.seriesId?'selected':''}>${esc(s.name)}</option>`).join('');$('#editDialog').showModal()}
$('#editForm').elements.body.addEventListener('input',()=>{if(editingId){try{localStorage.setItem(KEY+'-draft-'+editingId,$('#editForm').elements.body.value)}catch{}}});
$('#saveEdit').addEventListener('click',async e=>{
  e.preventDefault();const st=state.stories.find(s=>s.id===editingId);if(!st)return;
  const index=state.stories.findIndex(s=>s.id===editingId),previous=structuredClone(st),f=$('#editForm');
  const title=f.elements.title.value.trim();if(!title){toast('请填写番外标题');f.elements.title.focus();return}
  const coverFile=f.querySelector('[name="coverFile"]')?.files?.[0];
  const coverUrlInput=String(f.querySelector('[name="coverUrl"]')?.value||'').trim();
  let nextCover=st.coverUrl||st.cover||'',nextCoverUrl=/^https?:\/\//i.test(nextCover)?nextCover:'';
  try{
    if(coverFile){nextCover=await imageFileToDataURL(coverFile);nextCoverUrl=''}
    else if(coverUrlInput){if(!/^https?:\/\//i.test(coverUrlInput))throw new Error('封面 URL 请以 http:// 或 https:// 开头。');nextCover=coverUrlInput;nextCoverUrl=coverUrlInput}
  }catch(error){toast(error.message||'封面图片处理失败');return}
  st.history=[...(st.history||[]),{title:st.title,body:st.body,updatedAt:st.updatedAt}].slice(-1);
  st.title=title;st.body=f.elements.body.value;st.raw=st.body;st.summary=f.querySelector('[name="summary"]')?.value.trim()||'';st.tags=String(f.elements.tags.value||'').split(/[,，]/).map(tag=>tag.trim()).filter(Boolean);st.seriesId=f.elements.seriesId.value;st.cover=nextCover;st.coverUrl=nextCoverUrl;st.updatedAt=Date.now();
  try{localStorage.removeItem(KEY+'-draft-'+editingId)}catch{}
  if(!persist(null)){state.stories[index]=previous;return}
  toast('修改已保存；上一版本已备份');$('#editDialog').close();render();if($('#readerDialog').open)openReader(st);
});
function openAssociation(st){$('#associationStoryName').textContent=st.title;$('#associationPlaylist').innerHTML='<option value="">不关联歌单</option>'+state.playlists.map(p=>`<option value="${p.id}" ${p.id===st.music?.playlistId?'selected':''}>${esc(p.name)}</option>`).join('');const f=$('#associationForm');f.elements.mode.value=st.music?.mode||'fixed';f.elements.loop.value=st.music?.loop||'list';f.dataset.storyId=st.id;$('#associationDialog').showModal()}
$('#associationForm').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget,st=state.stories.find(s=>s.id===f.dataset.storyId);if(!st)return;const pl=state.playlists.find(p=>p.id===f.elements.playlistId.value);st.music={...(st.music||{}),mode:f.elements.mode.value,playlistId:pl?.id||'',trackIds:f.elements.mode.value==='fixed'?[...(pl?.trackIds||[])]:[],loop:f.elements.loop.value,disabled:!pl};persist('番外配乐设置已保存');$('#associationDialog').close();render()});
async function deleteTrackAndMedia(id){
  const track=state.tracks.find(item=>item.id===id);
  if(!track)return;
  const previousTracks=state.tracks;
  const previousPlaylists=state.playlists;
  const previousPlayer=state.player;
  state.tracks=state.tracks.filter(item=>item.id!==id);
  state.playlists=state.playlists.map(playlist=>({...playlist,trackIds:(playlist.trackIds||[]).filter(trackId=>trackId!==id)}));
  if(state.player?.trackId===id)state.player={...state.player,trackId:'',isPlaying:false,position:0};
  if(!persist(null)){
    state.tracks=previousTracks;state.playlists=previousPlaylists;state.player=previousPlayer;
    return;
  }
  if(state.player?.trackId!==id&&previousPlayer?.trackId===id){/* player metadata was cleared above */}
  if(previousPlayer?.trackId===id){audio.pause();audio.removeAttribute('src');audio.load()}
  const objectUrl=localTrackUrls.get(id);
  if(objectUrl){URL.revokeObjectURL(objectUrl);localTrackUrls.delete(id)}
  try{
    if(track.kind==='file')await deleteAudioRecord(id);
    toast('音乐已从收藏馆删除。');
  }catch(error){
    console.error('本地音频文件清理失败：',error);
    toast('音乐条目已删除，但设备未能清理音频文件；可重试清空数据。');
  }
  render();
}

function editCharacter(c){const name=prompt('角色名称',c?.name||'');if(!name?.trim())return;const desc=prompt('角色简介（可选）',c?.description||'')||'';if(c){c.name=name.trim();c.description=desc}else state.characters.push({id:uid('char'),name:name.trim(),description:desc,storyIds:[]});persist('角色档案已保存');render()}
function editSeries(s){const name=prompt('故事系列名称',s?.name||'');if(!name?.trim())return;if(s)s.name=name.trim();else state.series.push({id:uid('series'),name:name.trim(),themeId:''});persist('故事系列已保存');render()}
function editPlaylist(p){const name=prompt('歌单名称',p?.name||'');if(!name?.trim())return;const description=prompt('歌单描述（可选）',p?.description||'')||'';if(p){p.name=name.trim();p.description=description}else state.playlists.push({id:uid('playlist'),name:name.trim(),description,trackIds:[]});persist('歌单已保存');render()}
function choosePlaylistForTrack(trackId){const names=state.playlists.map((p,i)=>`${i+1}. ${p.name}`).join('\n');const choice=prompt('输入要加入的歌单序号：\n'+names,'1');const p=state.playlists[Number(choice)-1];if(!p)return;p.trackIds=p.trackIds||[];if(!p.trackIds.includes(trackId))p.trackIds.push(trackId);persist('已加入歌单');render()}
$('#musicForm').elements.kind.addEventListener('change',e=>{const file=e.target.value==='file';$('#musicFileBox').hidden=!file;$('#musicUrlBox').hidden=file});
$('#musicForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=e.currentTarget,fd=new FormData(f),kind=fd.get('kind'),file=$('#audioFile').files[0],url=String(fd.get('url')||'').trim();
  if(kind==='file'&&!file){toast('请先选择音频文件');return}
  if(kind==='url'&&!/^https?:\/\//i.test(url)){toast('请填写以 http:// 或 https:// 开头的可播放音频直链');return}
  const title=String(fd.get('title')||'').trim();
  if(!title){toast('请填写音乐名称');return}
  const t={id:uid('track'),title,kind,url:kind==='url'?url:'',fileName:file?.name||'',tags:String(fd.get('tags')||'').split(/[,，]/).map(s=>s.trim()).filter(Boolean),createdAt:Date.now()};
  if(kind==='file'){
    try{
      await saveAudioRecord(t.id,file);
      await askForPersistentStorage();
      t.audioStored=true;
    }catch(error){
      console.error('保存本地音频失败：',error);
      toast('本地音频保存失败，未添加到音乐馆。请检查设备可用空间与 WebView 的 IndexedDB 支持。');
      return;
    }
  }
  state.tracks.push(t);
  if(!persist(null)){
    state.tracks=state.tracks.filter(track=>track.id!==t.id);
    if(kind==='file')try{await deleteAudioRecord(t.id)}catch(error){console.warn('清理未登记的音频失败：',error)}
    return;
  }
  toast(kind==='file'?'音乐已保存到本机；重启后也可以直接播放。':'音乐已加入音乐馆。');
  $('#musicDialog').close();f.reset();render();
});
async function getTrackUrl(t){
  if(!t)return '';
  if(t.kind==='url')return /^https?:\/\//i.test(t.url||'')?t.url:'';
  if(localTrackUrls.has(t.id))return localTrackUrls.get(t.id);
  const record=await getAudioRecord(t.id);
  if(!record?.blob)return '';
  const objectUrl=URL.createObjectURL(record.blob);
  localTrackUrls.set(t.id,objectUrl);
  return objectUrl;
}
async function playTrack(id,options={}){
  const t=state.tracks.find(track=>track.id===id);if(!t)return;
  const autoAdvance=options.autoAdvance===true;
  let url='';
  try{url=await getTrackUrl(t)}catch(error){console.error('读取音乐失败：',error);if(!autoAdvance)toast('读取本地音频失败，请关闭并重新打开应用后重试。');return}
  if(!url){if(!autoAdvance)toast(t.kind==='file'?'这首音乐没有找到已保存的音频文件。它来自旧版本，请重新添加一次。':'请填写有效的音频直链。');return}
  audio.pause();audio.loop=state.player?.repeatMode==='single';audio.src=url;audio.load();
  audio.play().then(()=>{
    state.player={...(state.player||{}),trackId:id,isPlaying:true,position:0};
    persist(autoAdvance?null:'开始播放：'+t.title);
    showPlayer(t,{preserveVisibility:autoAdvance});
  }).catch(error=>{
    console.warn('音频播放未启动：',error);
    showPlayer(t,{preserveVisibility:autoAdvance});
    if(!autoAdvance)toast('浏览器可能要求再次点击播放，或该链接不可直接播放。');
  });
}function activePlayerTrackList(){
  const playlistId=state.player?.playlistId||'';
  if(!playlistId)return (state.tracks||[]).slice();
  const playlist=(state.playlists||[]).find(item=>item.id===playlistId);
  if(!playlist)return (state.tracks||[]).slice();
  const ids=Array.isArray(playlist.trackIds)?playlist.trackIds:[];
  return ids.map(id=>state.tracks.find(track=>track.id===id)).filter(Boolean);
}
function readPlayerDock(){
  try{
    const value=JSON.parse(localStorage.getItem(PLAYER_DOCK_KEY)||'{}');
    return {side:value.side==='left'?'left':'right',topRatio:Number.isFinite(Number(value.topRatio))?Math.min(.94,Math.max(.06,Number(value.topRatio))):.72};
  }catch{return {side:'right',topRatio:.72}}
}
function savePlayerDock(value){
  const safe={side:value.side==='left'?'left':'right',topRatio:Math.min(.94,Math.max(.06,Number(value.topRatio)||.72))};
  try{localStorage.setItem(PLAYER_DOCK_KEY,JSON.stringify(safe))}catch(error){console.warn('播放器悬浮球位置未能保存：',error)}
  return safe;
}
function applyPlayerFabDock(fab=$('#playerFab')){
  if(!fab)return;
  const dock=readPlayerDock(),height=window.innerHeight||800,rect=fab.getBoundingClientRect(),size=Math.max(44,rect.height||56);
  const top=Math.max(8,Math.min(height-size-8,dock.topRatio*Math.max(1,height-size)));
  const important=(property,value)=>fab.style.setProperty(property,value,'important');
  important('position','fixed');important('top',`${top}px`);important('bottom','auto');
  important('left',dock.side==='left'?'8px':'auto');important('right',dock.side==='right'?'8px':'auto');
  important('z-index','2147483600');important('margin','0');important('touch-action','none');important('user-select','none');important('-webkit-user-select','none');important('transform','none');
}
function rememberPlayerOrigin(node){
  if(node&&!playerLayerOrigins.has(node))playerLayerOrigins.set(node,{parent:node.parentNode||document.body,nextSibling:node.nextSibling});
}
function movePlayerNodeToReader(node){
  const dialog=$('#readerDialog');if(!node||!dialog)return;
  rememberPlayerOrigin(node);
  if(node.parentNode!==dialog)dialog.appendChild(node);
}
function restorePlayerNode(node){
  if(!node)return;
  const origin=playerLayerOrigins.get(node);
  if(origin?.parent?.isConnected){
    if(origin.nextSibling?.parentNode===origin.parent)origin.parent.insertBefore(node,origin.nextSibling);
    else origin.parent.appendChild(node);
  }else document.body.appendChild(node);
  playerLayerOrigins.delete(node);
}
function positionPlayerPanel(){
  const panel=$('#playerPanel'),fab=$('#playerFab');if(!panel||panel.hidden||!fab)return;
  const rect=fab.getBoundingClientRect(),savedDock=readPlayerDock(),dock={...savedDock,side:playerPointerDrag?.moved?((rect.left+rect.width/2)<(window.innerWidth||400)/2?'left':'right'):savedDock.side},height=window.innerHeight||800;
  const estimatedHeight=Math.min(380,Math.round(height*.72));
  let top=rect.top>height*.55?rect.top-estimatedHeight-10:rect.bottom+10;
  top=Math.max(8,Math.min(height-estimatedHeight-8,top));
  const important=(property,value)=>panel.style.setProperty(property,value,'important');
  important('position','fixed');important('top',`${top}px`);important('bottom','auto');
  important('left',dock.side==='left'?'12px':'auto');important('right',dock.side==='right'?'12px':'auto');
  important('width',`min(340px, calc(100vw - 24px))`);important('max-width','calc(100vw - 24px)');important('max-height','72vh');important('overflow','auto');important('box-sizing','border-box');important('z-index','2147483599');
}
function enterReaderPlayerLayer(){
  const dialog=$('#readerDialog');if(!dialog?.open)return;
  const fab=$('#playerFab'),panel=$('#playerPanel');
  movePlayerNodeToReader(fab);
  if(panel)movePlayerNodeToReader(panel);
  ensureFloatingPlayerStyles();applyPlayerFabDock(fab);positionPlayerPanel();
}
function restoreReaderPlayerLayer(){
  const fab=$('#playerFab'),panel=$('#playerPanel');
  restorePlayerNode(fab);restorePlayerNode(panel);
  readerId=null;
  if(fab)applyPlayerFabDock(fab);
  if(panel&&!panel.hidden){const current=state.tracks.find(track=>track.id===state.player?.trackId);showPlayer(current)}
}
function handlePlayerDragEnd(event){
  if(!playerPointerDrag||event.pointerId!==playerPointerDrag.pointerId)return;
  const drag=playerPointerDrag;playerPointerDrag=null;
  try{if(drag.fab.hasPointerCapture(event.pointerId))drag.fab.releasePointerCapture(event.pointerId)}catch{}
  if(!drag.moved)return;
  const rect=drag.fab.getBoundingClientRect(),side=(rect.left+rect.width/2)<(window.innerWidth||400)/2?'left':'right';
  const topRatio=Math.min(.94,Math.max(.06,rect.top/Math.max(1,(window.innerHeight||800)-rect.height)));
  savePlayerDock({side,topRatio});applyPlayerFabDock(drag.fab);positionPlayerPanel();
  playerFabWasDragged=true;
  setTimeout(()=>{playerFabWasDragged=false},450);
  event.preventDefault();
}
function installReaderPlayerFeatures(){
  ensureFloatingPlayerStyles();
  const fab=$('#playerFab'),reader=$('#readerDialog');if(!fab||fab.dataset.dragBound==='1')return;
  fab.dataset.dragBound='1';applyPlayerFabDock(fab);
  fab.addEventListener('pointerdown',event=>{
    if(event.pointerType==='mouse'&&event.button!==0)return;
    const rect=fab.getBoundingClientRect();
    playerPointerDrag={fab,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,left:rect.left,top:rect.top,moved:false};
    try{fab.setPointerCapture(event.pointerId)}catch{}
  });
  fab.addEventListener('pointermove',event=>{
    const drag=playerPointerDrag;if(!drag||drag.fab!==fab||drag.pointerId!==event.pointerId)return;
    const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;
    if(!drag.moved&&Math.hypot(dx,dy)<7)return;
    drag.moved=true;
    const rect=fab.getBoundingClientRect(),sizeW=rect.width||56,sizeH=rect.height||56;
    const left=Math.max(4,Math.min((window.innerWidth||400)-sizeW-4,drag.left+dx));
    const top=Math.max(8,Math.min((window.innerHeight||800)-sizeH-8,drag.top+dy));
    fab.style.setProperty('left',`${left}px`,'important');fab.style.setProperty('right','auto','important');fab.style.setProperty('top',`${top}px`,'important');fab.style.setProperty('bottom','auto','important');
    positionPlayerPanel();event.preventDefault();
  });
  fab.addEventListener('pointerup',handlePlayerDragEnd);
  fab.addEventListener('pointercancel',handlePlayerDragEnd);
  if(reader&&reader.dataset.playerLayerBound!=='1'){
    reader.dataset.playerLayerBound='1';
    reader.addEventListener('close',restoreReaderPlayerLayer);
  }
  window.addEventListener('resize',()=>{if(!playerPointerDrag)applyPlayerFabDock(fab);positionPlayerPanel()});
}
function exitReaderFromPlayer(){
  const dialog=$('#readerDialog');
  if(!dialog?.open||!readerId)return;
  const panel=$('#playerPanel');if(panel)panel.hidden=true;
  dialog.close('exit-from-player');
}
function showPlayer(t,options={}){
  let p=$('#playerPanel');
  if(!p){p=document.createElement('div');p.id='playerPanel';p.className='player-panel';p.hidden=true;document.body.append(p);}
  const wasHidden=p.hidden;
  const dialog=$('#readerDialog'),readerOpen=!!dialog?.open&&!!readerId;
  if(readerOpen&&p.parentNode!==dialog)movePlayerNodeToReader(p);
  if(!readerOpen&&p.parentNode===dialog)restorePlayerNode(p);
  const list=activePlayerTrackList(),playlistId=state.player?.playlistId||'',savedCurrent=state.tracks.find(track=>track.id===state.player?.trackId);
  const current=list.find(track=>track.id===savedCurrent?.id)||(t?list.find(track=>track.id===t.id):null)||list[0]||(!playlistId?(t||savedCurrent||null):null);
  const playlistOptions=[`<option value="">全部音乐</option>`,...(state.playlists||[]).map(item=>`<option value="${esc(item.id)}" ${item.id===playlistId?'selected':''}>${esc(item.name)}</option>`)].join('');
  const trackOptions=list.length?list.map(track=>`<option value="${esc(track.id)}" ${track.id===current?.id?'selected':''}>${esc(track.title)}</option>`).join(''):'<option value="">这个歌单还没有歌曲</option>';
  const kindLabel=current?(current.kind==='url'?'网络音频':'本地音频'):'尚未选择曲目';
  const singleLoop=state.player?.repeatMode==='single';
  p.innerHTML=`<div class="player-panel-head"><h3>${esc(current?.title||'音乐播放器')}</h3><button type="button" class="player-panel-close" data-player="close" aria-label="收起播放器">×</button></div><div class="muted">${esc(kindLabel)}${audio.paused?' · 已暂停':' · 正在播放'}</div><div class="player-panel-selectors"><label>切换歌单<select data-player="playlist">${playlistOptions}</select></label><label>选择曲目<select data-player="track" ${list.length?'':'disabled'}>${trackOptions}</select></label></div><div class="player-controls"><button type="button" data-player="prev" aria-label="上一首">|◀</button><button type="button" class="play" data-player="toggle" aria-label="播放或暂停" ${current?'':'disabled'}>${audio.paused?'▶':'Ⅱ'}</button><button type="button" data-player="next" aria-label="下一首">▶|</button></div><button type="button" class="player-repeat ${singleLoop?'active':''}" data-player="repeat" aria-pressed="${singleLoop?'true':'false'}" ${current?'':'disabled'} title="开启后重复播放当前歌曲">${singleLoop?'单曲循环：开启':'单曲循环：关闭'}</button><input type="range" id="playerSeek" min="0" max="100" value="0" aria-label="播放进度" ${audio.duration?'':'disabled'}><div class="audio-status">${singleLoop?'单曲循环已开启；当前歌曲会重复播放。':'单曲循环已关闭；列表结束后的行为遵循全局循环设置。'} 收起面板不会停止播放。</div>${readerOpen?'<button type="button" class="text-button" id="exitReaderFromPlayer">退出正文，返回收藏馆</button>':''}<button type="button" class="text-button" id="closePlayer">收起播放器</button>`;
  p.hidden=options.preserveVisibility===true?wasHidden:false;
  p.querySelector('[data-player="close"]').onclick=()=>p.hidden=true;
  p.querySelector('[data-player="toggle"]').onclick=()=>{
    if(!current){toast('请先在音乐馆添加音乐');return}
    if(audio.paused)audio.play().then(()=>{state.player={...(state.player||{}),trackId:current.id,isPlaying:true};showPlayer(current)}).catch(()=>toast('播放未启动，请再点一次播放。'));
    else{audio.pause();state.player={...(state.player||{}),isPlaying:false};showPlayer(current)}
  };
  p.querySelector('[data-player="prev"]').onclick=()=>stepTrack(-1);
  p.querySelector('[data-player="next"]').onclick=()=>stepTrack(1);
  p.querySelector('[data-player="playlist"]').onchange=event=>{
    const chosen=event.target.value;
    state.player={...(state.player||{}),playlistId:chosen};
    const tracks=activePlayerTrackList();
    if(tracks.length){persist(null);playTrack(tracks[0].id)}
    else{audio.pause();state.player={...(state.player||{}),trackId:'',isPlaying:false};persist(null);showPlayer(null);toast('这个歌单还没有歌曲，可以先去音乐馆添加曲目。')}
  };
  p.querySelector('[data-player="track"]').onchange=event=>{const id=event.target.value;if(id)playTrack(id)};
  p.querySelector('[data-player="repeat"]').onclick=()=>{
    const repeatMode=state.player?.repeatMode==='single'?'list':'single';
    state.player={...(state.player||{}),repeatMode};
    audio.loop=repeatMode==='single';
    persist(null);
    showPlayer(current,{preserveVisibility:true});
  };
  p.querySelector('#closePlayer').onclick=()=>{p.hidden=true};
  const exitButton=p.querySelector('#exitReaderFromPlayer');if(exitButton)exitButton.onclick=exitReaderFromPlayer;
  p.querySelector('#playerSeek').oninput=event=>{if(audio.duration)audio.currentTime=audio.duration*Number(event.target.value)/100};
  audio.ontimeupdate=()=>{const seek=$('#playerSeek');if(seek&&audio.duration)seek.value=audio.currentTime/audio.duration*100};
  audio.onplay=()=>{state.player={...(state.player||{}),isPlaying:true};const toggle=p.querySelector('[data-player="toggle"]');if(toggle)toggle.textContent='Ⅱ';const status=p.querySelector('.muted');if(status)status.textContent=`${current?.kind==='url'?'网络音频':'本地音频'} · 正在播放`};
  audio.onpause=()=>{state.player={...(state.player||{}),isPlaying:false};const toggle=p.querySelector('[data-player="toggle"]');if(toggle)toggle.textContent='▶';const status=p.querySelector('.muted');if(status&&current)status.textContent=`${current.kind==='url'?'网络音频':'本地音频'} · 已暂停`};
  audio.loop=state.player?.repeatMode==='single';
  audio.onended=()=>{
    if(state.player?.repeatMode==='single'){
      audio.currentTime=0;
      audio.play().then(()=>{state.player={...(state.player||{}),isPlaying:true};persist(null)}).catch(error=>console.warn('单曲循环未能继续播放：',error));
      return;
    }
    const tracks=activePlayerTrackList(),index=tracks.findIndex(track=>track.id===state.player?.trackId),next=index>=0?tracks[index+1]:tracks[0];
    if(next)playTrack(next.id,{autoAdvance:true});
    else if(state.settings.loop&&tracks.length)playTrack(tracks[0].id,{autoAdvance:true});
    else{state.player={...(state.player||{}),isPlaying:false};persist(null);showPlayer(state.tracks.find(track=>track.id===state.player?.trackId)||null,{preserveVisibility:true})}
  };
  applyPlayerFabDock();positionPlayerPanel();
}
function stepTrack(dir){
  const tracks=activePlayerTrackList();if(!tracks.length){toast('当前歌单还没有歌曲');return}
  const index=tracks.findIndex(track=>track.id===state.player?.trackId);
  let nextIndex=index+dir;
  if(index<0)nextIndex=dir>0?0:tracks.length-1;
  if(nextIndex<0||nextIndex>=tracks.length){if(state.settings.loop)nextIndex=(nextIndex+tracks.length)%tracks.length;else{toast(dir>0?'已经是最后一首':'已经是第一首');return}}
  playTrack(tracks[nextIndex].id);
}
$('#playerFab').onclick=event=>{
  if(playerFabWasDragged){playerFabWasDragged=false;event.preventDefault();return}
  const tracks=activePlayerTrackList(),t=state.tracks.find(track=>track.id===state.player?.trackId)||tracks[0]||state.tracks[0]||null;
  showPlayer(t);
};
function editTheme(t){if(!t){const name=prompt('新主题名称','我的月光主题');if(!name?.trim())return;t={id:uid('theme'),name:name.trim(),type:'reading',css:':root {\n  --paper: #fbf8f1;\n  --ink: #26394e;\n  --lav: #b19ad9;\n}\n.story-header { text-align: center; }',active:false};state.themes.push(t);persist('主题草稿已创建')}render();setTimeout(()=>{if(t)$('#themeSelect').value=t.id;$('#themeName').value=t.name;$('#themeCSS').value=t.css},0)}function previewCSS(){const css=$('#themeCSS')?.value;if(css===undefined)return;let style=$('#previewThemeStyle');if(!style){style=document.createElement('style');style.id='previewThemeStyle';document.head.append(style)}style.textContent=css;ensureModalProtectionStyles();protectOpenModalControls();ensureFloatingPlayerStyles();toast('已应用到当前预览（尚未覆盖正式主题）')}function validateCSS(){const css=$('#themeCSS')?.value||'';let n=0;for(const c of css){if(c==='{')n++;if(c==='}')n--;if(n<0)break}if(n!==0||/javascript\s*:/i.test(css)){toast('检查到括号不匹配或可疑内容，请检查 CSS。');return}toast('基础检查通过；复杂 CSS 冲突仍需更完整的解析器。')}function saveTheme(){const id=$('#themeSelect')?.value,t=state.themes.find(t=>t.id===id);if(!t)return;t.name=$('#themeName').value.trim()||t.name;t.css=$('#themeCSS').value;state.themes.forEach(x=>x.active=x.id===id);state.activeThemeId=id;const themeSaved=writeActiveThemeSnapshot(t);const stateSaved=persist(null);applyActiveTheme(t);render();toast(themeSaved||stateSaved?'主题已保存并应用，重新进入也会保留。':'主题已应用到当前页面，但浏览器存储失败；请检查存储空间。')}
function download(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}function exportJSON(){const data=JSON.stringify(stateForStorage(),null,2);download('Violets-Storybook-backup.json',new Blob([data],{type:'application/json'}));toast('JSON 数据备份已导出；本机音频文件保存在设备数据库中，不包含在 JSON 内。')}function exportStory(){const s=state.stories.find(s=>s.id===state.activeStoryId)||state.stories[0];if(!s){toast('没有可导出的番外');return}download((s.title||'story').replace(/[\\/:*?"<>|]/g,'_')+'.md',new Blob([s.body||''],{type:'text/markdown;charset=utf-8'}))}function exportCSS(){const t=state.themes.find(t=>t.active)||state.themes[0];download((t.name||'theme').replace(/[\\/:*?"<>|]/g,'_')+'.css',new Blob([t.css||''],{type:'text/css;charset=utf-8'}))}async function restoreBackup(e){
  const input=e?.target;
  const file=input?.files?.[0];
  if(!file)return;
  try{
    if(!/\.json$/i.test(file.name||''))throw new Error('请选择 .json 格式的备份文件。');
    const data=JSON.parse(await file.text());
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('备份内容不是有效对象。');
    if(!Array.isArray(data.stories)||!Array.isArray(data.series))throw new Error('备份缺少故事或系列数据。');
    for(const [key,label] of [['characters','角色'],['tracks','音乐'],['playlists','歌单'],['themes','主题']]){
      if(data[key]!==undefined&&!Array.isArray(data[key]))throw new Error(label+'数据格式不正确。');
    }
    if(data.settings!==undefined&&(!data.settings||typeof data.settings!=='object'||Array.isArray(data.settings)))throw new Error('设置数据格式不正确。');
    if(data.player!==undefined&&(!data.player||typeof data.player!=='object'||Array.isArray(data.player)))throw new Error('播放器设置格式不正确。');
    if(data.stories.some(x=>!x||typeof x!=='object'||typeof x.id!=='string'||typeof x.title!=='string'||(x.tags!==undefined&&!Array.isArray(x.tags))||(x.characterIds!==undefined&&!Array.isArray(x.characterIds))||(x.history!==undefined&&!Array.isArray(x.history))))throw new Error('故事列表中存在无效条目。');
    if(data.series.some(x=>!x||typeof x!=='object'||typeof x.id!=='string'||typeof x.name!=='string'))throw new Error('系列列表中存在无效条目。');
    if((data.characters||[]).some(x=>!x||typeof x!=='object'||typeof x.id!=='string'||typeof x.name!=='string'))throw new Error('角色列表中存在无效条目。');
    if((data.tracks||[]).some(x=>!x||typeof x!=='object'||typeof x.id!=='string'||typeof x.title!=='string'||(x.tags!==undefined&&!Array.isArray(x.tags))))throw new Error('音乐列表中存在无效条目。');
    if((data.playlists||[]).some(x=>!x||typeof x!=='object'||typeof x.id!=='string'||typeof x.name!=='string'||(x.trackIds!==undefined&&!Array.isArray(x.trackIds))))throw new Error('歌单列表中存在无效条目。');
    if((data.themes||[]).some(x=>!x||typeof x!=='object'||typeof x.id!=='string'||typeof x.name!=='string'||typeof x.css!=='string'))throw new Error('主题列表中存在无效条目。');
    if(!confirm('导入 JSON 备份会替换当前收藏数据。建议先导出当前备份。是否继续？'))return;
    const defaults=structuredClone(seed);
    const nextState={...defaults,...data,
      settings:{...defaults.settings,...(data.settings||{})},
      series:data.series,
      stories:data.stories,
      characters:data.characters??defaults.characters,
      tracks:(data.tracks??defaults.tracks).map(({file,blobUrl,...track})=>track),
      playlists:data.playlists??defaults.playlists,
      themes:data.themes?.length?data.themes:defaults.themes,
      player:{...defaults.player,...(data.player||{})}
    };
    const validPages=['home','stories','characters','series','music','themes','settings'];
    if(!validPages.includes(nextState.activePage))nextState.activePage='home';
    if(!nextState.themes.some(t=>t.id===nextState.activeThemeId)){
      const active=nextState.themes.find(t=>t.active)||nextState.themes[0];
      nextState.activeThemeId=active?.id||'';
    }
    // JSON backups contain metadata, not audio bytes. Reattach matching files already
    // present in this installation's IndexedDB; mark unavailable ones clearly.
    let localAudioIds=new Set();
    try{localAudioIds=new Set((await getAudioRecordKeys()).map(String))}
    catch(error){console.warn('恢复备份时无法读取现有本地音频：',error)}
    nextState.tracks=nextState.tracks.map(track=>track.kind==='file'
      ?{...track,audioStored:localAudioIds.has(String(track.id))}
      :track);
    const keepAudioIds=nextState.tracks.filter(track=>track.kind==='file').map(track=>track.id);
    const serialized=JSON.stringify(stateForStorage(nextState));
    // Only update the in-memory state after localStorage accepts the complete backup.
    localStorage.setItem(KEY,serialized);
    audio.pause();audio.removeAttribute('src');audio.load();
    localTrackUrls.forEach(objectUrl=>URL.revokeObjectURL(objectUrl));localTrackUrls.clear();
    state=nextState;
    try{await pruneAudioRecords(keepAudioIds)}catch(error){console.warn('备份恢复后清理未引用音频失败：',error)}
    currentPage=validPages.includes(state.activePage)?state.activePage:'home';
    const restoredTheme=state.themes.find(t=>t.id===state.activeThemeId)||state.themes.find(t=>t.active)||state.themes[0]||null;
    if(restoredTheme){
      state.activeThemeId=restoredTheme.id;
      state.themes.forEach(t=>t.active=t.id===restoredTheme.id);
      writeActiveThemeSnapshot(restoredTheme);
      applyActiveTheme(restoredTheme);
    }
    toast((state.tracks||[]).some(t=>t.kind==='file')
      ?'JSON 备份恢复成功；本地音频文件本体不包含在 JSON 中。'
      :'JSON 备份恢复成功！');
    render();
  }catch(err){
    console.error('JSON 备份恢复失败：',err);
    toast(err?.message||'导入失败：文件损坏或备份格式不兼容。');
  }finally{
    if(input)input.value='';
  }
}async function clearData(){
  if(!confirm('这会清除当前浏览器中的收藏、系列、角色、设置和本机保存的音频，且不可撤销。请先备份。确定清空？'))return;
  const previousState=state;
  state=structuredClone(seed);
  if(!persist(null)){state=previousState;return}
  try{localStorage.removeItem(ACTIVE_THEME_KEY)}catch(e){}
  audio.pause();audio.removeAttribute('src');audio.load();
  localTrackUrls.forEach(objectUrl=>URL.revokeObjectURL(objectUrl));localTrackUrls.clear();
  document.getElementById('previewThemeStyle')?.remove();
  try{await clearAudioRecords();toast('收藏数据与本机音频均已清除。')}
  catch(error){console.error('清理本地音频失败：',error);toast('收藏数据已清除，但本机音频数据库清理失败。')}
  applyActiveTheme(state.themes[0]||null);render();
}
$('#quickImport').onclick=openStory;$('#nav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)go(b.dataset.page)});
document.addEventListener('click',function(event){
  const target=event.target instanceof Element?event.target:null;
  const closeButton=target?.closest('dialog.modal[open] .modal-head button.icon-btn,dialog.modal[open] form[method="dialog"] button[value="cancel"],dialog.modal[open] .modal-actions button[value="cancel"],dialog.modal[open] button#closeReader,dialog.modal[open] button#readerDone,dialog.modal[open] button#closeSource,dialog.modal[open] button[data-close-dialog],dialog.modal[open] button[data-dialog-close]');
  if(!closeButton)return;
  const dialog=closeButton.closest('dialog.modal[open]');if(!dialog)return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
  dialog.close(closeButton.id==='readerDone'?'return':'cancel');
},true);
bindActionButtons();getActiveTheme();installModalControlProtection();installReaderPlayerFeatures();render();applyActiveTheme();void initializePersistentAudio();

/* ============================================================================
 * Violet's Storybook 1105 — additive enhancements, 2026-11-05
 * The original 1105 lines above are preserved verbatim. No original renderer,
 * CSS theme, player, story source or persistence key has been replaced.
 * Features: character deletion, avatars, scoped regex, series accordion.
 * Additional compatible features: series avatars, isolated generic rich renderer,
 * regex deletion, theme & music list accordions.
 * ========================================================================== */
(function violet1105Enhancements(){
  'use strict';

  const originalRender1105=render;
  const originalOpenReader1105=openReader;
  const originalAction1105=action;
  const expandedSeries1105=new Set();
  let themesListOpen1105=false;
  let musicListOpen1105=false;

  function ensureRules1105(){
    if(!Array.isArray(state.regexRules))state.regexRules=[];
    return state.regexRules;
  }

  function installStyles1105(){
    if(document.getElementById('violet1105EnhancementStyles'))return;
    const el=document.createElement('style');
    el.id='violet1105EnhancementStyles';
    el.textContent=`
      #pageContent .violet-series-contents[hidden],#violetRuleStoryOptions[hidden]{display:none!important}
      #pageContent .violet-series-title{appearance:none;background:transparent;border:0;box-shadow:none;padding:2px 0;text-align:left;color:inherit;font:inherit;font-weight:700;cursor:pointer;max-width:100%;overflow-wrap:anywhere}
      #pageContent .violet-series-toggle{flex-shrink:0;min-width:35px;min-height:35px;padding:3px 8px;cursor:pointer}
      #pageContent .violet-avatar-image{display:block;width:100%;height:100%;object-fit:cover;border-radius:inherit}
      #pageContent .violet-avatar-action{font:inherit;cursor:pointer;max-width:100%}
      #pageContent .violet-section-fold{width:100%;display:flex;align-items:center;justify-content:space-between;text-align:left;gap:10px;font:inherit;font-weight:700;cursor:pointer;min-height:40px}
      #pageContent .violet-section-fold .violet-chevron{flex-shrink:0;font-size:1.05em}
      #pageContent .violet-folded-list[hidden]{display:none!important}
      /* Music layout: fit columns to the actual available width instead of the device width.
         Preserve the original 1105 theme, controls, drag-sort and accordion. */
      #pageContent .violet-music-grid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr))!important;gap:16px;min-width:0}
      #pageContent .violet-music-grid > .panel{min-width:0;max-width:100%}
      #pageContent .violet-music-grid .list-row[data-track]{display:flex;flex-wrap:wrap!important;align-items:center;gap:9px 10px;min-width:0}
      #pageContent .violet-music-grid .list-row[data-track] .list-icon{flex:0 0 auto}
      #pageContent .violet-music-grid .list-row[data-track] .list-main{flex:1 1 210px!important;min-width:min(100%,210px)!important;max-width:100%;white-space:normal}
      #pageContent .violet-music-grid .list-row[data-track] .list-main strong,
      #pageContent .violet-music-grid .list-row[data-track] .list-main small{white-space:normal!important;word-break:normal!important;overflow-wrap:break-word!important}
      #pageContent .violet-music-grid .list-row[data-track] > button{flex:0 0 auto!important;white-space:nowrap!important;min-width:0}
      /* Role/series cards only on tablet/desktop; leave phone layout untouched. */
      @media(min-width:761px){
      #pageContent .violet-character-grid,#pageContent .violet-series-grid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr))!important;gap:16px;min-width:0}
      #pageContent .violet-character-grid > .panel,#pageContent .violet-series-grid > .panel{min-width:0;max-width:100%}
      #pageContent .violet-character-grid > .panel > .list-row,#pageContent .violet-series-grid > .panel > .list-row{display:flex;align-items:center;flex-wrap:wrap;gap:9px 10px;min-width:0}
      #pageContent .violet-character-grid > .panel > .list-row > .list-main,#pageContent .violet-series-grid > .panel > .list-row > .list-main{flex:1 1 190px!important;min-width:min(100%,190px)!important;max-width:100%;white-space:normal!important}
      #pageContent .violet-character-grid > .panel > .list-row .list-main strong,#pageContent .violet-character-grid > .panel > .list-row .list-main small,#pageContent .violet-series-grid > .panel > .list-row .list-main small,#pageContent .violet-series-grid .violet-series-title{white-space:normal!important;word-break:normal!important;overflow-wrap:break-word!important}
      #pageContent .violet-character-grid > .panel > .list-row button,#pageContent .violet-series-grid > .panel > .list-row button{flex:0 0 auto;white-space:nowrap}
      }
      /* Only close whitespace at rich-regex boundaries. Never change global paragraph spacing. */
      #readerBody .violet-rich-before{margin-bottom:0!important}
      #readerBody .violet-rich-widget{margin-top:8px!important;margin-bottom:12px!important}
      #pageContent .violet-series-avatar-action{flex-shrink:0}
      .violet-rich-widget{overflow:visible;max-width:100%}
      @media(max-width:600px){.violet-rich-widget{width:100%;min-width:0}}
      #pageContent .violet-avatar-action:focus-visible,#pageContent .violet-section-fold:focus-visible{outline:2px solid currentColor;outline-offset:2px}
      #pageContent .violet-role-actions{display:flex;flex-wrap:wrap;align-items:center;gap:7px}
      #pageContent .violet-regex-panel{margin-top:18px;min-width:0}
      #pageContent .violet-regex-rule{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:12px 0;border-bottom:1px dashed currentColor}
      #pageContent .violet-regex-rule-info{flex:1;min-width:160px;overflow-wrap:anywhere}
      #pageContent .violet-regex-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
      #pageContent .violet-regex-actions button{min-height:34px}
      #pageContent .violet-regex-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
      dialog.violet-extra-dialog{width:min(680px,calc(100vw - 22px));max-width:calc(100vw - 22px);max-height:90vh;overflow:auto;box-sizing:border-box}
      dialog.violet-extra-dialog label{display:block;margin:10px 0}
      dialog.violet-extra-dialog input:not([type=checkbox]):not([type=radio]),dialog.violet-extra-dialog textarea,dialog.violet-extra-dialog select{display:block;box-sizing:border-box;width:100%;max-width:100%;margin-top:5px}
      dialog.violet-extra-dialog .violet-extra-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:15px}
      dialog.violet-extra-dialog .violet-story-options{max-height:165px;overflow:auto;padding:8px;border:1px solid currentColor;border-radius:7px}
      dialog.violet-extra-dialog .violet-story-options label{display:flex;align-items:center;gap:8px;margin:6px 0}
      dialog.violet-extra-dialog .violet-story-options input{flex-shrink:0}
      dialog.violet-extra-dialog .violet-preview-area{max-height:52vh;overflow:auto;border:1px solid currentColor;border-radius:8px;padding:12px;box-sizing:border-box;overflow-wrap:anywhere}
      dialog.violet-extra-dialog .violet-avatar-preview{width:76px;height:76px;object-fit:cover;border:1px solid currentColor;border-radius:8px;vertical-align:middle}
      @media(max-width:480px){#pageContent .violet-role-actions{gap:5px}dialog.violet-extra-dialog{padding:12px}}
    `;
    document.head.appendChild(el);
  }

  function findCharacter1105(id){return (state.characters||[]).find(c=>c.id===id)}
  function getAvatar1105(character){
    const storyId=character?.avatarStoryId;
    if(storyId){
      const story=(state.stories||[]).find(s=>s.id===storyId);
      return story?safeImageSource(story.coverUrl||story.cover||''):'';
    }
    return safeImageSource(character?.avatar||'');
  }
  function enhanceCharacters1105(){
    document.querySelectorAll('#pageContent [data-action="edit-character"]').forEach(button=>{
      const character=findCharacter1105(button.dataset.id);
      const row=button.closest('.list-row');
      if(!character||!row)return;
      const icon=row.querySelector('.list-icon');
      const avatar=getAvatar1105(character);
      if(icon&&avatar){
        icon.textContent='';
        const img=document.createElement('img');
        img.className='violet-avatar-image';img.alt=character.name+'的头像';img.src=avatar;
        img.onerror=()=>{icon.textContent='♙'};
        icon.appendChild(img);
      }
      const actions=document.createElement('span');actions.className='violet-role-actions';
      const avatarButton=document.createElement('button');avatarButton.type='button';avatarButton.className='violet-avatar-action';avatarButton.dataset.action='violet-avatar';avatarButton.dataset.id=character.id;avatarButton.textContent='头像';
      const del=document.createElement('button');del.type='button';del.dataset.action='violet-delete-character';del.dataset.id=character.id;del.textContent='删除';
      button.parentNode.insertBefore(actions,button);actions.append(button,avatarButton,del);
    });
    bindActionButtons($('#pageContent'));
  }

  function deleteCharacter1105(id){
    const character=findCharacter1105(id);if(!character)return;
    const affected=(state.stories||[]).filter(st=>Array.isArray(st.characterIds)&&st.characterIds.includes(id)).length;
    const message=`确定删除角色「${character.name}」吗？\n\n该角色关联的 ${affected} 篇番外仍会完整保留，只移除此角色的关联。\n此操作不可撤销。`;
    if(!confirm(message))return;
    const previousCharacters=state.characters;
    const previousAssociations=(state.stories||[]).map(st=>({st,ids:st.characterIds}));
    state.characters=state.characters.filter(c=>c.id!==id);
    for(const {st} of previousAssociations){
      if(Array.isArray(st.characterIds)&&st.characterIds.includes(id)){
        st.characterIds=st.characterIds.filter(cid=>cid!==id);
      }
    }
    if(!persist(null)){
      state.characters=previousCharacters;
      for(const {st,ids} of previousAssociations)st.characterIds=ids;
      return;
    }
    toast('角色已删除；所有番外及正文均已保留。');render();
  }

  function showDialog1105(id,html){
    document.getElementById(id)?.remove();
    const dlg=document.createElement('dialog');dlg.id=id;dlg.className='modal violet-extra-dialog';
    dlg.innerHTML=html;document.body.appendChild(dlg);
    dlg.addEventListener('close',()=>dlg.remove(),{once:true});
    dlg.querySelectorAll('[data-violet-cancel]').forEach(b=>b.addEventListener('click',()=>dlg.close()));
    dlg.showModal();return dlg;
  }

  function openAvatar1105(id){
    const character=findCharacter1105(id);if(!character)return;
    const available=(state.stories||[]).filter(st=>safeImageSource(st.coverUrl||st.cover||''));
    const options=available.map(st=>`<option value="${esc(st.id)}" ${character.avatarStoryId===st.id?'selected':''}>${esc(st.title)}</option>`).join('');
    const avatar=getAvatar1105(character);
    const mode=character.avatarStoryId?'story':character.avatar?'upload':'none';
    const dlg=showDialog1105('violetAvatarDialog',`
      <h3>设置角色头像 · ${esc(character.name)}</h3>
      <p class="muted">可上传一张图片，或直接关联某篇番外的封面。选用番外封面后，封面更新会同步反映到头像。</p>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span id="violetAvatarPreview">${avatar?`<img class="violet-avatar-preview" src="${esc(avatar)}" alt="预览">`:'默认人物图标 ♙'}</span></div>
      <form id="violetAvatarForm">
        <label><input type="radio" name="avatarMode" value="none" ${mode==='none'?'checked':''}> 使用原版默认人物图标</label>
        <label><input type="radio" name="avatarMode" value="upload" ${mode==='upload'?'checked':''}> 上传本地头像</label>
        <input type="file" name="avatarFile" accept="image/png,image/jpeg,image/webp,image/gif,image/avif">
        <label><input type="radio" name="avatarMode" value="story" ${mode==='story'?'checked':''}> 使用已有番外封面</label>
        <select name="avatarStory"><option value="">请选择有封面的番外…</option>${options}</select>
        ${!available.length?'<p class="muted">目前没有带封面的番外可选。</p>':''}
        <div class="violet-extra-actions"><button type="button" data-violet-cancel>取消</button><button class="button primary" type="submit">保存头像</button></div>
      </form>`);
    const form=dlg.querySelector('form');
    form.elements.avatarFile.addEventListener('change',()=>{if(form.elements.avatarFile.files.length)form.querySelector('[value="upload"]').checked=true});
    form.elements.avatarStory.addEventListener('change',()=>{if(form.elements.avatarStory.value)form.querySelector('[value="story"]').checked=true});
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      const picked=form.querySelector('[name="avatarMode"]:checked')?.value;
      const oldAvatar=character.avatar,oldStoryId=character.avatarStoryId;
      let nextAvatar='',nextStoryId='';
      if(picked==='story'){
        nextStoryId=form.elements.avatarStory.value;
        if(!available.some(st=>st.id===nextStoryId)){toast('请选择一个有封面的番外');return}
      }else if(picked==='upload'){
        const file=form.elements.avatarFile.files[0];
        if(file){
          if(!/^image\/(?:png|jpeg|webp|gif|avif)$/.test(file.type)||file.size>15*1024*1024){toast('请使用小于 15MB 的 PNG、JPG、WebP、GIF 或 AVIF 图片。');return}
          try{nextAvatar=await imageFileToDataURL(file,480,.82)}catch(error){toast(error?.message||'头像图片处理失败');return}
        }else if(character.avatar&&!character.avatarStoryId){nextAvatar=character.avatar}
        else{toast('请先选择一张本地头像图片');return}
      }
      character.avatar=nextAvatar;character.avatarStoryId=nextStoryId;
      if(!persist(null)){
        character.avatar=oldAvatar;character.avatarStoryId=oldStoryId;
        return;
      }
      dlg.close();toast('角色头像已保存');render();
    });
  }

  function findSeries1105(id){return (state.series||[]).find(s=>s.id===id)}
  function getSeriesAvatar1105(series){
    if(series?.avatarStoryId){
      const story=(state.stories||[]).find(st=>st.id===series.avatarStoryId);
      return story?safeImageSource(story.coverUrl||story.cover||''):'';
    }
    return safeImageSource(series?.avatar||'');
  }
  function openSeriesAvatar1105(id){
    const series=findSeries1105(id);if(!series)return;
    const candidates=(state.stories||[]).filter(st=>safeImageSource(st.coverUrl||st.cover||''));
    const sorted=[...candidates].sort((a,b)=>Number(b.seriesId===id)-Number(a.seriesId===id));
    const avatar=getSeriesAvatar1105(series);
    const mode=series.avatarStoryId?'story':series.avatar?'upload':'none';
    const dlg=showDialog1105('violetSeriesAvatarDialog',`
      <h3>设置故事系列头像 · ${esc(series.name)}</h3>
      <p class="muted">可上传头像，也可以选用一篇番外的封面。本系列番外优先显示；封面发生变化后，系列头像会同步更新。</p>
      <div id="violetSeriesAvatarPreview">${avatar?`<img class="violet-avatar-preview" src="${esc(avatar)}" alt="当前头像">`:'默认系列图标 ❖'}</div>
      <form id="violetSeriesAvatarForm">
        <label><input type="radio" name="avatarMode" value="none" ${mode==='none'?'checked':''}> 使用原版默认系列图标</label>
        <label><input type="radio" name="avatarMode" value="upload" ${mode==='upload'?'checked':''}> 上传本地头像</label>
        <input type="file" name="avatarFile" accept="image/png,image/jpeg,image/webp,image/gif,image/avif">
        <label><input type="radio" name="avatarMode" value="story" ${mode==='story'?'checked':''}> 选用已有番外封面</label>
        <select name="avatarStory"><option value="">请选择有封面的番外…</option>${sorted.map(st=>`<option value="${esc(st.id)}" ${series.avatarStoryId===st.id?'selected':''}>${esc(st.title)}${st.seriesId===id?' · 本系列':''}</option>`).join('')}</select>
        ${!candidates.length?'<p class="muted">暂无可选的番外封面。</p>':''}
        <div class="violet-extra-actions"><button type="button" data-violet-cancel>取消</button><button type="submit" class="button primary">保存系列头像</button></div>
      </form>`);
    const form=dlg.querySelector('form');
    form.elements.avatarFile.addEventListener('change',()=>{if(form.elements.avatarFile.files.length)form.querySelector('[value="upload"]').checked=true});
    form.elements.avatarStory.addEventListener('change',()=>{if(form.elements.avatarStory.value)form.querySelector('[value="story"]').checked=true});
    form.addEventListener('submit',async e=>{
      e.preventDefault();const selected=form.querySelector('[name="avatarMode"]:checked')?.value;
      const oldAvatar=series.avatar,oldStoryId=series.avatarStoryId;
      let nextAvatar='',nextStoryId='';
      if(selected==='story'){
        nextStoryId=form.elements.avatarStory.value;
        if(!candidates.some(st=>st.id===nextStoryId)){toast('请选择一篇有封面的番外');return}
      }else if(selected==='upload'){
        const file=form.elements.avatarFile.files?.[0];
        if(file){
          if(!/^image\/(?:png|jpeg|webp|gif|avif)$/.test(file.type)||file.size>15*1024*1024){toast('请使用 15MB 以下的 PNG、JPG、WebP、GIF 或 AVIF 图片');return}
          try{nextAvatar=await imageFileToDataURL(file,480,.82)}catch(err){toast(err.message||'图片处理失败');return}
        }else if(series.avatar&&!series.avatarStoryId)nextAvatar=series.avatar;
        else{toast('请先选择本地图片');return}
      }
      series.avatar=nextAvatar;series.avatarStoryId=nextStoryId;
      if(!persist(null)){series.avatar=oldAvatar;series.avatarStoryId=oldStoryId;return}
      dlg.close();toast('故事系列头像已保存');render();
    });
  }
  function enhanceSeries1105(){
    document.querySelectorAll('#pageContent [data-action="edit-series"]').forEach(button=>{
      const row=button.closest('.list-row');const panel=row?.parentElement;
      if(!row||!panel)return;
      const id=button.dataset.id;
      const series=findSeries1105(id);
      const avatar=getSeriesAvatar1105(series);
      const icon=row.querySelector('.list-icon');
      if(icon&&avatar){
        icon.textContent='';const img=document.createElement('img');img.className='violet-avatar-image';
        img.alt=(series?.name||'系列')+'头像';img.src=avatar;img.onerror=()=>{icon.textContent='❖'};icon.appendChild(img);
      }
      const avatarButton=document.createElement('button');avatarButton.type='button';avatarButton.className='violet-series-avatar-action';
      avatarButton.dataset.action='violet-series-avatar';avatarButton.dataset.id=id;avatarButton.textContent='头像';
      row.insertBefore(avatarButton,button);
      const info=row.querySelector('.list-main');const title=info?.querySelector('strong');
      if(!title)return;
      const toggle=document.createElement('button');toggle.type='button';toggle.className='violet-series-title';
      toggle.dataset.action='violet-toggle-series';toggle.dataset.id=id;toggle.textContent=title.textContent;
      title.replaceWith(toggle);
      const arrow=document.createElement('button');arrow.type='button';arrow.className='violet-series-toggle';arrow.dataset.action='violet-toggle-series';arrow.dataset.id=id;
      arrow.setAttribute('aria-label','展开或折叠系列');row.insertBefore(arrow,button);
      const contents=document.createElement('div');contents.className='violet-series-contents';contents.id='violet-series-'+id.replace(/[^a-zA-Z0-9_-]/g,'_');
      while(row.nextSibling)contents.appendChild(row.nextSibling);
      panel.appendChild(contents);
      const expanded=expandedSeries1105.has(id);
      contents.hidden=!expanded;toggle.setAttribute('aria-expanded',String(expanded));arrow.setAttribute('aria-expanded',String(expanded));
      toggle.setAttribute('aria-controls',contents.id);arrow.setAttribute('aria-controls',contents.id);
      arrow.textContent=expanded?'▾':'▸';
    });
    bindActionButtons($('#pageContent'));
  }
  function toggleSeries1105(id){
    if(expandedSeries1105.has(id))expandedSeries1105.delete(id);else expandedSeries1105.add(id);
    const panel=[...document.querySelectorAll('#pageContent [data-action="edit-series"]')].find(b=>b.dataset.id===id)?.closest('.panel');
    if(!panel)return;
    const expanded=expandedSeries1105.has(id);
    const contents=panel.querySelector('.violet-series-contents');if(contents)contents.hidden=!expanded;
    panel.querySelectorAll('[data-action="violet-toggle-series"]').forEach(b=>{
      b.setAttribute('aria-expanded',String(expanded));
      if(b.classList.contains('violet-series-toggle'))b.textContent=expanded?'▾':'▸';
    });
  }

  // Regex patterns are applied only to rendered text nodes; this never writes to
  // story.body, story.raw, the Markdown parser, HTML sanitizer or CSS engine.
  function compileRegex1105(input,optionalFlags=''){
    const value=String(input||'').trim();
    if(!value||value.length>1200)throw new Error('正则表达式不能为空，且不能超过 1200 个字符。');
    let source=value,flags=String(optionalFlags||'').trim();
    const delimited=value.match(/^\/([\s\S]*)\/([dgimsuvy]*)$/);
    if(delimited){source=delimited[1];flags=delimited[2]}
    if(!/^[dgimsuvy]*$/.test(flags))throw new Error('正则 flags 只能使用 d、g、i、m、s、u、v、y。');
    if(!flags.includes('g')&&!flags.includes('y'))flags+='g';
    let re;
    try{re=new RegExp(source,flags)}catch(e){throw new Error('正则表达式无效：'+e.message)}
    // Prevent zero-length replacements from producing unlimited decorative HTML.
    re.lastIndex=0;
    if(re.exec('')?.[0]==='')throw new Error('不能使用可匹配空字符串的正则表达式。');
    re.lastIndex=0;
    if(re.exec('a')?.[0]==='')throw new Error('不能使用可匹配零长度的正则表达式。');
    // Reject the common nested-quantifier patterns responsible for catastrophic backtracking.
    if(/\((?:[^()]|\\.){0,150}[+*](?:[^()]|\\.){0,150}\)\s*(?:[+*]|\{\d+,?\d*\})/.test(source))throw new Error('检测到高风险嵌套量词，请简化正则表达式。');
    return re;
  }
  function normalizeRule1105(raw,index=0){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('第 '+(index+1)+' 条正则不是有效对象。');
    let input=raw.findRegex??raw.pattern??raw.regex??raw.find;
    if(input instanceof RegExp)input=input.toString();
    if(typeof input!=='string')throw new Error('第 '+(index+1)+' 条正则缺少 findRegex/pattern。');
    const replacement=raw.replaceString??raw.replacement??raw.replace??'';
    if(typeof replacement!=='string'||replacement.length>400000)throw new Error('第 '+(index+1)+' 条替换模板格式错误或过长。');
    compileRegex1105(input,raw.flags||'');
    const scope=raw.scope==='selected'?'selected':raw.scope==='all'?'all':Array.isArray(raw.storyIds)?'selected':'all';
    const storyIds=Array.isArray(raw.storyIds)?raw.storyIds.filter(id=>typeof id==='string'):[];
    return {
      id:uid('rx'),name:String(raw.scriptName??raw.regexName??raw.name??`美化正则 ${index+1}`).trim().slice(0,120)||`美化正则 ${index+1}`,
      findRegex:input,flags:typeof raw.flags==='string'?raw.flags:'',replaceString:replacement,
      enabled:raw.enabled!==false&&raw.disabled!==true,
      scope,storyIds:scope==='selected'?storyIds:[]
    };
  }
  function extractRules1105(data){
    if(Array.isArray(data))return data;
    if(!data||typeof data!=='object')throw new Error('正则文件内容必须是 JSON 对象或数组。');
    for(const k of ['regexRules','regexScripts','scripts','rules'])if(Array.isArray(data[k]))return data[k];
    return [data];
  }
  function saveRules1105(next,success){
    const previous=ensureRules1105();
    state.regexRules=next;
    if(!persist(null)){state.regexRules=previous;return false}
    toast(success);render();return true;
  }
  function ruleApplies1105(rule,storyId){
    return rule.enabled!==false && (rule.scope!=='selected'||(Array.isArray(rule.storyIds)&&rule.storyIds.includes(storyId)));
  }
  function templateReplacement1105(template,match,captures,groups){
    return String(template).replace(/\$\$|\$&|\$0|\$(\d{1,2})|\$<([^>]+)>|\{\{\s*(match|\d+)\s*\}\}/gi,(token,n,g,curly)=>{
      if(token==='$$')return '$';
      if(token==='$&'||token==='$0'||String(curly).toLowerCase()==='match')return esc(match);
      const pos=n!==undefined?Number(n):/^\d+$/.test(curly||'')?Number(curly):null;
      if(pos!==null)return esc(pos===0?match:captures[pos-1]??'');
      if(g!==undefined)return esc(groups?.[g]??'');
      return token;
    });
  }
  function applySingleRule1105(container,rule){
    let matcher;
    try{matcher=compileRegex1105(rule.findRegex,rule.flags)}catch(error){console.warn('跳过格式错误的正则：',rule.name,error);return 0}
    const doc=container.ownerDocument;
    const walker=doc.createTreeWalker(container,NodeFilter.SHOW_TEXT);
    const nodes=[];let node;
    while((node=walker.nextNode())){
      if(!node.nodeValue?.trim()||node.nodeValue.length>15000)continue;
      if(node.parentElement?.closest('script,style,pre,code,textarea,svg,math,noscript,a,[data-violet-regex-skip]'))continue;
      nodes.push(node);
    }
    let applied=0;
    for(const textNode of nodes){
      if(applied>=300||!textNode.parentNode)break;
      const value=textNode.nodeValue;
      matcher.lastIndex=0;const fragment=doc.createDocumentFragment();let cursor=0,local=0,m;
      while((m=matcher.exec(value))!==null&&applied<300&&local<80){
        if(!m[0]){matcher.lastIndex=Math.max(matcher.lastIndex+1,m.index+1);continue}
        fragment.appendChild(doc.createTextNode(value.slice(cursor,m.index)));
        const rawReplacement=templateReplacement1105(rule.replaceString,m[0],m.slice(1),m.groups);
        // Only formatted replacement fragments pass through the existing sanitizer.
        const withoutStyles=rawReplacement.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'');
        const safeMarkup=safeHtml(withoutStyles);
        const template=doc.createElement('template');template.innerHTML=safeMarkup;
        fragment.appendChild(template.content);
        cursor=m.index+m[0].length;local++;applied++;
        if(!matcher.global&&!matcher.sticky)break;
        if(matcher.lastIndex<=m.index)matcher.lastIndex=cursor;
      }
      if(local){fragment.appendChild(doc.createTextNode(value.slice(cursor)));textNode.parentNode.replaceChild(fragment,textNode)}
    }
    return applied;
  }
  function applyStoryRules1105(container,storyId,customRules){
    const rules=customRules||ensureRules1105();
    let count=0;
    for(const rule of rules){
      if(!ruleApplies1105(rule,storyId)||richRule1105(rule))continue;
      count+=applySingleRule1105(container,rule);
    }
    return count;
  }

  /* Generic rich-template renderer for imported regex JSON.
     Independent Storybook implementation: no built-in chat/forum/status markup.
     Imported HTML/CSS/JS runs only inside a sandboxed, opaque-origin iframe.
     The host exposes only an allowlisted, bounded local-interaction bridge. */
  const RICH_STORE_KEY_1105=KEY+'-rich-chat-v1'; // Retain existing storage slot.
  const MAX_RICH_MATCHES_1105=25;
  const RICH_BRIDGE_CHANNEL_1105='violet-storybook-rich-v2';
  const richFrames1105=new Map();
  let richBridgeInstalled1105=false;
  function richRule1105(rule){
    const replacement=String(rule?.replaceString||'');
    return /<style\b|<script\b|<\/?(?:div|section|article|main|table|form|button|input|textarea|select|figure|header|footer|details)\b/i.test(replacement) ||
      /\bon(?:click|input|change|submit|keydown)\s*=/i.test(replacement);
  }
  function getRichStore1105(){
    try{const data=JSON.parse(localStorage.getItem(RICH_STORE_KEY_1105)||'{}');return data&&typeof data==='object'&&!Array.isArray(data)?data:{}}
    catch{return {}}
  }
  function getRichEntry1105(key){
    const raw=getRichStore1105()[key];
    const values=raw?.values&&typeof raw.values==='object'&&!Array.isArray(raw.values)?raw.values:{};
    // The earlier interaction adapter stored posts; preserve them as read-only history
    // instead of silently erasing them during the renderer migration.
    const messages=Array.isArray(raw?.messages)?raw.messages:
      Array.isArray(raw?.posts)?raw.posts.map(p=>({text:String(p?.text||''),time:String(p?.time||'')})):[];
    return {values:Object.fromEntries(Object.entries(values).filter(([k,v])=>typeof k==='string'&&k.length<=120&&typeof v==='string'&&v.length<=30000).slice(0,100)),
      messages:messages.filter(p=>p&&typeof p.text==='string').slice(-60).map(p=>({text:p.text.slice(0,4000),time:String(p.time||'').slice(0,60)}))};
  }
  function saveRichEntry1105(key,entry){
    try{
      const store=getRichStore1105();
      const previous=store[key];
      // Keep legacy fields (if any) intact; the renderer never interprets them.
      store[key]={...(previous&&typeof previous==='object'?previous:{}),values:entry.values,messages:entry.messages};
      const keys=Object.keys(store);if(keys.length>120)keys.slice(0,keys.length-120).forEach(k=>delete store[k]);
      localStorage.setItem(RICH_STORE_KEY_1105,JSON.stringify(store));
      return true;
    }catch(error){console.warn('美化互动本地保存失败：',error);return false}
  }
  function stripRichFence1105(value){
    let text=String(value||'').trim();
    text=text.replace(/^```(?:html|htm)?\s*\r?\n/i,'').replace(/\r?\n```\s*$/,'');
    return text.replace(/<\/html\s*>\s*$/i,'');
  }
  function extractRichReplacements1105(story,rules){
    let source=String(story.body??'');const widgets=[];
    if(source.length>3000000)return {source,widgets};
    for(const rule of rules){
      if(!ruleApplies1105(rule,story.id)||!richRule1105(rule)||rule.promptOnly===true)continue;
      let re;try{re=compileRegex1105(rule.findRegex,rule.flags)}catch(err){console.warn('复杂美化正则跳过：',err);continue}
      let currentCount=0;
      source=source.replace(re,(match,...args)=>{
        if(widgets.length>=MAX_RICH_MATCHES_1105||currentCount>=MAX_RICH_MATCHES_1105)return match;
        const offsetIndex=args.length>=2&&typeof args[args.length-1]==='object'?args.length-3:args.length-2;
        const captures=args.slice(0,offsetIndex);
        const groups=typeof args[args.length-1]==='object'?args[args.length-1]:undefined;
        const unique=widgets.length;
        const marker=`VIOLETRICHWIDGET${unique}END`;
        const key=[story.id,rule.id,unique].map(x=>String(x).replace(/[^a-zA-Z0-9_-]/g,'_')).join('__');
        widgets.push({marker,key,ruleName:rule.name,html:templateReplacement1105(rule.replaceString,match,captures,groups)});
        currentCount++;
        return '\n\n'+marker+'\n\n';
      });
    }
    return {source,widgets};
  }

  function compactRichBoundary1105(host){
    // Rich-regex placeholders are padded with newlines for Markdown splitting.
    // In mixed HTML/Markdown those generated separators can become empty blocks/BRs.
    // Remove only empty nodes directly touching the widget; never touch prose or raw story data.
    const emptyParagraph=node=>node?.nodeType===Node.ELEMENT_NODE&&node.tagName==='P'&&
      !node.textContent.trim()&&!node.querySelector('img,video,audio,svg,canvas,iframe,object,embed');
    const blank=node=>node?.nodeType===Node.TEXT_NODE&&!node.textContent.trim();
    for(const direction of ['previousSibling','nextSibling']){
      let count=0,node=host[direction];
      while(node&&count<16){
        const removable=blank(node)||(node.nodeType===Node.ELEMENT_NODE&&node.tagName==='BR')||emptyParagraph(node);
        if(!removable)break;
        const next=node[direction];node.remove();node=next;count++;
      }
    }
    const before=host.previousElementSibling;
    if(before&&/^(P|DIV|BLOCKQUOTE)$/.test(before.tagName)){
      before.classList.add('violet-rich-before');
      if(before.tagName==='P'){
        let count=0;
        while(before.lastChild&&count<12){
          const tail=before.lastChild;
          if(blank(tail)||(tail.nodeType===Node.ELEMENT_NODE&&tail.tagName==='BR')){tail.remove();count++}
          else break;
        }
      }
    }
  }
  function replaceRichMarkers1105(container,widgets,preview=false){
    if(!widgets.length)return;
    const doc=container.ownerDocument;
    const markerMap=new Map(widgets.map(w=>[w.marker,w]));
    const walker=doc.createTreeWalker(container,NodeFilter.SHOW_TEXT);
    const pending=[];let node;
    while((node=walker.nextNode())){
      if(!node.nodeValue||!node.nodeValue.includes('VIOLETRICHWIDGET'))continue;
      pending.push(node);
    }
    for(const textNode of pending){
      if(!textNode.parentNode)continue;
      const text=textNode.nodeValue;
      const matcher=/VIOLETRICHWIDGET\d+END/g;
      let match,index=0;const fragment=doc.createDocumentFragment();
      while((match=matcher.exec(text))){
        fragment.appendChild(doc.createTextNode(text.slice(index,match.index)));
        const widget=markerMap.get(match[0]);
        if(widget)fragment.appendChild(buildRichWidget1105(doc,widget,preview));
        else fragment.appendChild(doc.createTextNode(match[0]));
        index=matcher.lastIndex;
      }
      if(!index)continue;
      fragment.appendChild(doc.createTextNode(text.slice(index)));
      const parent=textNode.parentElement;
      if(parent&&parent.tagName==='P'&&parent.textContent.trim()===text.trim()&&/^\s*VIOLETRICHWIDGET\d+END\s*$/.test(text))parent.replaceWith(fragment);
      else textNode.replaceWith(fragment);
    }
    container.querySelectorAll('.violet-rich-widget').forEach(compactRichBoundary1105);
  }
  function richFramePost1105(record,data){
    try{record.frame.contentWindow?.postMessage({channel:RICH_BRIDGE_CHANNEL_1105,token:record.token,...data},'*')}
    catch(error){console.warn('美化组件响应失败：',error)}
  }
  function ensureRichBridge1105(){
    if(richBridgeInstalled1105)return;
    richBridgeInstalled1105=true;
    window.addEventListener('message',event=>{
      const data=event.data;
      if(!data||data.channel!==RICH_BRIDGE_CHANNEL_1105||typeof data.token!=='string')return;
      let record;
      for(const [id,item] of richFrames1105){
        if(!item.frame.isConnected){richFrames1105.delete(id);continue}
        if(item.token===data.token&&event.source===item.frame.contentWindow){record=item;break}
      }
      if(!record)return;
      if(data.type==='resize'){
        const proposed=Number(data.height);
        if(!Number.isFinite(proposed))return;
        const h=Math.max(90,Math.min(5200,Math.ceil(proposed)));
        if(Math.abs(h-record.lastHeight)>2){record.frame.style.height=h+'px';record.lastHeight=h}
        return;
      }
      const now=Date.now();
      record.operations=(record.operations||[]).filter(t=>now-t<10000);
      if(record.operations.length>=60){
        if(data.type==='send')richFramePost1105(record,{type:'send-ack',id:data.id,ok:false});
        return;
      }
      record.operations.push(now);
      if(record.preview){
        if(data.type==='send')richFramePost1105(record,{type:'send-ack',id:data.id,ok:true});
        return;
      }
      if(data.type==='set' || data.type==='remove'){
        const key=String(data.key??'');if(!key||key.length>120)return;
        const entry=getRichEntry1105(record.key);
        if(data.type==='remove')delete entry.values[key];
        else{
          const val=String(data.value??'');if(val.length>30000||Object.keys(entry.values).length>=100&&!(key in entry.values))return;
          entry.values[key]=val;
        }
        saveRichEntry1105(record.key,entry);return;
      }
      if(data.type==='send'){
        const value=String(data.text??'');
        if(!value.trim()||value.length>4000){richFramePost1105(record,{type:'send-ack',id:data.id,ok:false});return}
        const entry=getRichEntry1105(record.key);
        entry.messages.push({text:value,time:new Date().toLocaleString('zh-CN')});
        entry.messages=entry.messages.slice(-60);
        const ok=saveRichEntry1105(record.key,entry);
        richFramePost1105(record,{type:'send-ack',id:data.id,ok});
      }
    });
  }
  /* Only a tiny generic bridge is injected by Storybook. No template-specific
     event handlers, selectors or style definitions are included here. */
  const RICH_IFRAME_BRIDGE_1105=String.raw`(function(){
    'use strict';
    const CHANNEL='violet-storybook-rich-v2';
    const boot=window.__storybookBoot;
    const values=Object.assign(Object.create(null),boot.values||{});
    const messages=Array.isArray(boot.messages)?boot.messages.slice(-60):[];
    const pending=new Map();let seq=0;
    function post(type,data){parent.postMessage(Object.assign({channel:CHANNEL,token:boot.token,type:type},data||{}),'*')}
    function emit(type,detail){window.dispatchEvent(new CustomEvent(type,{detail:detail}))}
    function updateLog(){
      let node=document.getElementById('storybook-local-log');
      if(!messages.length){if(node)node.remove();return}
      if(!node){
        node=document.createElement('details');node.id='storybook-local-log';
        node.style.cssText='max-width:100%;margin:12px 0;padding:10px 12px;border:1px dashed #aaa;border-radius:9px;font:13px/1.6 system-ui,sans-serif;color:#555;overflow-wrap:anywhere;';
        const summary=document.createElement('summary');summary.textContent='本地互动记录';summary.style.cursor='pointer';node.appendChild(summary);
        const list=document.createElement('div');list.id='storybook-local-log-list';node.appendChild(list);
        document.body.appendChild(node);
      }
      const list=node.querySelector('#storybook-local-log-list');list.replaceChildren();
      messages.slice(-60).forEach(entry=>{const item=document.createElement('div');item.style.cssText='padding:7px 0;border-top:1px solid #eee;white-space:pre-wrap;';item.textContent=(entry.time?entry.time+'  ':'')+entry.text;list.appendChild(item)});
    }
    const api={
      get:key=>Object.hasOwn(values,String(key))?values[String(key)]:null,
      set:(key,value)=>{key=String(key);value=String(value);if(!key||key.length>120||value.length>30000)return false;values[key]=value;post('set',{key:key,value:value});return true},
      remove:key=>{key=String(key);delete values[key];post('remove',{key:key})},
      history:()=>messages.map(m=>({...m})),
      send:text=>new Promise(resolve=>{text=String(text||'').trim();if(!text||text.length>4000){resolve(false);return}
        const id=++seq;pending.set(id,{resolve:resolve,text:text});post('send',{id:id,text:text});
        setTimeout(()=>{const p=pending.get(id);if(p){pending.delete(id);p.resolve(false)}},2500);
      })
    };
    window.StorybookLocal=Object.freeze(api);
    // Opaque-origin iframe has no native localStorage. This optional in-memory
    // compatible storage allows authored templates to persist basic UI state.
    const storage={
      getItem:key=>api.get(key),setItem:(key,value)=>api.set(key,value),removeItem:key=>api.remove(key),
      clear:()=>Object.keys(values).forEach(key=>api.remove(key)),
      key:i=>Object.keys(values)[i]??null,get length(){return Object.keys(values).length}
    };
    try{Object.defineProperty(window,'localStorage',{configurable:true,value:storage})}catch(e){}
    try{Object.defineProperty(window,'sessionStorage',{configurable:true,value:storage})}catch(e){}
    // Only /send is emulated. /trigger, generation, AI APIs and slash command
    // chains are NOT executed against the host application.
    window.triggerSlash=async command=>{
      const text=String(command||'');if(!/^\s*\/send\s+/i.test(text))return false;
      const payload=text.replace(/^\s*\/send\s+/i,'').replace(/\s*\|\s*\/trigger\s*$/i,'');
      return api.send(payload);
    };
    window.sillyTavern={send:command=>window.triggerSlash(command)};
    // Generic image lightbox. No navigation or new browser window is permitted
    // from untrusted templates; image previews stay inside the iframe.
    window.open=function(url){
      try{
        const target=new URL(String(url||''),document.baseURI);
        if(!['http:','https:','data:'].includes(target.protocol) ||
          !(/\.(?:png|jpe?g|gif|webp|avif)(?:$|[?#])/i.test(target.href)||target.protocol==='data:'))return null;
        const cover=document.createElement('div');
        cover.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.86);display:flex;align-items:center;justify-content:center;z-index:2147483600;padding:20px;cursor:zoom-out;';
        const img=document.createElement('img');img.src=target.href;img.alt='图片预览';
        img.style.cssText='max-width:100%;max-height:100%;object-fit:contain;';cover.appendChild(img);
        cover.addEventListener('click',()=>cover.remove());document.body.appendChild(cover);
        return {closed:false,close:()=>cover.remove()};
      }catch(e){return null}
    };
    window.addEventListener('message',event=>{
      if(event.source!==parent)return;
      const data=event.data;if(!data||data.channel!==CHANNEL||data.token!==boot.token)return;
      if(data.type==='send-ack'){
        const p=pending.get(data.id);if(!p)return;pending.delete(data.id);
        if(data.ok){messages.push({text:p.text,time:new Date().toLocaleString('zh-CN')});
          if(messages.length>60)messages.shift();updateLog();emit('storybook:local-message',{text:p.text})}
        p.resolve(Boolean(data.ok));
      }
    });
    let height=0;
    function measure(){
      const body=document.body;if(!body)return;
      const box=body.getBoundingClientRect();const css=getComputedStyle(body);
      const margins=(parseFloat(css.marginTop)||0)+(parseFloat(css.marginBottom)||0);
      // Measure the content itself: documentElement.scrollHeight is at least
      // the previous iframe viewport height and would prevent shrinking.
      // Top margins on a template's first block can collapse outside body.
      // Include body's actual bottom position, not just its box height.
      const proposed=Math.ceil(Math.max(box.height,box.bottom)+margins+3);
      if(Math.abs(proposed-height)>2){height=proposed;post('resize',{height:proposed})}
    }
    window.addEventListener('DOMContentLoaded',()=>{
      updateLog();measure();
      if(window.ResizeObserver){new ResizeObserver(measure).observe(document.body)}
      if(window.MutationObserver){new MutationObserver(()=>requestAnimationFrame(measure)).observe(document.body,{childList:true,subtree:true})}
      window.addEventListener('load',measure);setTimeout(measure,150);setTimeout(measure,700);
    });
  })();`;
  function buildRichWidget1105(doc,widget,preview=false){
    const host=doc.createElement('div');host.className='violet-rich-widget';host.dataset.violetRegexSkip='1';
    host.style.cssText='display:block;max-width:100%;min-width:0;margin:8px auto 12px;';
    const frame=doc.createElement('iframe');
    frame.className='violet-rich-frame';frame.title='美化互动：'+String(widget.ruleName||'自定义模板');
    frame.setAttribute('sandbox','allow-scripts');
    frame.setAttribute('scrolling','no');
    frame.style.cssText='display:block;box-sizing:border-box;border:0;width:100%;max-width:100%;height:120px;background:transparent;';
    host.appendChild(frame);
    ensureRichBridge1105();
    const token=uid('rich');
    const record={frame,token,key:widget.key,preview,lastHeight:120};
    richFrames1105.set(token,record);
    const saved=preview?{values:{},messages:[]}:getRichEntry1105(widget.key);
    const boot=JSON.stringify({token,values:saved.values,messages:saved.messages}).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
    const raw=stripRichFence1105(widget.html);
    const csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
    // No allow-same-origin, allow-top-navigation or allow-popups. A template cannot
    // read Storybook's DOM, storage, data or API keys through this iframe.
    frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<meta http-equiv="Content-Security-Policy" content="'+csp+'">'+
      '<style>html,body{max-width:100%;box-sizing:border-box}body{margin:0;padding:0}*,*::before,*::after{box-sizing:border-box}img,video,svg,canvas{max-width:100%}</style>'+
      '<script>window.__storybookBoot='+boot+';<\\/script>'.replace('\\/script','/script')+
      '<script>'+RICH_IFRAME_BRIDGE_1105+'<\\/script>'.replace('\\/script','/script')+
      '</head><body>'+raw+'</body></html>';
    return host;
  }

  function enhanceRegexPanel1105(){
    const parent=$('#pageContent');if(!parent)return;
    const panel=document.createElement('section');panel.id='violetRegexPanel';panel.className='panel violet-regex-panel';
    const rules=ensureRules1105();
    panel.innerHTML=`<h3>✧ 番外美化正则</h3>
      <p>追加式阅读美化：不会覆盖原稿，也不会替换现有 HTML、Markdown 或 CSS 渲染。可为全部番外或指定番外设置独立规则。</p>
      <div class="violet-regex-toolbar"><button class="button secondary" data-action="violet-regex-import">导入正则 JSON</button><button class="button secondary" data-action="violet-regex-new">＋ 新建正则</button><button class="button secondary" data-action="violet-regex-export">导出正则 JSON</button><button class="button secondary" data-action="violet-regex-preview">预览效果</button></div>
      <input id="violetRegexImportFile" type="file" accept=".json,application/json" hidden>
      ${rules.length?rules.map(r=>`<div class="violet-regex-rule"><div class="violet-regex-rule-info"><strong>${esc(r.name)}</strong><br><small>${r.scope==='selected'?`指定番外 · ${(r.storyIds||[]).length} 篇`:'全部番外'} · ${r.enabled===false?'已停用':'已启用'}</small></div><div class="violet-regex-actions"><button data-action="violet-regex-toggle" data-id="${esc(r.id)}">${r.enabled===false?'启用':'停用'}</button><button data-action="violet-regex-edit" data-id="${esc(r.id)}">编辑</button><button data-action="violet-regex-delete" data-id="${esc(r.id)}">删除</button></div></div>`).join(''):'<p class="muted">还没有美化规则。可以导入已有正则 JSON，或者新建一条。</p>'}
      <p class="muted">支持 $1、$2、$3、$&、{{match}}。普通规则匹配阅读后文本；大型 HTML/CSS 模板从原始番外匹配，独立渲染。复杂 HTML/CSS/JavaScript 模板在独立隔离窗口内运行；支持基本本地互动记录与 /send 模拟，不连接 AI。每条规则可以停用、编辑或删除。</p>`;
    parent.appendChild(panel);
    bindActionButtons(panel);
    panel.querySelector('#violetRegexImportFile').addEventListener('change',handleRegexImport1105);
  }
  function editRegex1105(id){
    const r=id?ensureRules1105().find(x=>x.id===id):null;
    if(id&&!r)return;
    const title=r?'编辑美化正则':'新建美化正则';
    const selected=new Set(r?.storyIds||[]);
    const dlg=showDialog1105('violetRegexEditDialog',`
      <h3>${title}</h3>
      <p class="muted">这里只设置阅读时的附加美化；原稿不改变。替换内容可以写安全的 HTML 标签和行内样式。</p>
      <form id="violetRegexEditForm">
        <label>规则名称<input name="ruleName" required maxlength="120" value="${esc(r?.name||'')}"></label>
        <label>匹配正则（支持 /表达式/g 或单独表达式）<textarea name="findRegex" rows="3" required spellcheck="false">${esc(r?.findRegex||'')}</textarea></label>
        <label>flags（可选，例如 gi）<input name="regexFlags" value="${esc(r?.flags||'')}"></label>
        <label>替换内容（HTML / $1 捕获组）<textarea name="replaceString" rows="6" spellcheck="false">${esc(r?.replaceString||'')}</textarea></label>
        <label>应用范围<select name="ruleScope"><option value="all" ${r?.scope!=='selected'?'selected':''}>全部番外</option><option value="selected" ${r?.scope==='selected'?'selected':''}>仅指定番外</option></select></label>
        <div class="violet-story-options" id="violetRuleStoryOptions">${(state.stories||[]).map(st=>`<label><input type="checkbox" name="storyId" value="${esc(st.id)}" ${selected.has(st.id)?'checked':''}>${esc(st.title)}</label>`).join('')||'暂无番外'}</div>
        <label><input name="ruleEnabled" type="checkbox" ${r?.enabled===false?'':'checked'}> 启用此规则</label>
        <div class="violet-extra-actions"><button type="button" data-violet-cancel>取消</button><button type="button" id="violetTestCurrentRegex">预览正则</button><button class="button primary" type="submit">保存规则</button></div>
      </form>`);
    const form=dlg.querySelector('form');
    const showScope=()=>{dlg.querySelector('#violetRuleStoryOptions').hidden=form.elements.ruleScope.value!=='selected'};
    form.elements.ruleScope.addEventListener('change',showScope);showScope();
    const readDraft=()=>normalizeRule1105({name:form.elements.ruleName.value,findRegex:form.elements.findRegex.value,flags:form.elements.regexFlags.value,replaceString:form.elements.replaceString.value,scope:form.elements.ruleScope.value,storyIds:[...form.querySelectorAll('[name="storyId"]:checked')].map(x=>x.value),enabled:form.elements.ruleEnabled.checked});
    dlg.querySelector('#violetTestCurrentRegex').addEventListener('click',()=>{
      try{
        const draft=readDraft();
        if(draft.scope==='selected'&&!draft.storyIds.length){toast('请至少选择一篇番外');return}
        openRegexPreview1105([draft]);
      }catch(error){toast(error.message)}
    });
    form.addEventListener('submit',e=>{
      e.preventDefault();
      try{
        const draft=readDraft();
        if(draft.scope==='selected'&&!draft.storyIds.length){toast('请至少选择一篇番外');return}
        draft.id=r?.id||draft.id;
        const rules=ensureRules1105();
        const updated=r?rules.map(x=>x.id===r.id?draft:x):[...rules,draft];
        if(saveRules1105(updated,'美化正则已保存'))dlg.close();
      }catch(error){toast(error.message)}
    });
  }
  async function handleRegexImport1105(e){
    const input=e.currentTarget,file=input.files?.[0];if(!file)return;
    try{
      if(!/\.json$/i.test(file.name)||file.size>3*1024*1024)throw new Error('请选择不超过 3MB 的 JSON 正则文件。');
      const entries=extractRules1105(JSON.parse(await file.text()));
      if(!entries.length||entries.length>100)throw new Error('正则文件应包含 1～100 条规则。');
      const imported=entries.map((rule,i)=>normalizeRule1105(rule,i));
      const existing=ensureRules1105();
      if(!confirm(`将导入 ${imported.length} 条正则并追加到现有 ${existing.length} 条规则后面。\n导入前请确认文件来源可信。继续吗？`))return;
      saveRules1105([...existing,...imported],`已导入 ${imported.length} 条美化正则`);
    }catch(error){toast('正则导入失败：'+error.message)}
    finally{input.value=''}
  }
  function openRegexPreview1105(customRules){
    if(!(state.stories||[]).length){toast('请先收藏一篇番外');return}
    const st=state.stories.find(s=>s.id===state.activeStoryId)||state.stories[0];
    const dlg=showDialog1105('violetRegexPreviewDialog',`
      <h3>正则美化预览</h3><label>预览番外<select id="violetPreviewStory">${state.stories.map(s=>`<option value="${esc(s.id)}" ${s.id===st.id?'selected':''}>${esc(s.title)}</option>`).join('')}</select></label>
      <p id="violetPreviewCount" class="muted"></p>
      <div class="violet-preview-area reader-body" id="violetRegexPreviewBody"></div>
      <p class="muted">仅在预览窗口展示，不修改原稿；交互预览不写入本地记录。大型模板可跨行匹配原始番外；交互在隔离窗口内预览，不写入本地记录，也不会连接 AI。</p>
      <div class="violet-extra-actions"><button type="button" data-violet-cancel>关闭</button></div>`);
    const select=dlg.querySelector('#violetPreviewStory'),body=dlg.querySelector('#violetRegexPreviewBody');
    const doPreview=()=>{
      const story=state.stories.find(s=>s.id===select.value);if(!story)return;
      const rules=customRules||ensureRules1105();
      const rich=extractRichReplacements1105(story,rules);
      body.innerHTML=bodyHTML({...story,body:rich.source});
      replaceRichMarkers1105(body,rich.widgets,true);
      const count=rich.widgets.length+applyStoryRules1105(body,story.id,rules);
      dlg.querySelector('#violetPreviewCount').textContent=`当前显示：${story.title} · 本次匹配替换 ${count} 处`;
    };
    select.addEventListener('change',doPreview);doPreview();
  }
  function regexAction1105(name,id){
    const rules=ensureRules1105();
    const r=rules.find(x=>x.id===id);
    if(name==='violet-regex-new'){editRegex1105();return}
    if(name==='violet-regex-edit'){editRegex1105(id);return}
    if(name==='violet-regex-toggle'&&r){saveRules1105(rules.map(x=>x.id===id?{...x,enabled:x.enabled===false}:x),'正则启用状态已保存');return}
    if(name==='violet-regex-delete'&&r){
      if(confirm(`确定永久删除美化正则「${r.name}」吗？\n仅删除此规则，不影响任何番外原稿。`)){
        if(saveRules1105(rules.filter(x=>x.id!==id),'美化正则已删除')){
          try{const stored=getRichStore1105();const safeId=String(id).replace(/[^a-zA-Z0-9_-]/g,'_');
            Object.keys(stored).filter(k=>k.includes('__'+safeId+'__')).forEach(k=>delete stored[k]);
            localStorage.setItem(RICH_STORE_KEY_1105,JSON.stringify(stored));}catch(err){console.warn('清理已删除规则的互动记录失败：',err)}
        }
      }return
    }
    if(name==='violet-regex-import'){$('#violetRegexImportFile')?.click();return}
    if(name==='violet-regex-export'){download('Violet-Storybook-Regex-Rules.json',new Blob([JSON.stringify({regexRules:rules},null,2)],{type:'application/json'}));return}
    if(name==='violet-regex-preview'){openRegexPreview1105();return}
  }

  function installListAccordion1105(kind){
    const parent=$('#pageContent');const grid=parent?.querySelector('.module-grid');
    const panel=grid?.querySelector(':scope > .panel');
    const heading=panel?.querySelector(':scope > h3');
    if(!heading)return;
    const expanded=kind==='theme'?themesListOpen1105:musicListOpen1105;
    const label=kind==='theme'?'主题列表':'全部音乐';
    const button=document.createElement('button');button.type='button';button.className='violet-section-fold';
    button.dataset.action='violet-fold-'+kind;button.setAttribute('aria-expanded',String(expanded));
    button.innerHTML=`<span>${heading.innerHTML}</span><span class="violet-chevron" aria-hidden="true">${expanded?'▾':'▸'}</span>`;
    heading.replaceWith(button);
    const fold=document.createElement('div');fold.className='violet-folded-list';fold.id='violet-fold-'+kind;fold.hidden=!expanded;
    button.setAttribute('aria-controls',fold.id);
    while(button.nextSibling)fold.appendChild(button.nextSibling);
    panel.appendChild(fold);
    bindActionButtons(panel);
  }
  function toggleListAccordion1105(kind){
    if(kind==='theme')themesListOpen1105=!themesListOpen1105;
    else musicListOpen1105=!musicListOpen1105;
    const expanded=kind==='theme'?themesListOpen1105:musicListOpen1105;
    const fold=document.getElementById('violet-fold-'+kind),button=document.querySelector('[data-action="violet-fold-'+kind+'"]');
    if(fold)fold.hidden=!expanded;
    if(button){button.setAttribute('aria-expanded',String(expanded));const arrow=button.querySelector('.violet-chevron');if(arrow)arrow.textContent=expanded?'▾':'▸'}
  }
  render=function violetRenderWithAdditions1105(){
    originalRender1105();
    installStyles1105();ensureRules1105();
    if(currentPage==='characters'){const grid=$('#pageContent .module-grid');if(grid)grid.classList.add('violet-character-grid');enhanceCharacters1105();}
    if(currentPage==='series'){const grid=$('#pageContent .module-grid');if(grid)grid.classList.add('violet-series-grid');enhanceSeries1105();}
    if(currentPage==='themes'){installListAccordion1105('theme');enhanceRegexPanel1105()}
    if(currentPage==='music'){const musicGrid=$('#pageContent .module-grid');if(musicGrid)musicGrid.classList.add('violet-music-grid');installListAccordion1105('music')}
  };
  openReader=function violetOpenReaderWithRegex1105(st){
    originalOpenReader1105(st);
    try{
      const readerBody=$('#readerBody');
      const rich=extractRichReplacements1105(st,ensureRules1105());
      if(rich.widgets.length){
        readerBody.innerHTML=bodyHTML({...st,body:rich.source});
        replaceRichMarkers1105(readerBody,rich.widgets,false);
      }
      applyStoryRules1105(readerBody,st.id);
    }catch(error){console.error('附加美化正则渲染失败：',error);toast('部分美化正则渲染失败，正文原稿未受影响。')}
  };
  action=function violetActionWithAdditions1105(name,id,button){
    if(name==='violet-delete-character'){deleteCharacter1105(id);return}
    if(name==='violet-avatar'){openAvatar1105(id);return}
    if(name==='violet-series-avatar'){openSeriesAvatar1105(id);return}
    if(name==='violet-fold-theme'){toggleListAccordion1105('theme');return}
    if(name==='violet-fold-music'){toggleListAccordion1105('music');return}
    if(name==='violet-toggle-series'){toggleSeries1105(id);return}
    if(name.startsWith('violet-regex-')){regexAction1105(name,id);return}
    if(name==='delete-story'){
      const existed=(state.stories||[]).some(st=>st.id===id);
      const outcome=originalAction1105(name,id,button);
      if(existed&&!(state.stories||[]).some(st=>st.id===id)){
        try{const stored=getRichStore1105();const safeId=String(id).replace(/[^a-zA-Z0-9_-]/g,'_');
          Object.keys(stored).filter(k=>k.startsWith(safeId+'__')).forEach(k=>delete stored[k]);
          localStorage.setItem(RICH_STORE_KEY_1105,JSON.stringify(stored));}catch(error){console.warn('清理已删除番外的互动记录失败：',error)}
      }
      return outcome;
    }
    return originalAction1105(name,id,button);
  };
  const originalClearData1105=clearData;
  clearData=async function violetClearDataIncludingInteractions1105(){
    const before=state;
    await originalClearData1105();
    if(before!==state){
      try{localStorage.removeItem(RICH_STORE_KEY_1105)}
      catch(error){console.warn('独立美化互动记录清理失败：',error);toast('收藏已清空，但美化互动记录清理失败，请检查浏览器存储。')}
    }
  };
  // The original startup has already run above; refresh once so added controls show.
  render();
})();
