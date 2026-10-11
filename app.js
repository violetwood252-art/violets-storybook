const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const KEY='violets-storybook-v1';
// Keep the currently applied theme in its own storage slot. This lets the theme
// survive a reload even if the main collection data is too large to save.
const ACTIVE_THEME_KEY='violets-storybook-active-theme-v1';
const seed={settings:{layout:'cover',autoPlay:false,loop:true,preview:'manual',fontSize:17,lineHeight:1.95,bodyFont:'Georgia',signature:'Violet196'},series:[{id:'ser-hogwarts',name:'霍格沃茨日常',themeId:''},{id:'ser-finn',name:'小狐狸的故事',themeId:''}],characters:[{id:'char-fin',name:'芬利·奥格尔维',description:'格拉斯哥的小狐狸',storyIds:[]}],stories:[{id:'story-welcome',title:'欢迎来到 Violet 的故事宇宙',seriesId:'ser-hogwarts',characterIds:['char-fin'],summary:'这是你的私人故事收藏馆。你可以导入自己的番外、整理角色与系列，并为每个故事安排专属配乐。',tags:['收藏馆指南','示例'],raw:'欢迎来到 Violet\'s Storybook！\n\n这里是一个本地原型示例。你可以通过右上角的 + 导入自己的番外。\n\n**提示：** 当前版本是功能原型，不是已编译的 Android APK。',body:'欢迎来到 Violet\'s Storybook！\n\n这里是一个本地原型示例。你可以通过右上角的 + 导入自己的番外。\n\n**提示：** 当前版本是功能原型，不是已编译的 Android APK。',createdAt:Date.now(),updatedAt:Date.now(),readProgress:0,cover:'',history:[],music:{mode:'fixed',playlistId:'',trackIds:[],loop:'list',disabled:false}}],tracks:[],playlists:[{id:'pl-rain',name:'雨夜氛围',description:'适合雨夜、独处与未寄出的信',trackIds:[]},{id:'pl-letters',name:'未寄出的信',description:'温柔、遗憾与克制的思念',trackIds:[]},{id:'pl-hogwarts',name:'霍格沃茨日常',description:'学院、魔法与古典氛围',trackIds:[]}],themes:[{id:'theme-default',name:'月光纸页',type:'combined',css:':root {\n  --paper: #fbf8f1;\n  --ink: #26394e;\n  --gold: #c6a45c;\n  --lav: #b19ad9;\n}\n.story-title { font-family: Georgia, serif; }\n.story-header { text-align: center; }',active:true}],activePage:'home',activeStoryId:'story-welcome',player:{trackId:'',playlistId:'',storyId:'',isPlaying:false,position:0}};
let state;try{state=JSON.parse(localStorage.getItem(KEY))||structuredClone(seed)}catch{state=structuredClone(seed)}
if(!state||typeof state!=='object')state=structuredClone(seed);
state.settings={...seed.settings,...(state.settings||{})};
for(const story of (Array.isArray(state.stories)?state.stories:[])){
  if(typeof story.summary!=='string'||!story.summary.trim()){
    const oldSummary=[story.description,story.intro,story.synopsis,story.blurb,story.excerpt].find(value=>typeof value==='string'&&value.trim());
    if(oldSummary)story.summary=oldSummary.trim();
  }
  if(!Array.isArray(story.tags))story.tags=typeof story.tags==='string'?story.tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean):[];
  if(typeof story.coverMediaId!=='string')story.coverMediaId='';
}
let currentPage='home',readerId=null,editingId=null,selectedFileText='',selectedAudioUrl='',audioObjectUrl='',audio=new Audio(),dragTrackId=null,toastTimer,readerProgressTimer=null;
const MEDIA_DB_NAME='violets-storybook-media-v1';
const MEDIA_STORE_NAME='audio-files';
const COVER_STORE_NAME='cover-files';
let mediaDbPromise=null;
const localTrackUrls=new Map();
const localCoverUrls=new Map();
const coverPreviewUrls=new WeakMap();
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
  try{request=window.indexedDB.open(MEDIA_DB_NAME,2)}
  catch(error){return Promise.reject(error)}
  mediaDbPromise=new Promise((resolve,reject)=>{
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(MEDIA_STORE_NAME))db.createObjectStore(MEDIA_STORE_NAME,{keyPath:'id'});
      if(!db.objectStoreNames.contains(COVER_STORE_NAME))db.createObjectStore(COVER_STORE_NAME,{keyPath:'id'});
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
function saveCoverRecord(id,file){
  return openMediaDB().then(db=>new Promise((resolve,reject)=>{
    let tx;
    try{
      tx=db.transaction(COVER_STORE_NAME,'readwrite');
      tx.objectStore(COVER_STORE_NAME).put({
        id,
        blob:file.slice(0,file.size,file.type||'image/jpeg'),
        name:file.name||'cover-image',
        type:file.type||'application/octet-stream',
        size:file.size||0,
        lastModified:file.lastModified||Date.now(),
        savedAt:Date.now()
      });
    }catch(error){reject(error);return}
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error||new Error('本地封面写入失败。'));
    tx.onabort=()=>reject(tx.error||new Error('本地封面写入被中止。'));
  }));
}
function getCoverRecord(id){
  return openMediaDB().then(db=>new Promise((resolve,reject)=>{
    let request;
    try{request=db.transaction(COVER_STORE_NAME,'readonly').objectStore(COVER_STORE_NAME).get(id)}
    catch(error){reject(error);return}
    request.onsuccess=()=>resolve(request.result||null);
    request.onerror=()=>reject(request.error||new Error('读取本地封面失败。'));
  }));
}
function deleteCoverRecord(id){
  if(!id)return Promise.resolve(false);
  const cached=localCoverUrls.get(id);
  if(cached){URL.revokeObjectURL(cached);localCoverUrls.delete(id)}
  return openMediaDB().then(db=>new Promise((resolve,reject)=>{
    let tx;
    try{tx=db.transaction(COVER_STORE_NAME,'readwrite');tx.objectStore(COVER_STORE_NAME).delete(id)}
    catch(error){reject(error);return}
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error||new Error('删除本地封面失败。'));
    tx.onabort=()=>reject(tx.error||new Error('删除本地封面被中止。'));
  }));
}
function clearCoverRecords(){
  localCoverUrls.forEach(url=>URL.revokeObjectURL(url));localCoverUrls.clear();
  return openMediaDB().then(db=>new Promise((resolve,reject)=>{
    let tx;
    try{tx=db.transaction(COVER_STORE_NAME,'readwrite');tx.objectStore(COVER_STORE_NAME).clear()}
    catch(error){reject(error);return}
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error||new Error('清理本地封面失败。'));
    tx.onabort=()=>reject(tx.error||new Error('清理本地封面被中止。'));
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
    tx.onabort=()=>reject(tx.error||new Error('清理本地音频被中止。'));
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
  // A saved/applied theme replaces the temporary editor preview.
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
    dialog.modal:not([open]){display:none!important;visibility:hidden!important;pointer-events:none!important;}
    dialog.modal::before,dialog.modal::after,
    dialog.modal .modal-head::before,dialog.modal .modal-head::after,
    dialog.modal .modal-actions::before,dialog.modal .modal-actions::after{pointer-events:none!important;}
    dialog.modal .modal-head,dialog.modal .modal-actions{
      position:relative!important;z-index:2147483647!important;pointer-events:auto!important;
      visibility:visible!important;opacity:1!important;overflow:visible!important;
    }
    dialog.modal .modal-head button.icon-btn,
    dialog.modal form[method="dialog"] button[value="cancel"],
    dialog.modal .modal-actions button[value="cancel"],
    dialog.modal button#closeReader,dialog.modal button#readerDone,
    dialog.modal button#closeSource,dialog.modal button[data-close-dialog],
    dialog.modal button[data-dialog-close]{
      display:inline-flex!important;visibility:visible!important;opacity:1!important;
      pointer-events:auto!important;position:relative!important;z-index:2147483647!important;
      transform:none!important;clip:auto!important;clip-path:none!important;
      min-width:38px!important;min-height:38px!important;flex-shrink:0!important;
      cursor:pointer!important;touch-action:manipulation!important;
    }
    .story-card .cover{position:relative!important;overflow:hidden!important;isolation:isolate!important;}
    .story-card .cover .story-cover-photo{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important;z-index:0!important;pointer-events:none!important;}
    .story-card .cover .cover-number{position:relative!important;z-index:2!important;}
    .cover-editor-preview{display:block;max-width:100%;max-height:180px;object-fit:contain;border-radius:12px;margin-top:8px;}
  `;
  // Always place the protection rules after the active/preview theme styles.
  document.head.appendChild(style);
}
const modalInlineProperties={
  dialog:['pointer-events','visibility','opacity','display','isolation'],
  head:['display','position','z-index','pointer-events','visibility','overflow'],
  form:['display','pointer-events','visibility','opacity'],
  actions:['display','position','z-index','pointer-events','visibility','opacity','overflow'],
  button:['display','visibility','opacity','pointer-events','position','z-index','transform','clip','clip-path','min-width','min-height','flex-shrink','cursor','touch-action']
};
function clearModalProtectionInlineStyles(dialog){
  if(!dialog)return;
  const clear=(el,properties)=>properties.forEach(property=>el.style.removeProperty(property));
  clear(dialog,modalInlineProperties.dialog);
  const head=dialog.querySelector('.modal-head');if(head)clear(head,modalInlineProperties.head);
  const form=dialog.querySelector('form');if(form)clear(form,modalInlineProperties.form);
  const actions=dialog.querySelector('.modal-actions');if(actions)clear(actions,modalInlineProperties.actions);
  const selector='.modal-head button.icon-btn, form[method="dialog"] button[value="cancel"], .modal-actions button[value="cancel"], #closeReader, #readerDone, #closeSource, button[data-close-dialog], button[data-dialog-close]';
  dialog.querySelectorAll(selector).forEach(button=>clear(button,modalInlineProperties.button));
}
function protectOpenModalControls(dialog){
  const dialogs=dialog?[dialog]:document.querySelectorAll('dialog.modal[open]');
  const setImportant=(element,property,value)=>element.style.setProperty(property,value,'important');
  for(const dlg of dialogs){
    if(!(dlg instanceof HTMLDialogElement)||!dlg.open)continue;
    ['pointer-events','visibility','opacity','display','isolation'].forEach((property,index)=>setImportant(dlg,property,['auto','visible','1','block','isolate'][index]));
    const head=dlg.querySelector('.modal-head');
    if(head){setImportant(head,'display','flex');setImportant(head,'position','relative');setImportant(head,'z-index','2147483647');setImportant(head,'pointer-events','auto');setImportant(head,'visibility','visible');setImportant(head,'overflow','visible');}
    const form=dlg.querySelector('form');
    if(form){setImportant(form,'display','block');setImportant(form,'pointer-events','auto');setImportant(form,'visibility','visible');setImportant(form,'opacity','1');}
    const actions=dlg.querySelector('.modal-actions');
    if(actions){setImportant(actions,'display','flex');setImportant(actions,'position','relative');setImportant(actions,'z-index','2147483647');setImportant(actions,'pointer-events','auto');setImportant(actions,'visibility','visible');setImportant(actions,'opacity','1');setImportant(actions,'overflow','visible');}
    const selector='.modal-head button.icon-btn, form[method="dialog"] button[value="cancel"], .modal-actions button[value="cancel"], #closeReader, #readerDone, #closeSource, button[data-close-dialog], button[data-dialog-close]';
    dlg.querySelectorAll(selector).forEach(button=>{
      setImportant(button,'display','inline-flex');setImportant(button,'visibility','visible');setImportant(button,'opacity','1');
      setImportant(button,'pointer-events','auto');setImportant(button,'position','relative');setImportant(button,'z-index','2147483647');
      setImportant(button,'transform','none');setImportant(button,'clip','auto');setImportant(button,'clip-path','none');
      setImportant(button,'min-width','38px');setImportant(button,'min-height','38px');setImportant(button,'flex-shrink','0');
      setImportant(button,'cursor','pointer');setImportant(button,'touch-action','manipulation');
    });
  }
  ensureModalProtectionStyles();
}
function installModalControlProtection(){
  ensureModalProtectionStyles();
  if(typeof HTMLDialogElement==='undefined')return;
  if(!HTMLDialogElement.prototype.showModal.__violetModalProtection){
    const nativeShowModal=HTMLDialogElement.prototype.showModal;
    const wrappedShowModal=function(...args){
      const result=nativeShowModal.apply(this,args);
      ensureModalProtectionStyles();protectOpenModalControls(this);
      return result;
    };
    wrappedShowModal.__violetModalProtection=true;
    HTMLDialogElement.prototype.showModal=wrappedShowModal;
  }
  if(!HTMLDialogElement.prototype.close.__violetModalProtection){
    const nativeClose=HTMLDialogElement.prototype.close;
    const wrappedClose=function(...args){
      const result=nativeClose.apply(this,args);
      clearModalProtectionInlineStyles(this);
      ensureModalProtectionStyles();
      return result;
    };
    wrappedClose.__violetModalProtection=true;
    HTMLDialogElement.prototype.close=wrappedClose;
  }
  // Native Escape and form method="dialog" closes do not necessarily call the JS wrapper.
  document.addEventListener('close',event=>{
    if(event.target instanceof HTMLDialogElement){clearModalProtectionInlineStyles(event.target);ensureModalProtectionStyles();}
  },true);
  const observer=new MutationObserver(records=>{
    for(const record of records){
      const dialog=record.target;
      if(dialog instanceof HTMLDialogElement&&!dialog.open)clearModalProtectionInlineStyles(dialog);
    }
  });
  document.querySelectorAll('dialog.modal').forEach(dialog=>observer.observe(dialog,{attributes:true,attributeFilter:['open']}));
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
function storySummary(story){
  const candidates=[story?.summary,story?.description,story?.intro,story?.synopsis,story?.blurb,story?.excerpt];
  const value=candidates.find(item=>typeof item==='string'&&item.trim());
  return value?value.trim():'';
}
function safeCoverUrl(value){
  const url=String(value||'').trim();
  if(/^https?:\/\//i.test(url))return url;
  if(/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(url))return url;
  return '';
}
async function resolveCoverSource(story){
  if(story?.coverMediaId){
    const id=String(story.coverMediaId);
    if(localCoverUrls.has(id))return localCoverUrls.get(id);
    try{
      const record=await getCoverRecord(id);
      if(record?.blob){const url=URL.createObjectURL(record.blob);localCoverUrls.set(id,url);return url;}
    }catch(error){console.warn('加载本地封面失败：',error)}
  }
  return safeCoverUrl(story?.cover);
}
function ensureCoverCardStyles(){ensureModalProtectionStyles()}
async function hydrateStoryCovers(root=document){
  ensureCoverCardStyles();
  const elements=[...root.querySelectorAll('.cover[data-cover-story-id]')];
  await Promise.all(elements.map(async element=>{
    const story=state.stories.find(item=>item.id===element.dataset.coverStoryId);
    if(!story)return;
    const source=await resolveCoverSource(story);
    if(!source||!element.isConnected)return;
    let img=element.querySelector('.story-cover-photo');
    if(!img){img=document.createElement('img');img.className='story-cover-photo';img.alt='';img.loading='lazy';img.decoding='async';element.insertBefore(img,element.firstChild)}
    if(img.src!==source)img.src=source;
    img.onerror=()=>{img.remove();toast('封面暂时无法加载，请检查图片网址或本地封面是否仍存在。')};
  }));
}
function card(story){
  const n=String(storyNo(story)).padStart(2,'0');
  const summary=storySummary(story)||'尚未添加简介。打开故事，开始阅读。';
  return `<article class="story-card ${state.settings.layout==='text'?'text-card':''}"><div class="cover" data-cover-story-id="${esc(story.id)}"><span class="cover-number">${esc(seriesName(story.seriesId))} · ${n}</span></div><div class="story-info"><div class="series">${esc(seriesName(story.seriesId))} · 第 ${storyNo(story)} 章</div><h3>${esc(story.title)}</h3><p class="summary">${esc(summary)}</p>${tagsHTML(story.tags||[])}<div class="card-footer"><div style="flex:1"><span class="muted">阅读进度 ${story.readProgress||0}%</span><div class="progress"><span style="width:${story.readProgress||0}%"></span></div></div><div class="small-actions"><button data-action="read" data-id="${esc(story.id)}" title="阅读">阅读 ↗</button><button data-action="edit" data-id="${esc(story.id)}" title="编辑">编辑</button><button data-action="music" data-id="${esc(story.id)}" title="配乐">♫</button><button data-action="delete-story" data-id="${esc(story.id)}" title="删除番外" aria-label="删除番外">删除</button></div></div></div></article>`;
}
function headerSection(title,sub,action=''){return `<div class="section-head"><div><h2>${title}</h2><p>${sub}</p></div>${action}</div>`}
function render(){const content=$('#pageContent');$('#pageTitle').textContent=titles[currentPage]||titles.home;$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===currentPage));if(currentPage==='home')content.innerHTML=renderHome();if(currentPage==='stories')content.innerHTML=renderStories();if(currentPage==='characters')content.innerHTML=renderCharacters();if(currentPage==='series')content.innerHTML=renderSeries();if(currentPage==='music')content.innerHTML=renderMusic();if(currentPage==='themes')content.innerHTML=renderThemes();if(currentPage==='settings')content.innerHTML=renderSettings();bindContent();bindActionButtons(content);void hydrateStoryCovers(content)}
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
function action(name,id,button){const st=state.stories.find(s=>s.id===id);if(name==='new-story')openStory();if(name==='goto-stories')go('stories');if(name==='goto-music')go('music');if(name==='read'&&st)openReader(st);if(name==='edit'&&st)openEdit(st);if(name==='music'&&st)openAssociation(st);if(name==='delete-story'&&st)void deleteStory(st.id);if(name==='layout-cover'||name==='layout-text'){state.settings.layout=name==='layout-cover'?'cover':'text';persist('卡片布局已保存');render()}if(name==='new-character')editCharacter();if(name==='edit-character')editCharacter(state.characters.find(c=>c.id===id));if(name==='character-stories'){const c=state.characters.find(c=>c.id===id);go('stories');setTimeout(()=>{const inp=$('#storySearch');if(inp){inp.value=c?.name||'';filterStories()}},20)}if(name==='new-series')editSeries();if(name==='edit-series')editSeries(state.series.find(s=>s.id===id));if(name==='move-up-series-story'){const target=state.stories.find(s=>s.id===id);if(target){const list=sortedSeriesStories(target.seriesId),idx=list.findIndex(s=>s.id===id);if(idx>0){const a=list[idx-1],b=list[idx];const temp=a.order??a.createdAt;a.order=b.order??b.createdAt;b.order=temp;persist('系列顺序已保存');render()}else if(idx===0)toast('这已经是本系列的第一篇了')}}if(name==='new-music')$('#musicDialog').showModal();if(name==='new-playlist')editPlaylist();if(name==='open-playlist')editPlaylist(state.playlists.find(p=>p.id===id));if(name==='play-track')playTrack(id);if(name==='delete-track'){if(confirm('删除这首音乐？歌单中的引用也会移除。'))deleteTrackAndMedia(id)}if(name==='add-to-playlist')choosePlaylistForTrack(id);if(name==='new-theme')editTheme();if(name==='edit-theme')editTheme(state.themes.find(t=>t.id===id));if(name==='apply-theme'){const chosen=state.themes.find(t=>t.id===id);if(chosen){state.themes.forEach(t=>t.active=t.id===id);state.activeThemeId=id;const themeSaved=writeActiveThemeSnapshot(chosen);const stateSaved=persist(null);applyActiveTheme(chosen);render();toast(themeSaved||stateSaved?'主题已应用并保存，重新进入也会保留。':'主题已应用到当前页面，但浏览器存储失败；请检查存储空间。')}}if(name==='save-theme')saveTheme();if(name==='preview-css')previewCSS();if(name==='validate-css')validateCSS();if(name==='export-json')exportJSON();if(name==='import-json'){const input=$('#restoreFile');if(input)input.click()}if(name==='export-story')exportStory();if(name==='export-css')exportCSS();if(name==='clear-data')clearData();if(name==='reader-music')openAssociation(st);if(name==='reader-edit'&&st)openEdit(st)}
async function deleteStory(id){
  const story=state.stories.find(item=>item.id===id);if(!story)return;
  if(!confirm(`确定删除番外《${story.title}》吗？此操作无法直接撤销，建议先导出 JSON 备份。`))return;
  const oldStories=state.stories,oldActiveStoryId=state.activeStoryId,oldPlayer=state.player;
  state.stories=state.stories.filter(item=>item.id!==id);
  if(state.activeStoryId===id)state.activeStoryId=state.stories[0]?.id||'';
  if(state.player?.storyId===id)state.player={...state.player,storyId:'',trackId:'',isPlaying:false,position:0};
  if(!persist(null)){state.stories=oldStories;state.activeStoryId=oldActiveStoryId;state.player=oldPlayer;toast('删除未完成：当前收藏尚未保存，请检查设备存储空间。');return;}
  try{localStorage.removeItem(KEY+'-draft-'+id)}catch{}
  if(readerId===id){
    if($('#sourceDialog')?.open)$('#sourceDialog').close();
    if($('#editDialog')?.open)$('#editDialog').close();
    if($('#readerDialog')?.open)$('#readerDialog').close();
    readerId=null;editingId=null;
  }
  if(oldPlayer?.storyId===id){audio.pause();audio.removeAttribute('src');audio.load();}
  if(story.coverMediaId)await deleteSupersededCover(story.coverMediaId,'');
  toast('番外已删除。');render();
}
function go(page){currentPage=page;render();window.scrollTo({top:0,behavior:'smooth'})}
function setCoverPreview(form,source,{temporary=false}={}){
  const old=coverPreviewUrls.get(form);
  if(old?.temporary&&old.url)URL.revokeObjectURL(old.url);
  const image=form.querySelector('.cover-editor-preview');
  const wrap=form.querySelector('.cover-editor-preview-wrap');
  if(!image||!wrap)return;
  if(source){image.src=source;wrap.hidden=false;coverPreviewUrls.set(form,{url:source,temporary})}
  else{image.removeAttribute('src');wrap.hidden=true;coverPreviewUrls.delete(form)}
}
function ensureCoverFields(form,{edit=false}={}){
  if(form.querySelector('.cover-editor-fields'))return;
  const legacyCover=form.querySelector('input[name="cover"]');
  if(legacyCover)legacyCover.closest('label')?.setAttribute('hidden','');
  if(edit&&!form.querySelector('[name="summary"]')){
    const titleField=form.querySelector('[name="title"]')?.closest('label');
    if(titleField){
      const label=document.createElement('label');label.innerHTML='简介（可选）<textarea name="summary" rows="3" placeholder="这篇番外的简短介绍"></textarea>';
      titleField.insertAdjacentElement('afterend',label);
    }
  }
  const host=document.createElement('div');host.className='cover-editor-fields';
  host.innerHTML=`
    <label>封面图片网址（可选）<input type="url" name="coverUrl" placeholder="https://example.com/cover.jpg" autocomplete="off"></label>
    <label>上传本地封面（可选）<input type="file" name="coverFile" accept="image/png,image/jpeg,image/webp,image/gif"></label>
    <div class="cover-editor-preview-wrap" hidden><img class="cover-editor-preview" alt="封面预览"><button type="button" class="pill" data-cover-clear>清除封面</button></div>
    <p class="muted">支持本地图片持久保存，或填写可直接打开的 HTTPS/HTTP 图片地址。优先使用新选择的本地图片。</p>`;
  const actions=form.querySelector('.modal-actions');
  if(actions)form.insertBefore(host,actions);else form.append(host);
  const urlInput=host.querySelector('[name="coverUrl"]');
  const fileInput=host.querySelector('[name="coverFile"]');
  urlInput.addEventListener('input',()=>{
    form.dataset.coverCleared='false';
    if(fileInput.files?.[0])return;
    const url=safeCoverUrl(urlInput.value);
    setCoverPreview(form,url);
  });
  fileInput.addEventListener('change',()=>{
    form.dataset.coverCleared='false';
    const file=fileInput.files?.[0];
    if(!file){setCoverPreview(form,safeCoverUrl(urlInput.value));return}
    if(!/^image\/(?:png|jpe?g|webp|gif)$/i.test(file.type)){
      fileInput.value='';toast('封面仅支持 PNG、JPG、WEBP 或 GIF 图片。');return;
    }
    if(file.size>15*1024*1024){fileInput.value='';toast('封面图片不能超过 15 MB，请选择较小的图片。');return;}
    setCoverPreview(form,URL.createObjectURL(file),{temporary:true});
  });
  host.querySelector('[data-cover-clear]').addEventListener('click',()=>{
    urlInput.value='';fileInput.value='';form.dataset.coverCleared='true';setCoverPreview(form,'');
  });
  form.dataset.coverCleared='false';
}
async function loadCoverIntoForm(form,story){
  ensureCoverFields(form,{edit:form.id==='editForm'});
  const urlInput=form.querySelector('[name="coverUrl"]');
  const fileInput=form.querySelector('[name="coverFile"]');
  if
