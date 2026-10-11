const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const KEY='violets-storybook-v1';
// Keep the currently applied theme in its own storage slot. This lets the theme
// survive a reload even if the main collection data is too large to save.
const ACTIVE_THEME_KEY='violets-storybook-active-theme-v1';
const seed={settings:{layout:'cover',autoPlay:false,loop:true,preview:'manual',fontSize:17,lineHeight:1.95,bodyFont:'Georgia',signature:'Violet196'},series:[{id:'ser-hogwarts',name:'霍格沃茨日常',themeId:''},{id:'ser-finn',name:'小狐狸的故事',themeId:''}],characters:[{id:'char-fin',name:'芬利·奥格尔维',description:'格拉斯哥的小狐狸',storyIds:[]}],stories:[{id:'story-welcome',title:'欢迎来到 Violet 的故事宇宙',seriesId:'ser-hogwarts',characterIds:['char-fin'],summary:'这是你的私人故事收藏馆。你可以导入自己的番外、整理角色与系列，并为每个故事安排专属配乐。',tags:['收藏馆指南','示例'],raw:'欢迎来到 Violet\'s Storybook！\n\n这里是一个本地原型示例。你可以通过右上角的 + 导入自己的番外。\n\n**提示：** 当前版本是功能原型，不是已编译的 Android APK。',body:'欢迎来到 Violet\'s Storybook！\n\n这里是一个本地原型示例。你可以通过右上角的 + 导入自己的番外。\n\n**提示：** 当前版本是功能原型，不是已编译的 Android APK。',createdAt:Date.now(),updatedAt:Date.now(),readProgress:0,cover:'',history:[],music:{mode:'fixed',playlistId:'',trackIds:[],loop:'list',disabled:false}}],tracks:[],playlists:[{id:'pl-rain',name:'雨夜氛围',description:'适合雨夜、独处与未寄出的信',trackIds:[]},{id:'pl-letters',name:'未寄出的信',description:'温柔、遗憾与克制的思念',trackIds:[]},{id:'pl-hogwarts',name:'霍格沃茨日常',description:'学院、魔法与古典氛围',trackIds:[]}],themes:[{id:'theme-default',name:'月光纸页',type:'combined',css:':root {\n  --paper: #fbf8f1;\n  --ink: #26394e;\n  --gold: #c6a45c;\n  --lav: #b19ad9;\n}\n.story-title { font-family: Georgia, serif; }\n.story-header { text-align: center; }',active:true}],activePage:'home',activeStoryId:'story-welcome',player:{trackId:'',playlistId:'',storyId:'',isPlaying:false,position:0}};
let state;try{state=JSON.parse(localStorage.getItem(KEY))||structuredClone(seed)}catch{state=structuredClone(seed)}
let currentPage='home',readerId=null,editingId=null,selectedFileText='',selectedAudioUrl='',audioObjectUrl='',audio=new Audio(),dragTrackId=null,toastTimer,readerProgressTimer=null;
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
    /* 阅读正文的基础防溢出保护，不干预主题的颜色与字体。 */
    #readerBody,.reader-body{box-sizing:border-box;min-width:0;max-width:100%;overflow-wrap:anywhere;}
    #readerBody img,#readerBody picture,#readerBody video,#readerBody canvas,#readerBody svg,#readerBody iframe{max-width:100%!important;height:auto!important;box-sizing:border-box;}
    #readerBody pre{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;}
    @media(max-width:600px){
      #readerBody{width:100%;min-width:0;max-width:100%;overflow-x:hidden;}
      #readerBody p,#readerBody li,#readerBody blockquote,#readerBody h1,#readerBody h2,#readerBody h3,#readerBody h4,#readerBody h5,#readerBody h6{max-width:100%;overflow-wrap:anywhere;word-break:normal;}
      #readerBody div,#readerBody section,#readerBody article,#readerBody figure,#readerBody picture{max-width:100%;box-sizing:border-box;}
      #readerBody .reader-table-scroll{display:block;width:100%;max-width:100%;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;margin:1em 0 1.3em;}
      #readerBody .reader-table-scroll>table{width:max-content!important;min-width:100%;max-width:none!important;margin:0;}
      #readerBody th,#readerBody td{overflow-wrap:anywhere;word-break:normal;}
      #readerBody pre{width:100%;max-width:100%;overflow-x:auto;white-space:pre;}
      #readerBody pre code{white-space:pre;overflow-wrap:normal;word-break:normal;}
      #readerBody p code,#readerBody li code,#readerBody blockquote code{white-space:normal;overflow-wrap:anywhere;word-break:break-word;}
      #readerBody blockquote{box-sizing:border-box;margin-left:0;margin-right:0;padding-left:.85em;padding-right:.85em;}
    }
  `;
  document.head.appendChild(style);
}
function prepareNarrowScreenReaderContent(container){
  if(!container)return;
  container.querySelectorAll('table').forEach(table=>{
    if(table.parentElement?.classList.contains('reader-table-scroll'))return;
    const wrapper=document.createElement('div');
    wrapper.className='reader-table-scroll';
    table.parentNode.insertBefore(wrapper,table);
    wrapper.appendChild(table);
  });
}
function openReader(st){ensureNarrowScreenReaderStyles();readerId=st.id;state.activeStoryId=st.id;$('#readerMeta').textContent=`${seriesName(st.seriesId)} · 第 ${storyNo(st)} 章`;$('#readerTitle').textContent=st.title;const readerBody=$('#readerBody');readerBody.innerHTML=bodyHTML(st);prepareNarrowScreenReaderContent(readerBody);readerBody.scrollTop=0;$('#readProgress').textContent=`阅读进度 ${st.readProgress||0}%`;$('#readerDialog').showModal();readerBody.onscroll=()=>{const height=Math.max(readerBody.scrollHeight,1);const ratio=Math.min(100,Math.round((readerBody.scrollTop+readerBody.clientHeight)/height*100));const previous=Number(st.readProgress)||0;if(ratio>previous){st.readProgress=ratio;st.updatedAt=Date.now();$('#readProgress').textContent=`阅读进度 ${ratio}%`;clearTimeout(readerProgressTimer);readerProgressTimer=setTimeout(()=>{persist(null);readerProgressTimer=null},400)}};}
$('#closeReader').onclick=$('#readerDone').onclick=()=>$('#readerDialog').close();$('#markRead').onclick=()=>{const st=state.stories.find(s=>s.id===readerId);if(st){st.readProgress=100;st.updatedAt=Date.now();persist('已标记读完');$('#readProgress').textContent='阅读进度 100%'}};$('#readerSource').onclick=()=>{const st=state.stories.find(s=>s.id===readerId);$('#sourceText').textContent=st?.raw||'';$('#sourceDialog').showModal()};$('#closeSource').onclick=()=>$('#sourceDialog').close();$('#readerEdit').onclick=()=>{const st=state.stories.find(s=>s.id===readerId);if(st)openEdit(st)};$('#readerMusic').onclick=()=>{const st=state.stories.find(s=>s.id===readerId);if(st)openAssociation(st)};
function openEdit(st){editingId=st.id;const f=$('#editForm');ensureStoryCoverFields(f);if(!f.querySelector('[name="summary"]')){const label=document.createElement('label');label.innerHTML='简介（可选）<textarea name="summary" rows="2"></textarea>';f.insertBefore(label,f.querySelector('[name="body"]')?.closest('label')||f.querySelector('.modal-actions')||null)}f.elements.title.value=st.title;f.elements.body.value=st.body;f.querySelector('[name="summary"]').value=st.summary||'';f.querySelector('[name="coverFile"]').value='';const existingCover=String(st.coverUrl||st.cover||'');f.querySelector('[name="coverUrl"]').value=/^https?:\/\//i.test(existingCover)?existingCover:'';f.elements.mode.value='text';f.elements.seriesId.innerHTML='<option value="">未分类</option>'+state.series.map(s=>`<option value="${s.id}" ${s.id===st.seriesId?'selected':''}>${esc(s.name)}</option>`).join('');$('#editDialog').showModal()}
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
  st.title=title;st.body=f.elements.body.value;st.raw=st.body;st.summary=f.querySelector('[name="summary"]')?.value.trim()||'';st.seriesId=f.elements.seriesId.value;st.cover=nextCover;st.coverUrl=nextCoverUrl;st.updatedAt=Date.now();
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
async function playTrack(id){
  const t=state.tracks.find(track=>track.id===id);if(!t)return;
  let url='';
  try{url=await getTrackUrl(t)}catch(error){console.error('读取音乐失败：',error);toast('读取本地音频失败，请关闭并重新打开应用后重试。');return}
  if(!url){toast(t.kind==='file'?'这首音乐没有找到已保存的音频文件。它来自旧版本，请重新添加一次。':'请填写有效的音频直链。');return}
  audio.pause();audio.src=url;audio.load();
  audio.play().then(()=>{state.player={trackId:id,isPlaying:true,position:0};persist('开始播放：'+t.title);showPlayer(t)}).catch(error=>{console.warn('音频播放未启动：',error);showPlayer(t);toast('浏览器可能要求再次点击播放，或该链接不可直接播放。')});
}function showPlayer(t){let p=$('#playerPanel');if(!p){p=document.createElement('div');p.id='playerPanel';p.className='player-panel';document.body.append(p)}p.hidden=false;p.innerHTML=`<h3>${esc(t?.title||'音乐播放器')}</h3><div class="muted">${esc(t?.kind==='url'?'网络音频':'本地音频')} · 当前原型</div><div class="player-controls"><button data-player="prev">|◀</button><button class="play" data-player="toggle">${audio.paused?'▶':'Ⅱ'}</button><button data-player="next">▶|</button></div><input type="range" id="playerSeek" min="0" max="100" value="0"><div class="audio-status">播放进度 · 同一首音乐切换故事时可沿用播放状态（原生后台播放待实现）</div><button class="text-button" id="closePlayer">收起播放器</button>`;p.querySelector('[data-player=toggle]').onclick=()=>{if(audio.paused)audio.play();else audio.pause();showPlayer(t)};p.querySelector('[data-player=prev]').onclick=()=>stepTrack(-1);p.querySelector('[data-player=next]').onclick=()=>stepTrack(1);p.querySelector('#closePlayer').onclick=()=>p.hidden=true;p.querySelector('#playerSeek').oninput=e=>{if(audio.duration)audio.currentTime=audio.duration*e.target.value/100};audio.ontimeupdate=()=>{const r=$('#playerSeek');if(r&&audio.duration)r.value=audio.currentTime/audio.duration*100};audio.onended=()=>{const current=state.tracks.findIndex(x=>x.id===state.player.trackId);if(current>=0&&current<state.tracks.length-1)playTrack(state.tracks[current+1].id);else if(state.settings.loop&&state.tracks.length)playTrack(state.tracks[0].id);else state.player.isPlaying=false}}
function stepTrack(dir){const idx=state.tracks.findIndex(t=>t.id===state.player.trackId),next=state.tracks[idx+dir];if(next)playTrack(next.id)}$('#playerFab').onclick=()=>{const t=state.tracks.find(t=>t.id===state.player.trackId)||state.tracks[0];showPlayer(t)};
function editTheme(t){if(!t){const name=prompt('新主题名称','我的月光主题');if(!name?.trim())return;t={id:uid('theme'),name:name.trim(),type:'reading',css:':root {\n  --paper: #fbf8f1;\n  --ink: #26394e;\n  --lav: #b19ad9;\n}\n.story-header { text-align: center; }',active:false};state.themes.push(t);persist('主题草稿已创建')}render();setTimeout(()=>{if(t)$('#themeSelect').value=t.id;$('#themeName').value=t.name;$('#themeCSS').value=t.css},0)}function previewCSS(){const css=$('#themeCSS')?.value;if(css===undefined)return;let style=$('#previewThemeStyle');if(!style){style=document.createElement('style');style.id='previewThemeStyle';document.head.append(style)}style.textContent=css;ensureModalProtectionStyles();protectOpenModalControls();toast('已应用到当前预览（尚未覆盖正式主题）')}function validateCSS(){const css=$('#themeCSS')?.value||'';let n=0;for(const c of css){if(c==='{')n++;if(c==='}')n--;if(n<0)break}if(n!==0||/javascript\s*:/i.test(css)){toast('检查到括号不匹配或可疑内容，请检查 CSS。');return}toast('基础检查通过；复杂 CSS 冲突仍需更完整的解析器。')}function saveTheme(){const id=$('#themeSelect')?.value,t=state.themes.find(t=>t.id===id);if(!t)return;t.name=$('#themeName').value.trim()||t.name;t.css=$('#themeCSS').value;state.themes.forEach(x=>x.active=x.id===id);state.activeThemeId=id;const themeSaved=writeActiveThemeSnapshot(t);const stateSaved=persist(null);applyActiveTheme(t);render();toast(themeSaved||stateSaved?'主题已保存并应用，重新进入也会保留。':'主题已应用到当前页面，但浏览器存储失败；请检查存储空间。')}
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
bindActionButtons();getActiveTheme();installModalControlProtection();render();applyActiveTheme();void initializePersistentAudio();
