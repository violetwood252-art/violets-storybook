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
const COVER_STORE_NAME='cover-files';
let mediaDbPromise=null;
const localTrackUrls=new Map();
const localCoverUrls=new Map();
let pendingCoverStoryId=null;
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

// Local audio bytes and cover images live in IndexedDB. localStorage keeps metadata.
function openMediaDB(){
  if(mediaDbPromise)return mediaDbPromise;
  if(!window.indexedDB)return Promise.reject(new Error('当前运行环境不支持 IndexedDB，无法持久保存本地媒体。'));
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
    request.onerror=()=>{const error=request.error||new Error('无法打开本地媒体数据库。');mediaDbPromise=null;reject(error)};
    request.onblocked=()=>console.warn('本地媒体数据库升级被其他页面阻塞，请关闭其他收藏馆页面后重试。');
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
function saveCoverRecord(id,file){
  return openMediaDB().then(db=>new Promise((resolve,reject)=>{
    let tx;
    try{
      tx=db.transaction(COVER_STORE_NAME,'readwrite');
      tx.objectStore(COVER_STORE_NAME).put({
        id,
        blob:file.slice(0,file.size,file.type||'image/jpeg'),
        name:file.name||'cover',
        type:file.type||'image/jpeg',
        size:file.size||0,
        savedAt:Date.now()
      });
    }catch(error){reject(error);return}
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error||new Error('封面图片保存失败。'));
    tx.onabort=()=>reject(tx.error||new Error('封面图片保存被中止。'));
  }));
}
function getCoverRecord(id){
  return openMediaDB().then(db=>new Promise((resolve,reject)=>{
    let request;
    try{request=db.transaction(COVER_STORE_NAME,'readonly').objectStore(COVER_STORE_NAME).get(id)}
    catch(error){reject(error);return}
    request.onsuccess=()=>resolve(request.result||null);
    request.onerror=()=>reject(request.error||new Error('读取封面图片失败。'));
  }));
}
function getCoverRecordKeys(){
  return openMediaDB().then(db=>new Promise((resolve,reject)=>{
    let request;
    try{request=db.transaction(COVER_STORE_NAME,'readonly').objectStore(COVER_STORE_NAME).getAllKeys()}
    catch(error){reject(error);return}
    request.onsuccess=()=>resolve(request.result||[]);
    request.onerror=()=>reject(request.error||new Error('读取封面列表失败。'));
  }));
}
function deleteCoverRecord(id){
  return openMediaDB().then(db=>new Promise((resolve,reject)=>{
    let tx;
    try{tx=db.transaction(COVER_STORE_NAME,'readwrite');tx.objectStore(COVER_STORE_NAME).delete(id)}
    catch(error){reject(error);return}
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>reject(tx.error||new Error('删除封面图片失败。'));
    tx.onabort=()=>reject(tx.error||new Error('删除封面图片被中止。'));
  }));
}
async function pruneCoverRecords(keepIds=[]){
  const keep=new Set(keepIds);
  const keys=await getCoverRecordKeys();
  const obsolete=keys.filter(id=>!keep.has(id));
  if(!obsolete.length)return;
  const db=await openMediaDB();
  await new Promise((resolve,reject)=>{
    let tx;
    try{
      tx=db.transaction(COVER_STORE_NAME,'readwrite');
      const store=tx.objectStore(COVER_STORE_NAME);
      obsolete.forEach(id=>store.delete(id));
    }catch(error){reject(error);return}
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error||new Error('清理旧封面失败。'));
    tx.onabort=()=>reject(tx.error||new Error('清理旧封面被中止。'));
  });
}
function revokeCoverUrl(id){
  const url=localCoverUrls.get(id);
  if(url){URL.revokeObjectURL(url);localCoverUrls.delete(id)}
}
async function initializePersistentCovers(shouldRender=true){
  let changed=false;
  const keepIds=new Set((state.stories||[]).map(story=>story.coverMediaId).filter(Boolean));
  for(const [id,url] of [...localCoverUrls.entries()]){
    if(!keepIds.has(id)){URL.revokeObjectURL(url);localCoverUrls.delete(id)}
  }
  for(const id of keepIds){
    if(localCoverUrls.has(id))continue;
    try{
      const record=await getCoverRecord(id);
      if(record?.blob)localCoverUrls.set(id,URL.createObjectURL(record.blob));
      else console.warn('找不到已保存的封面媒体：',id);
    }catch(error){console.warn('读取封面媒体失败：',error)}
  }
  // Migrate legacy cover values that were short-lived blob URLs; don't show a broken image.
  for(const story of state.stories||[]){
    if(typeof story.cover==='string'&&story.cover.startsWith('blob:')&&!story.coverMediaId){
      story.cover='';changed=true;
    }
    if(story.summary==null||String(story.summary).trim()===''){
      const fallback=story.description??story.synopsis??story.intro??story.blurb??'';
      if(String(fallback).trim()){story.summary=String(fallback);changed=true}
    }
  }
  if(changed)persist(null);
  if(shouldRender&&['home','stories'].includes(currentPage))render();
}
async function setStoryCover(story,file){
  if(!story||!file)return;
  if(!/^image\/(?:png|jpeg|jpg|gif|webp|avif)$/.test(file.type||'')){
    toast('请选取 PNG、JPEG、GIF、WebP 或 AVIF 图片。');
    return;
  }
  if(file.size>15*1024*1024){
    toast('封面图片不能超过 15 MiB，请先压缩后再上传。');
    return;
  }
  const newId=uid('cover');
  const oldId=story.coverMediaId||'';
  const oldCover=story.cover||'';
  const oldSummary=story.summary;
  const oldUpdated=story.updatedAt;
  try{
    await saveCoverRecord(newId,file);
    story.coverMediaId=newId;
    story.cover='';
    story.updatedAt=Date.now();
    if(!persist(null)){
      story.coverMediaId=oldId;
      story.cover=oldCover;
      story.summary=oldSummary;
      story.updatedAt=oldUpdated;
      await deleteCoverRecord(newId).catch(()=>{});
      return;
    }
    localCoverUrls.set(newId,URL.createObjectURL(file));
    if(oldId&&!state.stories.some(item=>item.id!==story.id&&item.coverMediaId===oldId)){
      revokeCoverUrl(oldId);
      try{await deleteCoverRecord(oldId)}catch(error){console.warn('旧封面已替换，但清理旧文件失败：',error)}
    }
    render();
    toast('番外封面已保存到本机，重新进入收藏馆也会保留。');
  }catch(error){
    console.error('封面保存失败：',error);
    story.coverMediaId=oldId;
    story.cover=oldCover;
    story.summary=oldSummary;
    story.updatedAt=oldUpdated;
    await deleteCoverRecord(newId).catch(()=>{});
    toast('封面保存失败，请检查浏览器存储空间后重试。');
  }
}
function installCoverPicker(){
  let input=document.getElementById('storyCoverPicker');
  if(input)return input;
  input=document.createElement('input');
  input.type='file';
  input.id='storyCoverPicker';
  input.accept='image/png,image/jpeg,image/gif,image/webp,image/avif';
  input.hidden=true;
  input.addEventListener('change',async event=>{
    const file=event.target.files?.[0];
    const story=state.stories.find(item=>item.id===pendingCoverStoryId);
    pendingCoverStoryId=null;
    if(file&&story)await setStoryCover(story,file);
    input.value='';
  });
  document.body.appendChild(input);
  return input;
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
    ||state.themes?.find(t=>t.active)
    ||state.themes?.[0]
    ||null;
  if(theme&&state.activeThemeId!==theme.id)state.activeThemeId=theme.id;
  return theme;
}
function installModalProtection(){
  let style=document.getElementById('modalProtectionStyle');
  if(!style){style=document.createElement('style');style.id='modalProtectionStyle';}
  style.textContent=`
    dialog.modal:not([open]),dialog.reader-modal:not([open]){display:none!important;visibility:hidden!important;pointer-events:none!important}
    dialog.modal[open],dialog.reader-modal[open]{pointer-events:auto!important}
    dialog.modal[open]::before,dialog.modal[open]::after,dialog.modal[open] .modal-head::before,dialog.modal[open] .modal-head::after,dialog.modal[open] .modal-actions::before,dialog.modal[open] .modal-actions::after{pointer-events:none!important}
    dialog.modal[open] .modal-head,dialog.modal[open] .modal-actions{position:relative!important;z-index:2147483000!important;pointer-events:auto!important;visibility:visible!important;opacity:1!important}
    dialog.modal[open] .modal-head button.icon-btn,dialog.modal[open] form[method="dialog"] button[value="cancel"],dialog.modal[open] button[value="cancel"],dialog.modal[open] #closeReader,dialog.modal[open] #readerDone,dialog.modal[open] #closeSource,dialog.modal[open] button[data-close-dialog],dialog.modal[open] button[data-dialog-close]{display:inline-flex!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;position:relative!important;z-index:2147483001!important;transform:none!important;clip:auto!important;clip-path:none!important;min-width:38px!important;min-height:38px!important;flex-shrink:0!important;cursor:pointer!important;touch-action:manipulation!important}
  `;
  document.head.appendChild(style);
}
function installModalDismissHandling(){
  if(document.documentElement.dataset.modalDismissHandler==='installed')return;
  document.documentElement.dataset.modalDismissHandler='installed';
  document.addEventListener('click',function(event){
    const target=event.target instanceof Element?event.target:null;
    if(!target)return;
    const closeButton=target.closest('dialog.modal[open] .modal-head button.icon-btn,dialog.modal[open] form[method="dialog"] button[value="cancel"],dialog.modal[open] button[value="cancel"],dialog.modal[open] #closeReader,dialog.modal[open] #readerDone,dialog.modal[open] #closeSource,dialog.modal[open] button[data-close-dialog],dialog.modal[open] button[data-dialog-close]');
    if(!closeButton)return;
    const dialog=closeButton.closest('dialog.modal[open]');
    if(!dialog)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    dialog.close('cancel');
  },true);
  document.addEventListener('close',event=>{
    const dialog=event.target;
    if(dialog instanceof HTMLDialogElement&&dialog.classList.contains('modal'))dialog.style.removeProperty('display');
  },true);
}
function uid(prefix='id'){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7)}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(s){const el=$('#toast');el.textContent=s;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2400)}
function dateLabel(t){return new Date(t||Date.now()).toLocaleDateString('zh-CN',{year:'numeric',month:'short',day:'numeric'})}
function seriesName(id){return state.series.find(s=>s.id===id)?.name||'未分类'}
function storyOrderValue(story){const order=story?.order;return order!==undefined&&order!==null&&Number.isFinite(Number(order))?Number(order):(Number(story?.createdAt)||0)}
function sortedSeriesStories(seriesId){return state.stories.filter(s=>s.seriesId===seriesId).slice().sort((a,b)=>storyOrderValue(a)-storyOrderValue(b))}
function storyNo(story){const list=sortedSeriesStories(story.seriesId);return Math.max(1,list.findIndex(s=>s.id===story.id)+1)}
function storySummary(story){const candidates=[story?.summary,story?.description,story?.synopsis,story?.intro,story?.blurb];return String(candidates.find(value=>typeof value==='string'&&value.trim())||'').trim()}
function storyCoverUrl(story){if(story?.coverMediaId&&localCoverUrls.has(story.coverMediaId))return localCoverUrls.get(story.coverMediaId);const cover=typeof story?.cover==='string'?story.cover:'';return /^https?:\/\//i.test(cover)||/^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i.test(cover)?cover:''}
function tagsHTML(tags=[]){return `<div class="tags">${tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`}
function card(story){const n=String(storyNo(story)).padStart(2,'0'),coverUrl=storyCoverUrl(story),summary=storySummary(story);return `<article class="story-card ${state.settings.layout==='text'?'text-card':''}"><div class="cover" ${coverUrl?`style="background-image:url('${esc(coverUrl)}');background-size:cover;background-position:center"`:''}><span class="cover-number">${esc(seriesName(story.seriesId))} · ${n}</span></div><div class="story-info"><div class="series">${esc(seriesName(story.seriesId))} · 第 ${storyNo(story)} 章</div><h3>${esc(story.title)}</h3><p class="summary">${esc(summary||'尚未添加简介。打开故事，开始阅读。')}</p>${tagsHTML(story.tags||[])}<div class="card-footer"><div style="flex:1"><span class="muted">阅读进度 ${story.readProgress||0}%</span><div class="progress"><span style="width:${story.readProgress||0}%"></span></div></div><div class="small-actions"><button data-action="read" data-id="${story.id}" title="阅读">阅读 ↗</button><button data-action="edit" data-id="${story.id}" title="编辑">编辑</button><button data-action="change-cover" data-id="${story.id}" title="更换封面">封面</button><button data-action="music" data-id="${story.id}" title="配乐">♫</button></div></div></div></article>`}
function headerSection(title,sub,action=''){return `<div class="section-head"><div><h2>${title}</h2><p>${sub}</p></div>${action}`}
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
function filterStories(){const q=($('#storySearch')?.value||'').toLowerCase(),sid=$('#seriesFilter')?.value||'',sort=$('#sortStories')?.value||'recent';let arr=state.stories.filter(s=>{if(sid&&s.seriesId!==sid)return false;const characterNames=state.characters.filter(c=>(s.characterIds||[]).includes(c.id)).map(c=>c.name);const haystack=[s.title,storySummary(s),s.raw,s.body,seriesName(s.seriesId),...(s.tags||[]),...characterNames].join(' ').toLowerCase();return haystack.includes(q)});if(sort==='title')arr.sort((a,b)=>(a.title||'').localeCompare(b.title||''));else if(sort==='series')arr.sort((a,b)=>(a.seriesId||'').localeCompare(b.seriesId||'')||storyNo(a)-storyNo(b));else arr.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));$('#storyGrid').innerHTML=arr.map(card).join('')||'<div class="empty"><strong>没有找到匹配的故事</strong>试试其他关键词或系列。</div>';bindActionButtons($('#storyGrid'))}
function bindActionButtons(root=document){root.querySelectorAll('[data-action]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',()=>action(b.dataset.action,b.dataset.id,b))})}
function action(name,id,button){const st=state.stories.find(s=>s.id===id);if(name==='change-cover'&&st){pendingCoverStoryId=st.id;const picker=installCoverPicker();picker.value='';picker.click()}if(name==='new-story')openStory();if(name==='goto-stories')go('stories');if(name==='goto-music')go('music');if(name==='read'&&st)openReader(st);if(name==='edit'&&st)openEdit(st);if(name==='music'&&st)openAssociation(st);if(name==='layout-cover'||name==='layout-text'){state.settings.layout=name==='layout-cover'?'cover':'text';persist('卡片布局已保存');render()}if(name==='new-character')editCharacter();if(name==='edit-character')editCharacter(state.characters.find(c=>c.id===id));if(name==='character-stories'){const c=state.characters.find(c=>c.id===id);go('stories');setTimeout(()=>{const inp=$('#storySearch');if(inp){inp.value=c?.name||'';filterStories()}},20)}if(name==='new-series')editSeries();if(name==='edit-series')editSeries(state.series.find(s=>s.id===id));if(name==='move-up-series-story'){const target=state.stories.find(s=>s.id===id);if(target){const list=sortedSeriesStories(target.seriesId),idx=list.findIndex(s=>s.id===id);if(idx>0){const a=list[idx-1],b=list[idx];const temp=a.order??a.createdAt;a.order=b.order??b.createdAt;b.order=temp;persist('系列顺序已保存');render()}else if(idx===0)toast('这已经是本系列的第一篇了')}}if(name==='new-music')$('#musicDialog').showModal();if(name==='new-playlist')editPlaylist();if(name==='open-playlist')editPlaylist(state.playlists.find(p=>p.id===id));if(name==='play-track')playTrack(id);if(name==='delete-track'){if(confirm('删除这首音乐？歌单中的引用也会移除。'))deleteTrackAndMedia(id)}if(name==='add-to-playlist')choosePlaylistForTrack(id);if(name==='new-theme')editTheme();if(name==='edit-theme')editTheme(state.themes.find(t=>t.id===id));if(name==='apply-theme'){const chosen=state.themes.find(t=>t.id===id);if(chosen){state.themes.forEach(t=>t.active=t.id===id);state.activeThemeId=id;const themeSaved=writeActiveThemeSnapshot(chosen);const stateSaved=persist(null);applyActiveTheme(chosen);render();toast(themeSaved||stateSaved?'主题已应用并保存，重新进入也会保留。':'主题已应用到当前页面，但浏览器存储失败；请检查存储空间。')}}if(name==='save-theme')saveTheme();if(name==='preview-css')previewCSS();if(name==='validate-css')validateCSS();if(name==='export-json')exportJSON();if(name==='import-json'){const input=$('#restoreFile');if(input)input.click()}if(name==='export-story')exportStory();if(name==='export-css')exportCSS();if(name==='clear-data')clearData();if(name==='reader-music')openAssociation(st);if(name==='reader-edit'&&st)openEdit(st)}
function go(page){currentPage=page;render();window.scrollTo({top:0,behavior:'smooth'})}
function openStory(){selectedFileText='';$('#storyForm').reset();$('#storySeries').innerHTML='<option value="">未分类</option>'+state.series.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');$('#pastePane').hidden=false;$('#filePane').hidden=true;$$('[data-import-tab]').forEach(b=>b.classList.toggle('active',b.dataset.importTab==='paste'));$('#storyDialog').showModal()}
$$('[data-import-tab]').forEach(b=>b.addEventListener('click',()=>{const file=b.dataset.importTab==='file';$('#pastePane').hidden=file;$('#filePane').hidden=!file;$$('[data-import-tab]').forEach(x=>x.classList.toggle('active',x===b))}));$('#storyFile').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;selectedFileText=await f.text();$('#storyForm').elements.body.value=selectedFileText;toast(`已读取 ${f.name}，保存时保留原始内容。`)});
$('#storyForm').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget;if(!f.reportValidity())return;const fd=new FormData(f),body=String(fd.get('body')||selectedFileText||'');const title=String(fd.get('title')).trim();if(!title){toast('请填写番外标题');return}const st={id:uid('story'),title,seriesId:String(fd.get('seriesId')||''),characterIds:[],summary:String(fd.get('summary')||fd.get('description')||'').trim(),tags:String(fd.get('tags')||'').split(/[,，]/).map(s=>s.trim()).filter(Boolean),raw:selectedFileText||body,body,createdAt:Date.now(),updatedAt:Date.now(),readProgress:0,cover:'',history:[],music:{mode:'fixed',playlistId:'',trackIds:[],loop:'list',disabled:false}};String(fd.get('characters')||'').split(/[,，]/).map(x=>x.trim()).filter(Boolean).forEach(name=>{let c=state.characters.find(c=>c.name===name);if(!c){c={id:uid('char'),name,description:'',storyIds:[]};state.characters.push(c)}st.characterIds.push(c.id)});state.stories.unshift(st);state.activeStoryId=st.id;persist('番外已收藏');$('#storyDialog').close();go('stories')});
function renderMarkdown(text){let s=esc(text);s=s.replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>').replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/^- (.+)$/gm,'<li>$1</li>').replace(/(?:<li>.*?<\/li>\n?)+/gs,m=>'<ul>'+m+'</ul>');return s.split(/\n\s*\n/).map(p=>/^<(h\d|ul|blockquote|pre|table)/.test(p.trim())?p:'<p>'+p.replace(/\n/g,'<br>')+'</p>').join('')}
function safeInlineStyle(value){
  return String(value||'').split(';').map(part=>part.trim()).filter(part=>{
    if(!part)return false;
    const colon=part.indexOf(':');if(colon<1)return false;
    const property=part.slice(0,colon).trim().toLowerCase();
    const val=part.slice(colon+1).trim();
    if(/^(?:position|z-index|pointer-events|behavior|-moz-binding|content|cursor)$/i.test(property))return false;
    if(/(?:expression\s*\(|url\s*\(|@import|javascript:|vbscript:|data:)/i.test(val))return false;
    if(property==='display'&&/^(?:none|contents)$/i.test(val))return false;
    if(property==='opacity'&&Number(val)<0.15)return false;
    return true;
  }).join('; ');
}
function safeHtml(source){
  const doc=new DOMParser().parseFromString(String(source||''),'text/html');
  doc.querySelectorAll('script,iframe,object,embed,form,base,meta[http-equiv],link,style').forEach(n=>n.remove());
  doc.querySelectorAll('*').forEach(el=>{
    [...el.attributes].forEach(a=>{
      const name=a.name.toLowerCase(),value=a.value||'';
      if(name.startsWith('on')){el.removeAttribute(a.name);return;}
      if(name==='style'){
        const clean=safeInlineStyle(value);
        if(clean)el.setAttribute('style',clean);else el.removeAttribute('style');
        return;
      }
      if(['href','src','xlink:href','formaction'].includes(name)){
        const trimmed=value.trim();
        const safeDataImage=name==='src'&&/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(trimmed);
        if(/^\s*(?:javascript|vbscript|file):/i.test(trimmed)||(/^\s*data:/i.test(trimmed)&&!safeDataImage)||/^\s*blob:/i.test(trimmed))el.removeAttribute(a.name);
      }
    });
    if(el.tagName==='IMG'){
      el.removeAttribute('srcset');
      el.setAttribute('loading','lazy');
      el.setAttribute('decoding','async');
    }
  });
  return doc.body.innerHTML;
}
function bodyHTML(st){
  const raw=String(st?.body||'');
  const containsHtml=/<\s*(?:!doctype\s+html|html|head|body|p|div|span|a|img|br|hr|strong|b|em|i|u|s|small|sup|sub|mark|del|ins|h[1-6]|blockquote|article|section|header|footer|main|aside|ul|ol|li|table|thead|tbody|tfoot|tr|th|td|pre|code|figure|figcaption|details|summary)\b[^>]*>/i.test(raw);
  if(containsHtml)return safeHtml(raw);
  return renderMarkdown(raw);
}
function openReader(st){readerId=st.id;state.activeStoryId=st.id;$('#readerMeta').textContent=`${seriesName(st.seriesId)} · 第 ${storyNo(st)} 章`;$('#readerTitle').textContent=st.title;const readerBody=$('#readerBody');readerBody.innerHTML=bodyHTML(st);readerBody.scrollTop=0;$('#readProgress').textContent=`阅读进度 ${st.readProgress||0}%`;$('#readerDialog').showModal();readerBody.onscroll=()=>{const height=Math.max(readerBody.scrollHeight,1);const ratio=Math.min(100,Math.round((readerBody.scrollTop+readerBody.clientHeight)/height*100));const previous=Number(st.readProgress)||0;if(ratio>previous){st.readProgress=ratio;st.updatedAt=Date.now();$('#readProgress').textContent=`阅读进度 ${ratio}%`;clearTimeout(readerProgressTimer);readerProgressTimer=setTimeout(()=>{persist(null);readerProgressTimer=null},400)}};}
$('#closeReader').onclick=$('#readerDone').onclick=()=>$('#readerDialog').close();$('#markRead').onclick=()=>{const st=state.stories.find(s=>s.id===readerId);if(st){st.readProgress=100;st.updatedAt=Date.now();persist('已标记读完');$('#readProgress').textContent='阅读进度 100%'}};$('#readerSource').onclick=()=>{const st=state.stories.find(s=>s.id===readerId);$('#sourceText').textContent=st?.raw||'';$('#sourceDialog').showModal()};$('#closeSource').onclick=()=>$('#sourceDialog').close();$('#readerEdit').onclick=()=>{const st=state.stories.find(s=>s.id===readerId);if(st)openEdit(st)};$('#readerMusic').onclick=()=>{const st=state.stories.find(s=>s.id===readerId);if(st)openAssociation(st)};
function openEdit(st){editingId=st.id;const f=$('#editForm');f.elements.title.value=st.title;f.elements.body.value=st.body;f.elements.mode.value='text';f.elements.seriesId.innerHTML='<option value="">未分类</option>'+state.series.map(s=>`<option value="${s.id}" ${s.id===st.seriesId?'selected':''}>${esc(s.name)}</option>`).join('');$('#editDialog').showModal()}
$('#editForm').elements.body.addEventListener('input',()=>{if(editingId){try{localStorage.setItem(KEY+'-draft-'+editingId,$('#editForm').elements.body.value)}catch{}}});$('#saveEdit').addEventListener('click',e=>{e.preventDefault();const st=state.stories.find(s=>s.id===editingId);if(!st)return;st.history=[...(st.history||[]).slice(-0),{title:st.title,body:st.body,updatedAt:st.updatedAt}].slice(-1);st.title=$('#editForm').elements.title.value.trim();st.body=$('#editForm').elements.body.value;st.seriesId=$('#editForm').elements.seriesId.value;st.updatedAt=Date.now();try{localStorage.removeItem(KEY+'-draft-'+editingId)}catch{}persist('修改已保存；上一版本已备份');$('#editDialog').close();render();if($('#readerDialog').open)openReader(st)});
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
function editTheme(t){if(!t){const name=prompt('新主题名称','我的月光主题');if(!name?.trim())return;t={id:uid('theme'),name:name.trim(),type:'reading',css:':root {\n  --paper: #fbf8f1;\n  --ink: #26394e;\n  --lav: #b19ad9;\n}\n.story-header { text-align: center; }',active:false};state.themes.push(t);persist('主题草稿已创建')}render();setTimeout(()=>{if(t)$('#themeSelect').value=t.id;$('#themeName').value=t.name;$('#themeCSS').value=t.css},0)}function previewCSS(){const css=$('#themeCSS')?.value;if(css===undefined)return;let style=$('#previewThemeStyle');if(!style){style=document.createElement('style');style.id='previewThemeStyle';document.head.append(style)}style.textContent=css;installModalProtection();toast('已应用到当前预览（尚未覆盖正式主题）')}function validateCSS(){const css=$('#themeCSS')?.value||'';let n=0;for(const c of css){if(c==='{')n++;if(c==='}')n--;if(n<0)break}if(n!==0||/javascript\s*:/i.test(css)){toast('检查到括号不匹配或可疑内容，请检查 CSS。');return}toast('基础检查通过；复杂 CSS 冲突仍需更完整的解析器。')}function saveTheme(){const id=$('#themeSelect')?.value,t=state.themes.find(t=>t.id===id);if(!t)return;t.name=$('#themeName').value.trim()||t.name;t.css=$('#themeCSS').value;state.themes.forEach(x=>x.active=x.id===id);state.activeThemeId=id;const themeSaved=writeActiveThemeSnapshot(t);const stateSaved=persist(null);applyActiveTheme(t);render();toast(themeSaved||stateSaved?'主题已保存并应用，重新进入也会保留。':'主题已应用到当前页面，但浏览器存储失败；请检查存储空间。')}
function download(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function exportJSON(){const data=JSON.stringify(stateForStorage(),null,2);download('Violets-Storybook-backup.json',new Blob([data],{type:'application/json'}));toast('JSON 数据备份已导出；本机音频文件保存在设备数据库中，不包含在 JSON 内。')}
function exportStory(){const s=state.stories.find(s=>s.id===state.activeStoryId)||state.stories[0];if(!s){toast('没有可导出的番外');return}download((s.title||'story').replace(/[\\/:*?"<>|]/g,'_')+'.md',new Blob([s.body||''],{type:'text/markdown;charset=utf-8'}))}
function exportCSS(){const t=state.themes.find(t=>t.active)||state.themes[0];download((t.name||'theme').replace(/[\\/:*?"<>|]/g,'_')+'.css',new Blob([t.css||''],{type:'text/css;charset=utf-8'}))}
async function restoreBackup(e){
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
    let localAudioIds=new Set();
    try{localAudioIds=new Set((await getAudioRecordKeys()).map(String))}
    catch(error){console.warn('恢复备份时无法读取现有本地音频：',error)}
    nextState.tracks=nextState.tracks.map(track=>track.kind==='file'
      ?{...track,audioStored:localAudioIds.has(String(track.id))}
      :track);
    const keepAudioIds=nextState.tracks.filter(track=>track.kind==='file').map(track=>track.id);
    const serialized=JSON.stringify(stateForStorage(nextState));
    localStorage.setItem(KEY,serialized);
    audio.pause();audio.removeAttribute('src');audio.load();
    localTrackUrls.forEach(objectUrl=>URL.revokeObjectURL(objectUrl));localTrackUrls.clear();
    localCoverUrls.forEach(objectUrl=>URL.revokeObjectURL(objectUrl));localCoverUrls.clear();
    state=nextState;
    try{await pruneAudioRecords(keepAudioIds)}catch(error){console.warn('备份恢复后清理未引用音频失败：',error)}
    try{await pruneCoverRecords(nextState.stories.map(story=>story.coverMediaId).filter(Boolean))}catch(error){console.warn('备份恢复后清理未引用封面失败：',error)}
    await initializePersistentCovers(false);
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
}
async function clearData(){
  if(!confirm('这会清除当前浏览器中的收藏、系列、角色、设置和本机保存的音频，且不可撤销。请先备份。确定清空？'))return;
  const previousState=state;
  state=structuredClone(seed);
  if(!persist(null)){state=previousState;return}
  try{localStorage.removeItem(ACTIVE_THEME_KEY)}catch(e){}
  audio.pause();audio.removeAttribute('src');audio.load();
  localTrackUrls.forEach(objectUrl=>URL.revokeObjectURL(objectUrl));localTrackUrls.clear();
  localCoverUrls.forEach(objectUrl=>URL.revokeObjectURL(objectUrl));localCoverUrls.clear();
  document.getElementById('previewThemeStyle')?.remove();
  try{await Promise.all([clearAudioRecords(),pruneCoverRecords([])]);toast('收藏数据、封面与本机音频均已清除。')}
  catch(error){console.error('清理本地媒体失败：',error);toast('收藏数据已清除，但部分本机媒体清理失败。')}
  applyActiveTheme(state.themes[0]||null);render();
}
$('#quickImport').onclick=openStory;
$('#nav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)go(b.dataset.page)});
installModalDismissHandling();
installModalProtection();
installCoverPicker();
bindActionButtons();
getActiveTheme();
render();
applyActiveTheme();
void initializePersistentAudio();
void initializePersistentCovers();
