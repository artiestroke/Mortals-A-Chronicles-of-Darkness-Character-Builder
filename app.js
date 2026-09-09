// ── Global constants ──────────────────────────────────────────────────────────
// ATTRIBUTES / ATTR_LABELS — hardcoded; cannot be configured via data.json.
// The 9 CofD attributes (3 categories × 3) are fixed by the game system.
const ATTRIBUTES={mental:['intelligence','wits','resolve'],physical:['strength','dexterity','stamina'],social:['presence','manipulation','composure']};
const ATTR_LABELS={intelligence:'Intelligence',wits:'Wits',resolve:'Resolve',strength:'Strength',dexterity:'Dexterity',stamina:'Stamina',presence:'Presence',manipulation:'Manipulation',composure:'Composure'};

// SKILLS / SKILL_LABELS / ALL_SKILLS — populated from data.json skill_definitions.
// Skills are configurable (add/remove/rename) unlike attributes.
let SKILLS={},SKILL_LABELS={},ALL_SKILLS=[];

// SECTION_DEFS — full array of section definition objects from data.json.
// SEC_DEFAULTS — map of key → boolean (true = visible by default for that section).
// SECTION_MAP  — map of key → section definition object (O(1) lookup by key).
// ZONES        — map of zone name → ordered array of section definitions.
//                Rebuilt by rebuildZones() on load and after every drag-drop.
// PRESETS      — array of named preset objects (e.g. "Vampire", "Mage") from data.json.
let SECTION_DEFS=[],SEC_DEFAULTS={},SECTION_MAP={},ZONES={},PRESETS=[];

// ENTITY_ATTRS — the three fixed attributes for Ephemeral Entity sheets.
// Unlike mortal attributes these are not data.json-configurable.
const ENTITY_ATTRS=[{key:'power',label:'Power'},{key:'finesse',label:'Finesse'},{key:'resistance',label:'Resistance'}];

// DB — in-memory content library, keyed by db_key from section_definitions.
// Populated from data.json on load. e.g. DB.merits, DB.disciplines, DB.weapons.
// Content arrays are sorted alphabetically on load unless preserve_order:true.
const DB={};

// STATE — the active character object. Everything on the sheet reads/writes here.
// Persisted to localStorage as JSON. See patchState() for the full field schema
// and _baseCharacterFields() for the initial values assigned on character creation.
// currentSaveId — the localStorage key suffix for the loaded character, or null
// if the current sheet has never been saved.
let STATE={},currentSaveId=null;

// ── Startup: load data.json ───────────────────────────────────────────────────
// Fetches data.json once, populates all global data structures, and builds the
// config panel. Called once on page load. The app is inert until this resolves.

async function loadDB(){
  // ── Source data.json — FSS folder takes priority over server fetch ────────
  let d=null;
  if(_fssDataHandle){
    const fssData=await _fssReadDataJson();
    if(fssData){
      const validation=_fssValidateDataJson(fssData);
      if(validation.ok){
        d=fssData;
      }else{
        showWarning('Folder data.json is invalid ('+validation.reason+') — using built-in library. Check your data folder.');
      }
    }else{
      showWarning('Could not read folder data.json — using built-in library. Check your data folder.');
    }
  }
  if(!d)d=await fetch('./data.json').then(r=>r.json());
  // Sort content lists alphabetically (preserve_order lists are left as-is)
  const preserve=new Set((d.section_definitions||[]).filter(s=>s.db_key&&s.preserve_order).map(s=>s.db_key));
  (d.section_definitions||[]).filter(s=>s.db_key&&!preserve.has(s.db_key)).forEach(s=>{
    if(Array.isArray(d[s.db_key]))d[s.db_key].sort((a,b)=>(a.name||'').toLowerCase().localeCompare((b.name||'').toLowerCase()));
  });
  // Populate DB from all db_key values declared in section_definitions
  SECTION_DEFS=(d.section_definitions||[]).filter(sd=>sd.key);SEC_DEFAULTS={};SECTION_MAP={};
  SECTION_DEFS.forEach(sd=>{
    SEC_DEFAULTS[sd.key]=sd.default||false;SECTION_MAP[sd.key]=sd;
    if(sd.db_key&&!(sd.db_key in DB))DB[sd.db_key]=d[sd.db_key]||[];
  });
  // ── Merge supplemental library — localStorage first, then FSS (FSS wins) ──
  // Merge order: base data.json → localStorage supplement → FSS supplement.
  // Later sources win on name conflict within the same db_key.
  const _mergeSupp=(suppObj)=>{
    Object.keys(suppObj).forEach(k=>{
      if(Array.isArray(suppObj[k])&&suppObj[k].length){
        if(!DB[k])DB[k]=[];
        const suppNames=new Set(suppObj[k].map(e=>e.name));
        DB[k]=DB[k].filter(e=>!suppNames.has(e.name));
        DB[k]=[...DB[k],...suppObj[k]];
      }
    });
  };
  _mergeSupp(_getSupplementRaw());
  // FSS supplement — read synchronously from the module-level handle if available.
  // _fssReadSuppJson is async; we await it here since loadDB is already async.
  const fssSuppRaw=await _fssReadSuppJson();
  if(fssSuppRaw&&typeof fssSuppRaw==='object')_mergeSupp(fssSuppRaw);
  // Re-sort after merge (preserve_order lists are excluded)
  SECTION_DEFS.filter(s=>s.db_key&&!preserve.has(s.db_key)).forEach(s=>{
    if(Array.isArray(DB[s.db_key]))DB[s.db_key].sort((a,b)=>(a.name||'').toLowerCase().localeCompare((b.name||'').toLowerCase()));
  });

  window._DB_RAW=d;
  SKILLS={};SKILL_LABELS={};ALL_SKILLS=[];
  (d.skill_definitions||[]).forEach(sd=>{
    if(!SKILLS[sd.category])SKILLS[sd.category]=[];
    SKILLS[sd.category].push(sd.key);SKILL_LABELS[sd.key]=sd.label;ALL_SKILLS.push(sd.key);
  });
  rebuildZones();
  PRESETS=d.sheet_presets||[];
  // Populate both desktop and drawer preset selects, grouped by category
  const presetsByCategory=[];
  const catOrder=[];
  PRESETS.forEach(p=>{
    const cat=p.category||'Other';
    if(!catOrder.includes(cat))catOrder.push(cat);
    let group=presetsByCategory.find(g=>g.cat===cat);
    if(!group){group={cat,presets:[]};presetsByCategory.push(group);}
    group.presets.push(p);
  });
  const presetOpts='<option value="">— Custom —</option>'+presetsByCategory.map(g=>
    `<optgroup label="${escH(g.cat)}">${g.presets.map(p=>`<option value="${escH(p.name)}">${escH(p.name)}</option>`).join('')}</optgroup>`
  ).join('');
  document.getElementById('presetSelect').innerHTML=presetOpts;
  document.getElementById('drawerPresetSelect').innerHTML=presetOpts;
  // Entity-specific data
  DB.entityTypes=d.entity_types||{};
  DB.entityBans=d.entity_bans||[];
  DB.entityBanes=d.entity_banes||[];
  DB.rankStats=d.rank_stats||{};
  DB.mortalGeneration=d.mortal_generation||{attribute_spreads:[5,4,3],skill_spreads:[11,7,4],size:5};
  DB.helpSections=d.help_sections||[];

  buildCfgPanel();
  // Auto-open help modal for first-time visitors
  if(!localStorage.getItem('mortalsplus_help_seen')){
    try{localStorage.setItem('mortalsplus_help_seen','1');}catch(e){/* quota full — skip marking seen */}
    openHelp();
  }
}

// ── Zone layout ───────────────────────────────────────────────────────────────
// ZONES maps each zone name to an ordered array of section definitions.
// The default order comes from the `order` field in section_definitions.
// Per-character drag-drop overrides are stored in STATE.sectionConfig._zoneOrder.
// rebuildZones() merges these two sources: user overrides take priority, and any
// sections missing from the override are appended in their default order.
// CRITICAL: This sort by `order` must be preserved — it was broken and fixed
// twice. Without it, sections render in data.json insertion order, not order value.
function rebuildZones(){
  ZONES={};
  const defaultOrder={};
  // Sort section_definitions by order within each zone before building defaultOrder
  const sorted=[...SECTION_DEFS].sort((a,b)=>(a.order||0)-(b.order||0));
  sorted.forEach(sd=>{
    if(!defaultOrder[sd.zone])defaultOrder[sd.zone]=[];
    defaultOrder[sd.zone].push(sd.key);
  });
  const zoneOrder=(STATE.sectionConfig&&STATE.sectionConfig._zoneOrder)||{};
  const explicitlyPlaced=new Set(Object.values(zoneOrder).flat());
  const allZones=new Set([...Object.keys(defaultOrder),...Object.keys(zoneOrder)]);
  allZones.forEach(zone=>{
    let keys;
    if(zoneOrder[zone]){
      const inArray=new Set(zoneOrder[zone]);
      const extras=(defaultOrder[zone]||[]).filter(k=>!inArray.has(k)&&!explicitlyPlaced.has(k));
      keys=[...zoneOrder[zone],...extras];
    } else {
      keys=(defaultOrder[zone]||[]).filter(k=>!explicitlyPlaced.has(k));
    }
    ZONES[zone]=keys.map(k=>SECTION_MAP[k]).filter(Boolean).map(sd=>({...sd}));
  });
}

// ── Collapsible sections ──────────────────────────────────────────────────────
// Collapsed state is persisted separately from character STATE so sections
// stay collapsed across saves and page refreshes without dirtying the save.
// Only sections in COLLAPSIBLE_ZONES get toggles — header and beats zones
// are intentionally always visible.
const LS_COLLAPSED='mortals_plus_collapsed';

function _getCollapsed(){
  try{const s=localStorage.getItem(LS_COLLAPSED);return s?new Set(JSON.parse(s)):new Set();}
  catch(e){return new Set();}
}
function _saveCollapsed(set){
  try{localStorage.setItem(LS_COLLAPSED,JSON.stringify([...set]));}catch(e){}
}
function toggleSectionCollapse(key,e){
  if(e){e.stopPropagation();e.preventDefault();}
  const block=document.getElementById('secblock-'+key);if(!block)return;
  const collapsed=_getCollapsed();
  if(collapsed.has(key)){collapsed.delete(key);block.classList.remove('sec-collapsed');}
  else{collapsed.add(key);block.classList.add('sec-collapsed');}
  _saveCollapsed(collapsed);
}
function _applyCollapsedState(){
  const collapsed=_getCollapsed();
  collapsed.forEach(key=>{
    const block=document.getElementById('secblock-'+key);
    if(block)block.classList.add('sec-collapsed');
  });
}
// Zones where collapse toggles are added (excludes header and beats)
const COLLAPSIBLE_ZONES=new Set(['full-width-top','left-column','right-column','full-width-bottom']);
// ── End collapsible sections ──────────────────────────────────────────────

// ── Drag and drop layout ──────────────────────────────────────────────────────
// Sections can be dragged by their header (.sec) to reorder within a zone or
// move between zones. Both mouse (HTML5 drag API) and touch (touchstart/move/end)
// are supported. The drop target is determined by midpoint distance — whichever
// sec-block's centre is closest to the pointer gets the before/after indicator.
// Layout is committed to STATE.sectionConfig._zoneOrder and persisted with save.
// While layout is locked (STATE.layoutLocked), drag events are blocked.
let _dragKey=null;
let _pendingInsertion=null;
const ZONE_IDS={'beats':'zone-beats','full-width-top':'zone-full-width-top','left-column':'zone-left-column','right-column':'zone-right-column','full-width-bottom':'zone-full-width-bottom'};
const _zoneListenersAttached=new WeakMap();

function initDragAndDrop(){
  document.querySelectorAll('.sec-block[id^="secblock-"]').forEach(block=>{
    const secEl=block.querySelector('.sec');
    if(!secEl||secEl.dataset.dndInit)return;
    secEl.dataset.dndInit='1';
    secEl.setAttribute('draggable','true');
    secEl.classList.add('draggable');
    const key=block.id.replace('secblock-','');

    // ── Mouse drag (desktop) ──────────────────────────────────────────────
    secEl.addEventListener('dragstart',e=>{
      if(STATE.layoutLocked){e.preventDefault();return;}
      _dragKey=key;
      _pendingInsertion=null;
      block.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain',key);
    });
    secEl.addEventListener('dragend',()=>{
      _dragKey=null;
      _pendingInsertion=null;
      document.querySelectorAll('.sec-block').forEach(b=>
        b.classList.remove('dragging','drag-over-before','drag-over-after'));
      document.querySelectorAll('.drop-zone-highlight').forEach(z=>
        z.classList.remove('drop-zone-highlight'));
    });

    // ── Touch drag (mobile) ───────────────────────────────────────────────
    secEl.addEventListener('touchstart',e=>{
      // Only initiate on a single-finger touch on the handle itself
      if(e.touches.length!==1)return;
      if(STATE.layoutLocked)return;
      _dragKey=key;
      _pendingInsertion=null;
      block.classList.add('dragging');
      // Create a floating ghost element
      const rect=block.getBoundingClientRect();
      const ghost=block.cloneNode(true);
      ghost.id='touch-drag-ghost';
      ghost.style.cssText=`position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;opacity:.6;pointer-events:none;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25);border-radius:4px;`;
      document.body.appendChild(ghost);
      secEl._touchGhost=ghost;
      secEl._touchStartX=e.touches[0].clientX;
      secEl._touchStartY=e.touches[0].clientY;
      secEl._ghostOffsetX=e.touches[0].clientX-rect.left;
      secEl._touchBlockRect=rect;
    },{passive:true});

    secEl.addEventListener('touchmove',e=>{
      if(!_dragKey||_dragKey!==key)return;
      e.preventDefault();
      const touch=e.touches[0];
      const ghost=secEl._touchGhost;
      if(ghost){
        ghost.style.left=(touch.clientX-secEl._ghostOffsetX)+'px';
        ghost.style.top=(touch.clientY-(secEl._touchBlockRect.height/2))+'px';
      }
      // Hide ghost briefly to get element underneath
      if(ghost)ghost.style.display='none';
      const target=document.elementFromPoint(touch.clientX,touch.clientY);
      if(ghost)ghost.style.display='';
      // Clear highlights
      document.querySelectorAll('.sec-block').forEach(b=>
        b.classList.remove('drag-over-before','drag-over-after'));
      document.querySelectorAll('.drop-zone-highlight').forEach(z=>
        z.classList.remove('drop-zone-highlight'));
      if(!target)return;
      // Find which zone container and block we're over
      const zoneEl=target.closest('[id^="zone-"]');
      if(!zoneEl)return;
      const zoneId=zoneEl.id;
      const capturedZone=Object.entries(ZONE_IDS).find(([z,id])=>id===zoneId)?.[0];
      if(!capturedZone)return;
      const blocks=[...zoneEl.querySelectorAll(':scope>.sec-block[id^="secblock-"]')]
        .filter(b=>b.id!=='secblock-'+_dragKey&&!b.classList.contains('hidden'));
      if(!blocks.length){
        zoneEl.classList.add('drop-zone-highlight');
        _pendingInsertion={zone:capturedZone,block:null,before:false};
        return;
      }
      let closest=null,closestDist=Infinity,insertBefore=true;
      blocks.forEach(b=>{
        const rect=b.getBoundingClientRect();
        const mid=rect.top+rect.height/2;
        const dist=Math.abs(touch.clientY-mid);
        if(dist<closestDist){closestDist=dist;closest=b;insertBefore=touch.clientY<mid;}
      });
      if(closest){
        closest.classList.add(insertBefore?'drag-over-before':'drag-over-after');
        _pendingInsertion={zone:capturedZone,block:closest,before:insertBefore};
      }
    },{passive:false});

    secEl.addEventListener('touchend',e=>{
      // Remove ghost
      const ghost=secEl._touchGhost;
      if(ghost){ghost.remove();secEl._touchGhost=null;}
      block.classList.remove('dragging');
      document.querySelectorAll('.sec-block').forEach(b=>
        b.classList.remove('dragging','drag-over-before','drag-over-after'));
      document.querySelectorAll('.drop-zone-highlight').forEach(z=>
        z.classList.remove('drop-zone-highlight'));
      if(!_dragKey||!_pendingInsertion){_dragKey=null;_pendingInsertion=null;return;}
      const ins=_pendingInsertion;
      const dk=_dragKey;
      _dragKey=null;_pendingInsertion=null;
      commitDrop(dk,ins.zone,ins.block?{block:ins.block,before:ins.before}:null);
    });

    secEl.addEventListener('touchcancel',()=>{
      const ghost=secEl._touchGhost;
      if(ghost){ghost.remove();secEl._touchGhost=null;}
      block.classList.remove('dragging');
      document.querySelectorAll('.sec-block').forEach(b=>
        b.classList.remove('dragging','drag-over-before','drag-over-after'));
      document.querySelectorAll('.drop-zone-highlight').forEach(z=>
        z.classList.remove('drop-zone-highlight'));
      _dragKey=null;_pendingInsertion=null;
    });
    // ── End touch drag ────────────────────────────────────────────────────
  });

  Object.entries(ZONE_IDS).forEach(([zone,containerId])=>{
    const container=document.getElementById(containerId);
    if(!container||_zoneListenersAttached.has(container))return;
    _zoneListenersAttached.set(container,true);
    const capturedZone=zone;

    container.addEventListener('dragover',e=>{
      e.preventDefault();e.dataTransfer.dropEffect='move';
      document.querySelectorAll('.sec-block').forEach(b=>
        b.classList.remove('drag-over-before','drag-over-after'));
      document.querySelectorAll('.drop-zone-highlight').forEach(z=>
        z.classList.remove('drop-zone-highlight'));
      if(!_dragKey)return;
      const blocks=[...container.querySelectorAll(':scope>.sec-block[id^="secblock-"]')]
        .filter(b=>b.id!=='secblock-'+_dragKey&&!b.classList.contains('hidden'));
      if(!blocks.length){
        container.classList.add('drop-zone-highlight');
        _pendingInsertion={zone:capturedZone,block:null,before:false};
        return;
      }
      let closest=null,closestDist=Infinity,insertBefore=true;
      blocks.forEach(b=>{
        const rect=b.getBoundingClientRect();
        const mid=rect.top+rect.height/2;
        const dist=Math.abs(e.clientY-mid);
        if(dist<closestDist){closestDist=dist;closest=b;insertBefore=e.clientY<mid;}
      });
      if(closest){
        closest.classList.add(insertBefore?'drag-over-before':'drag-over-after');
        _pendingInsertion={zone:capturedZone,block:closest,before:insertBefore};
      }
    });

    container.addEventListener('dragleave',e=>{
      if(!container.contains(e.relatedTarget)){
        container.classList.remove('drop-zone-highlight');
        container.querySelectorAll('.sec-block').forEach(b=>
          b.classList.remove('drag-over-before','drag-over-after'));
        _pendingInsertion=null;
      }
    });

    container.addEventListener('drop',e=>{
      e.preventDefault();
      const key=_dragKey;
      _dragKey=null;
      container.classList.remove('drop-zone-highlight');
      container.querySelectorAll('.sec-block').forEach(b=>
        b.classList.remove('drag-over-before','drag-over-after'));
      if(!key)return;
      const ins=_pendingInsertion;
      _pendingInsertion=null;
      if(!ins||ins.zone!==capturedZone)return;
      commitDrop(key,capturedZone,ins.block?{block:ins.block,before:ins.before}:null);
    });
  });
}

// Writes the new section order to STATE.sectionConfig._zoneOrder, then calls
// rebuildZones() + renderEditor() to re-render the full sheet.
function commitDrop(dragKey,targetZone,insertion){
  if(!dragKey)return;
  if(!STATE.sectionConfig)STATE.sectionConfig={};
  if(!STATE.sectionConfig._zoneOrder)STATE.sectionConfig._zoneOrder={};
  const currentOrder=(ZONES[targetZone]||[]).map(sd=>sd.key);
  Object.keys(STATE.sectionConfig._zoneOrder).forEach(z=>{
    STATE.sectionConfig._zoneOrder[z]=STATE.sectionConfig._zoneOrder[z].filter(k=>k!==dragKey);
  });
  const newOrder=currentOrder.filter(k=>k!==dragKey);
  let insertIdx=newOrder.length;
  if(insertion){
    const refKey=insertion.block.id.replace('secblock-','');
    const refIdx=newOrder.indexOf(refKey);
    if(refIdx!==-1)insertIdx=insertion.before?refIdx:refIdx+1;
  }
  newOrder.splice(insertIdx,0,dragKey);
  STATE.sectionConfig._zoneOrder[targetZone]=newOrder;
  rebuildZones();
  renderEditor();
  autoSave();
}

function toggleLayoutLock(){
  STATE.layoutLocked=!STATE.layoutLocked;
  updateLayoutLockButton();
  showStatus(STATE.layoutLocked?'Layout locked.':'Layout unlocked.');
  autoSave();
}
function updateLayoutLockButton(){
  document.querySelectorAll('.layout-lock-btn').forEach(btn=>{
    const locked=STATE.layoutLocked||false;
    btn.textContent=locked?'🔒 Layout locked':'🔓 Lock layout';
    btn.style.color=locked?'var(--accent)':'var(--faint)';
    btn.style.fontWeight=locked?'700':'';
  });
}

// applyTheme — sets data-theme attribute on <body>, activating one of the
// CSS variable overrides at the top of the stylesheet. Syncs both theme
// selects (desktop sidebar + drawer). Watermark is now independent — see applyWatermark().
function applyTheme(theme){
  theme=theme||'neutral';
  STATE.theme=theme;
  document.body.setAttribute('data-theme',theme);
  const d=document.getElementById('themeSelect');
  const dr=document.getElementById('drawerThemeSelect');
  if(d)d.value=theme;
  if(dr)dr.value=theme;
  autoSave();
}

// WATERMARK_ASSETS — maps watermark option values to their asset paths.
const WATERMARK_ASSETS={
  mortal:'assets/skull-mortal.jpg',
  mage:'assets/skull-mage.jpg',
  ascension:'assets/prime.jpg',
  vampire:'assets/skull-vampire.jpg',
  beast:'assets/skull-beast.jpg',
  changeling:'assets/skull-changeling.jpg',
  deviant:'assets/skull-deviant.jpg',
  geist:'assets/skull-geist.jpg',
  hunter:'assets/skull-hunter.jpg',
  mummy:'assets/skull-mummy.jpg',
  promethean:'assets/skull-promethean.jpg',
  werewolf:'assets/skull-werewolf.jpg',
  demon:'assets/skull-demon.jpg',
  neutral:'assets/skull-mortal.jpg',
  entity:'assets/skull-mortal.jpg',
};

// applyWatermark — sets the watermark image independently of theme.
// value: one of the WATERMARK_ASSETS keys, 'custom', or 'none'.
// Syncs both watermark selects (desktop + drawer).
function applyWatermark(value){
  value=value||'mortal';
  STATE.watermark=value;
  const wmEl=document.getElementById('splat-watermark');
  const imgEl=document.getElementById('splatWatermarkImg');
  if(!wmEl||!imgEl)return;
  const customData=value==='custom'?(localStorage.getItem(LS_CUSTOM_WATERMARK)||null):null;
  const isVisible=!(value==='none'||(value==='custom'&&!customData));
  if(!isVisible){
    wmEl.classList.add('watermark-hidden');
  } else {
    wmEl.classList.remove('watermark-hidden');
    if(value==='custom'){
      imgEl.src=customData;
    } else {
      imgEl.src=WATERMARK_ASSETS[value]||'assets/skull-mortal.jpg';
    }
  }
  const d=document.getElementById('watermarkSelect');
  const dr=document.getElementById('drawerWatermarkSelect');
  if(d)d.value=value;
  if(dr)dr.value=value;
  // Show/hide custom upload controls
  const cu=document.getElementById('customWatermarkUpload');
  const cud=document.getElementById('drawerCustomWatermarkUpload');
  if(cu)cu.style.display=value==='custom'?'block':'none';
  if(cud)cud.style.display=value==='custom'?'block':'none';
  // Show/hide opacity slider — visible whenever an image is selected
  const or_=document.getElementById('watermarkOpacityRow');
  const dor=document.getElementById('drawerWatermarkOpacityRow');
  const showSlider=isVisible;
  if(or_)or_.style.display=showSlider?'flex':'none';
  if(dor)dor.style.display=showSlider?'flex':'none';
  // Apply current opacity
  applyWatermarkOpacity(STATE.watermark_opacity!=null?STATE.watermark_opacity:0.035);
  autoSave();
}

// applyWatermarkOpacity — sets the watermark image opacity and persists to STATE.
// Valid range 0.02–0.06; default 0.035. Syncs both sliders and value labels.
const WATERMARK_OPACITY_DEFAULT=0.035;
function applyWatermarkOpacity(value){
  value=Math.round(Math.min(0.06,Math.max(0.02,value))*1000)/1000;
  STATE.watermark_opacity=value;
  const imgEl=document.getElementById('splatWatermarkImg');
  if(imgEl)imgEl.style.opacity=value;
  // Sync sliders
  const sl=document.getElementById('watermarkOpacitySlider');
  const dsl=document.getElementById('drawerWatermarkOpacitySlider');
  if(sl)sl.value=value;
  if(dsl)dsl.value=value;
  // Sync value labels — show as percentage for readability (e.g. "3.5%")
  const pct=Math.round(value*1000)/10;
  const lbl=`${pct}%`;
  const vl=document.getElementById('watermarkOpacityVal');
  const dvl=document.getElementById('drawerWatermarkOpacityVal');
  if(vl)vl.textContent=lbl;
  if(dvl)dvl.textContent=lbl;
  autoSave();
}

// loadCustomWatermark — handles file input for custom watermark upload.
// Reads the file as a base64 data URL and stores it in localStorage under
// LS_CUSTOM_WATERMARK (browser-level, not per-character). STATE.watermark is
// set to 'custom' so the character references the slot; the image data itself
// never enters STATE or exports.
function loadCustomWatermark(input){
  const file=input.files&&input.files[0];
  if(!file)return;
  if(file.size>300000){
    showStatus('Warning: large image may approach storage limits. Consider a smaller file.',4000);
  }
  const reader=new FileReader();
  reader.onload=function(e){
    try{
      localStorage.setItem(LS_CUSTOM_WATERMARK,e.target.result);
    }catch(err){
      if(_isQuotaError(err)){showStatus(LS_STORAGE_FULL_MSG,4000);return;}
    }
    STATE.watermark='custom';
    applyWatermark('custom');
  };
  reader.readAsDataURL(file);
}

// clearCustomWatermark — removes the browser-level custom watermark and
// reverts any character currently using it to 'none'.
function clearCustomWatermark(){
  try{localStorage.removeItem(LS_CUSTOM_WATERMARK);}catch(e){}
  if(STATE.watermark==='custom') applyWatermark('none');
}



// sec-blocks in collapsible zones, attaches the collapse chevron and click
// handler if not already done (idempotent via dataset.collapseInit), then
// restores previously-collapsed state from localStorage.
function initCollapsibleSections(){
  COLLAPSIBLE_ZONES.forEach(zone=>{
    const container=document.getElementById(ZONE_IDS[zone]);
    if(!container)return;
    container.querySelectorAll(':scope>.sec-block[id^="secblock-"]').forEach(block=>{
      const key=block.id.replace('secblock-','');
      // Find the clickable header — either .sec or .merit-toggle-hd (attributes, merits)
      const toggleHd=block.querySelector('.merit-toggle-hd')||block.querySelector('.sec');
      if(!toggleHd||toggleHd.dataset.collapseInit)return;
      toggleHd.dataset.collapseInit='1';
      toggleHd.classList.add('collapsible');
      // Add chevron to the header
      const chevron=document.createElement('span');
      chevron.className='sec-chevron';
      chevron.innerHTML='&#9660;'; // ▼
      toggleHd.appendChild(chevron);
      // Click handler
      toggleHd.addEventListener('click',e=>toggleSectionCollapse(key,e));
    });
  });
  _applyCollapsedState();
}

function resetLayout(){
  if(STATE.sectionConfig)delete STATE.sectionConfig._zoneOrder;
  rebuildZones();renderEditor();
  showStatus('Layout reset to defaults.');
}

function refillSelect(id,list,filter=''){
  const s=document.getElementById(id);if(!s)return;
  const f=filter.toLowerCase();
  s.innerHTML='<option disabled selected value="">— pick —</option>'+
    list.filter(x=>!f||x.name.toLowerCase().includes(f))
        .map(x=>`<option value="${escH(x.name)}" title="${x.desc||''}">${escH(x.name)}</option>`).join('');
}
function filterSelect(iId,dId,list){refillSelect(dId,list,document.getElementById(iId).value);}
function filterSelectAndFill(iId,dId,descId,dbList){
  const q=document.getElementById(iId).value;refillSelect(dId,dbList,q);
  const found=dbList.find(x=>x.name.toLowerCase()===q.toLowerCase());
  const el=document.getElementById(descId);if(found&&el)el.value=found.desc||'';
}
function fillDescFromDrop(dId,descId,dbList){
  const val=document.getElementById(dId).value;if(!val)return;
  const found=dbList.find(x=>x.name===val);
  const el=document.getElementById(descId);if(found&&el)el.value=found.desc||'';
}

// buildCfgPanel — renders the section toggle checkboxes grouped by splat.
// Writes to both desktop (#cfgPanel) and drawer (#drawerCfgPanel) so both
// stay in sync without any further coordination. Groups are collapsible
// via sessionStorage to avoid overwhelming new users. Called once after loadDB.
function buildCfgPanel(){
  // Build groups map, respecting also_groups
  const groups={};
  const groupCategory={};
  SECTION_DEFS.forEach(sd=>{
    const g=sd.group||'Other';
    if(!groups[g])groups[g]=[];
    groups[g].push(sd);
    groupCategory[g]=sd.config_category||'Other';
    (sd.also_groups||[]).forEach(ag=>{
      if(!groups[ag])groups[ag]=[];
      groups[ag].push(sd);
    });
  });
  // Bucket groups into categories, preserving encounter order
  const catOrder=[];
  const cats={};
  Object.keys(groups).forEach(gname=>{
    const cat=groupCategory[gname]||'Other';
    if(!cats[cat]){cats[cat]=[];catOrder.push(cat);}
    cats[cat].push(gname);
  });
  const slugify=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'-');
  const html=catOrder.map(cat=>{
    const catSlug=slugify(cat);
    const groupsHtml=cats[cat].map(gname=>{
      const sds=groups[gname];
      const slug=slugify(gname);
      const collapsed=getCfgGroupCollapsed(gname);
      const sorted=[...sds].sort((a,b)=>a.label.localeCompare(b.label));
      return `<div class="cfg-group-hdr" onclick="toggleCfgGroup('${escH(gname)}')" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between">
      <span>${escH(gname)}</span>
      <span class="item-toggle cfg-chevron-${slug}" style="${collapsed?'':'transform:rotate(90deg)'}">&#9654;</span>
    </div>
    <div class="cfg-group-body-${slug}" style="display:${collapsed?'none':'block'}">
      <div class="cfg-grid">${sorted.map(sd=>`
        <label class="cfg-chk"><input type="checkbox" data-sec="${sd.key}" onchange="toggleSec('${sd.key}',this.checked)"> ${escH(sd.label)}</label>`).join('')}
      </div>
    </div>`;
    }).join('');
    const catCollapsed=getCfgCatCollapsed(cat);
    return `<div class="cfg-cat-hdr" onclick="toggleCfgCat('${escH(cat)}')" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;margin-top:6px;padding:3px 4px;background:var(--border);border-radius:3px;font-size:.72rem;font-weight:bold;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)">
      <span>${escH(cat)}</span>
      <span class="item-toggle cfg-cat-chevron-${catSlug}" style="${catCollapsed?'':'transform:rotate(90deg)'}">&#9654;</span>
    </div>
    <div class="cfg-cat-body-${catSlug}" style="display:${catCollapsed?'none':'block'};padding-left:4px">${groupsHtml}</div>`;
  }).join('');
  document.getElementById('cfgPanel').innerHTML=html;
  document.getElementById('drawerCfgPanel').innerHTML=html;
}

// ── Config panel collapse helpers (unified) ───────────────────────────────────
// getCfgCollapsed(key, storageKey, defaultFn) — reads collapse state from sessionStorage.
// toggleCfgCollapse(key, storageKey, bodyClass, chevronClass) — toggles and persists.
function getCfgCollapsed(key,storageKey,defaultFn){
  try{
    const s=sessionStorage.getItem(storageKey);
    const map=s?JSON.parse(s):{};
    if(map[key]!==undefined)return map[key];
  }catch(e){}
  return defaultFn(key);
}
function toggleCfgCollapse(key,storageKey,bodyClass,chevronClass){
  const slug=key.toLowerCase().replace(/[^a-z0-9]/g,'-');
  const bodies=document.querySelectorAll(`.${bodyClass}-${slug}`);
  const chevrons=document.querySelectorAll(`.${chevronClass}-${slug}`);
  const first=bodies[0];if(!first)return;
  const nowCollapsed=first.style.display!=='none';
  bodies.forEach(b=>b.style.display=nowCollapsed?'none':'block');
  chevrons.forEach(c=>c.style.transform=nowCollapsed?'':'rotate(90deg)');
  try{
    const s=sessionStorage.getItem(storageKey);
    const map=s?JSON.parse(s):{};
    map[key]=nowCollapsed;
    sessionStorage.setItem(storageKey,JSON.stringify(map));
  }catch(e){}
}
// Public wrappers — call sites in buildCfgPanel() HTML use these names.
function getCfgGroupCollapsed(gname){return getCfgCollapsed(gname,'cfgGroups',g=>g!=='Mortal');}
function toggleCfgGroup(gname){toggleCfgCollapse(gname,'cfgGroups','cfg-group-body','cfg-chevron');}
function getCfgCatCollapsed(cat){return getCfgCollapsed(cat,'cfgCats',()=>false);}
function toggleCfgCat(cat){toggleCfgCollapse(cat,'cfgCats','cfg-cat-body','cfg-cat-chevron');}

// ── Section visibility ────────────────────────────────────────────────────────
// Section visibility is stored in STATE.sectionConfig as a flat key→boolean map.
// getSecConfig() lazily initialises missing keys from SEC_DEFAULTS.
// secVisible(key) returns true if the section should currently be shown.
// Sections not in sectionConfig fall back to their default value.
function getSecConfig(){
  if(!STATE.sectionConfig)STATE.sectionConfig={};
  SECTION_DEFS.forEach(sd=>{
    if(STATE.sectionConfig[sd.key]===undefined)STATE.sectionConfig[sd.key]=sd.default||false;
  });
  return STATE.sectionConfig;
}
function secVisible(key){
  const cfg=getSecConfig();
  const v=cfg[key];
  if(v===undefined)return SEC_DEFAULTS[key]||false;
  if(typeof v==='object')return v.enabled!==false;
  return v!==false;
}
function toggleSec(secId,enabled){
  getSecConfig()[secId]=enabled;
  document.getElementById('secblock-'+secId)?.classList.toggle('hidden',!enabled);
  if(SECTION_MAP[secId]?.zone==='header')renderDynamicHeader();
  // Keep both cfg panels in sync
  syncCfgCheckboxes();
}
function syncCfgCheckboxes(){
  document.querySelectorAll('.cfg-chk input[type=checkbox]').forEach(chk=>{
    const sec=chk.getAttribute('data-sec');if(sec)chk.checked=secVisible(sec);
  });
}
function applySectionConfig(){
  getSecConfig();
  SECTION_DEFS.forEach(sd=>{
    const vis=secVisible(sd.key);
    document.getElementById('secblock-'+sd.key)?.classList.toggle('hidden',!vis);
  });
  syncCfgCheckboxes();
}
// applyPreset — replaces STATE.sectionConfig entirely with the preset's config
// object (minus any _zoneOrder, which is always cleared on preset apply).
// Any key not in the preset config falls back to its SEC_DEFAULTS value.
function applyPreset(presetName){
  if(!presetName)return;
  const preset=PRESETS.find(p=>p.name===presetName);if(!preset)return;
  STATE.sectionConfig={...preset.config};
  delete STATE.sectionConfig._zoneOrder;
  // Sync both preset selects to show the applied preset
  document.getElementById('presetSelect').value=presetName;
  document.getElementById('drawerPresetSelect').value=presetName;
  rebuildZones();renderEditor();
  // Show entity gen options when an entity preset is active
  showStatus(`Preset "${presetName}" applied.`);
}


// ── Tablet drawer ─────────────────────────────────────────────────────────────
let _activeDrawerTab='saves';

function openDrawer(){
  document.getElementById('drawerBackdrop').classList.add('open');
  document.body.style.overflow='hidden'; // prevent background scroll
  // Refresh via loadSaves so the drawer gets the FSS-merged list
  loadSaves();
}
function closeDrawer(){
  document.getElementById('drawerBackdrop').classList.remove('open');
  document.body.style.overflow='';
}
function closeDrawerOnBackdrop(e){
  // Close only when clicking the backdrop itself, not the panel inside it
  if(e.target===document.getElementById('drawerBackdrop'))closeDrawer();
}
function switchDrawerTab(tab){
  _activeDrawerTab=tab;
  document.querySelectorAll('.drawer-tab').forEach(el=>{
    el.classList.toggle('active',el.id==='dtab-'+tab);
  });
  document.querySelectorAll('.drawer-pane').forEach(el=>{
    el.classList.toggle('active',el.id==='dpane-'+tab);
  });
}

// _refreshDrawerSaveList — renders the drawer save list using pre-merged data
// from loadSaves(). Always called via loadSaves() so the list reflects FSS state.
// rawList: full merged character list. list: filtered subset. folders: folder array.
function _refreshDrawerSaveList(rawList,list,folders){
  const el=document.getElementById('drawerSaveList');
  if(!el)return;
  if(!rawList.length){
    el.innerHTML='<span style="font-size:.8rem;color:var(--faint);font-family:sans-serif">No saved characters yet.</span>';
    return;
  }
  if(!list.length){
    el.innerHTML='<span style="font-size:.8rem;color:var(--faint);font-family:sans-serif">No characters match your filter.</span>';
    return;
  }
  const f=_saveListFilter;
  const _drawerItem=s=>_buildSaveItemHTML(s,folders,'drawer');
  if(f){
    el.innerHTML=list.map(_drawerItem).join('');
    return;
  }
  // Folder grouping — rename/delete buttons omitted (drawer is not the right place)
  const folderSections=folders.map(folder=>{
    const chars=list.filter(s=>s.folder===folder.id);
    if(!chars.length)return'';
    const chevClass='si-folder-chevron'+(folder.collapsed?'':' open');
    const bodyClass='si-folder-body'+(folder.collapsed?' collapsed':'');
    return `<div class="si-folder">
      <div class="si-folder-hdr" onclick="toggleFolderCollapsed('${folder.id}')">
        <span class="${chevClass}">▶</span>
        <span class="si-folder-name">${escH(folder.name)}</span>
        <span class="si-folder-count">${chars.length}</span>
      </div>
      <div class="${bodyClass}">${chars.map(_drawerItem).join('')}</div>
    </div>`;
  }).join('');
  const ungrouped=list.filter(s=>!s.folder||!folders.find(fd=>fd.id===s.folder));
  el.innerHTML=folderSections+(ungrouped.length?`<div class="si-ungrouped">${ungrouped.map(_drawerItem).join('')}</div>`:'');
}
// ── End tablet drawer ─────────────────────────────────────────────────────────

// ── Core derived stat functions ───────────────────────────────────────────────
// All accept an optional `char` parameter. When omitted, they fall back to the
// global STATE object so all existing call sites continue to work unchanged.
// Storyteller Mode passes instance/source objects explicitly to these functions
// so instances can calculate their own derived stats without touching STATE.
function getAttr(k,char){return((char||STATE).attributes||{})[k]||0;}
function getSkill(k,char){const s=((char||STATE).skills||{})[k];return s?s.rating||0:0;}
function calcBaseHealth(char){char=char||STATE;return getAttr('stamina',char)+(char.size||5);}
function calcBaseWillpower(char){char=char||STATE;return getAttr('resolve',char)+getAttr('composure',char);}
function calcBaseDefense(char){char=char||STATE;return Math.min(getAttr('dexterity',char),getAttr('wits',char))+getSkill('athletics',char);}
function calcBaseInitiative(char){char=char||STATE;return getAttr('dexterity',char)+getAttr('composure',char);}
function calcBaseSpeed(char){char=char||STATE;return getAttr('strength',char)+getAttr('dexterity',char)+5;}
function getHealthMax(char){char=char||STATE;return Math.max(1,calcBaseHealth(char)+((char.derivedOverrides||{}).health||0));}
function getWpMax(char){char=char||STATE;return char.willpower_max_override!=null?char.willpower_max_override:calcBaseWillpower(char);}
function calcGearMods(char){
  char=char||STATE;
  let defPenalty=0,initMod=0,speedPenalty=0;
  const coverage={head:{g:0,b:0},torso:{g:0,b:0},arms:{g:0,b:0},legs:{g:0,b:0}};
  (char.armor||[]).forEach(a=>{
    if(!a.equipped)return;
    defPenalty+=(a.defense_penalty||0);
    speedPenalty+=(a.speed_penalty||0);
    const cov=a.coverage||{};
    ['head','torso','arms','legs'].forEach(loc=>{
      if(cov[loc]){coverage[loc].g+=(a.armor_general||0);coverage[loc].b+=(a.armor_ballistic||0);}
    });
  });
  (char.weapons||[]).forEach(w=>{if(w.equipped)initMod+=(w.initiative_mod||0);});
  return{defPenalty,initMod,speedPenalty,coverage};
}

function _uuid(){return'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:r&0x3|0x8).toString(16);});}
function _distribute(total,slots){
  const vals=Array(slots).fill(1);let rem=total-slots;
  while(rem>0){const el=vals.map((v,i)=>v<5?i:-1).filter(i=>i>=0);if(!el.length)break;vals[el[Math.random()*el.length|0]]++;rem--;}
  for(let i=vals.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[vals[i],vals[j]]=[vals[j],vals[i]];}
  return vals;
}
function _distributeSkills(total,slots){
  const vals=Array(slots).fill(0);
  for(let t=0;t<total;t++){const el=vals.map((v,i)=>v<5?i:-1).filter(i=>i>=0);if(!el.length)break;vals[el[Math.random()*el.length|0]]++;}
  for(let i=vals.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[vals[i],vals[j]]=[vals[j],vals[i]];}
  return vals;
}
// _baseCharacterFields(attrs, skills) — builds the initial STATE object for a
// new character. Takes pre-computed attr and skill maps, derives initial health/
// willpower/defense values, stamps zeroed state for every section type defined
// in SECTION_DEFS, and returns the complete object. Called by generateMortal(),
// generateEntity(), blank(), and blankEntity() — always followed by patchState().
function _baseCharacterFields(attrs,skills){
  const stamina=attrs.stamina||1,resolve=attrs.resolve||1,composure=attrs.composure||1;
  const dexterity=attrs.dexterity||1,wits=attrs.wits||1,strength=attrs.strength||1;
  const athletics=(skills.athletics&&skills.athletics.rating)||0;
  const size=5;
  const base={};
  SECTION_DEFS.forEach(sd=>{
    const t=sd.type,sk=sd.state_key;
    if(t==='beats-xp'){base[sd.beats_key||'beats']=0;base[sd.xp_key||'experience']=0;return;}
    if(t==='header-fields'){(sd.fields||[]).forEach(f=>{if(base[f.key]===undefined)base[f.key]='';});return;}
    if(!sk||sk in base)return;
    if(t==='line-list'||t==='named-list'||t==='rated-list'||t==='pool-list')base[sk]=[];
    else if(t==='textarea')base[sk]='';
    else if(t==='dot-track')base[sk]=sd.default_value||1;
    else if(t==='dot-square-track'){base[sk]=sd.max||10;base[sk+'_squares']=Array(sd.max||10).fill(false);}
    else if(t==='resource-track')base[sk]=Array(sd.max||20).fill(false);
    else if(t==='labeled-track'){base[sk]=sd.default_value||1;base[sk+'_labels']=Array(sd.max||10).fill('');}
    else if(t==='arcana-block')base[sk]=Object.fromEntries((sd.fields||[]).map(f=>[f.key,0]));
    else if(t==='renown-block')base[sk]=Object.fromEntries((sd.fields||[]).map(f=>[f.key,0]));
    else if(t==='pillars-block')base[sk]=Object.fromEntries((sd.fields||[]).map(f=>[f.key,{dots:0,squares:Array(5).fill(false),note:''}]));
    else if(t==='cipher-block')base[sk]=Object.fromEntries((sd.fields||[]).map(f=>[f.key,'']));
    else if(t==='covers')base[sk]=[];
    else if(t==='quinpar-wheel'){base[sk+'_quintessence']=0;base[sk+'_paradox']=0;}
    else if(t==='clarity-track'){base[sk]=[];base[sk+'_max_override']=null;}
    else if(t==='stability-track'){base[sk]=[];base[sk+'_max_override']=null;}
    else if(t==='attributes-3'){
      // entity_attrs initialised here; other entity fields handled by derived-traits-entity
      if(!STATE.entity_attrs)STATE.entity_attrs={};
      ENTITY_ATTRS.forEach(a=>{if(STATE.entity_attrs[a.key]==null)STATE.entity_attrs[a.key]=1;});
      if(STATE.attr3MaxDots==null)STATE.attr3MaxDots=5;
      if(STATE.attr3ShowSpinner===undefined)STATE.attr3ShowSpinner=false;
    }
    else if(t==='derived-traits-entity'){
      if(STATE.entity_size==null)STATE.entity_size=5;
      if(STATE.entity_rank_num==null)STATE.entity_rank_num=1;
      if(STATE.entity_essence_max==null)STATE.entity_essence_max=10;
      if(STATE.entity_essence_current==null)STATE.entity_essence_current=0;
      if(STATE.corpus_track===undefined)STATE.corpus_track=[];
      if(STATE.corpus_max_override===undefined)STATE.corpus_max_override=null;
      if(STATE.entity_wp_spent==null)STATE.entity_wp_spent=0;
      if(STATE.entity_wp_max_override===undefined)STATE.entity_wp_max_override=null;
      if(!STATE.entityDerivedOverrides)STATE.entityDerivedOverrides={};
      if(STATE.entity_defense==null)STATE.entity_defense=0;
      if(STATE.entity_initiative==null)STATE.entity_initiative=0;
      if(STATE.entity_speed==null)STATE.entity_speed=0;
    }
  });
  return{id:_uuid(),name:'',
    attributes:attrs,skills,size,
    health_track:Array(stamina+size).fill(''),
    willpower_spent:0,willpower_max_override:null,
    defense:Math.min(dexterity,wits)+athletics,initiative:dexterity+composure,speed:strength+dexterity+5,
    derivedOverrides:{},
    meritMaxDots:5,sectionConfig:{},...base,layoutLocked:true,theme:'neutral',watermark:'mortal',watermark_opacity:0.035,
    resource_track_maxes:{},
    // Ephemeral Entity fields — zeroed for mortal characters
    entity_attrs:{power:1,finesse:1,resistance:1},
    entity_size:5,entity_rank_num:1,entity_type:'',entity_rank:'',entity_concept:'',entity_virtue:'',entity_vice:'',
    entity_essence_max:10,entity_essence_current:0,
    corpus_track:[],corpus_max_override:null,
    entity_wp_spent:0,entity_wp_max_override:null,
    entityDerivedOverrides:{},
    entity_defense:0,entity_initiative:0,entity_speed:0,
    attr3MaxDots:5,attr3ShowSpinner:false,
    numina:[],manifestations:[],influences:[],anchors:[],
    entity_ban:'',entity_bane:'',folder:null};
}
// ── Character generation ──────────────────────────────────────────────────────
// _rr(lo, hi) — inclusive random integer, used for rank stat ranges.
function _rr(lo,hi){return lo+Math.floor(Math.random()*(hi-lo+1));}
// _applySelectedPreset — reads the preset dropdown and applies the selected
// preset to STATE.sectionConfig. Falls back to fallbackName if nothing selected.
// Used by generateMortal and blank so they respect a pre-selected preset.
function _applySelectedPreset(fallbackName){
  const sel=document.getElementById('presetSelect');
  const chosen=(sel&&sel.value)||'';
  const preset=PRESETS.find(p=>p.name===(chosen||fallbackName));
  if(preset){STATE.sectionConfig={...preset.config};delete STATE.sectionConfig._zoneOrder;}
}
function generateMortal(){
  // Respect the preset selected in the dropdown; fall back to Mortal
  _applySelectedPreset('Mortal');
  // ── Mortal generation (data-driven spreads) ───────────────────────────────
  const d=window._DB_RAW||{};
  const gen=DB.mortalGeneration||{attribute_spreads:[5,4,3],skill_spreads:[11,7,4],size:5};
  const names=d.mortal_names||['Unnamed'];
  const cats=Object.keys(ATTRIBUTES);
  for(let i=cats.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[cats[i],cats[j]]=[cats[j],cats[i]];}
  const attrSpreads=gen.attribute_spreads||[5,4,3];
  const extraDots={[cats[0]]:attrSpreads[0]||5,[cats[1]]:attrSpreads[1]||4,[cats[2]]:attrSpreads[2]||3};
  const attrs={};
  Object.entries(ATTRIBUTES).forEach(([cat,attrList])=>{
    const vals=_distribute((extraDots[cat]||3)+attrList.length,attrList.length);
    attrList.forEach((a,i)=>attrs[a]=Math.min(5,vals[i]));
  });
  const skillCats=Object.keys(SKILLS);
  for(let i=skillCats.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[skillCats[i],skillCats[j]]=[skillCats[j],skillCats[i]];}
  const skillSpreads=gen.skill_spreads||[11,7,4];
  const skillDots={[skillCats[0]]:skillSpreads[0]||11,[skillCats[1]]:skillSpreads[1]||7,[skillCats[2]]:skillSpreads[2]||4};
  const skills={};
  ALL_SKILLS.forEach(s=>skills[s]={rating:0,rote:false,specialty:'',label:SKILL_LABELS[s]});
  Object.entries(SKILLS).forEach(([cat,skList])=>{
    const vals=_distributeSkills(skillDots[cat]||4,skList.length);
    skList.forEach((s,i)=>skills[s].rating=Math.min(5,vals[i]));
  });
  const savedConfig={...STATE.sectionConfig};
  STATE=_baseCharacterFields(attrs,skills);
  STATE.sectionConfig=savedConfig;
  STATE.name=names[Math.random()*names.length|0];
  patchState();currentSaveId=null;showEditor();renderEditor();
}
function generateEphemeral(){
  // Apply Ephemeral Entity preset first, then generate
  const eePreset=PRESETS.find(p=>p.name==='Ephemeral Entity');
  if(eePreset){STATE.sectionConfig={...eePreset.config};delete STATE.sectionConfig._zoneOrder;}
  generateEntity();
}
function generateEntity(){
  // ── Ephemeral Entity generation (data-driven rank stats) ──────────────────
  const rankSel=document.getElementById('entityRankSelect');
  const rank=parseInt((rankSel&&rankSel.value)||'3')||3;
  // Type is not selected in the gen bar — default to spirit for generation
  // (Entity type is set via the Entity Identity header field on the sheet)
  const type='spirit';
  const typeEntry=(DB.entityTypes||{})[type]||{label:type,names:['Unnamed Entity']};
  const rs=(DB.rankStats||{})[String(rank)]||{power:[1,3],finesse:[1,3],resistance:[1,3],essence:[10,15],integrity:[5,7],size:[3,5],numina_count:2,manifestation_count:1};
  // Use type-specific size override if present
  const sizeRange=typeEntry.size_override||rs.size||[3,5];
  const p=_rr(...rs.power),f=_rr(...rs.finesse),r=_rr(...rs.resistance);
  const ess=_rr(...rs.essence),sz=_rr(...sizeRange),integ=_rr(...rs.integrity);
  const nCount=rs.numina_count||2,mCount=rs.manifestation_count||1;
  // Sample content
  function sampleDB(key,n){const arr=DB[key]||[];const out=[];const a=[...arr];for(let i=0;i<Math.min(n,a.length);i++)out.push(a.splice(Math.floor(Math.random()*a.length),1)[0]);return out;}
  const numina=sampleDB('numina',nCount).map(x=>({name:x.name,desc:x.desc||''}));
  const manifestations=sampleDB('manifestations',mCount).map(x=>({name:x.name,desc:x.desc||''}));
  const infCount=rank<=2?1:rank<=3?2:3;
  const influences=sampleDB('influences',infCount).map(x=>({name:x.name,rating:0}));
  const bans=DB.entityBans||[];const banes=DB.entityBanes||[];
  const ban=bans.length?bans[Math.floor(Math.random()*bans.length)]:'';
  const bane=banes.length?banes[Math.floor(Math.random()*banes.length)]:'';
  const name=typeEntry.names&&typeEntry.names.length?typeEntry.names[Math.floor(Math.random()*typeEntry.names.length)]:'Unnamed Entity';
  // Preserve existing sectionConfig (preset already applied)
  const savedConfig={...STATE.sectionConfig};
  const attrs=Object.fromEntries(Object.values(ATTRIBUTES).flat().map(a=>[a,1]));
  const skills=Object.fromEntries(ALL_SKILLS.map(s=>[s,{rating:0,rote:false,specialty:'',label:SKILL_LABELS[s]}]));
  STATE=_baseCharacterFields(attrs,skills);
  STATE.sectionConfig=savedConfig;
  STATE.name=name;
  STATE.entity_attrs={power:p,finesse:f,resistance:r};
  STATE.entity_size=sz;
  STATE.entity_rank_num=rank;
  STATE.entity_type=typeEntry.label||type;
  STATE.entity_rank=`Rank ${rank} — ${['','Minor','Common','Established','Greater','Mighty'][rank]||rank}`;
  STATE.entity_essence_max=ess;
  STATE.entity_essence_current=ess;
  STATE.corpus_track=[];
  STATE.numina=numina;
  STATE.manifestations=manifestations;
  STATE.influences=influences;
  STATE.entity_ban=ban;
  STATE.entity_bane=bane;
  STATE.theme='entity';
  patchState();currentSaveId=null;showEditor();renderEditor();
}
function blank(){
  // Respect the preset selected in the dropdown; fall back to Mortal
  _applySelectedPreset('Mortal');
  const appliedConfig={...STATE.sectionConfig};
  const attrs=Object.fromEntries(Object.values(ATTRIBUTES).flat().map(a=>[a,1]));
  const skills=Object.fromEntries(ALL_SKILLS.map(s=>[s,{rating:0,rote:false,specialty:'',label:SKILL_LABELS[s]}]));
  STATE=_baseCharacterFields(attrs,skills);
  // Restore the applied preset config (overrides the empty sectionConfig from _baseCharacterFields)
  STATE.sectionConfig={...appliedConfig};
  patchState();currentSaveId=null;showEditor();renderEditor();
}
function blankEntity(){
  // Apply Ephemeral Entity preset, read rank selector, produce a zeroed entity sheet
  const eePreset=PRESETS.find(p=>p.name==='Ephemeral Entity');
  if(eePreset){STATE.sectionConfig={...eePreset.config};delete STATE.sectionConfig._zoneOrder;}
  const rankSel=document.getElementById('entityRankSelect');
  const rank=parseInt((rankSel&&rankSel.value)||'3')||3;
  const attrs=Object.fromEntries(Object.values(ATTRIBUTES).flat().map(a=>[a,1]));
  const skills=Object.fromEntries(ALL_SKILLS.map(s=>[s,{rating:0,rote:false,specialty:'',label:SKILL_LABELS[s]}]));
  const savedConfig={...STATE.sectionConfig};
  STATE=_baseCharacterFields(attrs,skills);
  STATE.sectionConfig=savedConfig;
  STATE.entity_rank_num=rank;
  patchState();currentSaveId=null;showEditor();renderEditor();
}
function showEditor(){
  document.getElementById('emptyState').style.display='none';
  document.getElementById('editorWrap').style.display='block';
}

// ── State management ──────────────────────────────────────────────────────────
// setState(path, value) — canonical single-point STATE mutation that calls
// autoSave() automatically. path is a dot-separated string, e.g. 'name' or
// 'attributes.strength'. Nested paths are created if absent.
// Usage: setState('name', 'Alice')  →  STATE.name = 'Alice'; autoSave();
// All new mutation call sites should use this. Existing inline handlers
// (oninput/onchange) are covered by the #editorCol delegation and continue
// to work as-is; setState() is the preferred path for JS-driven mutations.
function setState(path,value){
  const parts=path.split('.');
  let obj=STATE;
  for(let i=0;i<parts.length-1;i++){
    if(obj[parts[i]]==null||typeof obj[parts[i]]!=='object')obj[parts[i]]={};
    obj=obj[parts[i]];
  }
  obj[parts[parts.length-1]]=value;
  autoSave();
}

// patchState() — called after every load or import to ensure STATE is complete.
// Adds any fields that are missing (e.g. a character saved before a new splat
// was added). Safe to call repeatedly — only fills in missing values, never
// overwrites existing ones. Also enforces array sizes for tracks whose `max`
// may have changed between versions.
function patchState(){
  if(!STATE.attributes)STATE.attributes={};
  Object.values(ATTRIBUTES).flat().forEach(a=>{if(STATE.attributes[a]==null)STATE.attributes[a]=1;});
  if(!STATE.skills)STATE.skills={};
  ALL_SKILLS.forEach(s=>{
    if(!STATE.skills[s])STATE.skills[s]={rating:0,rote:false,specialty:'',label:SKILL_LABELS[s]};
    if(STATE.skills[s].rote==null)STATE.skills[s].rote=false;
    if(STATE.skills[s].specialty==null)STATE.skills[s].specialty='';
    if(!STATE.skills[s].label)STATE.skills[s].label=SKILL_LABELS[s];
  });
  SECTION_DEFS.forEach(sd=>{
    const t=sd.type,sk=sd.state_key;
    if(t==='beats-xp'){
      const bk=sd.beats_key||'beats',xk=sd.xp_key||'experience';
      if(STATE[bk]==null)STATE[bk]=0;
      if(STATE[xk]==null)STATE[xk]=0;
    }
    else if(t==='header-fields'){(sd.fields||[]).forEach(f=>{if(STATE[f.key]==null)STATE[f.key]='';});}
    else if(t==='attributes-3'){
      if(!STATE.entity_attrs)STATE.entity_attrs={};
      ENTITY_ATTRS.forEach(a=>{if(STATE.entity_attrs[a.key]==null)STATE.entity_attrs[a.key]=1;});
      if(STATE.attr3MaxDots==null)STATE.attr3MaxDots=5;
      if(STATE.attr3ShowSpinner===undefined)STATE.attr3ShowSpinner=false;
    }
    else if(t==='derived-traits-entity'){
      if(STATE.entity_size==null)STATE.entity_size=5;
      if(STATE.entity_rank_num==null)STATE.entity_rank_num=1;
      if(STATE.entity_essence_max==null)STATE.entity_essence_max=10;
      if(STATE.entity_essence_current==null)STATE.entity_essence_current=0;
      if(STATE.corpus_max_override===undefined)STATE.corpus_max_override=null;
      // v33 migration: convert legacy corpus_damage integer to B/L/A track
      if(STATE.corpus_track===undefined){
        const legacyDmg=STATE.corpus_damage||0;
        const res=(STATE.entity_attrs||{}).resistance||1,sz=STATE.entity_size||5;
        const max=STATE.corpus_max_override!=null?STATE.corpus_max_override:(res+sz);
        const track=Array(Math.max(1,max)).fill('');
        for(let i=0;i<Math.min(legacyDmg,max);i++)track[max-1-i]='a';
        STATE.corpus_track=track;
      }
      if(!Array.isArray(STATE.corpus_track))STATE.corpus_track=[];
      if(STATE.entity_wp_spent==null)STATE.entity_wp_spent=0;
      if(STATE.entity_wp_max_override===undefined)STATE.entity_wp_max_override=null;
      if(!STATE.entityDerivedOverrides)STATE.entityDerivedOverrides={};
      if(STATE.entity_defense==null)STATE.entity_defense=0;
      if(STATE.entity_initiative==null)STATE.entity_initiative=0;
      if(STATE.entity_speed==null)STATE.entity_speed=0;
    }
    else if(sk){
      if(t==='line-list'||t==='named-list'||t==='rated-list'||t==='pool-list'){if(!STATE[sk])STATE[sk]=[];}
      else if(t==='textarea'){if(STATE[sk]==null)STATE[sk]='';}
      else if(t==='dot-track'){if(STATE[sk]==null)STATE[sk]=sd.default_value||1;}
      else if(t==='dot-square-track'){
        if(STATE[sk]==null)STATE[sk]=sd.max||10;
        const sqKey=sk+'_squares';
        const max=sd.max||10;
        if(!Array.isArray(STATE[sqKey])||STATE[sqKey].length!==max)STATE[sqKey]=Array(max).fill(false);
      }
      else if(t==='resource-track'){
        if(!STATE.resource_track_maxes)STATE.resource_track_maxes={};
        const rtMax=STATE.resource_track_maxes[sk]!=null?STATE.resource_track_maxes[sk]:(sd.max||20);
        if(!Array.isArray(STATE[sk])||STATE[sk].length!==rtMax)STATE[sk]=Array(rtMax).fill(false);
      }
      else if(t==='quinpar-wheel'){
        if(STATE[sk+'_quintessence']==null)STATE[sk+'_quintessence']=0;
        if(STATE[sk+'_paradox']==null)STATE[sk+'_paradox']=0;
      }
      else if(t==='labeled-track'){
        if(STATE[sk]==null)STATE[sk]=sd.default_value||1;
        const lblKey=sk+'_labels';
        const ltMax=sd.max||10;
        if(!Array.isArray(STATE[lblKey])||STATE[lblKey].length!==ltMax)STATE[lblKey]=Array(ltMax).fill('');
      }
      else if(t==='arcana-block'){
        if(!STATE[sk]||typeof STATE[sk]!=='object')STATE[sk]={};
        (sd.fields||[]).forEach(f=>{if(STATE[sk][f.key]==null)STATE[sk][f.key]=0;});
      }
      else if(t==='renown-block'){
        if(!STATE[sk]||typeof STATE[sk]!=='object')STATE[sk]={};
        (sd.fields||[]).forEach(f=>{if(STATE[sk][f.key]==null)STATE[sk][f.key]=0;});
      }
      else if(t==='pillars-block'){
        if(!STATE[sk]||typeof STATE[sk]!=='object')STATE[sk]={};
        (sd.fields||[]).forEach(f=>{
          if(!STATE[sk][f.key]||typeof STATE[sk][f.key]!=='object')
            STATE[sk][f.key]={dots:0,squares:Array(5).fill(false),note:''};
          else{
            if(STATE[sk][f.key].dots==null)STATE[sk][f.key].dots=0;
            if(!Array.isArray(STATE[sk][f.key].squares)||STATE[sk][f.key].squares.length!==5)
              STATE[sk][f.key].squares=Array(5).fill(false);
            if(STATE[sk][f.key].note==null)STATE[sk][f.key].note='';
          }
        });
      }
      else if(t==='cipher-block'){
        if(!STATE[sk]||typeof STATE[sk]!=='object')STATE[sk]={};
        (sd.fields||[]).forEach(f=>{if(STATE[sk][f.key]==null)STATE[sk][f.key]='';});
      }
      else if(t==='covers'){
        if(!Array.isArray(STATE[sk]))STATE[sk]=[];
        STATE[sk].forEach(c=>{
          if(!c.id)c.id=_uuid();
          if(c.cover_rating==null)c.cover_rating=7;
          if(!c.notes)c.notes='';
          if(!Array.isArray(c.merits))c.merits=[];
        });
      }
      else if(t==='clarity-track'){
        if(!Array.isArray(STATE[sk]))STATE[sk]=[];
        if(STATE[sk+'_max_override']===undefined)STATE[sk+'_max_override']=null;
      }
      else if(t==='stability-track'){
        if(!Array.isArray(STATE[sk]))STATE[sk]=[];
        if(STATE[sk+'_max_override']===undefined)STATE[sk+'_max_override']=null;
      }
    }
  });
  if(!STATE.health_track||!STATE.health_track.length)STATE.health_track=Array(getHealthMax()).fill('');
  if(STATE.willpower_spent===undefined)STATE.willpower_spent=0;
  if(STATE.willpower_max_override===undefined)STATE.willpower_max_override=null;
  if(!STATE.derivedOverrides)STATE.derivedOverrides={};
  if(STATE.size==null)STATE.size=5;
  if(!STATE.meritMaxDots)STATE.meritMaxDots=5;
  if(!STATE.attrMaxDots)STATE.attrMaxDots=5;
  if(STATE.attrShowSpinner===undefined)STATE.attrShowSpinner=false;
  if(STATE.layoutLocked===undefined)STATE.layoutLocked=true;
  if(!STATE.theme)STATE.theme='neutral';
  // v27: decouple watermark from theme. Migrate legacy watermarkVisible to new watermark field.
  if(STATE.watermark===undefined){
    STATE.watermark = (STATE.watermarkVisible===false) ? 'none' : 'mortal';
  }
  // v27.1: customWatermarkData moved to browser localStorage — strip from any old saves that have it
  if('customWatermarkData' in STATE) delete STATE.customWatermarkData;
  // v28: watermark opacity — default 0.035 for existing characters
  if(STATE.watermark_opacity==null)STATE.watermark_opacity=0.035;
  // v30: folder membership — null means ungrouped
  if(!('folder' in STATE))STATE.folder=null;
  // v33: per-character resource track max overrides
  if(!STATE.resource_track_maxes||typeof STATE.resource_track_maxes!=='object')STATE.resource_track_maxes={};
  if(!STATE.sectionConfig)STATE.sectionConfig={};
  (STATE.weapons||[]).forEach(w=>{if(w.equipped===undefined)w.equipped=false;});
  (STATE.armor||[]).forEach(a=>{
    if(a.equipped===undefined)a.equipped=false;
    if(a.speed_penalty===undefined)a.speed_penalty=0;
    if(!a.coverage||typeof a.coverage!=='object')a.coverage={head:false,torso:false,arms:false,legs:false};
    ['head','torso','arms','legs'].forEach(loc=>{if(a.coverage[loc]===undefined)a.coverage[loc]=false;});
  });
}

// ── Sheet rendering pipeline ──────────────────────────────────────────────────
// renderEditor() — top-level call. Rebuilds ZONES, populates all zone
// containers via renderSheetZone(), applies visibility, theme, and watermark,
// then initialises drag-drop and collapse in the next animation frame (so the
// DOM is fully painted before event listeners are attached).
//
// renderSheetZone(zone, containerId) — iterates the zone's section defs in
// order, calls buildSectionHTML() to get the HTML string for each, injects it,
// then dispatches to per-type render functions that need live DOM work after
// injection (attributes, skills, dot tracks, arcana, etc.).
//
// buildSectionHTML(sd) — returns the full HTML string for one section based on
// sd.type. Every section wraps its content in .sec-collapsible-body so the
// collapse system can hide/show it without unmounting the content.
//
// To add a new section type, you need to touch four places:
//   1. buildSectionHTML()   — add an `if (t === 'your-type')` branch
//   2. renderSheetZone()    — add a dispatch case to call your renderer
//   3. patchState()         — initialise STATE fields with safe defaults
//   4. _baseCharacterFields() — stamp zero values on new character creation
function renderEditor(){
  rebuildZones();
  document.getElementById('charName').value=STATE.name||'';
  renderDynamicHeader();
  renderSheetZone('beats','zone-beats');
  renderSheetZone('full-width-top','zone-full-width-top');
  renderSheetZone('left-column','zone-left-column');
  renderSheetZone('right-column','zone-right-column');
  renderSheetZone('full-width-bottom','zone-full-width-bottom');
  applySectionConfig();
  updateLayoutLockButton();
  applyTheme(STATE.theme||'neutral');
  applyWatermark(STATE.watermark||'mortal');
  requestAnimationFrame(()=>{
    initDragAndDrop();
    initCollapsibleSections();
  });
}

function renderDynamicHeader(){
  const el=document.getElementById('dynamicHeader');if(!el)return;
  const hdrSecs=(ZONES['header']||[]).filter(sd=>sd.type==='header-fields');
  if(!hdrSecs.length){el.innerHTML='';return;}
  el.innerHTML=hdrSecs.map(sd=>{
    const hidden=secVisible(sd.key)?'':'hidden';
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}">
      <div class="hdr-grid" style="margin-bottom:6px">
        ${(sd.fields||[]).map(f=>`
          <div class="hdr-field">
            <span class="hdr-lbl">${escH(f.label)}</span>
            <div class="hdr-ce" contenteditable="true" spellcheck="false"
              data-placeholder="${escH(f.label)}"
              data-key="${escH(f.key)}"
              oninput="STATE[this.dataset.key]=this.textContent"
              onkeydown="if(event.key==='Enter'){event.preventDefault()}"
              onpaste="event.preventDefault();document.execCommand('insertText',false,event.clipboardData.getData('text/plain'))"
              >${escH(STATE[f.key]||'')}</div>
          </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function renderSheetZone(zone,containerId){
  const el=document.getElementById(containerId);if(!el)return;
  const secs=ZONES[zone]||[];
  el.innerHTML=secs.map(sd=>buildSectionHTML(sd)).join('');
  secs.forEach(sd=>{
    const t=sd.type;
    if(t==='attributes-9')renderAttrBlock();
    else if(t==='attributes-3')renderAttr3Block();
    else if(t==='skills')renderSkillBlock();
    else if(t==='derived-traits'){updateDerived();renderHealthTrack();renderWpTracker();}
    else if(t==='derived-traits-entity'){updateEntityDerived();renderCorpusTracker();renderEntityWpTracker();}
    else if(t==='dot-track')renderDotTrack(sd);
    else if(t==='dot-square-track')renderDotSquareTrack(sd);
    else if(t==='named-list'){
      renderNamedList(sd.state_key||sd.key,`${sd.key}-list`);
      if(sd.db_key) refillSelect(`${sd.key}-drop`,DB[sd.db_key]);
    }
    else if(t==='line-list')renderLineItems(sd.state_key||sd.key,`${sd.key}-lines`);
    else if(t==='rated-list'){
      if(sd.special_renderer==='merits'){renderMeritList();refillSelect('meritDrop',DB.merits);}
      else{ renderGenericRatedList(sd); if(sd.db_key) refillSelect(`${sd.key}-drop`,DB[sd.db_key]); }
    }
    else if(t==='weapons'){renderWeaponList();refillSelect('weaponDrop',DB.weapons);}
    else if(t==='armor'){renderArmorList();refillSelect('armorDrop',DB.armor);}
    else if(t==='equipment'){renderEquipList();refillSelect('equipDrop',DB.equipment);}
    else if(t==='resource-track')renderResourceTrack(sd);
    else if(t==='labeled-track'){/* rows rendered inline in buildSectionHTML */}
    else if(t==='arcana-block')renderArcanaBlock(sd);
    else if(t==='renown-block')renderRenownBlock(sd);
    else if(t==='pillars-block')renderPillarsBlock(sd);
    else if(t==='forms-block')renderFormsBlock(sd);
    else if(t==='cipher-block'){/* fields rendered inline in buildSectionHTML */}
    else if(t==='covers')renderCovers(sd.state_key||sd.key,`${sd.key}-list`);
    else if(t==='quinpar-wheel')renderQuinparWheel(sd.state_key||sd.key,sd.key);
    else if(t==='pool-list')renderPoolList(sd);
    else if(t==='clarity-track')renderClarityTrack(sd);
    else if(t==='stability-track')renderStabilityTrack(sd);
  });
}

// Builds one embed+interlock node overlay box for the cipher diagram
function buildCipherNode(sk,cv,embedKey,embedLbl,interlockKey,interlockLbl){
  return '<div style="display:flex;flex-direction:column;gap:2px;padding:5px 8px;width:100%">'
    +'<div class="cipher-cell-lbl" style="font-size:.5rem">'+interlockLbl+'</div>'
    +'<input style="width:100%;font-family:sans-serif;font-size:.72rem;border:none;border-bottom:1px solid var(--border-light);background:transparent;color:var(--muted);padding:1px 3px;outline:none;text-align:center"'
    +' value="'+escH(cv[interlockKey]||'')+'" oninput="setCipherField(\''+sk+'\',\''+interlockKey+'\',this.value)" placeholder="Interlock…">'
    +'<div class="cipher-cell-lbl" style="margin-top:3px">'+embedLbl+'</div>'
    +'<input style="width:100%;font-family:sans-serif;font-size:.78rem;border:none;border-bottom:1.5px solid var(--border);background:transparent;color:var(--text);padding:2px 3px;outline:none;text-align:center"'
    +' value="'+escH(cv[embedKey]||'')+'" oninput="setCipherField(\''+sk+'\',\''+embedKey+'\',this.value)" placeholder="Embed…">'
    +'</div>';
}

function buildSectionHTML(sd){
  const hidden=secVisible(sd.key)?'':'hidden';
  const t=sd.type,lbl=escH(sd.label);
  const printEmpty=sd.print_empty?'print-empty':'';

  if(t==='beats-xp')return buildBeatsXpHTML(sd,hidden);
  if(t==='attributes-9')return `<div class="sec-block ${hidden}" id="secblock-attributes">
    <div class="merit-toggle-hd"><span class="sec">Attributes <span style="font-weight:400;font-size:.6rem;color:var(--faint)">(1–10)</span></span>
      <div style="display:flex;gap:4px">
        <button id="attrMaxToggle" class="sm" onclick="event.stopPropagation();toggleAttrMax()" style="font-size:.62rem;padding:2px 7px">5-dot max</button>
        <button id="attrSpinnerToggle" class="sm" onclick="event.stopPropagation();toggleAttrSpinner()" style="font-size:.62rem;padding:2px 7px">Show number values</button>
      </div>
    </div>
    <div class="sec-collapsible-body"><div id="attrBlock"></div></div></div>`;

  if(t==='skills')return `<div class="sec-block ${hidden}" id="secblock-skills">
    <div class="sec">Skills <span style="font-weight:400;font-size:.6rem;color:var(--faint)">(0–5 · ◆ = rote)</span></div>
    <div class="sec-collapsible-body"><div id="skillBlock"></div></div></div>`;

  if(t==='derived-traits')return `<div class="sec-block ${hidden}" id="secblock-other-traits">
    <div class="sec">Other traits <span style="font-weight:400;font-size:.62rem;color:var(--faint)">(auto-calc — adjustable)</span></div>
    <div class="sec-collapsible-body">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-family:sans-serif;font-size:.82rem">
      <span style="color:var(--muted);min-width:36px">Size</span>
      <div class="spin-row"><button class="spin" onclick="adjSize(-1)">−</button><span class="av" id="v-size" style="font-size:1rem">5</span><button class="spin" onclick="adjSize(1)">+</button></div>
    </div>
    <div class="health-track-wrap">
      <div class="health-track-lbl">
        <span>Health</span>
        <span class="derived-spin-row">
          <button class="spin" onclick="adjHealthMax(-1)">−</button>
          <span id="health-max-lbl" style="font-size:.78rem;font-weight:700;min-width:16px;text-align:center"></span>
          <button class="spin" onclick="adjHealthMax(1)">+</button>
        </span>
        <span id="health-val-lbl" style="color:var(--muted);font-size:.65rem"></span>
        <span id="health-wound-lbl" style="color:var(--info);font-size:.72rem;font-family:sans-serif;font-weight:700;display:none"></span>
      </div>
      <div class="health-boxes" id="health-boxes"></div>
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="health-legend">
          <span class="hl-item"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="#999" stroke-width="1"/><line x1="1" y1="11" x2="11" y2="1" stroke="#b85c00" stroke-width="1.2"/></svg> Bashing</span>
          <span class="hl-item"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="#999" stroke-width="1"/><line x1="1" y1="11" x2="11" y2="1" stroke="#333" stroke-width="1.2"/><line x1="11" y1="11" x2="1" y2="1" stroke="#333" stroke-width="1.2"/></svg> Lethal</span>
          <span class="hl-item"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="#999" stroke-width="1"/><line x1="1" y1="11" x2="11" y2="1" stroke="#5a0000" stroke-width="1.2"/><line x1="11" y1="11" x2="1" y2="1" stroke="#5a0000" stroke-width="1.2"/><line x1="6" y1="1" x2="6" y2="11" stroke="#5a0000" stroke-width="1.2"/><line x1="1" y1="6" x2="11" y2="6" stroke="#5a0000" stroke-width="1.2"/></svg> Aggravated</span>
        </div>
        <button class="sm" onclick="clearHealthTrack()" style="font-size:.62rem;color:var(--faint);padding:1px 5px">Clear</button>
      </div>
    </div>
    <div class="tracker-wrap">
      <div class="tracker-lbl">
        <span>Willpower</span>
        <span class="derived-spin-row">
          <button class="spin" onclick="adjWpMax(-1)">−</button>
          <span id="wp-max-lbl" style="font-size:.78rem;font-weight:700;min-width:16px;text-align:center;color:var(--text)"></span>
          <button class="spin" onclick="adjWpMax(1)">+</button>
        </span>
        <span id="wp-val-lbl" style="color:var(--muted);font-size:.65rem"></span>
      </div>
      <div class="tracker-circles" id="wp-circles"></div>
      <div class="tracker-squares" id="wp-squares"></div>
    </div>
    <div class="derived-grid">
      <div class="dr"><span class="dl">Defense</span>
        <span style="display:flex;align-items:center;gap:4px">
          <span class="derived-spin-row"><button class="spin" onclick="adjDerived('defense',-1)">−</button><span id="d-defense" class="dv"></span><button class="spin" onclick="adjDerived('defense',1)">+</button></span>
          <span id="d-defense-calc" class="dv-calc" style="display:none"></span>
        </span>
      </div>
      <div class="dr"><span class="dl">Initiative</span>
        <span style="display:flex;align-items:center;gap:4px">
          <span class="derived-spin-row"><button class="spin" onclick="adjDerived('initiative',-1)">−</button><span id="d-initiative" class="dv"></span><button class="spin" onclick="adjDerived('initiative',1)">+</button></span>
          <span id="d-initiative-calc" class="dv-calc" style="display:none"></span>
        </span>
      </div>
      <div class="dr"><span class="dl">Speed</span>
        <span style="display:flex;align-items:center;gap:4px">
          <span class="derived-spin-row"><button class="spin" onclick="adjDerived('speed',-1)">−</button><span id="d-speed" class="dv"></span><button class="spin" onclick="adjDerived('speed',1)">+</button></span>
          <span id="d-speed-calc" class="dv-calc" style="display:none"></span>
        </span>
      </div>
      <div id="d-coverage-row" style="display:none;grid-column:1/-1;padding:3px 0;border-bottom:1px solid var(--border-light)">
        <div class="dl" style="margin-bottom:3px">Armor</div>
        <div style="display:flex;gap:14px;font-family:sans-serif;font-size:.78rem;flex-wrap:wrap">
          <span><span style="color:var(--muted);font-size:.68rem">Head </span><span id="d-cov-head" class="dv" title="General / Ballistic"></span></span>
          <span><span style="color:var(--muted);font-size:.68rem">Torso </span><span id="d-cov-torso" class="dv" title="General / Ballistic"></span></span>
          <span><span style="color:var(--muted);font-size:.68rem">Arms </span><span id="d-cov-arms" class="dv" title="General / Ballistic"></span></span>
          <span><span style="color:var(--muted);font-size:.68rem">Legs </span><span id="d-cov-legs" class="dv" title="General / Ballistic"></span></span>
        </div>
      </div>
    </div>
    <div style="text-align:right;margin-top:4px">
      <button class="sm" onclick="resetDerivedOverrides()" style="font-size:.62rem;color:var(--faint)">Reset to formula</button>
    </div>
    </div></div>`;

  if(t==='dot-track'){
    const sk=sd.state_key||sd.key,val=STATE[sk]||0,max=sd.max||10;
    const dots=Array.from({length:max},(_,i)=>i+1).map(d=>
      `<span class="dot${val>=d?' filled':''}" onclick="setDotTrack('${sk}',${d},${max})"></span>`).join('');
    return `<div class="sec-block ${hidden} ${printEmpty}" id="secblock-${sd.key}" style="margin-bottom:8px">
      <div class="sec" style="margin-top:12px">${lbl}</div>
      <div class="sec-collapsible-body"><div class="integrity-row">
        <div class="dot-row" id="${sd.key}-dots">${dots}</div>
        <span id="${sd.key}-val-lbl" style="color:var(--muted);font-size:.72rem;font-family:sans-serif;margin-left:4px">(${val}/${max})</span>
      </div></div></div>`;
  }

  if(t==='dot-square-track'){
    const sk=sd.state_key||sd.key,max=sd.max||10;
    const val=STATE[sk]||max;
    const sqKey=sk+'_squares';
    const squares=STATE[sqKey]||Array(max).fill(false);
    const filled=squares.filter(Boolean).length;
    const circles=Array.from({length:max},()=>`<span class="tcircle"></span>`).join('');
    const sqs=Array.from({length:max},(_,i)=>
      `<span class="tsquare${i<filled?' on':''}" onclick="toggleDotSquare('${sk}',${i})"></span>`).join('');
    return `<div class="sec-block ${hidden} ${printEmpty}" id="secblock-${sd.key}" style="margin-bottom:8px">
      <div class="sec" style="margin-top:12px">${lbl}</div>
      <div class="sec-collapsible-body"><div class="tracker-wrap" style="margin-bottom:4px">
        <div class="tracker-lbl">
          <span>${lbl}</span>
          <span class="derived-spin-row">
            <button class="spin" onclick="setDotSquareMax('${sk}',Math.max(0,(STATE['${sk}']||${max})-1),${max})">−</button>
            <span id="${sd.key}-max-lbl" style="font-size:.78rem;font-weight:700;min-width:16px;text-align:center;color:var(--text)">${val}</span>
            <button class="spin" onclick="setDotSquareMax('${sk}',Math.min(${max},(STATE['${sk}']||${max})+1),${max})">+</button>
          </span>
          <span id="${sd.key}-val-lbl" style="color:var(--muted);font-size:.65rem">(${filled} remaining)</span>
        </div>
        <div class="tracker-circles" id="${sd.key}-dots">${circles}</div>
        <div class="tracker-squares" id="${sd.key}-squares">${sqs}</div>
      </div></div></div>`;
  }

  if(t==='clarity-track'){
    const sk=sd.state_key||sd.key;
    const track=STATE[sk]||[];
    const max=getClarityMax(sd);
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}">
      <div class="sec" style="margin-top:12px">${lbl}</div>
      <div class="sec-collapsible-body">
      <div class="health-track-wrap">
        <div class="health-track-lbl">
          <span>${lbl}</span>
          <span class="derived-spin-row">
            <button class="spin" onclick="adjClarityMax('${sd.key}',-1)">−</button>
            <span id="${sd.key}-max-lbl" style="font-size:.78rem;font-weight:700;min-width:16px;text-align:center">${max}</span>
            <button class="spin" onclick="adjClarityMax('${sd.key}',1)">+</button>
          </span>
          <span id="${sd.key}-val-lbl" style="color:var(--muted);font-size:.65rem">(${track.filter(x=>x!=='').length} marked)</span>
        </div>
        <div class="health-boxes" id="${sd.key}-boxes"></div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="health-legend">
            <span class="hl-item"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="#999" stroke-width="1"/><line x1="1" y1="11" x2="11" y2="1" stroke="#b85c00" stroke-width="1.2"/></svg> Mild</span>
            <span class="hl-item"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="#999" stroke-width="1"/><line x1="1" y1="11" x2="11" y2="1" stroke="#1a1916" stroke-width="1.2"/><line x1="11" y1="11" x2="1" y2="1" stroke="#1a1916" stroke-width="1.2"/></svg> Severe</span>
          </div>
          <button class="sm" onclick="clearCustomTrack('${sk}','${sd.key}')" style="font-size:.62rem;color:var(--faint);padding:1px 5px">Clear</button>
        </div>
      </div>
      </div></div>`;
  }

  if(t==='stability-track'){
    const sk=sd.state_key||sd.key;
    const track=STATE[sk]||[];
    const max=getStabilityMax(sd);
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}">
      <div class="sec" style="margin-top:12px">${lbl}</div>
      <div class="sec-collapsible-body">
      <div class="health-track-wrap">
        <div class="health-track-lbl">
          <span>${lbl}</span>
          <span class="derived-spin-row">
            <button class="spin" onclick="adjStabilityMax('${sd.key}',-1)">−</button>
            <span id="${sd.key}-max-lbl" style="font-size:.78rem;font-weight:700;min-width:16px;text-align:center">${max}</span>
            <button class="spin" onclick="adjStabilityMax('${sd.key}',1)">+</button>
          </span>
          <span id="${sd.key}-val-lbl" style="color:var(--muted);font-size:.65rem">(${track.filter(x=>x!=='').length} marked)</span>
        </div>
        <div class="health-boxes" id="${sd.key}-boxes"></div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="health-legend">
            <span class="hl-item"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="#999" stroke-width="1"/><line x1="1" y1="11" x2="11" y2="1" stroke="#b85c00" stroke-width="1.2"/></svg> Minor</span>
            <span class="hl-item"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="#999" stroke-width="1"/><line x1="1" y1="11" x2="11" y2="1" stroke="#1a1916" stroke-width="1.2"/><line x1="11" y1="11" x2="1" y2="1" stroke="#1a1916" stroke-width="1.2"/></svg> Medium</span>
            <span class="hl-item"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="#999" stroke-width="1"/><line x1="1" y1="11" x2="11" y2="1" stroke="#5a0000" stroke-width="1.2"/><line x1="11" y1="11" x2="1" y2="1" stroke="#5a0000" stroke-width="1.2"/><line x1="6" y1="1" x2="6" y2="11" stroke="#5a0000" stroke-width="1.2"/><line x1="1" y1="6" x2="11" y2="6" stroke="#5a0000" stroke-width="1.2"/></svg> Major</span>
          </div>
          <button class="sm" onclick="clearCustomTrack('${sk}','${sd.key}')" style="font-size:.62rem;color:var(--faint);padding:1px 5px">Clear</button>
        </div>
      </div>
      </div></div>`;
  }

  if(t==='labeled-track'){
    const sk=sd.state_key||sd.key,max=sd.max||10;
    const val=STATE[sk]||1;
    const lblKey=sk+'_labels';
    const labels=STATE[lblKey]||Array(max).fill('');
    const rows=Array.from({length:max},(_,i)=>{
      const level=max-i;
      const dot=val>=level;
      return `<div class="labeled-track-row">
        <span class="labeled-track-num">${level}</span>
        <span class="dot${dot?' filled':''}" style="flex-shrink:0" onclick="setLabeledTrack('${sk}',${level},${max})"></span>
        <input class="labeled-track-lbl-inp" value="${escH(labels[level-1]||'')}"
          placeholder="Label…"
          oninput="setLabeledTrackLabel('${sk}',${level-1},this.value)">
      </div>`;
    }).join('');
    return `<div class="sec-block ${hidden} ${printEmpty}" id="secblock-${sd.key}" style="margin-bottom:8px">
      <div class="sec" style="margin-top:12px">${lbl}</div>
      <div class="sec-collapsible-body">
        <div id="${sd.key}-labeled-track">${rows}</div>
      </div></div>`;
  }

  if(t==='named-list'){
    const sk=sd.state_key||sd.key,dbKey=sd.db_key,dbRef=dbKey?`DB.${dbKey}`:'[]';
    const sId=`${sd.key}-search`,dId=`${sd.key}-drop`,descId=`${sd.key}-desc`,listId=`${sd.key}-list`;
    const addCall=`addNamedItemFromDrop('${sk}','${sId}','${dId}','${descId}','${listId}',()=>renderNamedList('${sk}','${listId}'),${dbRef})`;
    const rcStyle=sd.zone==='right-column'?'margin-top:12px':'';
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}" style="${rcStyle}">
      <div class="sec" style="${rcStyle}">${lbl}</div>
      <div class="sec-collapsible-body">
      <div id="${listId}"></div>
      <div class="add-row">
        <input id="${sId}" placeholder="Search or type…" style="flex:1" oninput="filterSelectAndFill('${sId}','${dId}','${descId}',${dbRef})">
        <select id="${dId}" onchange="fillDescFromDrop('${dId}','${descId}',${dbRef})"><option disabled selected value="">— pick —</option></select>
        <button onclick="${addCall}">Add</button>
      </div>
      <input id="${descId}" placeholder="Description (auto-fills from selection)…"
        style="width:100%;margin-top:4px;font-family:sans-serif;font-size:.82rem;padding:3px 6px;border:1px solid var(--border-light);border-radius:3px;background:var(--surface);color:var(--text)">
      </div>
    </div>`;
  }

  if(t==='line-list'){
    const sk=sd.state_key||sd.key,ph=sd.add_placeholder||'Add item…';
    const linesId=`${sd.key}-lines`,inputId=`${sd.key}-new`;
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}" style="margin-top:12px">
      <div class="sec" style="margin-top:12px">${lbl}</div>
      <div class="sec-collapsible-body">
      <div id="${linesId}" class="lines-block"></div>
      <div class="add-row">
        <input id="${inputId}" placeholder="${escH(ph)}" style="flex:1">
        <button onclick="addLineItem('${sk}','${inputId}','${linesId}')">Add</button>
      </div></div></div>`;
  }

  if(t==='rated-list'){if(sd.special_renderer==='merits')return buildMeritsHTML(sd,hidden);return buildGenericRatedHTML(sd,hidden);}
  if(t==='weapons')return buildWeaponsHTML(hidden);
  if(t==='armor')return buildArmorHTML(hidden);
  if(t==='equipment')return buildEquipmentHTML(hidden);

  if(t==='textarea'){
    const sk=sd.state_key||sd.key;
    const val=STATE[sk]||'';
    const stateExpr=`STATE['${sk}']=this.value`;
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}">
      <div class="sec" style="margin-top:18px">${lbl}</div>
      <div class="sec-collapsible-body">
      ${descField(stateExpr,val,6)}
      </div></div>`;
  }

  if(t==='resource-track'){
    const sk=sd.state_key||sd.key;
    const rtMax=getResourceTrackMax(sd);
    const numRows=Math.ceil(rtMax/10);
    const rowDivs=Array.from({length:numRows},(_,i)=>`<div class="resource-track-grid" id="${sd.key}-rt-row${i}"></div>`).join('');
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}" style="margin-bottom:8px">
      <div class="sec" style="margin-top:12px">
        <span>${lbl}</span>
        <span class="derived-spin-row" style="margin-left:6px" onclick="event.stopPropagation()">
          <button class="spin no-print" onclick="adjResourceTrackMax('${sk}','${sd.key}',-1)">−</button>
          <span id="${sd.key}-rt-max-lbl" class="no-print" style="font-size:.78rem;font-weight:700;min-width:16px;text-align:center">${rtMax}</span>
          <button class="spin no-print" onclick="adjResourceTrackMax('${sk}','${sd.key}',1)">+</button>
        </span>
      </div>
      <div class="sec-collapsible-body">
      <div id="${sd.key}-rt-rows">${rowDivs}</div>
      </div>
    </div>`;
  }

  if(t==='arcana-block'){
    const sk=sd.state_key||sd.key;
    const rows=(sd.fields||[]).map(f=>`
      <div class="arcana-row">
        <span class="arcana-lbl">${escH(f.label)}</span>
        <div class="dot-row" id="arcana-dots-${sd.key}-${f.key}"></div>
      </div>`).join('');
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}">
      <div class="sec">${lbl} <span style="font-weight:400;font-size:.6rem;color:var(--faint)">(0–5)</span></div>
      <div class="sec-collapsible-body"><div id="arcana-inner-${sd.key}">${rows}</div></div>
    </div>`;
  }

  if(t==='renown-block'){
    const sk=sd.state_key||sd.key;
    const rows=(sd.fields||[]).map(f=>`
      <div class="renown-row">
        <span class="renown-lbl">${escH(f.label)}</span>
        <div class="dot-row" id="renown-dots-${sd.key}-${f.key}"></div>
      </div>`).join('');
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}" style="margin-bottom:8px">
      <div class="sec" style="margin-top:12px">${lbl}</div>
      <div class="sec-collapsible-body"><div id="renown-inner-${sd.key}">${rows}</div></div>
    </div>`;
  }

  if(t==='pillars-block'){
    // Five named rows: label + text input on left; 5 dots (permanent) stacked above
    // 5 squares (temporary) on the right — matching the official Mummy sheet layout.
    const sk=sd.state_key||sd.key;
    const rows=(sd.fields||[]).map(f=>{
      const pf=(STATE[sk]&&STATE[sk][f.key])||{};
      const inpVal=escH(pf.note||'');
      return `<div class="pillars-row">
        <div class="pillars-left">
          <span class="pillars-lbl">${escH(f.label)}</span>
          <input class="pillars-inp" value="${inpVal}" placeholder=""
            oninput="setPillarNote('${sk}','${f.key}',this.value)">
        </div>
        <div class="pillars-tracks">
          <div class="pillars-dots" id="pillars-dots-${sd.key}-${f.key}"></div>
          <div class="pillars-squares" id="pillars-squares-${sd.key}-${f.key}"></div>
        </div>
      </div>`;
    }).join('');
    return `<div class="sec-block ${hidden} ${printEmpty}" id="secblock-${sd.key}" style="margin-bottom:8px">
      <div class="sec" style="margin-top:12px">${lbl}</div>
      <div class="sec-collapsible-body"><div id="pillars-inner-${sd.key}">${rows}</div></div>
    </div>`;
  }

  if(t==='forms-block'){
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}">
      <div class="sec" style="margin-top:14px">${lbl}</div>
      <div class="sec-collapsible-body"><div class="forms-wrap"><div class="forms-table" id="forms-table-inner-${sd.key}"></div></div></div>
    </div>`;
  }

  if(t==='cipher-block'){
    const sk=sd.state_key||sd.key;
    const cv=STATE[sk]||{};
    const teethLines=Array.from({length:12},(_,i)=>{
      const a=i*30*Math.PI/180,r1=50,r2=57;
      const x1=(280+r1*Math.cos(a)).toFixed(1),y1=(127+r1*Math.sin(a)).toFixed(1);
      const x2=(280+r2*Math.cos(a)).toFixed(1),y2=(127+r2*Math.sin(a)).toFixed(1);
      return '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="var(--border)" stroke-width="3.5"/>';
    }).join('');
    // Layout (matches official sheet):
    // Top    (y=8)  : Embed 1 only — no interlock
    // Right  (x=400): Interlock 1 above Embed 2
    // Bottom (y=182): Interlock 2 above Embed 3
    // Left   (x=18) : Interlock 3 above Embed 4
    // Centre         : Cipher
    // Node rects: top/bottom 130×62, left/right 142×62
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}">
      <div class="sec" style="margin-top:14px">${lbl}</div>
      <div class="sec-collapsible-body">
        <div class="cipher-outer">
          <div class="cipher-diagram">
            <svg class="cipher-svg" viewBox="0 0 560 270" xmlns="http://www.w3.org/2000/svg" style="pointer-events:none">
              <defs>
                <filter id="gshadow" x="-15%" y="-15%" width="130%" height="130%">
                  <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="rgba(0,0,0,.15)"/>
                </filter>
              </defs>
              <!-- connectors -->
              <line x1="160" y1="127" x2="226" y2="127" stroke="var(--border)" stroke-width="2"/>
              <line x1="334" y1="127" x2="400" y2="127" stroke="var(--border)" stroke-width="2"/>
              <line x1="280" y1="8"   x2="280" y2="73"  stroke="var(--border)" stroke-width="2"/>
              <line x1="280" y1="181" x2="280" y2="187" stroke="var(--border)" stroke-width="2"/>
              <!-- centre gear ring -->
              <circle cx="280" cy="127" r="54" fill="var(--chip)" stroke="var(--border)" stroke-width="2" filter="url(#gshadow)"/>
              <circle cx="280" cy="127" r="46" fill="var(--surface)" stroke="var(--border-light)" stroke-width="1"/>
              ${teethLines}
              <!-- node rects — top (embed 1 only, 44px tall), others 72px tall -->
              <rect x="215" y="8"   width="130" height="44" rx="8" fill="var(--surface)" stroke="var(--border)" stroke-width="1.5" filter="url(#gshadow)"/>
              <rect x="215" y="187" width="130" height="72" rx="8" fill="var(--surface)" stroke="var(--border)" stroke-width="1.5" filter="url(#gshadow)"/>
              <rect x="18"  y="91"  width="142" height="72" rx="8" fill="var(--surface)" stroke="var(--border)" stroke-width="1.5" filter="url(#gshadow)"/>
              <rect x="400" y="91"  width="142" height="72" rx="8" fill="var(--surface)" stroke="var(--border)" stroke-width="1.5" filter="url(#gshadow)"/>
            </svg>
            <!-- Top: Embed 1 only -->
            <div style="position:absolute;top:8px;left:215px;width:130px;display:flex;flex-direction:column;gap:2px;padding:5px 8px">
              <div class="cipher-cell-lbl">Embed 1</div>
              <input style="width:100%;font-family:sans-serif;font-size:.78rem;border:none;border-bottom:1.5px solid var(--border);background:transparent;color:var(--text);padding:2px 3px;outline:none;text-align:center"
                value="${escH(cv.embed1||'')}" oninput="setCipherField('${sk}','embed1',this.value)" placeholder="Embed…">
            </div>
            <!-- Right: Interlock 1 / Embed 2 -->
            <div style="position:absolute;top:91px;left:400px;width:142px">${buildCipherNode(sk,cv,'embed2','Embed 2','interlock1','Interlock 1')}</div>
            <!-- Bottom: Interlock 2 / Embed 3 -->
            <div style="position:absolute;top:187px;left:215px;width:130px">${buildCipherNode(sk,cv,'embed3','Embed 3','interlock2','Interlock 2')}</div>
            <!-- Left: Interlock 3 / Embed 4 -->
            <div style="position:absolute;top:91px;left:18px;width:142px">${buildCipherNode(sk,cv,'embed4','Embed 4','interlock3','Interlock 3')}</div>
            <!-- Centre: Cipher -->
            <div style="position:absolute;top:92px;left:228px;width:104px;display:flex;flex-direction:column;align-items:center;gap:3px;padding:4px 6px">
              <div class="cipher-cell-lbl" style="font-size:.5rem;letter-spacing:.05em">Cipher</div>
              <input style="width:100%;font-family:sans-serif;font-size:.82rem;font-weight:700;border:none;border-bottom:1.5px solid var(--border);background:transparent;color:var(--text);padding:2px 3px;outline:none;text-align:center"
                value="${escH(cv.cipher||'')}" oninput="setCipherField('${sk}','cipher',this.value)" placeholder="…">
            </div>
          </div>
        </div>
        <!-- Mobile fallback: vertical stack shown below 600px instead of diagram -->
        <div class="cipher-mobile-stack">
          <div class="cipher-mobile-node">
            <div class="cipher-mobile-node-lbl">Cipher</div>
            <div class="cipher-mobile-field">
              <input style="font-weight:700" value="${escH(cv.cipher||'')}" oninput="setCipherField('${sk}','cipher',this.value)" placeholder="Cipher name\u2026">
            </div>
          </div>
          <div class="cipher-mobile-node">
            <div class="cipher-mobile-node-lbl">Embed 1</div>
            <div class="cipher-mobile-field">
              <input value="${escH(cv.embed1||'')}" oninput="setCipherField('${sk}','embed1',this.value)" placeholder="Embed\u2026">
            </div>
          </div>
          <div class="cipher-mobile-node">
            <div class="cipher-mobile-node-lbl">Interlock 1 / Embed 2</div>
            <div class="cipher-mobile-field">
              <div class="cipher-mobile-field-lbl">Interlock 1</div>
              <input value="${escH(cv.interlock1||'')}" oninput="setCipherField('${sk}','interlock1',this.value)" placeholder="Interlock\u2026">
            </div>
            <div class="cipher-mobile-field">
              <div class="cipher-mobile-field-lbl">Embed 2</div>
              <input value="${escH(cv.embed2||'')}" oninput="setCipherField('${sk}','embed2',this.value)" placeholder="Embed\u2026">
            </div>
          </div>
          <div class="cipher-mobile-node">
            <div class="cipher-mobile-node-lbl">Interlock 2 / Embed 3</div>
            <div class="cipher-mobile-field">
              <div class="cipher-mobile-field-lbl">Interlock 2</div>
              <input value="${escH(cv.interlock2||'')}" oninput="setCipherField('${sk}','interlock2',this.value)" placeholder="Interlock\u2026">
            </div>
            <div class="cipher-mobile-field">
              <div class="cipher-mobile-field-lbl">Embed 3</div>
              <input value="${escH(cv.embed3||'')}" oninput="setCipherField('${sk}','embed3',this.value)" placeholder="Embed\u2026">
            </div>
          </div>
          <div class="cipher-mobile-node">
            <div class="cipher-mobile-node-lbl">Interlock 3 / Embed 4</div>
            <div class="cipher-mobile-field">
              <div class="cipher-mobile-field-lbl">Interlock 3</div>
              <input value="${escH(cv.interlock3||'')}" oninput="setCipherField('${sk}','interlock3',this.value)" placeholder="Interlock\u2026">
            </div>
            <div class="cipher-mobile-field">
              <div class="cipher-mobile-field-lbl">Embed 4</div>
              <input value="${escH(cv.embed4||'')}" oninput="setCipherField('${sk}','embed4',this.value)" placeholder="Embed\u2026">
            </div>
          </div>
        </div>
          <div class="cipher-final-truth" style="margin-top:8px">
            <div class="cipher-final-truth-lbl">Final Truth</div>
            ${descField(`setCipherField('${sk}','final_truth',this.value)`,cv.final_truth||'',3)}
          </div>
      </div>
    </div>`;
  }

  if(t==='covers'){
    const sk=sd.state_key||sd.key;
    const listId=`${sd.key}-list`;
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}">
      <div class="sec" style="margin-top:14px">${lbl}</div>
      <div class="sec-collapsible-body">
        <div class="covers-list" id="${listId}"></div>
        <div class="add-row" style="margin-top:6px">
          <button onclick="addCover('${sk}','${listId}')">+ Add Cover</button>
        </div>
        <div class="hint">Each Cover represents a false identity. Cover Rating tracks how intact the identity is.</div>
      </div>
    </div>`;
  }


  // ── Ephemeral Entity: 3-attribute block ──────────────────────────────────────
  if(t==='attributes-3'){
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}">
      <div class="merit-toggle-hd"><span class="sec">Attributes <span style="font-weight:400;font-size:.6rem;color:var(--faint)">(Power / Finesse / Resistance)</span></span>
        <div style="display:flex;gap:4px">
          <button id="attr3MaxToggle" class="sm" onclick="event.stopPropagation();toggleAttr3Max()" style="font-size:.62rem;padding:2px 7px">5-dot max</button>
          <button id="attr3SpinnerToggle" class="sm" onclick="event.stopPropagation();toggleAttr3Spinner()" style="font-size:.62rem;padding:2px 7px">Show number values</button>
        </div>
      </div>
      <div class="sec-collapsible-body"><div id="attr3Block"></div></div></div>`;
  }

  // ── Ephemeral Entity: derived traits ─────────────────────────────────────────
  if(t==='derived-traits-entity'){
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}">
      <div class="sec" style="margin-top:14px">Other Traits <span style="font-weight:400;font-size:.62rem;color:var(--faint)">(auto-calc — adjustable)</span></div>
      <div class="sec-collapsible-body">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-family:sans-serif;font-size:.82rem">
        <span style="color:var(--muted);min-width:36px">Size</span>
        <div class="spin-row"><button class="spin" onclick="adjEntitySize(-1)">−</button><span class="av" id="v-entity-size" style="font-size:1rem">5</span><button class="spin" onclick="adjEntitySize(1)">+</button></div>
      </div>
      <div class="health-track-wrap">
        <div class="health-track-lbl">
          <span>Corpus</span>
          <span class="derived-spin-row">
            <button class="spin" onclick="adjCorpusMax(-1)">−</button>
            <span id="corpus-max-lbl" style="font-size:.78rem;font-weight:700;min-width:16px;text-align:center"></span>
            <button class="spin" onclick="adjCorpusMax(1)">+</button>
          </span>
          <span id="corpus-val-lbl" style="color:var(--muted);font-size:.65rem"></span>
          <span id="corpus-wound-lbl" style="color:var(--info);font-size:.72rem;font-family:sans-serif;font-weight:700;display:none"></span>
        </div>
        <div class="health-boxes" id="corpus-boxes"></div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="health-legend">
            <span class="hl-item"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="#999" stroke-width="1"/><line x1="1" y1="11" x2="11" y2="1" stroke="#b85c00" stroke-width="1.2"/></svg> Bashing</span>
            <span class="hl-item"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="#999" stroke-width="1"/><line x1="1" y1="11" x2="11" y2="1" stroke="#333" stroke-width="1.2"/><line x1="11" y1="11" x2="1" y2="1" stroke="#333" stroke-width="1.2"/></svg> Lethal</span>
            <span class="hl-item"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="#999" stroke-width="1"/><line x1="1" y1="11" x2="11" y2="1" stroke="#5a0000" stroke-width="1.2"/><line x1="11" y1="11" x2="1" y2="1" stroke="#5a0000" stroke-width="1.2"/><line x1="6" y1="1" x2="6" y2="11" stroke="#5a0000" stroke-width="1.2"/><line x1="1" y1="6" x2="11" y2="6" stroke="#5a0000" stroke-width="1.2"/></svg> Aggravated</span>
          </div>
          <button class="sm" onclick="clearCorpusTrack()" style="font-size:.62rem;color:var(--faint);padding:1px 5px">Clear</button>
        </div>
      </div>
      <div class="tracker-wrap">
        <div class="tracker-lbl">
          <span>Willpower</span>
          <span class="derived-spin-row">
            <button class="spin" onclick="adjEntityWpMax(-1)">−</button>
            <span id="entity-wp-max-lbl" style="font-size:.78rem;font-weight:700;min-width:16px;text-align:center;color:var(--text)"></span>
            <button class="spin" onclick="adjEntityWpMax(1)">+</button>
          </span>
          <span id="entity-wp-val-lbl" style="color:var(--muted);font-size:.65rem"></span>
        </div>
        <div class="tracker-circles" id="entity-wp-circles"></div>
        <div class="tracker-squares" id="entity-wp-squares"></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-family:sans-serif;font-size:.82rem">
        <span style="color:var(--muted);min-width:36px">Essence</span>
        <div class="spin-row">
          <button class="spin" onclick="adjEssenceCurrent(-1)">−</button>
          <span class="av" id="v-essence-current" style="font-size:1rem">0</span>
          <button class="spin" onclick="adjEssenceCurrent(1)">+</button>
          <span style="font-family:sans-serif;font-size:.8rem;color:var(--muted)">/</span>
          <button class="spin" onclick="adjEntityEssenceMax(-1)">−</button>
          <span class="av" id="v-essence-max" style="font-size:.9rem;color:var(--muted)">0</span>
          <button class="spin" onclick="adjEntityEssenceMax(1)">+</button>
        </div>
      </div>
      <div class="derived-grid">
        <div class="dr"><span class="dl">Defense</span>
          <span style="display:flex;align-items:center;gap:4px">
            <span class="derived-spin-row"><button class="spin" onclick="adjEntityDerived('entity_defense',-1)">−</button><span id="d-entity-defense" class="dv"></span><button class="spin" onclick="adjEntityDerived('entity_defense',1)">+</button></span>
          </span>
        </div>
        <div class="dr"><span class="dl">Initiative</span>
          <span style="display:flex;align-items:center;gap:4px">
            <span class="derived-spin-row"><button class="spin" onclick="adjEntityDerived('entity_initiative',-1)">−</button><span id="d-entity-initiative" class="dv"></span><button class="spin" onclick="adjEntityDerived('entity_initiative',1)">+</button></span>
          </span>
        </div>
        <div class="dr"><span class="dl">Speed</span>
          <span style="display:flex;align-items:center;gap:4px">
            <span class="derived-spin-row"><button class="spin" onclick="adjEntityDerived('entity_speed',-1)">−</button><span id="d-entity-speed" class="dv"></span><button class="spin" onclick="adjEntityDerived('entity_speed',1)">+</button></span>
          </span>
        </div>
        <div id="d-entity-coverage-row" style="display:none;grid-column:1/-1;padding:3px 0;border-bottom:1px solid var(--border-light)">
          <div class="dl" style="margin-bottom:3px">Armor</div>
          <div style="display:flex;gap:14px;font-family:sans-serif;font-size:.78rem;flex-wrap:wrap">
            <span><span style="color:var(--muted);font-size:.68rem">Head </span><span id="d-entity-cov-head" class="dv" title="General / Ballistic"></span></span>
            <span><span style="color:var(--muted);font-size:.68rem">Torso </span><span id="d-entity-cov-torso" class="dv" title="General / Ballistic"></span></span>
            <span><span style="color:var(--muted);font-size:.68rem">Arms </span><span id="d-entity-cov-arms" class="dv" title="General / Ballistic"></span></span>
            <span><span style="color:var(--muted);font-size:.68rem">Legs </span><span id="d-entity-cov-legs" class="dv" title="General / Ballistic"></span></span>
          </div>
        </div>
      </div>
      <div style="text-align:right;margin-top:4px">
        <button class="sm" onclick="resetEntityDerivedOverrides()" style="font-size:.62rem;color:var(--faint)">Reset to formula</button>
      </div>
      </div></div>`;
  }

  // ── Quintessence/Paradox wheel ──────────────────────────────────────────────
  // 20 squares arranged in a circle. Quintessence fills clockwise from pos 0
  // (top). Paradox fills counter-clockwise from pos 19 (just left of top).
  // Overlap: Paradox wins. Print: both zero out, all boxes empty.
  if(t==='quinpar-wheel'){
    const sk=sd.state_key||sd.key;
    const qVal=STATE[sk+'_quintessence']||0;
    const pVal=STATE[sk+'_paradox']||0;
    const qLbl=escH(sd.top_label||'Quintessence');
    const pLbl=escH(sd.bottom_label||'Paradox');
    return `<div class="sec-block ${hidden}" id="secblock-${sd.key}" style="margin-bottom:8px">
      <div class="sec" style="margin-top:12px">${lbl}</div>
      <div class="sec-collapsible-body">
        <div class="quinpar-wrap">
          <div class="quinpar-svg-wrap">
            <svg class="quinpar-svg" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg" id="${sd.key}-wheel-svg"></svg>
            <div class="quinpar-lbl-top">${qLbl}</div>
            <div class="quinpar-lbl-btm">${pLbl}</div>
          </div>
          <div class="quinpar-controls">
            <div class="quinpar-ctrl">
              <div class="quinpar-ctrl-lbl">${qLbl}</div>
              <div class="quinpar-ctrl-row">
                <button class="spin" onclick="adjQuinpar('${sk}','${sd.key}',-1,1)">−</button>
                <span class="quinpar-val" id="${sd.key}-q-val">${qVal}</span>
                <button class="spin" onclick="adjQuinpar('${sk}','${sd.key}',1,1)">+</button>
              </div>
            </div>
            <div class="quinpar-ctrl">
              <div class="quinpar-ctrl-lbl">${pLbl}</div>
              <div class="quinpar-ctrl-row">
                <button class="spin" onclick="adjQuinpar('${sk}','${sd.key}',-1,2)">−</button>
                <span class="quinpar-val" id="${sd.key}-p-val">${pVal}</span>
                <button class="spin" onclick="adjQuinpar('${sk}','${sd.key}',1,2)">+</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }

  if(t==='pool-list'){
    const sk=sd.state_key||sd.key;
    const listId=`${sd.key}-pool-list`;
    return `<div class="sec-block ${hidden} ${printEmpty}" id="secblock-${sd.key}">
      <div class="sec" style="margin-top:14px">${lbl}</div>
      <div class="sec-collapsible-body">
        <div class="pool-list" id="${listId}"></div>
        <div class="add-row" style="margin-top:4px">
          <button onclick="addPoolEntry('${sk}','${listId}')">Add</button>
        </div>
      </div>
    </div>`;
  }

  return '';
}

function buildBeatsXpHTML(sd,hidden){
  const bk=sd.beats_key||'beats',xk=sd.xp_key||'experience';
  const lbl=escH(sd.label);
  return `<div class="sec-block ${hidden}" id="secblock-${sd.key}" style="display:inline-flex;flex-direction:column;gap:4px">
    <div class="bx-lbl" style="font-size:.58rem;font-family:sans-serif;text-transform:uppercase;letter-spacing:.06em;color:var(--faint)">${lbl}</div>
    <div style="display:flex;gap:16px;align-items:flex-start">
      <div class="bx-cell">
        <div class="bx-lbl">Beats</div>
        <div class="spin-row">
          <button class="spin" onclick="adjBeats('${bk}','${xk}',-1)">−</button>
          <span class="av" id="v-${bk}" style="font-size:1rem">${STATE[bk]||0}</span>
          <span style="font-family:sans-serif;font-size:.8rem;color:var(--muted)">/5</span>
          <button class="spin" onclick="adjBeats('${bk}','${xk}',1)">+</button>
        </div>
      </div>
      <div class="bx-cell">
        <div class="bx-lbl">Experience</div>
        <div class="spin-row">
          <button class="spin" onclick="adjXP('${xk}',-1)">−</button>
          <span class="av" id="v-${xk}" style="font-size:1rem">${STATE[xk]||0}</span>
          <button class="spin" onclick="adjXP('${xk}',1)">+</button>
        </div>
      </div>
    </div>
  </div>`;
}
function buildMeritsHTML(sd,hidden){
  return `<div class="sec-block ${hidden}" id="secblock-merits">
    <div class="merit-toggle-hd"><span class="sec">${escH(sd.label||'Merits')}</span>
      <button id="meritMaxToggle" class="sm" onclick="event.stopPropagation();toggleMeritMax()" style="font-size:.62rem;padding:2px 7px">5-dot max</button>
    </div>
    <div class="sec-collapsible-body">
    <hr style="border:none;border-top:1px solid var(--border-light);margin-bottom:8px">
    <div id="meritList"></div>
    <div class="add-row">
      <input id="meritSearch" placeholder="Search…" oninput="filterSelect('meritSearch','meritDrop',DB.merits)">
      <select id="meritDrop"><option disabled selected value="">— pick —</option></select>
      <button onclick="addMerit()">Add</button>
    </div>
    <div class="hint">Click dots to set rating.</div>
    </div></div>`;
}
function buildGenericRatedHTML(sd,hidden){
  const sk=sd.state_key||sd.key,max=sd.max_rating||5,dbKey=sd.db_key,dbRef=dbKey?`DB.${dbKey}`:'[]';
  const sId=`${sd.key}-search`,dId=`${sd.key}-drop`,listId=`${sd.key}-rated-list`;
  return `<div class="sec-block ${hidden}" id="secblock-${sd.key}">
    <div class="sec" style="margin-top:14px">${escH(sd.label)}</div>
    <div class="sec-collapsible-body">
    <hr style="border:none;border-top:1px solid var(--border-light);margin-bottom:8px">
    <div id="${listId}"></div>
    <div class="add-row">
      <input id="${sId}" placeholder="Search or type…" oninput="filterSelect('${sId}','${dId}',${dbRef})">
      <select id="${dId}"><option disabled selected value="">— pick —</option></select>
      <button onclick="addGenericRated('${sk}','${sId}','${dId}','${listId}',${max},${dbRef},'${sd.key}')">Add</button>
    </div>
    <div class="hint">Click dots to set rating (1–${max}).</div>
    </div></div>`;
}
function buildWeaponsHTML(hidden){
  return `<div class="sec-block ${hidden}" id="secblock-weapons">
    <div class="sec">Weapons</div>
    <div class="sec-collapsible-body"><div id="weaponList"></div>
    <div class="add-row">
      <input id="weaponSearch" placeholder="Search…" oninput="filterSelect('weaponSearch','weaponDrop',DB.weapons)">
      <select id="weaponDrop"><option disabled selected value="">— pick —</option></select>
      <button onclick="addWeapon()">Add</button>
    </div>
    <div class="hint">Tick Equipped to apply Initiative modifier to derived traits.</div>
    </div></div>`;
}
function buildArmorHTML(hidden){
  return `<div class="sec-block ${hidden}" id="secblock-armor">
    <div class="sec">Armor</div>
    <div class="sec-collapsible-body"><div id="armorList"></div>
    <div class="add-row">
      <input id="armorSearch" placeholder="Search…" oninput="filterSelect('armorSearch','armorDrop',DB.armor)">
      <select id="armorDrop"><option disabled selected value="">— pick —</option></select>
      <button onclick="addArmor()">Add</button>
    </div>
    <div class="hint">Tick Equipped to apply Defense, Speed penalties to derived traits.</div>
    </div></div>`;
}
function buildEquipmentHTML(hidden){
  return `<div class="sec-block ${hidden}" id="secblock-equipment">
    <div class="sec">Equipment</div>
    <div class="sec-collapsible-body"><div id="equipList"></div>
    <div class="add-row">
      <input id="equipSearch" placeholder="Search…" oninput="filterSelect('equipSearch','equipDrop',DB.equipment)">
      <select id="equipDrop"><option disabled selected value="">— pick —</option></select>
      <button onclick="addEquip()">Add</button>
    </div>
    </div></div>`;
}

function renderAttrBlock(){
  const el=document.getElementById('attrBlock');if(!el)return;
  const maxD=STATE.attrMaxDots||5;
  const showSpin=STATE.attrShowSpinner||false;
  const ROW_LABELS=['Power','Finesse','Resistance'];
  el.innerHTML=`<div class="attr-wrap">
    <div class="attr-row-labels">
      <div class="attr-row-lbl-spacer"></div>
      ${ROW_LABELS.map(r=>`<div class="attr-row-lbl">${r}</div>`).join('')}
    </div>
    <div class="attr-block${showSpin?'':' attr-spinners-hidden'}">
      ${Object.entries(ATTRIBUTES).map(([cat,attrs])=>`
        <div class="attr-category">
          <div class="attr-cat-lbl">${cat}</div>
          ${attrs.map(a=>{
            const val=getAttr(a)||1;
            const dots=Array.from({length:maxD},(_,i)=>i+1).map(d=>
              `<span class="dot${val>=d?' filled':''}" onclick="setAttrDot('${a}',${d})"></span>`).join('');
            return `<div class="attr-cell">
              <div class="an">${ATTR_LABELS[a]}</div>
              <div class="attr-dots">${dots}${val>maxD?`<span class="attr-overflow">+${val-maxD}</span>`:''}</div>
              <div class="attr-spinner">
                <button class="spin" style="width:16px;height:16px;font-size:11px" onclick="adjAttr('${a}',-1)">−</button>
                <span style="font-size:.75rem;font-family:sans-serif;color:var(--muted);min-width:14px;text-align:center" id="v-${a}">${val}</span>
                <button class="spin" style="width:16px;height:16px;font-size:11px" onclick="adjAttr('${a}',1)">+</button>
              </div></div>`;
          }).join('')}
        </div>`).join('')}
    </div>
  </div>`;
  updateAttrMaxToggle();
  updateAttrSpinnerToggle();
}
// ── Shared attribute helpers ───────────────────────────────────────────────────
// _setAttrDotShared / _adjAttrShared — parameterised so mortal and entity share logic.
function _setAttrDotShared(stateKey,maxKey,attr,val,renderFn,derivedFn){
  if(!STATE[stateKey])STATE[stateKey]={};
  const cap=STATE[maxKey]||5;
  STATE[stateKey][attr]=Math.max(1,Math.min(cap,val===(STATE[stateKey][attr]||1)?val-1:val));
  renderFn();if(derivedFn)derivedFn();
}
function _adjAttrShared(stateKey,maxKey,attr,delta,renderFn,derivedFn){
  if(!STATE[stateKey])STATE[stateKey]={};
  const cap=STATE[maxKey]||5;
  STATE[stateKey][attr]=Math.max(1,Math.min(cap,(STATE[stateKey][attr]||1)+delta));
  renderFn();if(derivedFn)derivedFn();
}
function setAttrDot(attr,val){_setAttrDotShared('attributes','attrMaxDots',attr,val,renderAttrBlock,updateDerived);}
function adjAttr(attr,delta){_adjAttrShared('attributes','attrMaxDots',attr,delta,renderAttrBlock,updateDerived);}
function toggleAttrMax(){
  const cur=STATE.attrMaxDots||5;
  STATE.attrMaxDots=cur===5?10:cur===10?15:5;
  renderAttrBlock();
}
// ── Toggle-button update utility ──────────────────────────────────────────────
// updateToggleButton(id, active, label) — sets text, background, border and colour
// on any toggle button using the standard info-colour active state.
function updateToggleButton(id,active,label){
  const el=document.getElementById(id);if(!el)return;
  el.textContent=label;
  el.style.background=active?'var(--info-bg)':'';
  el.style.borderColor=active?'var(--info)':'';
  el.style.color=active?'var(--info)':'';
}
function updateAttrMaxToggle(){
  const v=STATE.attrMaxDots||5;
  updateToggleButton('attrMaxToggle',v>5,v===5?'5-dot max':v===10?'10-dot max':'15-dot max');
}
function toggleAttrSpinner(){
  STATE.attrShowSpinner=!STATE.attrShowSpinner;
  renderAttrBlock();
}
// Note: spinner toggles are not wired through updateToggleButton() because
// they alternate between two labels ("Show…"/"Hide…") rather than the
// standard active/inactive pattern that utility expects.
function updateAttrSpinnerToggle(){
  const el=document.getElementById('attrSpinnerToggle');if(!el)return;
  const on=STATE.attrShowSpinner||false;
  el.textContent=on?'Hide number values':'Show number values';
  el.style.background=on?'var(--info-bg)':'';
  el.style.borderColor=on?'var(--info)':'';
  el.style.color=on?'var(--info)':'';
}


// ── Ephemeral Entity: 3-attribute renderer ────────────────────────────────────
function renderAttr3Block(){
  const el=document.getElementById('attr3Block');if(!el)return;
  const maxD=STATE.attr3MaxDots||5;
  const showSpin=STATE.attr3ShowSpinner||false;
  el.innerHTML=`<div class="attr-block-entity${showSpin?'':' attr-spinners-hidden'}">
    ${ENTITY_ATTRS.map(a=>{
      const val=getEntityAttrVal(a.key)||1;
      const dots=Array.from({length:maxD},(_,i)=>i+1).map(d=>
        `<span class="dot${val>=d?' filled':''}" onclick="setEntityAttrDot('${a.key}',${d})"></span>`).join('');
      return `<div class="attr-cell">
        <div class="an">${a.label}</div>
        <div class="attr-dots">${dots}${val>maxD?`<span class="attr-overflow">+${val-maxD}</span>`:''}</div>
        <div class="attr-spinner">
          <button class="spin" style="width:16px;height:16px;font-size:11px" onclick="adjEntityAttr('${a.key}',-1)">−</button>
          <span style="font-size:.75rem;font-family:sans-serif;color:var(--muted);min-width:14px;text-align:center" id="v-entity-${a.key}">${val}</span>
          <button class="spin" style="width:16px;height:16px;font-size:11px" onclick="adjEntityAttr('${a.key}',1)">+</button>
        </div></div>`;
    }).join('')}
  </div>`;
  updateAttr3MaxToggle();
  updateAttr3SpinnerToggle();
  updateEntityDerived();
}
function setEntityAttrDot(attr,val){_setAttrDotShared('entity_attrs','attr3MaxDots',attr,val,renderAttr3Block,updateEntityDerived);}
function adjEntityAttr(attr,delta){_adjAttrShared('entity_attrs','attr3MaxDots',attr,delta,renderAttr3Block,updateEntityDerived);}
function toggleAttr3Max(){
  const cur=STATE.attr3MaxDots||5;
  STATE.attr3MaxDots=cur===5?10:cur===10?15:5;
  renderAttr3Block();
}
function updateAttr3MaxToggle(){
  const v=STATE.attr3MaxDots||5;
  updateToggleButton('attr3MaxToggle',v>5,v===5?'5-dot max':v===10?'10-dot max':'15-dot max');
}
function toggleAttr3Spinner(){
  STATE.attr3ShowSpinner=!STATE.attr3ShowSpinner;
  renderAttr3Block();
}
function updateAttr3SpinnerToggle(){
  const el=document.getElementById('attr3SpinnerToggle');if(!el)return;
  const on=STATE.attr3ShowSpinner||false;
  el.textContent=on?'Hide number values':'Show number values';
  el.style.background=on?'var(--info-bg)':'';
  el.style.borderColor=on?'var(--info)':'';
  el.style.color=on?'var(--info)':'';
}

// ── Ephemeral Entity: derived traits ─────────────────────────────────────────
function getEntityAttrVal(k){return(STATE.entity_attrs||{})[k]||1;}
function calcBaseCorpus(){return getEntityAttrVal('resistance')+(STATE.entity_size||5);}
function calcBaseEntityWp(){return getEntityAttrVal('resistance')+getEntityAttrVal('finesse');}
function calcBaseEntityDefense(){
  const rank=STATE.entity_rank_num||1;
  const p=getEntityAttrVal('power'),f=getEntityAttrVal('finesse');
  return rank===1?Math.max(p,f):Math.min(p,f);
}
function calcBaseEntityInitiative(){return getEntityAttrVal('finesse')+getEntityAttrVal('resistance');}
function calcBaseEntitySpeed(){return getEntityAttrVal('power')+getEntityAttrVal('finesse')+5;}
function getCorpusMax(){return STATE.corpus_max_override!=null?STATE.corpus_max_override:calcBaseCorpus();}
function getEntityWpMax(){return STATE.entity_wp_max_override!=null?STATE.entity_wp_max_override:calcBaseEntityWp();}

function adjEntitySize(delta){
  STATE.entity_size=Math.max(1,(STATE.entity_size||5)+delta);
  const el=document.getElementById('v-entity-size');if(el)el.textContent=STATE.entity_size;
  updateEntityDerived();
}
function adjCorpusMax(delta){
  const base=calcBaseCorpus(),cur=getCorpusMax(),nv=Math.max(1,cur+delta);
  STATE.corpus_max_override=nv===base?null:nv;
  _syncCorpusTrack(nv);
  renderCorpusTracker();autoSave();
}
function adjEntityWpMax(delta){
  const base=calcBaseEntityWp(),cur=getEntityWpMax(),nv=Math.max(0,cur+delta);
  STATE.entity_wp_max_override=nv===base?null:nv;
  STATE.entity_wp_spent=Math.min(STATE.entity_wp_spent||0,nv);renderEntityWpTracker();
}
function adjEntityEssenceMax(delta){
  STATE.entity_essence_max=Math.max(0,(STATE.entity_essence_max||10)+delta);
  STATE.entity_essence_current=Math.min(STATE.entity_essence_current||0,STATE.entity_essence_max);
  updateEntityDerived();
}
function adjEssenceCurrent(delta){
  const max=STATE.entity_essence_max||10;
  STATE.entity_essence_current=Math.max(0,Math.min(max,(STATE.entity_essence_current||0)+delta));
  const el=document.getElementById('v-essence-current');if(el)el.textContent=STATE.entity_essence_current;
}

function getEntityDerivedOverrides(){if(!STATE.entityDerivedOverrides)STATE.entityDerivedOverrides={};return STATE.entityDerivedOverrides;}
function adjEntityDerived(field,delta){const ov=getEntityDerivedOverrides();ov[field]=(ov[field]||0)+delta;updateEntityDerived();}
function resetEntityDerivedOverrides(){STATE.entityDerivedOverrides={};updateEntityDerived();}

function updateEntityDerived(){
  const ov=getEntityDerivedOverrides();
  const szEl=document.getElementById('v-entity-size');if(szEl)szEl.textContent=STATE.entity_size||5;
  const base={entity_defense:calcBaseEntityDefense(),entity_initiative:calcBaseEntityInitiative(),entity_speed:calcBaseEntitySpeed()};
  ['entity_defense','entity_initiative','entity_speed'].forEach(k=>{
    STATE[k]=base[k]+(ov[k]||0);
    const domKey=k.replace('entity_','entity-');
    const el=document.getElementById('d-'+domKey);if(!el)return;
    const hasOv=(ov[k]||0)!==0;
    el.textContent=STATE[k];el.style.color=hasOv?'var(--info)':'';
  });
  // Essence display
  const ecEl=document.getElementById('v-essence-current');if(ecEl)ecEl.textContent=STATE.entity_essence_current||0;
  const emEl=document.getElementById('v-essence-max');if(emEl)emEl.textContent=STATE.entity_essence_max||10;
  // Coverage row — same calcGearMods() data as mortal, entity-namespaced DOM IDs
  const gm=calcGearMods();
  const entityCovRowEl=document.getElementById('d-entity-coverage-row');
  if(entityCovRowEl){
    const anyEquipped=(STATE.armor||[]).some(a=>a.equipped);
    entityCovRowEl.style.display=anyEquipped?'':'none';
    if(anyEquipped){
      ['head','torso','arms','legs'].forEach(loc=>{
        const el=document.getElementById('d-entity-cov-'+loc);
        if(el)el.textContent=`${gm.coverage[loc].g}/${gm.coverage[loc].b}`;
      });
    }
  }
  renderCorpusTracker();renderEntityWpTracker();
}

function renderCorpusTracker(){
  const max=Math.max(0,getCorpusMax());
  _syncCorpusTrack(max);
  const track=STATE.corpus_track||[];
  const dmgCount=track.filter(x=>x!=='').length;
  const el=document.getElementById('corpus-boxes');
  const lbl=document.getElementById('corpus-val-lbl'),ml=document.getElementById('corpus-max-lbl');
  const wlbl=document.getElementById('corpus-wound-lbl');
  if(!el)return;
  if(ml)ml.textContent=max;
  if(lbl)lbl.textContent=`(${max-dmgCount} undamaged)`;
  let wp=0;for(let o=0;o<Math.min(3,max);o++){if(track[max-1-o]&&track[max-1-o]!=='')wp++;}
  if(wlbl){if(wp>0){wlbl.textContent=`−${wp} wound`;wlbl.style.display='';}else wlbl.style.display='none';}
  el.innerHTML=track.map((s,i)=>`<div class="hbox" onclick="cycleCorpus(${i})" title="Click to cycle: empty → bashing → lethal → aggravated → empty">${healthSVG(s)}</div>`).join('');
}
function _syncCorpusTrack(max){
  if(!Array.isArray(STATE.corpus_track))STATE.corpus_track=[];
  while(STATE.corpus_track.length<max)STATE.corpus_track.push('');
  if(STATE.corpus_track.length>max)STATE.corpus_track=STATE.corpus_track.slice(0,max);
}
function cycleCorpus(idx){
  if(!STATE.corpus_track||idx>=STATE.corpus_track.length)return;
  STATE.corpus_track[idx]=DAMAGE_CYCLE[STATE.corpus_track[idx]||'']||'';
  renderCorpusTracker();autoSave();
}
function clearCorpusTrack(){
  if(!STATE.corpus_track)return;
  STATE.corpus_track=STATE.corpus_track.map(()=>'');
  renderCorpusTracker();autoSave();
}
function renderEntityWpTracker(){
  const max=Math.max(0,getEntityWpMax()),spent=Math.min(max,STATE.entity_wp_spent||0),avail=max-spent;
  const c=document.getElementById('entity-wp-circles'),s=document.getElementById('entity-wp-squares');
  const l=document.getElementById('entity-wp-val-lbl'),ml=document.getElementById('entity-wp-max-lbl');
  if(!c||!s)return;
  if(ml)ml.textContent=max;if(l)l.textContent=`(${avail} remaining)`;
  c.innerHTML=Array.from({length:max},()=>'<span class="tcircle"></span>').join('');
  s.innerHTML=Array.from({length:max},(_,i)=>`<span class="tsquare${i<avail?' on':''}" onclick="toggleEntityWpBox(${i})"></span>`).join('');
}
function toggleEntityWpBox(idx){
  const max=getEntityWpMax(),avail=max-(STATE.entity_wp_spent||0);
  STATE.entity_wp_spent=idx<avail?max-idx:max-(idx+1);
  STATE.entity_wp_spent=Math.max(0,Math.min(max,STATE.entity_wp_spent));renderEntityWpTracker();
}
// ── End Ephemeral Entity renderers ────────────────────────────────────────────

function renderSkillBlock(){
  const el=document.getElementById('skillBlock');if(!el)return;
  el.innerHTML=Object.entries(SKILLS).map(([cat,skillList])=>`
    <div class="skill-cat-lbl">${cat}</div>
    <div class="skill-list">${skillList.map(sk=>{
      const sd=STATE.skills[sk]||{rating:0,rote:false,specialty:'',label:SKILL_LABELS[sk]};
      const rating=sd.rating||0,rote=sd.rote||false,spec=sd.specialty||'',label=sd.label||SKILL_LABELS[sk];
      const dots=[1,2,3,4,5].map(d=>`<span class="dot${rating>=d?' filled':''}" onclick="setSkillRating('${sk}',${d})"></span>`).join('');
      return `<div class="skill-row">
        <input type="checkbox" class="skill-rote" title="Rote skill" ${rote?'checked':''}
          onchange="STATE.skills['${sk}'].rote=this.checked">
        <input class="skill-name-inp" value="${escH(label)}"
          onchange="STATE.skills['${sk}'].label=this.value" onclick="event.stopPropagation()" title="Click to rename">
        <div class="dot-row">${dots}</div>
        <input class="skill-spec" value="${escH(spec)}"
          onchange="STATE.skills['${sk}'].specialty=this.value" onclick="event.stopPropagation()">
      </div>`;
    }).join('')}</div>`).join('');
}
function setSkillRating(sk,val){
  if(!STATE.skills[sk])STATE.skills[sk]={rating:0,rote:false,specialty:'',label:SKILL_LABELS[sk]};
  STATE.skills[sk].rating=(val===STATE.skills[sk].rating)?val-1:val;
  STATE.skills[sk].rating=Math.max(0,STATE.skills[sk].rating);
  updateDerived();renderSkillBlock();
}

function getDerivedOverrides(){if(!STATE.derivedOverrides)STATE.derivedOverrides={};return STATE.derivedOverrides;}
function adjDerived(field,delta){const ov=getDerivedOverrides();ov[field]=(ov[field]||0)+delta;updateDerived();}
function resetDerivedOverrides(){
  STATE.derivedOverrides={};
  STATE.willpower_max_override=null;
  STATE.willpower_spent=Math.min(STATE.willpower_spent||0,calcBaseWillpower());
  updateDerived();renderWpTracker();
}

function updateDerived(){
  const ov=getDerivedOverrides();
  const base={defense:calcBaseDefense(),initiative:calcBaseInitiative(),speed:calcBaseSpeed()};
  ['defense','initiative','speed'].forEach(k=>{
    STATE[k]=base[k]+(ov[k]||0);
    const el=document.getElementById('d-'+k);if(!el)return;
    const hasOv=(ov[k]||0)!==0;
    el.textContent=STATE[k];el.style.color=hasOv?'var(--info)':'';
    el.title=hasOv?`Formula: ${base[k]}  Override: ${ov[k]>0?'+':''}${ov[k]}`:'';
  });
  const gm=calcGearMods();
  const calcs={defense:STATE.defense+gm.defPenalty,initiative:STATE.initiative+gm.initMod,speed:STATE.speed+gm.speedPenalty};
  ['defense','initiative','speed'].forEach(k=>{
    const calcEl=document.getElementById('d-'+k+'-calc');if(!calcEl)return;
    const mod=k==='defense'?gm.defPenalty:k==='initiative'?gm.initMod:gm.speedPenalty;
    if(mod!==0){calcEl.style.display='';calcEl.textContent='→'+calcs[k];calcEl.title=`Base: ${STATE[k]}  Gear: ${mod>=0?'+':''}${mod}  Total: ${calcs[k]}`;}
    else calcEl.style.display='none';
  });
  // Coverage row — per-location armor totals; hidden when nothing is equipped
  const covRowEl=document.getElementById('d-coverage-row');
  if(covRowEl){
    const anyEquipped=(STATE.armor||[]).some(a=>a.equipped);
    covRowEl.style.display=anyEquipped?'':'none';
    if(anyEquipped){
      const locs=['head','torso','arms','legs'];
      const labels={head:'Head',torso:'Torso',arms:'Arms',legs:'Legs'};
      locs.forEach(loc=>{
        const el=document.getElementById('d-cov-'+loc);
        if(el)el.textContent=`${gm.coverage[loc].g}/${gm.coverage[loc].b}`;
      });
    }
  }
  syncHealthTrackLength();renderHealthTrack();renderWpTracker();
  SECTION_DEFS.filter(s=>s.type==='forms-block').forEach(s=>{
    if(secVisible(s.key))renderFormsBlock(s);
  });
}
function adjSize(delta){
  STATE.size=Math.max(1,(STATE.size||5)+delta);
  document.getElementById('v-size').textContent=STATE.size;
  syncHealthTrackLength();renderHealthTrack();
}

const DAMAGE_CYCLE={'':'b','b':'l','l':'a','a':''};
function syncHealthTrackLength(){
  const max=getHealthMax();if(!STATE.health_track)STATE.health_track=[];
  while(STATE.health_track.length<max)STATE.health_track.push('');
  if(STATE.health_track.length>max)STATE.health_track=STATE.health_track.slice(0,max);
}
function adjHealthMax(delta){
  const base=calcBaseHealth(),ov=(STATE.derivedOverrides||{}).health||0;
  const newOv=ov+delta,newMax=Math.max(1,base+newOv);
  STATE.derivedOverrides.health=newMax===base?0:newOv;
  syncHealthTrackLength();renderHealthTrack();
}
function renderHealthTrack(){
  syncHealthTrackLength();
  const max=getHealthMax(),track=STATE.health_track,dmgCount=track.filter(x=>x!=='').length;
  const el=document.getElementById('health-boxes'),lbl=document.getElementById('health-val-lbl');
  const mlbl=document.getElementById('health-max-lbl'),wlbl=document.getElementById('health-wound-lbl');
  if(!el)return;
  if(mlbl)mlbl.textContent=max;
  if(lbl)lbl.textContent=`(${max-dmgCount} undamaged)`;
  let wp=0;for(let o=0;o<Math.min(3,max);o++){if(track[max-1-o]&&track[max-1-o]!=='')wp++;}
  if(wlbl){if(wp>0){wlbl.textContent=`−${wp} wound`;wlbl.style.display='';}else wlbl.style.display='none';}
  el.innerHTML=track.map((state,i)=>`<div class="hbox" onclick="cycleHealth(${i})" title="Click to cycle: empty → bashing → lethal → aggravated → empty">${healthSVG(state)}</div>`).join('');
}
function healthSVG(s){
  if(!s)return'';
  if(s==='b')return`<svg viewBox="0 0 14 14"><line x1="0" y1="14" x2="14" y2="0" stroke="#b85c00" stroke-width="1.8"/></svg>`;
  if(s==='l')return`<svg viewBox="0 0 14 14"><line x1="0" y1="14" x2="14" y2="0" stroke="#1a1916" stroke-width="1.8"/><line x1="14" y1="14" x2="0" y2="0" stroke="#1a1916" stroke-width="1.8"/></svg>`;
  if(s==='a')return`<svg viewBox="0 0 14 14"><line x1="0" y1="14" x2="14" y2="0" stroke="#5a0000" stroke-width="1.8"/><line x1="14" y1="14" x2="0" y2="0" stroke="#5a0000" stroke-width="1.8"/><line x1="7" y1="0" x2="7" y2="14" stroke="#5a0000" stroke-width="1.8"/><line x1="0" y1="7" x2="14" y2="7" stroke="#5a0000" stroke-width="1.8"/></svg>`;
  return'';
}
function cycleHealth(idx){if(!STATE.health_track||idx>=STATE.health_track.length)return;STATE.health_track[idx]=DAMAGE_CYCLE[STATE.health_track[idx]||'']||'';renderHealthTrack();}
function clearHealthTrack(){if(!STATE.health_track)return;STATE.health_track=STATE.health_track.map(()=>'');renderHealthTrack();}

// ── Clarity track (Changeling) ────────────────────────────────────────────────
const CLARITY_CYCLE={'':'m','m':'s','s':''};
function getClarityMax(sd){
  const sk=sd.state_key||sd.key;
  return STATE[sk+'_max_override']!=null?STATE[sk+'_max_override']:5;
}
function adjClarityMax(sdKey,delta){
  const sd=SECTION_DEFS.find(s=>s.key===sdKey);if(!sd)return;
  const sk=sd.state_key||sd.key;
  const cur=getClarityMax(sd);
  const nv=Math.max(1,cur+delta);
  STATE[sk+'_max_override']=nv===5?null:nv;
  _syncCustomTrack(sk,nv);renderClarityTrack(sd);autoSave();
}
function renderClarityTrack(sd){
  const sk=sd.state_key||sd.key;
  const max=getClarityMax(sd);
  _syncCustomTrack(sk,max);
  const track=STATE[sk]||[];
  const marked=track.filter(x=>x!=='').length;
  const el=document.getElementById(`${sd.key}-boxes`);
  const mlbl=document.getElementById(`${sd.key}-max-lbl`);
  const vlbl=document.getElementById(`${sd.key}-val-lbl`);
  if(!el)return;
  if(mlbl)mlbl.textContent=max;
  if(vlbl)vlbl.textContent=`(${marked} marked)`;
  el.innerHTML=track.map((s,i)=>
    `<div class="hbox" onclick="cycleClarityBox('${sd.key}',${i})" title="Click to cycle: empty → mild → severe → empty">${_clarityBoxSVG(s)}</div>`
  ).join('');
}
function _clarityBoxSVG(s){
  if(s==='m')return`<svg viewBox="0 0 14 14"><line x1="0" y1="14" x2="14" y2="0" stroke="#b85c00" stroke-width="1.8"/></svg>`;
  if(s==='s')return`<svg viewBox="0 0 14 14"><line x1="0" y1="14" x2="14" y2="0" stroke="#1a1916" stroke-width="1.8"/><line x1="14" y1="14" x2="0" y2="0" stroke="#1a1916" stroke-width="1.8"/></svg>`;
  return'';
}
function cycleClarityBox(sdKey,idx){
  const sd=SECTION_DEFS.find(s=>s.key===sdKey);if(!sd)return;
  const sk=sd.state_key||sd.key;
  if(!STATE[sk]||idx>=STATE[sk].length)return;
  STATE[sk][idx]=CLARITY_CYCLE[STATE[sk][idx]||'']||'';
  renderClarityTrack(sd);autoSave();
}

// ── Stability track (Deviant) ─────────────────────────────────────────────────
const STABILITY_CYCLE={'':'minor','minor':'medium','medium':'major','major':''};
function getStabilityMax(sd){
  const sk=sd.state_key||sd.key;
  return STATE[sk+'_max_override']!=null?STATE[sk+'_max_override']:5;
}
function adjStabilityMax(sdKey,delta){
  const sd=SECTION_DEFS.find(s=>s.key===sdKey);if(!sd)return;
  const sk=sd.state_key||sd.key;
  const cur=getStabilityMax(sd);
  const nv=Math.max(1,cur+delta);
  STATE[sk+'_max_override']=nv===5?null:nv;
  _syncCustomTrack(sk,nv);renderStabilityTrack(sd);autoSave();
}
function renderStabilityTrack(sd){
  const sk=sd.state_key||sd.key;
  const max=getStabilityMax(sd);
  _syncCustomTrack(sk,max);
  const track=STATE[sk]||[];
  const marked=track.filter(x=>x!=='').length;
  const el=document.getElementById(`${sd.key}-boxes`);
  const mlbl=document.getElementById(`${sd.key}-max-lbl`);
  const vlbl=document.getElementById(`${sd.key}-val-lbl`);
  if(!el)return;
  if(mlbl)mlbl.textContent=max;
  if(vlbl)vlbl.textContent=`(${marked} marked)`;
  el.innerHTML=track.map((s,i)=>
    `<div class="hbox" onclick="cycleStabilityBox('${sd.key}',${i})" title="Click to cycle: empty → minor → medium → major → empty">${_stabilityBoxSVG(s)}</div>`
  ).join('');
}
function _stabilityBoxSVG(s){
  if(s==='minor')return`<svg viewBox="0 0 14 14"><line x1="0" y1="14" x2="14" y2="0" stroke="#b85c00" stroke-width="1.8"/></svg>`;
  if(s==='medium')return`<svg viewBox="0 0 14 14"><line x1="0" y1="14" x2="14" y2="0" stroke="#1a1916" stroke-width="1.8"/><line x1="14" y1="14" x2="0" y2="0" stroke="#1a1916" stroke-width="1.8"/></svg>`;
  if(s==='major')return`<svg viewBox="0 0 14 14"><line x1="0" y1="14" x2="14" y2="0" stroke="#5a0000" stroke-width="1.8"/><line x1="14" y1="14" x2="0" y2="0" stroke="#5a0000" stroke-width="1.8"/><line x1="7" y1="0" x2="7" y2="14" stroke="#5a0000" stroke-width="1.8"/><line x1="0" y1="7" x2="14" y2="7" stroke="#5a0000" stroke-width="1.8"/></svg>`;
  return'';
}
function cycleStabilityBox(sdKey,idx){
  const sd=SECTION_DEFS.find(s=>s.key===sdKey);if(!sd)return;
  const sk=sd.state_key||sd.key;
  if(!STATE[sk]||idx>=STATE[sk].length)return;
  STATE[sk][idx]=STABILITY_CYCLE[STATE[sk][idx]||'']||'';
  renderStabilityTrack(sd);autoSave();
}

// ── Shared custom track helpers ───────────────────────────────────────────────
function _syncCustomTrack(sk,max){
  if(!Array.isArray(STATE[sk]))STATE[sk]=[];
  while(STATE[sk].length<max)STATE[sk].push('');
  if(STATE[sk].length>max)STATE[sk]=STATE[sk].slice(0,max);
}
function clearCustomTrack(sk,sdKey){
  if(!Array.isArray(STATE[sk]))return;
  STATE[sk]=STATE[sk].map(()=>'');
  const sd=SECTION_DEFS.find(s=>s.key===sdKey);
  if(!sd)return;
  if(sd.type==='clarity-track')renderClarityTrack(sd);
  else if(sd.type==='stability-track')renderStabilityTrack(sd);
  autoSave();
}

function renderWpTracker(){
  const max=Math.max(0,getWpMax()),spent=Math.min(max,STATE.willpower_spent||0),avail=max-spent;
  const c=document.getElementById('wp-circles'),s=document.getElementById('wp-squares');
  const l=document.getElementById('wp-val-lbl'),ml=document.getElementById('wp-max-lbl');
  if(!c||!s)return;
  if(ml)ml.textContent=max;if(l)l.textContent=`(${avail} remaining)`;
  c.innerHTML=Array.from({length:max},()=>'<span class="tcircle"></span>').join('');
  s.innerHTML=Array.from({length:max},(_,i)=>`<span class="tsquare${i<avail?' on':''}" onclick="toggleWpBox(${i})"></span>`).join('');
}
function toggleWpBox(idx){
  const max=getWpMax(),avail=max-(STATE.willpower_spent||0);
  STATE.willpower_spent=idx<avail?max-idx:max-(idx+1);
  STATE.willpower_spent=Math.max(0,Math.min(max,STATE.willpower_spent));renderWpTracker();
}
function adjWpMax(delta){
  const base=calcBaseWillpower(),cur=getWpMax(),nv=Math.max(0,cur+delta);
  STATE.willpower_max_override=nv===base?null:nv;
  STATE.willpower_spent=Math.min(STATE.willpower_spent||0,nv);renderWpTracker();
}

function adjBeats(bk,xk,delta){
  let b=(STATE[bk]||0)+delta;
  if(b>=5){
    b=0;STATE[xk]=(STATE[xk]||0)+1;
    const xEl=document.getElementById('v-'+xk);if(xEl)xEl.textContent=STATE[xk];
    showStatus('Beat threshold reached — 1 XP awarded.');
  }
  if(b<0)b=0;
  STATE[bk]=b;
  const bEl=document.getElementById('v-'+bk);if(bEl)bEl.textContent=b;
}
function adjXP(xk,delta){
  STATE[xk]=Math.max(0,(STATE[xk]||0)+delta);
  const el=document.getElementById('v-'+xk);if(el)el.textContent=STATE[xk];
}

function setDotTrack(sk,val,max){
  const cur=STATE[sk]||0;STATE[sk]=(val===cur)?val-1:val;STATE[sk]=Math.max(0,Math.min(max,STATE[sk]));
  // Re-render ALL dot-track sections sharing this state key (e.g. gnosis + ascension-gnosis)
  const matches=SECTION_DEFS.filter(s=>s.type==='dot-track'&&(s.state_key||s.key)===sk);
  if(matches.length)matches.forEach(s=>renderDotTrack(s));
  else renderDotTrack({key:sk,state_key:sk,max});
}
function renderDotTrack(sd){
  // DOM IDs use sd.key (unique) to avoid collisions when multiple sections share a state_key
  const sk=sd.state_key||sd.key,val=STATE[sk]||0,max=sd.max||10;
  const dotsEl=document.getElementById(`${sd.key}-dots`),lblEl=document.getElementById(`${sd.key}-val-lbl`);
  if(dotsEl)dotsEl.innerHTML=Array.from({length:max},(_,i)=>i+1).map(d=>
    `<span class="dot${val>=d?' filled':''}" onclick="setDotTrack('${sk}',${d},${max})"></span>`).join('');
  if(lblEl)lblEl.textContent=`(${val}/${max})`;
}

function setDotSquareMax(sk,val,max){
  STATE[sk]=Math.max(0,Math.min(max,val));
  const sqKey=sk+'_squares';
  if(!Array.isArray(STATE[sqKey])||STATE[sqKey].length!==max)STATE[sqKey]=Array(max).fill(false);
  const matches=SECTION_DEFS.filter(s=>s.type==='dot-square-track'&&(s.state_key||s.key)===sk);
  if(matches.length)matches.forEach(s=>renderDotSquareTrack(s));
  else renderDotSquareTrack({key:sk,state_key:sk,max});
}
function toggleDotSquare(sk,idx){
  const sqKey=sk+'_squares';
  const max=(SECTION_DEFS.find(s=>(s.state_key||s.key)===sk)||{}).max||10;
  if(!Array.isArray(STATE[sqKey])||STATE[sqKey].length!==max)STATE[sqKey]=Array(max).fill(false);
  const filled=STATE[sqKey].filter(Boolean).length;
  if(idx===filled-1) STATE[sqKey]=STATE[sqKey].map((_,i)=>i<filled-1);
  else STATE[sqKey]=STATE[sqKey].map((_,i)=>i<=idx);
  const matches=SECTION_DEFS.filter(s=>s.type==='dot-square-track'&&(s.state_key||s.key)===sk);
  if(matches.length)matches.forEach(s=>renderDotSquareTrack(s));
  else renderDotSquareTrack({key:sk,state_key:sk});
}
function renderDotSquareTrack(sd){
  // DOM IDs use sd.key (unique) to avoid collisions when multiple sections share a state_key
  const sk=sd.state_key||sd.key,max=sd.max||10;
  const val=STATE[sk]!=null?STATE[sk]:max;
  const sqKey=sk+'_squares';
  if(!Array.isArray(STATE[sqKey])||STATE[sqKey].length!==max)STATE[sqKey]=Array(max).fill(false);
  const squares=STATE[sqKey];
  const filled=squares.filter(Boolean).length;
  const dotsEl=document.getElementById(`${sd.key}-dots`);
  const sqsEl=document.getElementById(`${sd.key}-squares`);
  const lblEl=document.getElementById(`${sd.key}-val-lbl`);
  const maxLbl=document.getElementById(`${sd.key}-max-lbl`);
  if(dotsEl)dotsEl.innerHTML=Array.from({length:max},(_,i)=>
    `<span class="tcircle"${i>=val?' style="opacity:0.2"':''}></span>`).join('');
  if(sqsEl)sqsEl.innerHTML=Array.from({length:max},(_,i)=>
    `<span class="tsquare${i<filled?' on':''}" onclick="toggleDotSquare('${sk}',${i})"></span>`).join('');
  if(maxLbl)maxLbl.textContent=val;
  if(lblEl)lblEl.textContent=`(${filled} remaining)`;
}

function getResourceTrackMax(sd){
  const sk=sd.state_key||sd.key;
  const maxes=STATE.resource_track_maxes||{};
  return maxes[sk]!=null?maxes[sk]:(sd.max||20);
}
function adjResourceTrackMax(sk,sdKey,delta){
  if(!STATE.resource_track_maxes)STATE.resource_track_maxes={};
  const sd=SECTION_DEFS.find(s=>s.key===sdKey);
  if(!sd)return;
  const base=sd.max||20;
  const cur=getResourceTrackMax(sd);
  // Floor: can't go below the number of currently-filled squares
  const filled=(STATE[sk]||[]).filter(Boolean).length;
  const nv=Math.max(filled,Math.max(1,cur+delta));
  STATE.resource_track_maxes[sk]=nv===base?null:nv;
  // Resize the state array
  if(!Array.isArray(STATE[sk]))STATE[sk]=[];
  while(STATE[sk].length<nv)STATE[sk].push(false);
  if(STATE[sk].length>nv)STATE[sk]=STATE[sk].slice(0,nv);
  // Rebuild row divs and re-render
  const rowsEl=document.getElementById(`${sdKey}-rt-rows`);
  if(rowsEl){
    const numRows=Math.ceil(nv/10);
    rowsEl.innerHTML=Array.from({length:numRows},(_,i)=>`<div class="resource-track-grid" id="${sdKey}-rt-row${i}"></div>`).join('');
  }
  const mlbl=document.getElementById(`${sdKey}-rt-max-lbl`);
  if(mlbl)mlbl.textContent=nv;
  renderResourceTrack(sd);autoSave();
}
function renderResourceTrack(sd){
  // DOM IDs use sd.key (unique) to avoid collisions when multiple sections share a state_key
  const sk=sd.state_key||sd.key;
  const rtMax=getResourceTrackMax(sd);
  const rowSize=10;
  const numRows=Math.ceil(rtMax/rowSize);
  const vals=STATE[sk]||Array(rtMax).fill(false);
  for(let row=0;row<numRows;row++){
    const el=document.getElementById(`${sd.key}-rt-row${row}`);if(!el)return;
    const start=row*rowSize,end=Math.min(start+rowSize,rtMax);
    el.innerHTML=Array.from({length:end-start},(_,i)=>{
      const idx=start+i;
      return `<div class="rsquare${vals[idx]?' on':''}" onclick="toggleResourceSquare('${sk}',${idx},'${sd.key}')"></div>`;
    }).join('');
  }
}
function toggleResourceSquare(sk,idx,sdKey){
  const matches=SECTION_DEFS.filter(s=>s.type==='resource-track'&&(s.state_key||s.key)===sk);
  const sd=matches[0];
  const rtMax=sd?getResourceTrackMax(sd):(sd&&sd.max)||20;
  if(!Array.isArray(STATE[sk])||STATE[sk].length!==rtMax)STATE[sk]=Array(rtMax).fill(false);
  STATE[sk][idx]=!STATE[sk][idx];
  if(matches.length)matches.forEach(s=>renderResourceTrack(s));
  autoSave();
}

// ── Quintessence/Paradox wheel ────────────────────────────────────────────────
// 20 squares in a circle. Position 0 = 12 o'clock, clockwise.
// Quintessence fills positions 0..Q-1 (from top, clockwise) — solid black fill.
// Paradox fills positions 19..20-P (from bottom, counter-clockwise) — X mark.
// Overlap rule: Q + P cannot exceed 20. Increasing Paradox decrements Quintessence.
// Print: controls hidden via CSS; SVG renders as-is.
// sk = state_key (for STATE reads), sectionKey = sd.key (for DOM IDs, unique)
function renderQuinparWheel(sk,sectionKey){
  const domKey=sectionKey||sk;
  const svg=document.getElementById(domKey+'-wheel-svg');if(!svg)return;
  const Q=STATE[sk+'_quintessence']||0;
  const P=STATE[sk+'_paradox']||0;
  const N=20;
  const cx=90,cy=90,R=72,hw=5.5;
  const squares=Array.from({length:N},(_,i)=>{
    // Position 0 starts at 9 o'clock (left), fills clockwise
    const angle=(2*Math.PI*i/N)-Math.PI;
    const bx=cx+R*Math.cos(angle);
    const by=cy+R*Math.sin(angle);
    const rot=(360*i/N).toFixed(2);
    const isQ=i<Q;
    const isP=P>0&&i>=(N-P);
    if(isP){
      const x1=(bx-hw).toFixed(2),y1=(by-hw).toFixed(2);
      const x2=(bx+hw).toFixed(2),y2=(by+hw).toFixed(2);
      return `<g transform="rotate(${rot},${bx.toFixed(2)},${by.toFixed(2)})">
        <rect x="${x1}" y="${y1}" width="${(hw*2).toFixed(2)}" height="${(hw*2).toFixed(2)}" rx="1.5"
          fill="transparent" stroke="var(--text)" stroke-width="1.5"/>
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--text)" stroke-width="1.2"/>
        <line x1="${x2}" y1="${y1}" x2="${x1}" y2="${y2}" stroke="var(--text)" stroke-width="1.2"/>
      </g>`;
    } else if(isQ){
      const x=(bx-hw).toFixed(2),y=(by-hw).toFixed(2);
      return `<rect transform="rotate(${rot},${bx.toFixed(2)},${by.toFixed(2)})"
        x="${x}" y="${y}" width="${(hw*2).toFixed(2)}" height="${(hw*2).toFixed(2)}"
        rx="1.5" fill="var(--text)" stroke="var(--text)" stroke-width="1.5"/>`;
    } else {
      const x=(bx-hw).toFixed(2),y=(by-hw).toFixed(2);
      return `<rect transform="rotate(${rot},${bx.toFixed(2)},${by.toFixed(2)})"
        x="${x}" y="${y}" width="${(hw*2).toFixed(2)}" height="${(hw*2).toFixed(2)}"
        rx="1.5" fill="transparent" stroke="var(--border)" stroke-width="1.5"/>`;
    }
  }).join('');
  svg.innerHTML=`<g transform="rotate(9,90,90)">${squares}</g>`;
  const qEl=document.getElementById(domKey+'-q-val');if(qEl)qEl.textContent=Q;
  const pEl=document.getElementById(domKey+'-p-val');if(pEl)pEl.textContent=P;
}
function adjQuinpar(sk,sectionKey,delta,which){
  const N=20;
  if(which===1){
    const p=STATE[sk+'_paradox']||0;
    const q=STATE[sk+'_quintessence']||0;
    STATE[sk+'_quintessence']=Math.max(0,Math.min(N-p,q+delta));
  } else {
    const q=STATE[sk+'_quintessence']||0;
    const p=STATE[sk+'_paradox']||0;
    const newP=Math.max(0,Math.min(N,p+delta));
    STATE[sk+'_paradox']=newP;
    if(newP+q>N)STATE[sk+'_quintessence']=Math.max(0,N-newP);
  }
  renderQuinparWheel(sk,sectionKey);
}

// ── Labeled-track functions ───────────────────────────────────────────────────
function setLabeledTrack(sk,val,max){
  const cur=STATE[sk]||0;
  STATE[sk]=(val===cur)?val-1:val;
  STATE[sk]=Math.max(0,Math.min(max,STATE[sk]));
  // Re-render just the dots in ALL labeled-track sections sharing this state key
  // DOM container IDs use sd.key to avoid collisions
  const matches=SECTION_DEFS.filter(s=>s.type==='labeled-track'&&(s.state_key||s.key)===sk);
  const newVal=STATE[sk];
  matches.forEach(s=>{
    const container=document.getElementById(`${s.key}-labeled-track`);if(!container)return;
    container.querySelectorAll('.labeled-track-row').forEach((row,ri)=>{
      const level=(s.max||10)-ri;
      const dot=row.querySelector('.dot');
      if(dot){
        if(newVal>=level)dot.classList.add('filled');
        else dot.classList.remove('filled');
      }
    });
  });
}
function setLabeledTrackLabel(sk,idx,val){
  const lblKey=sk+'_labels';
  if(!Array.isArray(STATE[lblKey]))STATE[lblKey]=[];
  STATE[lblKey][idx]=val;
}

function renderArcanaBlock(sd){
  const sk=sd.state_key||sd.key;
  const vals=STATE[sk]||{};
  (sd.fields||[]).forEach(f=>{
    // IDs are namespaced by section key (not state_key) to avoid collisions when
    // two arcana-block sections share the same state_key (e.g. arcana + ascension-arcana)
    const el=document.getElementById(`arcana-dots-${sd.key}-${f.key}`);if(!el)return;
    const val=vals[f.key]||0;
    el.innerHTML=Array.from({length:5},(_,i)=>i+1).map(d=>
      `<span class="dot${val>=d?' filled':''}" onclick="setArcana('${sk}','${f.key}',${d})"></span>`).join('');
  });
}
// setNestedDot(sk, fkey, val, sectionType, renderFn) — shared logic for arcana-block
// and renown-block: toggle-off if clicking the same dot, clamp 0–5, re-render all
// sections of the given type that share the same state key.
function setNestedDot(sk,fkey,val,sectionType,renderFn){
  if(!STATE[sk]||typeof STATE[sk]!=='object')STATE[sk]={};
  const cur=STATE[sk][fkey]||0;
  STATE[sk][fkey]=Math.max(0,Math.min(5,(val===cur)?val-1:val));
  SECTION_DEFS.filter(s=>s.type===sectionType&&(s.state_key||s.key)===sk)
    .forEach(s=>renderFn(s));
}
function setArcana(sk,akey,val){setNestedDot(sk,akey,val,'arcana-block',renderArcanaBlock);}
function setRenown(sk,rkey,val){setNestedDot(sk,rkey,val,'renown-block',renderRenownBlock);}

function renderRenownBlock(sd){
  // DOM IDs use sd.key (unique) to avoid collisions when multiple sections share a state_key.
  // Fields are data-driven from sd.fields — no hardcoded renown names.
  const sk=sd.state_key||sd.key;
  const vals=STATE[sk]||{};
  (sd.fields||[]).forEach(f=>{
    const el=document.getElementById(`renown-dots-${sd.key}-${f.key}`);if(!el)return;
    const val=vals[f.key]||0;
    el.innerHTML=Array.from({length:5},(_,i)=>i+1).map(d=>
      `<span class="dot${val>=d?' filled':''}" onclick="setRenown('${sk}','${f.key}',${d})"></span>`).join('');
  });
}


// ── Pillars block (Mummy: the Curse) ─────────────────────────────────────────
// Each Pillar has 5 permanent dots (rating) + 5 temporary squares (spent).
// State: STATE[sk] = { ab: { dots: 0, squares: [false×5] }, ba: {...}, ... }
function renderPillarsBlock(sd){
  const sk=sd.state_key||sd.key;
  if(!STATE[sk]||typeof STATE[sk]!=='object')STATE[sk]={};
  (sd.fields||[]).forEach(f=>{
    if(!STATE[sk][f.key]||typeof STATE[sk][f.key]!=='object')
      STATE[sk][f.key]={dots:0,squares:Array(5).fill(false),note:''};
    const pf=STATE[sk][f.key];
    const rating=pf.dots||0;
    const squares=Array.isArray(pf.squares)?pf.squares:Array(5).fill(false);
    const filled=squares.filter(Boolean).length;
    // Dots row — tcircle matches tsquare size (11px); unset dots rendered at low opacity
    // clicking cycles the permanent rating, same toggle behaviour as dot-square-track
    const dotsEl=document.getElementById(`pillars-dots-${sd.key}-${f.key}`);
    if(dotsEl)dotsEl.innerHTML=Array.from({length:5},(_,i)=>
      `<span class="tcircle" style="cursor:pointer${i>=rating?';opacity:0.2':''}"
        onclick="setPillarDot('${sk}','${f.key}',${i+1})"></span>`).join('');
    // Squares row — toggleable temporary track
    const sqsEl=document.getElementById(`pillars-squares-${sd.key}-${f.key}`);
    if(sqsEl)sqsEl.innerHTML=Array.from({length:5},(_,i)=>
      `<span class="tsquare${i<filled?' on':''}" onclick="togglePillarSquare('${sk}','${f.key}',${i})"></span>`).join('');
  });
}
function setPillarDot(sk,fkey,val){
  if(!STATE[sk])STATE[sk]={};
  if(!STATE[sk][fkey])STATE[sk][fkey]={dots:0,squares:Array(5).fill(false),note:''};
  const cur=STATE[sk][fkey].dots||0;
  STATE[sk][fkey].dots=Math.max(0,val===cur?val-1:val);
  SECTION_DEFS.filter(s=>s.type==='pillars-block'&&(s.state_key||s.key)===sk)
    .forEach(s=>renderPillarsBlock(s));
}
function togglePillarSquare(sk,fkey,idx){
  if(!STATE[sk])STATE[sk]={};
  if(!STATE[sk][fkey])STATE[sk][fkey]={dots:0,squares:Array(5).fill(false),note:''};
  const squares=STATE[sk][fkey].squares;
  if(!Array.isArray(squares)||squares.length!==5)STATE[sk][fkey].squares=Array(5).fill(false);
  const filled=STATE[sk][fkey].squares.filter(Boolean).length;
  if(idx===filled-1)STATE[sk][fkey].squares=STATE[sk][fkey].squares.map((_,i)=>i<filled-1);
  else STATE[sk][fkey].squares=STATE[sk][fkey].squares.map((_,i)=>i<=idx);
  SECTION_DEFS.filter(s=>s.type==='pillars-block'&&(s.state_key||s.key)===sk)
    .forEach(s=>renderPillarsBlock(s));
}
function setPillarNote(sk,fkey,val){
  if(!STATE[sk])STATE[sk]={};
  if(!STATE[sk][fkey])STATE[sk][fkey]={dots:0,squares:Array(5).fill(false),note:''};
  STATE[sk][fkey].note=val;
}
// ── End Pillars block ─────────────────────────────────────────────────────────

function renderFormsBlock(sd){
  const dbKey=(sd&&sd.db_key)||'werewolf_forms';
  const tableId=sd?`forms-table-inner-${sd.key}`:'forms-table-inner';
  const el=document.getElementById(tableId);if(!el)return;
  const forms=DB[dbKey]||[];
  if(!forms.length){el.innerHTML='<span style="font-size:.8rem;color:var(--faint);font-family:sans-serif;padding:8px">No form data loaded.</span>';return;}
  const attrs=STATE.attributes||{};
  const charSize=STATE.size||5;
  const ath=(STATE.skills&&STATE.skills.athletics&&typeof STATE.skills.athletics==='object')?STATE.skills.athletics.rating||0:0;
  const ATTR_DISPLAY=[
    ['strength','Strength'],['dexterity','Dexterity'],['stamina','Stamina'],
    ['presence','Presence'],['manipulation','Manipulation'],['composure','Composure'],
    ['intelligence','Intelligence'],['wits','Wits'],['resolve','Resolve']
  ];
  el.style.gridTemplateColumns=`repeat(${forms.length},1fr)`;
  el.innerHTML=forms.map((form,fi)=>{
    const mods=form.attr_mods||{};
    const fStr=(attrs.strength||0)+( mods.strength||0);
    const fDex=(attrs.dexterity||0)+(mods.dexterity||0);
    const fSta=(attrs.stamina||0)+ (mods.stamina||0);
    const fWit=(attrs.wits||0)+    (mods.wits||0);
    const fCom=(attrs.composure||0)+(mods.composure||0);
    const fSiz=charSize+(form.size_mod||0);
    const fDef=Math.min(fDex,fWit)+ath;
    const fInit=fDex+fCom;
    const fSpd=fStr+fDex+5;
    let attrRows='';
    const formDots=(val)=>{
      const max=val<=5?5:val<=10?10:15;
      return Array.from({length:max},(_,i)=>
        `<span class="dot${val>i?' filled':''}" style="width:7px;height:7px"></span>`).join('');
    };
    ATTR_DISPLAY.forEach(([akey,albl])=>{
      const base=attrs[akey]||0;
      const mod=mods[akey]||0;
      if(fi===0){
        if(base>0)attrRows+=`<div class="form-stat">${albl}<div class="dot-row" style="margin-top:2px">${formDots(base)}</div></div>`;
      } else {
        if(mod!==0){
          const total=Math.max(0,base+mod);
          const sign=mod>0?'+':'';
          attrRows+=`<div class="form-stat">${albl}<span class="form-stat-mod">(${sign}${mod})</span><div class="dot-row" style="margin-top:2px">${formDots(total)}</div></div>`;
        }
      }
    });
    const derivedRows=`
      <div class="form-stat">Size: <b>${fSiz}</b></div>
      <div class="form-stat">Defense: <b>${fDef}</b></div>
      <div class="form-stat">Initiative: <b>${fInit}</b></div>
      <div class="form-stat">Speed: <b>${fSpd}</b></div>
      <div class="form-stat">Armor: <b>${form.armor||0}</b></div>
      <div class="form-stat">Perception+: <b>${form.perception_bonus||0}</b></div>`;
    const traitRows=(form.special_traits||[]).map(t=>`<div class="form-trait">${escH(t)}</div>`).join('');
    return `<div class="form-col">
      <div class="form-col-hdr">
        <div class="form-col-name">${escH(form.name)}</div>
        <div class="form-col-sub">${escH(form.subtitle||'')}</div>
      </div>
      ${attrRows}
      <div class="form-divider"></div>
      ${derivedRows}
      <div class="form-divider"></div>
      ${traitRows}
    </div>`;
  }).join('');
}

// ── Cipher functions ──────────────────────────────────────────────────────────
function setCipherField(sk,field,val){
  if(!STATE[sk]||typeof STATE[sk]!=='object')STATE[sk]={};
  STATE[sk][field]=val;
}

// ── Covers functions ──────────────────────────────────────────────────────────
// listId is always passed explicitly (derived from sd.key, not state_key) so that
// multiple covers sections sharing a state_key don't collide on DOM IDs.
function addCover(sk,listId){
  if(!Array.isArray(STATE[sk]))STATE[sk]=[];
  STATE[sk].push({id:_uuid(),name:'New Cover',age:'',appearance:'',cover_rating:7,notes:'',merits:[]});
  renderCovers(sk,listId);
}
function removeCover(sk,id,listId){
  if(!Array.isArray(STATE[sk]))return;
  STATE[sk]=STATE[sk].filter(c=>c.id!==id);
  renderCovers(sk,listId);
}
function setCoverField(sk,id,field,val){
  const c=(STATE[sk]||[]).find(x=>x.id===id);if(c)c[field]=val;
}
function setCoverRating(sk,id,val){
  const c=(STATE[sk]||[]).find(x=>x.id===id);if(!c)return;
  c.cover_rating=c.cover_rating===val?val-1:val;
  const dotEl=document.getElementById(`cover-rating-dots-${id}`);
  if(dotEl)dotEl.innerHTML=buildCoverRatingDots(sk,id,c.cover_rating);
}
function buildCoverRatingDots(sk,id,rating){
  return Array.from({length:10},(_,i)=>i+1).map(d=>
    `<span class="dot${rating>=d?' filled':''}" onclick="setCoverRating('${sk}','${id}',${d})"></span>`
  ).join('');
}
function addCoverMerit(sk,id,listId){
  const dropId=`cover-merit-drop-${id}`,searchId=`cover-merit-search-${id}`;
  const drop=document.getElementById(dropId),search=document.getElementById(searchId);
  if(!drop||!search)return;
  const val=(drop.value&&drop.value!=='')?drop.value:search.value.trim();if(!val)return;
  const c=(STATE[sk]||[]).find(x=>x.id===id);if(!c)return;
  if(!Array.isArray(c.merits))c.merits=[];
  const found=DB.merits?DB.merits.find(m=>m.name===val):null;
  c.merits.push({name:val,rating:found?found.rating||1:1,desc:found?found.desc||'':''});
  renderCovers(sk,listId);
}
function removeCoverMerit(sk,id,mi,listId){
  const c=(STATE[sk]||[]).find(x=>x.id===id);if(!c||!c.merits)return;
  c.merits.splice(mi,1);
  renderCovers(sk,listId);
}
function setCoverMeritRating(sk,id,mi,val,listId){
  const c=(STATE[sk]||[]).find(x=>x.id===id);if(!c||!c.merits)return;
  c.merits[mi].rating=val;
  renderCovers(sk,listId);
}
function renderCovers(sk,listId){
  const el=document.getElementById(listId);if(!el)return;
  const covers=STATE[sk]||[];
  const meritsDB=DB.merits||[];
  el.innerHTML=covers.map(c=>{
    const ratingDots=buildCoverRatingDots(sk,c.id,c.cover_rating||7);
    const meritRows=(c.merits||[]).map((m,mi)=>{
      const mDots=Array.from({length:5},(_,i)=>i+1).map(d=>
        `<span class="dot${(m.rating||0)>=d?' filled':''}" onclick="setCoverMeritRating('${sk}','${c.id}',${mi},${d},'${listId}')"></span>`
      ).join('');
      return `<div class="cover-merit-row">
        <span class="cover-merit-name">${escH(m.name||'')}</span>
        <div class="cover-merit-dots">${mDots}</div>
        <button class="sm danger" onclick="removeCoverMerit('${sk}','${c.id}',${mi},'${listId}')">✕</button>
      </div>`;
    }).join('');
    return `<div class="cover-card open" id="cover-card-${c.id}">
      <div class="cover-card-hd" onclick="toggleCoverCard('${c.id}')">
        <span class="cover-card-toggle">&#9654;</span>
        <input class="cover-card-name" value="${escH(c.name||'')}" placeholder="Cover name"
          onclick="event.stopPropagation()" onchange="setCoverField('${sk}','${c.id}','name',this.value)">
        <span style="font-size:.72rem;font-family:sans-serif;color:var(--muted);flex-shrink:0">Rating ${c.cover_rating||0}/10</span>
        <button class="sm danger" onclick="event.stopPropagation();removeCover('${sk}','${c.id}','${listId}')">Remove</button>
      </div>
      <div class="cover-card-body">
        <div class="cover-rating-row">
          <span class="cover-rating-lbl">Cover Rating</span>
          <div class="dot-row" id="cover-rating-dots-${c.id}">${ratingDots}</div>
          <span style="color:var(--muted);font-size:.72rem;font-family:sans-serif;margin-left:4px">(${c.cover_rating||0}/10)</span>
        </div>
        <div class="field-wrap" style="margin-bottom:8px">
          <span class="field-lbl">Description</span>
          ${descField(`setCoverField('${sk}','${c.id}','notes',this.value)`,c.notes||'')}
        </div>
        <div class="cover-merits-hd">Cover Merits</div>
        ${meritRows}
        <div class="add-row" style="margin-top:5px">
          <input id="cover-merit-search-${c.id}" placeholder="Search merits…"
            oninput="filterSelect('cover-merit-search-${c.id}','cover-merit-drop-${c.id}',DB.merits||[])">
          <select id="cover-merit-drop-${c.id}"><option disabled selected value="">— pick —</option></select>
          <button onclick="addCoverMerit('${sk}','${c.id}','${listId}')">Add</button>
        </div>
      </div>
    </div>`;
  }).join('');
  covers.forEach(c=>refillSelect(`cover-merit-drop-${c.id}`,meritsDB));
}
function toggleCoverCard(id){
  const card=document.getElementById(`cover-card-${id}`);
  if(card)card.classList.toggle('open');
}

function renderGenericRatedList(sd){
  const isMerits=sd.special_renderer==='merits';
  const sk=sd.state_key||sd.key;
  const max=isMerits?(STATE.meritMaxDots||5):(sd.max_rating||5);
  const listId=isMerits?'meritList':`${sd.key}-rated-list`;
  const el=document.getElementById(listId);if(!el)return;
  el.innerHTML=(STATE[sk]||[]).map((m,i)=>{
    const rating=m.rating||0;
    const dots=Array.from({length:max},(_,idx)=>idx+1).map(d=>
      `<span class="dot${rating>=d?' filled':''}" onclick="setGenericRatedRating('${sk}',${i},${d},'${sd.key}')"></span>`).join('');
    return `<div class="item-card open">
      <div class="item-hd" onclick="toggleCard(this)">
        <span class="item-toggle">&#9654;</span>
        <input class="item-name" value="${escH(m.name||'')}" placeholder="Name"
          onclick="event.stopPropagation()" onchange="STATE['${sk}'][${i}].name=this.value">
        <span class="item-key-stat">${'●'.repeat(rating)||'unrated'}</span>
        ${_libSyncBtn(sd.db_key,m,sk,i)}
        <button class="sm danger" onclick="event.stopPropagation();removeGenericRated('${sk}',${i},'${sd.key}')">Remove</button>
      </div>
      <div class="item-body">
        <div class="field-wrap" style="margin-bottom:5px"><span class="field-lbl">Description</span>
          ${descField(`STATE['${sk}'][${i}].desc=this.value`,m.desc||'')}
        </div>
        <div class="field-wrap"><span class="field-lbl">Rating</span><div class="dot-row">${dots}</div></div>
      </div></div>`;
  }).join('');
}
function setGenericRatedRating(sk,i,val,sdKey){
  const cur=STATE[sk][i].rating||0;
  STATE[sk][i].rating=Math.max(0,val===cur?val-1:val);
  renderGenericRatedList(SECTION_MAP[sdKey]||{key:sdKey,state_key:sk,max_rating:5});
}
function removeGenericRated(sk,i,sdKey){STATE[sk].splice(i,1);renderGenericRatedList(SECTION_MAP[sdKey]||{key:sdKey,state_key:sk,max_rating:5});}
function addGenericRated(sk,sId,dId,listId,max,dbList,sdKey){
  const drop=document.getElementById(dId),search=document.getElementById(sId);
  const val=(drop.value&&drop.value!=='')?drop.value:search.value.trim();if(!val)return;
  if(!STATE[sk])STATE[sk]=[];
  const found=Array.isArray(dbList)?dbList.find(m=>m.name===val):null;
  STATE[sk].push({name:val,rating:found?found.rating:1,desc:found?found.desc:''});
  const sd=SECTION_MAP[sdKey]||SECTION_DEFS.find(s=>s.state_key===sk)||{key:sk,state_key:sk,max_rating:max};
  renderGenericRatedList(sd);drop.selectedIndex=0;search.value='';
}

function renderNamedList(sk,listId){
  const el=document.getElementById(listId);if(!el)return;
  const sd=SECTION_DEFS.find(s=>(s.state_key||s.key)===sk&&s.type==='named-list');
  el.innerHTML=(STATE[sk]||[]).map((item,i)=>`
    <div class="item-card open">
      <div class="item-hd" onclick="toggleCard(this)">
        <span class="item-toggle">&#9654;</span>
        <input class="item-name" value="${escH(item.name||'')}" placeholder="Name"
          onclick="event.stopPropagation()" onchange="STATE['${sk}'][${i}].name=this.value">
        ${sd?_libSyncBtn(sd.db_key,item,sd.state_key||sd.key,i):''}
        <button class="sm danger" onclick="event.stopPropagation();removeNamedItem('${sk}',${i},'${listId}')">Remove</button>
      </div>
      <div class="item-body">
        ${descField(`STATE['${sk}'][${i}].desc=this.value`,item.desc||'')}
      </div></div>`).join('');
}
function removeNamedItem(sk,i,listId){STATE[sk].splice(i,1);renderNamedList(sk,listId);}
function addNamedItemFromDrop(stateKey,sId,dId,descId,listId,renderFn,dbList){
  const drop=document.getElementById(dId),search=document.getElementById(sId);
  const name=(drop.value&&drop.value!=='')?drop.value:search.value.trim();if(!name)return;
  const descEl=document.getElementById(descId);
  // Read desc from DB directly to preserve newlines — input elements strip \n from .value
  const found=Array.isArray(dbList)?dbList.find(x=>x.name===name):null;
  const desc=found?found.desc||'':(descEl?descEl.value.trim():'');
  if(!STATE[stateKey])STATE[stateKey]=[];
  STATE[stateKey].push({name,desc});renderFn();
  drop.selectedIndex=0;search.value='';if(descEl)descEl.value='';
}

function renderLineItems(sk,listId){
  const el=document.getElementById(listId);if(!el)return;
  el.innerHTML=(STATE[sk]||[]).map((item,i)=>`
    <div class="line-item-row">
      <input value="${escH(item)}" onchange="STATE['${sk}'][${i}]=this.value">
      <button class="sm danger" onclick="removeLineItem('${sk}',${i},'${listId}')">×</button>
    </div>`).join('');
}
function removeLineItem(sk,i,listId){STATE[sk].splice(i,1);renderLineItems(sk,listId);}
function addLineItem(sk,inputId,listId){
  const val=document.getElementById(inputId).value.trim();if(!val)return;
  if(!STATE[sk])STATE[sk]=[];STATE[sk].push(val);renderLineItems(sk,listId);document.getElementById(inputId).value='';
}

// ── Pool-list renderers ────────────────────────────────────────────────────────
// pool-list state: [{name, value}] — freeform name + integer dice pool total.
// Used by General Dice Pools and Combat Dice Pools on Minor NPC sheets.
function renderPoolList(sd){
  const sk=sd.state_key||sd.key;
  const listId=`${sd.key}-pool-list`;
  const el=document.getElementById(listId);if(!el)return;
  el.innerHTML=(STATE[sk]||[]).map((entry,i)=>`
    <div class="pool-row">
      <input class="pool-name-inp" value="${escH(entry.name||'')}" placeholder="Pool name…"
        onchange="STATE['${sk}'][${i}].name=this.value">
      <input class="pool-val-inp" type="text" inputmode="numeric" pattern="[0-9]*" value="${entry.value!=null?entry.value:0}"
        onchange="STATE['${sk}'][${i}].value=Math.max(0,parseInt(this.value)||0);this.value=STATE['${sk}'][${i}].value">
      <button class="sm danger" onclick="removePoolEntry('${sk}',${i},'${sd.key}')">×</button>
    </div>`).join('');
}
function removePoolEntry(sk,i,sectionKey){
  STATE[sk].splice(i,1);
  const sd=SECTION_MAP[sectionKey];if(sd)renderPoolList(sd);
}
function addPoolEntry(sk,listId){
  if(!STATE[sk])STATE[sk]=[];
  STATE[sk].push({name:'',value:0});
  const sd=SECTION_DEFS.find(s=>(s.state_key||s.key)===sk&&s.type==='pool-list');
  if(sd)renderPoolList(sd);
}
// ── End pool-list renderers ───────────────────────────────────────────────────

// renderMeritList — thin wrapper; all rendering done by renderGenericRatedList.
// The merits sd object is available via SECTION_MAP once data loads; fall back
// to a synthetic sd if called before SECTION_MAP is populated.
function _getMeritsSd(){return SECTION_MAP['merits']||{key:'merits',state_key:'merits',max_rating:STATE.meritMaxDots||5,special_renderer:'merits',db_key:'merits'};}
function renderMeritList(){renderGenericRatedList(_getMeritsSd());}
function setMeritRating(i,val){setGenericRatedRating('merits',i,val,'merits');}
function addMerit(){
  const drop=document.getElementById('meritDrop'),search=document.getElementById('meritSearch');
  const val=(drop.value&&drop.value!=='')?drop.value:search.value.trim();if(!val)return;
  if(!STATE.merits)STATE.merits=[];
  const found=DB.merits.find(m=>m.name===val);
  STATE.merits.push({name:val,rating:found?found.rating:1,desc:found?found.desc:''});
  renderMeritList();drop.selectedIndex=0;search.value='';refillSelect('meritDrop',DB.merits);
}
function toggleMeritMax(){
  STATE.meritMaxDots=(STATE.meritMaxDots===5)?10:5;
  (STATE.merits||[]).forEach(m=>{if(m.rating>STATE.meritMaxDots)m.rating=STATE.meritMaxDots;});
  updateMeritMaxToggle();renderMeritList();
}
function updateMeritMaxToggle(){
  const ext=(STATE.meritMaxDots||5)>5;
  updateToggleButton('meritMaxToggle',ext,ext?'10-dot max':'5-dot max');
}


function renderWeaponList(){
  const el=document.getElementById('weaponList');if(!el)return;
  el.innerHTML=(STATE.weapons||[]).map((w,i)=>{
    const isRanged=(w.weapon_type||'melee')==='ranged';
    const availDots=[1,2,3,4,5].map(d=>`<span class="dot${(w.availability||0)>=d?' filled':''}" onclick="setAvailability('weapons',${i},${d},renderWeaponList)"></span>`).join('');
    const summary=isRanged?`Dmg +${w.damage||0} | Rng ${w.ranges||'—'} | Clip ${w.clip||0} | Init ${w.initiative_mod>=0?'+':''}${w.initiative_mod||0} | Str ${w.strength_req||0} | Sz ${w.size||0}`:`Dmg +${w.damage||0} | Init ${w.initiative_mod>=0?'+':''}${w.initiative_mod||0} | Str ${w.strength_req||0} | Sz ${w.size||0}`;
    const equippedChk=`<label class="equip-chk-wrap" onclick="event.stopPropagation()"><input type="checkbox" ${w.equipped?'checked':''} onchange="STATE.weapons[${i}].equipped=this.checked;updateDerived()"> Equipped</label>`;
    const sharedFields=`<div class="field-wrap"><span class="field-lbl">Damage</span><input class="field-inp" type="number" value="${w.damage||0}" onchange="STATE.weapons[${i}].damage=+this.value"></div><div class="field-wrap"><span class="field-lbl">Initiative mod</span><input class="field-inp" type="number" value="${w.initiative_mod||0}" onchange="STATE.weapons[${i}].initiative_mod=+this.value;updateDerived()"></div><div class="field-wrap"><span class="field-lbl">Strength req</span><input class="field-inp" type="number" value="${w.strength_req||0}" onchange="STATE.weapons[${i}].strength_req=+this.value"></div><div class="field-wrap"><span class="field-lbl">Size</span><input class="field-inp" type="number" value="${w.size||0}" onchange="STATE.weapons[${i}].size=+this.value"></div><div class="field-wrap"><span class="field-lbl">Availability</span><div class="dot-row">${availDots}</div></div>`;
    const rangedFields=isRanged?`<div class="field-wrap"><span class="field-lbl">Ranges (S/M/L)</span><input class="field-inp" type="text" value="${escH(w.ranges||'')}" placeholder="e.g. 20/40/80" onchange="STATE.weapons[${i}].ranges=this.value"></div><div class="field-wrap"><span class="field-lbl">Clip</span><input class="field-inp" type="number" value="${w.clip||0}" onchange="STATE.weapons[${i}].clip=+this.value"></div>`:'';
    const notesField=`<div class="field-wrap" style="grid-column:1/-1"><span class="field-lbl">Notes</span>${descField(`STATE.weapons[${i}].notes=this.value`,w.notes||'')}</div>`;
    return `<div class="item-card open"><div class="item-hd" onclick="toggleCard(this)">
      <span class="item-toggle">&#9654;</span>
      <input class="item-name" value="${escH(w.name)}" placeholder="Weapon name" onclick="event.stopPropagation()" onchange="STATE.weapons[${i}].name=this.value">
      <span class="item-key-stat">${summary}</span>${equippedChk}
      <select class="field-inp" style="width:auto;font-size:.72rem;min-height:0;padding:2px 4px" onclick="event.stopPropagation()" onchange="STATE.weapons[${i}].weapon_type=this.value;renderWeaponList()">
        <option value="melee" ${!isRanged?'selected':''}>Melee</option>
        <option value="ranged" ${isRanged?'selected':''}>Ranged</option>
      </select>
      ${_libSyncBtn('weapons',w,'weapons',i)}
      <button class="sm danger" onclick="event.stopPropagation();removeStruct('weapons',${i},renderWeaponList)">Remove</button>
      </div><div class="item-body"><div class="struct-fields" style="grid-template-columns:repeat(3,1fr)">${sharedFields}${rangedFields}${notesField}</div></div></div>`;
  }).join('');
}
// addWeapon / addArmor / addEquip share the search-drop-push-render pattern.
function addWeapon(){
  const drop=document.getElementById('weaponDrop'),search=document.getElementById('weaponSearch');
  const val=(drop.value&&drop.value!=='')?drop.value:search.value.trim();if(!val)return;
  if(!STATE.weapons)STATE.weapons=[];
  const found=DB.weapons.find(w=>w.name===val);
  STATE.weapons.push(found?{...found,equipped:false}:{name:val,weapon_type:'melee',damage:0,initiative_mod:0,strength_req:0,size:0,availability:0,ranges:'',clip:0,notes:'',equipped:false});
  renderWeaponList();drop.selectedIndex=0;search.value='';refillSelect('weaponDrop',DB.weapons);
}
function addArmor(){
  const drop=document.getElementById('armorDrop'),search=document.getElementById('armorSearch');
  const val=(drop.value&&drop.value!=='')?drop.value:search.value.trim();if(!val)return;
  if(!STATE.armor)STATE.armor=[];
  const found=DB.armor.find(a=>a.name===val);
  STATE.armor.push(found?{...found,equipped:false,speed_penalty:found.speed_penalty||0,coverage:found.coverage||{head:false,torso:false,arms:false,legs:false}}:{name:val,armor_general:0,armor_ballistic:0,defense_penalty:0,speed_penalty:0,strength_req:0,availability:0,notes:'',equipped:false,coverage:{head:false,torso:false,arms:false,legs:false}});
  renderArmorList();drop.selectedIndex=0;search.value='';refillSelect('armorDrop',DB.armor);
}
function addEquip(){
  const drop=document.getElementById('equipDrop'),search=document.getElementById('equipSearch');
  const val=(drop.value&&drop.value!=='')?drop.value:search.value.trim();if(!val)return;
  if(!STATE.equipment)STATE.equipment=[];
  const found=DB.equipment.find(e=>e.name===val);
  STATE.equipment.push(found?{...found}:{name:val,dice_bonus:0,durability:0,size:0,structure:0,availability:0,desc:''});
  renderEquipList();drop.selectedIndex=0;search.value='';refillSelect('equipDrop',DB.equipment);
}


function renderArmorList(){
  const el=document.getElementById('armorList');if(!el)return;
  el.innerHTML=(STATE.armor||[]).map((a,i)=>{
    const availDots=[1,2,3,4,5].map(d=>`<span class="dot${(a.availability||0)>=d?' filled':''}" onclick="setAvailability('armor',${i},${d},renderArmorList)"></span>`).join('');
    const equippedChk=`<label class="equip-chk-wrap" onclick="event.stopPropagation()"><input type="checkbox" ${a.equipped?'checked':''} onchange="STATE.armor[${i}].equipped=this.checked;updateDerived()"> Equipped</label>`;
    const summary=`Armor ${a.armor_general||0}/${a.armor_ballistic||0} | Def ${a.defense_penalty>=0?'+':''}${a.defense_penalty||0} | Spd ${a.speed_penalty>=0?'+':''}${a.speed_penalty||0} | Str ${a.strength_req||0}`;
    return `<div class="item-card open"><div class="item-hd" onclick="toggleCard(this)">
      <span class="item-toggle">&#9654;</span>
      <input class="item-name" value="${escH(a.name)}" placeholder="Armor name" onclick="event.stopPropagation()" onchange="STATE.armor[${i}].name=this.value">
      <span class="item-key-stat">${summary}</span>${equippedChk}
      ${_libSyncBtn('armor',a,'armor',i)}
      <button class="sm danger" onclick="event.stopPropagation();removeStruct('armor',${i},renderArmorList)">Remove</button>
      </div><div class="item-body"><div class="struct-fields" style="grid-template-columns:repeat(3,1fr)">
        <div class="field-wrap"><span class="field-lbl">Armor (general)</span><input class="field-inp" type="number" value="${a.armor_general||0}" onchange="STATE.armor[${i}].armor_general=+this.value"></div>
        <div class="field-wrap"><span class="field-lbl">Armor (ballistic)</span><input class="field-inp" type="number" value="${a.armor_ballistic||0}" onchange="STATE.armor[${i}].armor_ballistic=+this.value"></div>
        <div class="field-wrap"><span class="field-lbl">Defense penalty</span><input class="field-inp" type="number" value="${a.defense_penalty||0}" onchange="STATE.armor[${i}].defense_penalty=+this.value;updateDerived()"></div>
        <div class="field-wrap"><span class="field-lbl">Speed penalty</span><input class="field-inp" type="number" value="${a.speed_penalty||0}" onchange="STATE.armor[${i}].speed_penalty=+this.value;updateDerived()"></div>
        <div class="field-wrap"><span class="field-lbl">Strength req</span><input class="field-inp" type="number" value="${a.strength_req||0}" onchange="STATE.armor[${i}].strength_req=+this.value"></div>
        <div class="field-wrap"><span class="field-lbl">Availability</span><div class="dot-row">${availDots}</div></div>
        <div class="field-wrap" style="grid-column:1/-1"><span class="field-lbl">Coverage</span>
          <div style="display:flex;gap:14px;margin-top:3px;flex-wrap:wrap">
            ${['head','torso','arms','legs'].map(loc=>`<label class="equip-chk-wrap"><input type="checkbox" ${(a.coverage&&a.coverage[loc])?'checked':''} onchange="STATE.armor[${i}].coverage['${loc}']=this.checked;updateDerived()"> ${loc[0].toUpperCase()+loc.slice(1)}</label>`).join('')}
          </div>
        </div>
        <div class="field-wrap" style="grid-column:1/-1"><span class="field-lbl">Notes</span>${descField(`STATE.armor[${i}].notes=this.value`,a.notes||'')}</div>
      </div></div></div>`;
  }).join('');
}
function renderEquipList(){
  const el=document.getElementById('equipList');if(!el)return;
  el.innerHTML=(STATE.equipment||[]).map((e,i)=>{
    const eAvailDots=Array.from({length:10},(_,d)=>`<span class="dot${(e.availability||0)>d?' filled':''}" onclick="STATE.equipment[${i}].availability=${d+1};renderEquipList()"></span>`).join('');
    const summary=`Bonus +${e.dice_bonus||0} | Dur ${e.durability||0} | Sz ${e.size||0} | Str ${e.structure||0}`;
    return `<div class="item-card open"><div class="item-hd" onclick="toggleCard(this)">
      <span class="item-toggle">&#9654;</span>
      <input class="item-name" value="${escH(e.name)}" placeholder="Item name" onclick="event.stopPropagation()" onchange="STATE.equipment[${i}].name=this.value">
      <span class="item-key-stat">${summary}</span>
      ${_libSyncBtn('equipment',e,'equipment',i)}
      <button class="sm danger" onclick="event.stopPropagation();removeStruct('equipment',${i},renderEquipList)">Remove</button>
      </div><div class="item-body"><div class="struct-fields" style="grid-template-columns:repeat(3,1fr);margin-bottom:5px">
        <div class="field-wrap"><span class="field-lbl">Dice bonus</span><input class="field-inp" type="number" value="${e.dice_bonus||0}" onchange="STATE.equipment[${i}].dice_bonus=+this.value"></div>
        <div class="field-wrap"><span class="field-lbl">Durability</span><input class="field-inp" type="number" value="${e.durability||0}" onchange="STATE.equipment[${i}].durability=+this.value"></div>
        <div class="field-wrap"><span class="field-lbl">Size</span><input class="field-inp" type="number" value="${e.size||0}" onchange="STATE.equipment[${i}].size=+this.value"></div>
        <div class="field-wrap"><span class="field-lbl">Structure</span><input class="field-inp" type="number" value="${e.structure||0}" onchange="STATE.equipment[${i}].structure=+this.value"></div>
        <div class="field-wrap" style="grid-column:span 2"><span class="field-lbl">Availability (1–10)</span><div class="dot-row">${eAvailDots}</div></div>
      </div>
      <div class="field-wrap"><span class="field-lbl">Description</span>
        ${descField(`STATE.equipment[${i}].desc=this.value`,e.desc||'')}
      </div></div></div>`;
  }).join('');
}
function setAvailability(key,i,val,renderFn){STATE[key][i].availability=val;renderFn();}
function removeStruct(key,i,renderFn){STATE[key].splice(i,1);renderFn();updateDerived();}
function toggleCard(el){el.closest('.item-card').classList.toggle('open');}
function collapseAll(){
  document.querySelectorAll('.item-card').forEach(c=>c.classList.remove('open'));
  // Also collapse all collapsible sec-blocks
  const collapsed=_getCollapsed();
  COLLAPSIBLE_ZONES.forEach(zone=>{
    const container=document.getElementById(ZONE_IDS[zone]);
    if(!container)return;
    container.querySelectorAll(':scope>.sec-block[id^="secblock-"]').forEach(block=>{
      const key=block.id.replace('secblock-','');
      block.classList.add('sec-collapsed');
      collapsed.add(key);
    });
  });
  _saveCollapsed(collapsed);
}
function expandAll(){
  document.querySelectorAll('.item-card').forEach(c=>c.classList.add('open'));
  // Also expand all collapsible sec-blocks
  const collapsed=_getCollapsed();
  COLLAPSIBLE_ZONES.forEach(zone=>{
    const container=document.getElementById(ZONE_IDS[zone]);
    if(!container)return;
    container.querySelectorAll(':scope>.sec-block[id^="secblock-"]').forEach(block=>{
      const key=block.id.replace('secblock-','');
      block.classList.remove('sec-collapsed');
      collapsed.delete(key);
    });
  });
  _saveCollapsed(collapsed);
}
// ── Help modal ────────────────────────────────────────────────────────────────
function renderHelp(){
  const sections=DB.helpSections||[];
  document.getElementById('helpContent').innerHTML=sections.map(s=>
    `<div class="help-section">
      <div class="help-section-title">${escH(s.title)}</div>
      <div class="help-section-body">${mdH(s.content)}</div>
    </div>`
  ).join('');
}
function openHelp(){
  renderHelp();
  document.getElementById('helpBackdrop').classList.add('open');
}
function closeHelp(){
  document.getElementById('helpBackdrop').classList.remove('open');
}
function closeHelpOnBackdrop(e){
  if(e.target===document.getElementById('helpBackdrop'))closeHelp();
}
// ── End help modal ────────────────────────────────────────────────────────────

// ── Storyteller Mode help modal ───────────────────────────────────────────────
const ST_HELP_SECTIONS=[
  {
    title:'What is Storyteller Mode?',
    content:`Storyteller Mode is a live scene runner for the Storyteller — a workspace for tracking multiple characters during play.\n\nThe panel shows all characters currently in your scene as compact cards. Each card displays health, willpower, resources, derived stats, armour coverage, and any equipped gear, conditions, tilts, and notes at a glance — everything you need to run a scene without switching between sheets.`
  },
  {
    title:'Adding characters to a scene',
    content:`Use **Add to Scene** in the sidebar to bring saved characters into the scene. Characters are shown grouped by folder if you have folders set up. Each entry you add becomes an **instance** — an independent copy tied to the saved character as a read-only source.\n\nInstances are separate from the main character sheet. Anything you change on an instance (health damage, conditions, equipped gear, notes) exists only in the scene and never affects the original saved sheet. You can spawn multiple instances of the same character — useful for groups of identical NPCs.`
  },
  {
    title:'Initiative tracker',
    content:`Click **Init** in the Storyteller Mode toolbar to open the Initiative Tracker.\n\nAll characters in the scene appear in the tracker, ordered by Initiative value (highest first). Use **Roll All** to roll Initiative for any unrolled characters at once, or set values manually by clicking the Initiative number on any entry.\n\nClick a character's row to mark them as **acted** for the current round. Once everyone has acted, click **Next Round** to advance the round counter and reset all acted markers.\n\nFor minor NPCs not in the main scene, use **+ Add entry** to create ad-hoc tracker entries with a name and Initiative value.\n\nThe tracker state — rolls, round count, acted markers — persists across scene reloads.`
  },
  {
    title:'Equipping items and pinning sections',
    content:`Click the **▼ arrow** on any card to expand its body. From there you can:\n\n**Equip gear** — Weapons, Armour, and Equipment all have checkboxes. Ticking a checkbox marks that item as equipped; it then appears in the compact card header so you can see it at a glance without the body open.\n\n**Pin sections** — Sections like Arcana, dice pool lists, and individual abilities and merits each have a **☆ pin button** in their header. Pinning a section adds it to the card header in a compact form. Use this to surface the information you reach for most during play — a mage's highest Arcana, a fighter's key combat pools, a character's signature merit.`
  },
  {
    title:'Columns and moving cards',
    content:`Use the **− Columns +** control in the toolbar to add or remove columns. Up to five columns are supported.\n\nTo move a character card between columns, drag it by its title bar and drop it into any column — including the grey **Drop cards here** placeholder that appears in empty columns. The layout is saved automatically and restored when you return to Storyteller Mode.`
  }
];

function openStHelp(){
  document.getElementById('stHelpContent').innerHTML=ST_HELP_SECTIONS.map(s=>
    `<div class="help-section">
      <div class="help-section-title">${escH(s.title)}</div>
      <div class="help-section-body">${mdH(s.content)}</div>
    </div>`
  ).join('');
  document.getElementById('stHelpBackdrop').classList.add('open');
}
function closeStHelp(){
  document.getElementById('stHelpBackdrop').classList.remove('open');
}
// ── End Storyteller Mode help modal ──────────────────────────────────────────

// ── Initiative tracker ────────────────────────────────────────────────────────
// State is split across two localStorage keys:
//   LS_INIT       — { open: bool, round: int }
//   LS_INIT_ADHOC — [{ id, name, init_val, acted }]  (non-instance entries)
// Per-instance roll data lives on inst.init_roll (int, 0 = unrolled) and
// inst.init_acted (bool), stored via _stMutate.

function _stInitState(){
  try{return JSON.parse(localStorage.getItem(LS_INIT))||{};}catch(e){return{};}
}
function _stSaveInitState(s){
  try{localStorage.setItem(LS_INIT,JSON.stringify(s));}catch(e){}
}
function _stInitAdhoc(){
  try{return JSON.parse(localStorage.getItem(LS_INIT_ADHOC))||[];}catch(e){return[];}
}
function _stSaveInitAdhoc(a){
  try{localStorage.setItem(LS_INIT_ADHOC,JSON.stringify(a));}catch(e){}
}

function stToggleInitTracker(){
  const s=_stInitState();
  s.open=!s.open;
  _stSaveInitState(s);
  const area=document.getElementById('stMainArea');
  if(area)area.classList.toggle('tracker-open',s.open);
  stRenderInitTracker();
}

function stRenderInitTracker(){
  const s=_stInitState();
  const area=document.getElementById('stMainArea');
  if(area)area.classList.toggle('tracker-open',!!s.open);
  if(!s.open)return;

  // Apply saved width
  const panel=document.getElementById('stInitPanel');
  if(panel&&s.width)panel.style.width=s.width+'px';

  // Wire resize handle (idempotent)
  stInitInitResize();
  if(!s.open)return;

  // Update round counter
  const roundEl=document.getElementById('stInitRound');
  if(roundEl)roundEl.textContent=s.round||1;

  // Build combined list: instances + ad-hoc entries
  const scene=_stGetScene();
  const adhoc=_stInitAdhoc();

  // Calculate total for each instance; display_name already includes #N for duplicates
  const instEntries=scene.map(inst=>{
    const src=_stReadChar(inst.source_id);
    if(!src)return null;
    const cfg=src.sectionConfig||{};
    const isEntity=SECTION_DEFS.some(sd=>sd.type==='derived-traits-entity'&&cfg[sd.key]!==false);
    const d=_stCalcInstanceDerived(inst,src,isEntity);
    const base=d.initiative; // fully modified: includes equipped weapon init mods via calcGearMods
    const roll=inst.init_roll||0;
    const total=roll?base+roll:null;
    const displayName=inst.display_name||src.name||'Unknown';
    return{type:'inst',iid:inst.id,name:displayName,base,roll,total,acted:!!inst.init_acted};
  }).filter(Boolean);

  const adhocEntries=adhoc.map(a=>({
    type:'adhoc',id:a.id,name:a.name,base:0,roll:0,total:a.init_val||0,acted:!!a.acted
  }));

  // Sort: unrolled at bottom, then by total descending
  const all=[...instEntries,...adhocEntries].sort((a,b)=>{
    if(a.total===null&&b.total===null)return 0;
    if(a.total===null)return 1;
    if(b.total===null)return-1;
    return b.total-a.total;
  });

  const listEl=document.getElementById('stInitList');
  if(!listEl)return;

  if(!all.length){
    listEl.innerHTML=`<div style="padding:8px 10px;font-family:sans-serif;font-size:.75rem;color:var(--faint)">No characters in scene yet.</div>`;
    return;
  }

  listEl.innerHTML=all.map((entry,rank)=>{
    const actedClass=entry.acted?'acted':'';
    const totalClass=entry.total===null?'unrolled':'';
    const totalDisplay=entry.total!==null?entry.total:'—';
    const rankDisplay=entry.total!==null?`${rank+1}.`:'';

    if(entry.type==='inst'){
      const rollVal=entry.roll||'';
      return `<div class="st-init-row ${actedClass}" id="stInitRow-${entry.iid}">
        <span class="st-init-rank">${rankDisplay}</span>
        <input type="checkbox" class="st-init-acted-chk" ${entry.acted?'checked':''} title="Acted this round"
          onchange="stInitSetActed('inst','${entry.iid}',this.checked)">
        <span class="st-init-name" title="${escH(entry.name)}">${escH(entry.name)}</span>
        <span class="st-init-base" title="Modified Initiative">${entry.base}</span>
        <span class="st-init-plus">+</span>
        <input type="number" class="st-init-roll-inp" min="1" max="10" value="${rollVal}" placeholder="d10"
          title="d10 roll"
          onchange="stInitSetRoll('${entry.iid}',this.value)"
          oninput="stInitSetRoll('${entry.iid}',this.value)">
        <span class="st-init-total ${totalClass}">${totalDisplay}</span>
        <span style="min-width:14px"></span>
      </div>`;
    } else {
      return `<div class="st-init-row ${actedClass}" id="stInitRow-adhoc-${entry.id}">
        <span class="st-init-rank">${rankDisplay}</span>
        <input type="checkbox" class="st-init-acted-chk" ${entry.acted?'checked':''} title="Acted this round"
          onchange="stInitSetActed('adhoc','${entry.id}',this.checked)">
        <span class="st-init-name" title="${escH(entry.name)}">${escH(entry.name)}</span>
        <span class="st-init-base" style="color:var(--text);font-weight:600">${entry.total}</span>
        <span class="st-init-plus" style="visibility:hidden">+</span>
        <span style="width:30px"></span>
        <span class="st-init-total" style="visibility:hidden">—</span>
        <button class="st-init-remove" title="Remove" onclick="stInitRemoveAdhoc('${entry.id}')">✕</button>
      </div>`;
    }
  }).join('');
}

function stInitSetRoll(iid,val){
  const n=Math.max(1,Math.min(10,parseInt(val,10)||0));
  _stMutate(iid,inst=>{inst.init_roll=n||0;});
  stRenderInitTracker();
}

function stInitSetActed(type,id,checked){
  if(type==='inst'){
    _stMutate(id,inst=>{inst.init_acted=checked;});
  } else {
    const adhoc=_stInitAdhoc();
    const a=adhoc.find(x=>x.id===id);
    if(a)a.acted=checked;
    _stSaveInitAdhoc(adhoc);
  }
  stRenderInitTracker();
}

function stInitRollAll(){
  const scene=_stGetScene();
  scene.forEach(inst=>{
    if(!inst.init_roll){
      _stMutate(inst.id,i=>{i.init_roll=Math.ceil(Math.random()*10);});
    }
  });
  stRenderInitTracker();
}

function stInitNewRound(){
  const s=_stInitState();
  s.round=(s.round||1)+1;
  _stSaveInitState(s);
  // Clear acted flags on all instances
  _stGetScene().forEach(inst=>{
    if(inst.init_acted)_stMutate(inst.id,i=>{i.init_acted=false;});
  });
  // Clear acted flags on ad-hoc entries
  const adhoc=_stInitAdhoc().map(a=>({...a,acted:false}));
  _stSaveInitAdhoc(adhoc);
  stRenderInitTracker();
}

function stInitAdjRound(delta){
  const s=_stInitState();
  s.round=Math.max(1,(s.round||1)+delta);
  _stSaveInitState(s);
  stRenderInitTracker();
}

function stInitReset(){
  // Clear rolls and acted on all instances
  _stGetScene().forEach(inst=>{
    _stMutate(inst.id,i=>{i.init_roll=0;i.init_acted=false;});
  });
  // Clear ad-hoc
  _stSaveInitAdhoc([]);
  // Reset round to 1
  const s=_stInitState();
  s.round=1;
  _stSaveInitState(s);
  stRenderInitTracker();
}

function stInitAddAdhoc(){
  const nameEl=document.getElementById('stInitAddName');
  const valEl=document.getElementById('stInitAddVal');
  const name=(nameEl.value||'').trim();
  const val=parseInt(valEl.value,10)||0;
  if(!name)return;
  const adhoc=_stInitAdhoc();
  adhoc.push({id:'adhoc_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),name,init_val:val,acted:false});
  _stSaveInitAdhoc(adhoc);
  nameEl.value='';valEl.value='';
  stRenderInitTracker();
}

function stInitRemoveAdhoc(id){
  _stSaveInitAdhoc(_stInitAdhoc().filter(a=>a.id!==id));
  stRenderInitTracker();
}

// ── Initiative tracker resize handle ─────────────────────────────────────────
let _stInitResizeWired=false;
function stInitInitResize(){
  if(_stInitResizeWired)return;
  const handle=document.getElementById('stInitResizeHandle');
  const panel=document.getElementById('stInitPanel');
  if(!handle||!panel)return;
  _stInitResizeWired=true;
  const MIN_W=180,MAX_W=480;
  handle.addEventListener('mousedown',e=>{
    e.preventDefault();
    const startX=e.clientX;
    const startW=panel.offsetWidth;
    handle.classList.add('dragging');
    panel.classList.add('resizing');
    function onMove(e){
      // Handle is on the LEFT edge; dragging left = wider (panel grows leftward)
      const delta=startX-e.clientX;
      const newW=Math.max(MIN_W,Math.min(MAX_W,startW+delta));
      panel.style.width=newW+'px';
    }
    function onUp(){
      handle.classList.remove('dragging');
      panel.classList.remove('resizing');
      // Persist width
      const s=_stInitState();
      s.width=panel.offsetWidth;
      _stSaveInitState(s);
      document.removeEventListener('mousemove',onMove);
      document.removeEventListener('mouseup',onUp);
    }
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
  });
}
// ── End initiative tracker resize handle ──────────────────────────────────────

// ── Utilities ─────────────────────────────────────────────────────────────────
// escH — escapes a string for safe HTML insertion. Call on every user-supplied
// value before inserting into innerHTML to prevent XSS.
function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// mdH — lightweight markdown renderer for description fields.
// Input is HTML-escaped first (XSS-safe), then:
//   \n (literal in JSON) and real newlines → <br>
//   ***text*** → <strong><em>text</em></strong>
//   **text**   → <strong>text</strong>
//   *text*     → <em>text</em>
// Used in all description display paths. Never called on values written to STATE.
function mdH(s){
  return escH(s)
    .replace(/\\n/g,'\n')
    .replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/\n/g,'<br>');
}
// Show the textarea for editing a description field; hide the display div.
function showDescEdit(displayEl){
  const fieldWrap=displayEl.parentElement;
  const taWrapEl=fieldWrap.querySelector('.desc-ta-wrap');
  const ta=fieldWrap.querySelector('textarea');
  const hint=fieldWrap.querySelector('.desc-edit-hint');
  if(!taWrapEl||!ta)return;
  displayEl.style.display='none';
  if(hint)hint.style.display='block';
  taWrapEl.style.display='block';
  // Auto-size to content, with a minimum of 3 rows worth of height
  ta.style.height='auto';
  ta.style.height=Math.max(ta.scrollHeight,72)+'px';
  ta.focus();
}
// Hide the textarea; update and show the display div.
function hideDescEdit(taEl){
  const fieldWrap=taEl.closest('.field-wrap');
  const displayEl=fieldWrap?fieldWrap.querySelector('.desc-display'):null;
  const taWrapEl=fieldWrap?fieldWrap.querySelector('.desc-ta-wrap'):null;
  const hint=fieldWrap?fieldWrap.querySelector('.desc-edit-hint'):null;
  if(!displayEl)return;
  const val=taEl.value;
  displayEl.innerHTML=mdH(val)||'';
  if(!val.trim())displayEl.classList.add('empty');else displayEl.classList.remove('empty');
  if(taWrapEl)taWrapEl.style.display='none';
  displayEl.style.display='block';
  if(hint)hint.style.display='block';
}
// descField(stateExpr, val, rows) — builds the click-to-edit description pair:
// a rendered-markdown .desc-display div (shown by default) and a hidden
// .desc-ta-wrap containing a textarea. Clicking the display calls showDescEdit();
// blurring the textarea calls hideDescEdit(), re-renders markdown, and saves.
// stateExpr — JS assignment string executed onchange, e.g. "STATE.merits[0].desc=this.value"
// val       — current raw markdown string from STATE (not HTML-escaped at this point)
// rows      — textarea row count (default 3)
function descField(stateExpr,val,rows){
  rows=rows||3;
  const isEmpty=!(val||'').trim();
  const displayDiv=`<div class="desc-display${isEmpty?' empty':''}" onclick="showDescEdit(this)">${isEmpty?'':mdH(val)}</div>`;
  const hint=`<div class="desc-edit-hint" style="display:none">**bold**&nbsp;&nbsp;*italic*&nbsp;&nbsp;***both***</div>`;
  const ta=taWrap(`<textarea class="field-inp" rows="${rows}" style="resize:vertical;min-height:60px" onchange="${stateExpr}" onblur="hideDescEdit(this)">${escH(val||'')}</textarea>`);
  return `<div class="field-wrap">${displayDiv}${hint}<div class="desc-ta-wrap" style="display:none">${ta}</div></div>`;
}

// ── Textarea mobile resize ─────────────────────────────────────────────────
// Wraps a <textarea> string in a .ta-wrap div with a touch-drag resize handle.
// The handle is CSS-hidden on desktop and visible on touch devices (body.touch-device).
function taWrap(textareaHTML){
  return `<div class="ta-wrap">${textareaHTML}<div class="ta-resize-handle" ontouchstart="initTaResize(event,this)" onmousedown="initTaResize(event,this)">⠿ drag to resize</div></div>`;
}

function initTaResize(e,handle){
  const wrap=handle.parentElement;
  const ta=wrap.querySelector('textarea');
  if(!ta)return;
  e.preventDefault();
  const startY=e.touches?e.touches[0].clientY:e.clientY;
  const startH=ta.offsetHeight;
  function onMove(ev){
    const y=ev.touches?ev.touches[0].clientY:ev.clientY;
    const newH=Math.max(48,startH+(y-startY));
    ta.style.height=newH+'px';
  }
  function onEnd(){
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onEnd);
    document.removeEventListener('touchmove',onMove);
    document.removeEventListener('touchend',onEnd);
  }
  document.addEventListener('mousemove',onMove,{passive:false});
  document.addEventListener('mouseup',onEnd);
  document.addEventListener('touchmove',onMove,{passive:false});
  document.addEventListener('touchend',onEnd);
}
// ── End textarea mobile resize ─────────────────────────────────────────────

// ── Clipboard export ──────────────────────────────────────────────────────────
// copyText() — serialises the active character to a plain-text block and
// copies it to the clipboard. Covers attributes, skills, derived traits, gear,
// and all visible list sections. Entity sheets get corpus/essence instead of
// health/willpower. Note: entity-specific sections (Numina, Manifestations,
// etc.) are not yet included — see PROJECT_INSTRUCTIONS "Entity-aware copyText".
function copyText(){
  const a=k=>getAttr(k),sk=k=>getSkill(k),gm=calcGearMods();
  const attrStr=Object.entries(ATTRIBUTES).map(([cat,attrs])=>
    `  ${cat.toUpperCase()}: `+attrs.map(k=>`${ATTR_LABELS[k]} ${a(k)}`).join(' | ')).join('\n');
  const skillStr=Object.entries(SKILLS).map(([cat,skList])=>
    `  ${cat.toUpperCase()}:\n`+skList.filter(k=>sk(k)>0).map(k=>{
      const sd=STATE.skills[k]||{};
      return `    ${sd.label||SKILL_LABELS[k]} ${'●'.repeat(sk(k))}${sd.specialty?` (${sd.specialty})`:''}${sd.rote?' [Rote]':''}`;
    }).join('\n')).join('\n');
  const healthStr=(STATE.health_track||[]).map(s=>!s?'□':s==='b'?'/':s==='l'?'X':'*').join(' ');
  const hdrStr=(ZONES['header']||[]).filter(sd=>sd.type==='header-fields'&&secVisible(sd.key)).flatMap(sd=>
    (sd.fields||[]).map(f=>`${f.label}: ${STATE[f.key]||'—'}`)).join('  |  ');
  const beatsStr=SECTION_DEFS.filter(sd=>sd.type==='beats-xp'&&secVisible(sd.key)).map(sd=>{
    const bk=sd.beats_key||'beats',xk=sd.xp_key||'experience';
    return `${sd.label}: ${STATE[bk]||0}/5  |  XP: ${STATE[xk]||0}`;
  }).join('  |  ')||`Beats: ${STATE.beats||0}/5  |  XP: ${STATE.experience||0}`;
  // Active morality/integrity track — use whichever visible dot-track has default_value:7
  const moralitySD=SECTION_DEFS.find(sd=>sd.type==='dot-track'&&sd.default_value===7&&secVisible(sd.key));
  const moralityStr=moralitySD?`  ${moralitySD.label}: ${STATE[moralitySD.state_key||moralitySD.key]||0}`:'';
  // Visible named-lists and line-lists (tilts, conditions, aspirations, etc.)
  const listSections=SECTION_DEFS.filter(sd=>
    (sd.type==='named-list'||sd.type==='line-list')&&secVisible(sd.key)&&
    !['tactics','endowments'].includes(sd.key) // exclude ability lists
  );
  const listStr=listSections.map(sd=>{
    const items=STATE[sd.state_key||sd.key]||[];
    if(!items.length)return null;
    const lines=sd.type==='line-list'
      ?items.map(i=>`  ${i}`)
      :items.map(i=>`  ${i.name||''}${i.desc?': '+i.desc:''}`);
    return `${sd.label.toUpperCase()}\n${lines.join('\n')}`;
  }).filter(Boolean).join('\n\n');
  // Determine which broad sections are visible
  const showMortalAttrs=secVisible('attributes');
  const showMortalSkills=secVisible('skills');
  const showMortalDerived=secVisible('other-traits');
  const showEntityAttrs=secVisible('entity-attributes');
  const showEntityDerived=secVisible('entity-traits');
  const showMerits=secVisible('merits');
  const showWeapons=secVisible('weapons');
  const showArmor=secVisible('armor');
  const showEquip=secVisible('equipment');
  // Entity derived traits block
  const entityDerivedStr=showEntityDerived?(()=>{
    const corpusMax=STATE.corpus_max_override!=null?STATE.corpus_max_override:
      (getEntityAttrVal('resistance')+(STATE.entity_size||5));
    const corpusTrack=STATE.corpus_track||[];
    const corpusDmgCount=corpusTrack.filter(x=>x!=='').length;
    const corpusStr=corpusTrack.map(s=>!s?'□':s==='b'?'/':s==='l'?'X':'*').join(' ');
    const ewpMax=STATE.entity_wp_max_override!=null?STATE.entity_wp_max_override:
      (getEntityAttrVal('resistance')+getEntityAttrVal('finesse'));
    const ewpSpent=STATE.entity_wp_spent||0;
    return `\nENTITY TRAITS\n  Corpus: ${corpusMax-corpusDmgCount} / ${corpusMax}  ${corpusStr}\n  Willpower: ${ewpMax} (${ewpMax-ewpSpent} remaining)\n  Essence: ${STATE.entity_essence_current||0} / ${STATE.entity_essence_max||10}\n  Defense: ${STATE.entity_defense||0}\n  Initiative: ${STATE.entity_initiative||0}\n  Speed: ${STATE.entity_speed||0}`;
  })():'';
  // Entity attributes block
  const entityAttrStr=showEntityAttrs?`\nATTRIBUTES (ENTITY)\n  Power: ${getEntityAttrVal('power')} | Finesse: ${getEntityAttrVal('finesse')} | Resistance: ${getEntityAttrVal('resistance')}`:'';
  const txt=(`=====================================\n${STATE.name||'Unnamed'}\n${hdrStr}\n${beatsStr}\n=====================================`
    +(showMortalAttrs?`\n\nATTRIBUTES\n${attrStr}`:'')
    +(entityAttrStr)
    +(showMortalSkills?`\n\nSKILLS\n${skillStr||'  None'}`:'')
    +(showMortalDerived?`\n\nDERIVED TRAITS\n  Health: ${healthStr}\n  Willpower: ${getWpMax()} (${getWpMax()-(STATE.willpower_spent||0)} remaining)\n  Defense: ${STATE.defense||0}${gm.defPenalty?` (→${STATE.defense+gm.defPenalty} with gear)`:''}\n  Initiative: ${STATE.initiative||0}${gm.initMod?` (→${STATE.initiative+gm.initMod} with gear)`:''}\n  Speed: ${STATE.speed||0}${gm.speedPenalty?` (→${STATE.speed+gm.speedPenalty} with gear)`:''}\n  Size: ${STATE.size||5}${moralityStr}${(STATE.armor||[]).some(a=>a.equipped)?(()=>{const locs=["head","torso","arms","legs"];const covStr=locs.map(loc=>{const c=gm.coverage[loc];return loc[0].toUpperCase()+loc.slice(1)+" "+c.g+"/"+c.b;}).join(" | ");return "\\n  Armor: "+covStr;})():''}`:'')
    +(entityDerivedStr)
    +(showMerits?`\n\nMERITS\n${(STATE.merits||[]).map(m=>`  ${m.name} ${'●'.repeat(m.rating||0)||'(unrated)'}${m.desc?': '+m.desc:''}`).join('\n')||'  None'}`:'')
    +(showWeapons?`\n\nWEAPONS\n${(STATE.weapons||[]).map(w=>w.weapon_type==='ranged'?`  ${w.name}${w.equipped?' [Equipped]':''}\n    Dmg +${w.damage||0} | Ranges: ${w.ranges||'—'} | Clip: ${w.clip||0} | Init ${w.initiative_mod>=0?'+':''}${w.initiative_mod||0} | Str ${w.strength_req||0} | Sz ${w.size||0}`:`  ${w.name}${w.equipped?' [Equipped]':''}\n    Dmg +${w.damage||0} | Init ${w.initiative_mod>=0?'+':''}${w.initiative_mod||0} | Str ${w.strength_req||0} | Sz ${w.size||0}`).join('\n')||'  None'}`:'')
    +(showArmor?`\n\nARMOR\n${(STATE.armor||[]).map(a=>`  ${a.name}${a.equipped?' [Equipped]':''}\n    Armor ${a.armor_general||0}/${a.armor_ballistic||0} | Defense ${a.defense_penalty>=0?'+':''}${a.defense_penalty||0} | Speed ${a.speed_penalty>=0?'+':''}${a.speed_penalty||0}`).join('\n')||'  None'}`:'')
    +(showEquip?`\n\nEQUIPMENT\n${(STATE.equipment||[]).map(e=>`  ${e.name}\n    Dice Bonus +${e.dice_bonus||0} | Durability ${e.durability||0} | Size ${e.size||0} | Structure ${e.structure||0}${e.desc?'\n    '+e.desc:''}`).join('\n')||'  None'}`:'')
    +(listStr?'\n\n'+listStr:'')
    +(STATE.notes?'\n\nNOTES\n  '+STATE.notes:'')
    +'\n=====================================').trim();
  navigator.clipboard.writeText(txt).then(()=>showStatus('Copied to clipboard.'));
}

// ── localStorage save/load ────────────────────────────────────────────────────
// Characters are stored as JSON under the key mortals_plus_save_{uuid}.
// An index of {id, name} pairs is kept separately under mortals_plus_index
// so the save list can be populated without loading every character.
// There is no server — all data is local to the browser.
const LS_PREFIX='mortals_plus_save_';
const LS_INDEX='mortals_plus_index';
const LS_CUSTOM_WATERMARK='mortals_plus_custom_watermark';
const LS_SCENE='mortals_plus_scene';
const LS_INIT='mortals_plus_st_init';
const LS_INIT_ADHOC='mortals_plus_st_init_adhoc';
const LS_STORAGE_FULL_MSG='Storage full — export characters to free up space.';
const LS_FOLDERS='mortals_plus_folders';
const LS_SUPPLEMENT='mortals_plus_supplement';
const LS_LIB_SORT='mortals_plus_lib_sort';
const LS_SAVE_LIST_H='mortals_plus_save_list_h';

// ── File System Save (FSS) constants — v35 ───────────────────────────────────
// IndexedDB is used to persist FileSystemDirectoryHandles between sessions.
// localStorage cannot store handles (they are not JSON-serialisable).
const IDB_DB_NAME='mortals_plus_fss';
const IDB_STORE='handles';
const IDB_KEY_CHARS='fss_chars_dir';
const IDB_KEY_DATA='fss_data_dir';
const IDB_KEY_SUPP='fss_supp_dir';

// One-time folder warning flags — stored in localStorage (not IDB).
// Set after the user has seen and acknowledged the dedicated-folder warning
// for each connection type. Never shown again once set.
const LS_FSS_WARNED_CHARS='mortals_plus_fss_warned_chars';
const LS_FSS_WARNED_DATA='mortals_plus_fss_warned_data';
const LS_FSS_WARNED_SUPP='mortals_plus_fss_warned_supp';

// Live handles for the current session. Null means not connected.
let _fssCharsHandle=null;
let _fssDataHandle=null;
let _fssSuppHandle=null;

// ── Theme accent colours for save list badges ─────────────────────────────────
// Maps theme keys to their accent CSS variable value for inline badge display.
const THEME_ACCENTS={
  neutral:'#2c2218',mortal:'#284880',hunter:'#103020',mage:'#004868',
  ascension:'#3a006f',werewolf:'#784840',vampire:'#000000',changeling:'#006038',
  demon:'#2a2f38',deviant:'#3a0a0a',promethean:'#2a1a4a',geist:'#1a3040',
  entity:'#2a3040',beast:'#3a2400',mummy:'#2a1e00',
};
function _themeAccent(theme){return THEME_ACCENTS[theme]||THEME_ACCENTS.neutral;}

// ── Save index migration ───────────────────────────────────────────────────────
// Patches any existing index entries missing the v29/v30 fields.
function _patchIndexEntry(entry){
  if(!entry.theme)entry.theme='neutral';
  if(!entry.tags)entry.tags=[];
  if(!entry.last_modified)entry.last_modified=0;
  if(!('folder' in entry))entry.folder=null;
  return entry;
}

// ── Folder management ─────────────────────────────────────────────────────────
// Folders are stored as [{id, name, collapsed}] in LS_FOLDERS.
// Characters reference a folder by id via the index entry's `folder` field.
function lsGetFolders(){
  try{const s=localStorage.getItem(LS_FOLDERS);return s?JSON.parse(s):[];}catch(e){return[];}
}
function lsSaveFolders(folders){
  try{localStorage.setItem(LS_FOLDERS,JSON.stringify(folders));}catch(e){
    if(_isQuotaError(e))showStatus(LS_STORAGE_FULL_MSG,4000);
  }
}
function createFolder(name){
  name=(name||'').trim();if(!name)return;
  const folders=lsGetFolders();
  if(folders.some(f=>f.name.toLowerCase()===name.toLowerCase())){showStatus('A folder with that name already exists.');return;}
  folders.push({id:_uuid(),name,collapsed:false});
  lsSaveFolders(folders);loadSaves();
}
function renameFolder(fid,name){
  name=(name||'').trim();if(!name)return;
  const folders=lsGetFolders();
  const f=folders.find(f=>f.id===fid);if(!f)return;
  if(folders.some(f2=>f2.id!==fid&&f2.name.toLowerCase()===name.toLowerCase())){showStatus('A folder with that name already exists.');return;}
  f.name=name;lsSaveFolders(folders);loadSaves();
}
function deleteFolder(fid){
  const idx=lsGetIndex();
  const hasChars=idx.some(s=>s.folder===fid);
  if(hasChars&&!confirm('This folder contains characters. Delete folder and ungroup its characters?'))return;
  idx.forEach(s=>{if(s.folder===fid)s.folder=null;});
  lsSaveIndex(idx);
  const folders=lsGetFolders().filter(f=>f.id!==fid);
  lsSaveFolders(folders);loadSaves();
}
function toggleFolderCollapsed(fid){
  const folders=lsGetFolders();
  const f=folders.find(f=>f.id===fid);if(!f)return;
  f.collapsed=!f.collapsed;lsSaveFolders(folders);
  loadSaves();
  if(_stModeActive)stRenderAddToScene();
}
function setCharFolder(id,fid){
  const idx=lsGetIndex();
  const entry=idx.find(s=>s.id===id);if(!entry)return;
  _patchIndexEntry(entry);
  entry.folder=fid||null;
  lsSaveIndex(idx);loadSaves();
}

// ── Tag management ────────────────────────────────────────────────────────────
// Tags live in the index entry only — never in STATE or exports.
function _getAllTags(){
  const idx=lsGetIndex();
  const all=new Set();
  idx.forEach(s=>(s.tags||[]).forEach(t=>all.add(t)));
  return [...all].sort();
}
function addTagToSave(id,tag){
  tag=(tag||'').trim();if(!tag)return;
  const idx=lsGetIndex();
  const entry=idx.find(s=>s.id===id);if(!entry)return;
  _patchIndexEntry(entry);
  if(!entry.tags.includes(tag))entry.tags.push(tag);
  lsSaveIndex(idx);loadSaves();
}
function removeTagFromSave(id,tag){
  const idx=lsGetIndex();
  const entry=idx.find(s=>s.id===id);if(!entry)return;
  entry.tags=(entry.tags||[]).filter(t=>t!==tag);
  lsSaveIndex(idx);loadSaves();
}
// _saveListFilter — current search string, updated by the filter input
let _saveListFilter='';
function setSaveFilter(val){_saveListFilter=(val||'').toLowerCase();loadSaves();}

// _formatRelativeTime — compact human-readable timestamp for save items
function _formatRelativeTime(ts){
  if(!ts)return'';
  const diff=Date.now()-ts;
  const m=Math.floor(diff/60000),h=Math.floor(diff/3600000),d=Math.floor(diff/86400000);
  if(diff<60000)return'just now';
  if(m<60)return m+'m ago';
  if(h<24)return h+'h ago';
  if(d<7)return d+'d ago';
  return new Date(ts).toLocaleDateString();
}

function _isQuotaError(e){return e&&(e.name==='QuotaExceededError'||e.name==='NS_ERROR_DOM_QUOTA_REACHED');}

function lsSaveIndex(saves){
  try{localStorage.setItem(LS_INDEX,JSON.stringify(saves));}catch(e){
    if(_isQuotaError(e))showStatus(LS_STORAGE_FULL_MSG,4000);
  }
}
function lsGetIndex(){
  try{const s=localStorage.getItem(LS_INDEX);return s?JSON.parse(s):[];}catch(e){return[];}
}

async function saveCharacter(){
  if(!STATE.name&&!STATE.id){showStatus('Nothing to save — load or create a sheet first.');return;}
  if(!STATE.id)STATE.id=_uuid();
  currentSaveId=STATE.id;

  // ── Dual write: FSS folder first, localStorage second ────────────────────
  let fssSaved=false;
  let lsSaved=false;

  if(_fssCharsHandle){
    fssSaved=await _fssWriteChar(STATE);
    if(!fssSaved)showStatus('Folder save failed — saving to browser only. Check your folder connection.',4000);
  }

  try{
    localStorage.setItem(LS_PREFIX+STATE.id,JSON.stringify(STATE));
    lsSaved=true;
    _autoSaveWarnActive=false;
    const idx=lsGetIndex();
    const existing=idx.findIndex(s=>s.id===STATE.id);
    const entry={id:STATE.id,name:STATE.name||'Unnamed',theme:STATE.theme||'neutral',tags:existing>=0?(idx[existing].tags||[]):[],last_modified:Date.now(),folder:existing>=0?(idx[existing].folder||null):(STATE.folder||null)};
    if(existing>=0)idx[existing]=entry;else idx.push(entry);
    idx.sort((a,b)=>(a.name||'').toLowerCase().localeCompare((b.name||'').toLowerCase()));
    lsSaveIndex(idx);
    if(fssSaved){
      showStatus('Saved.');
    }else if(!_fssCharsHandle){
      showStatus('Saved.');
    }
  }catch(e){
    if(_isQuotaError(e)){
      if(fssSaved){
        showStatus('Saved to folder. Browser storage is full — browser backup unavailable.',4000);
      }else{
        showStatus(LS_STORAGE_FULL_MSG,4000);
      }
    }else{
      if(!fssSaved)showStatus('Save failed — unexpected error.');
      else showStatus('Saved to folder. Browser save failed — unexpected error.',4000);
    }
  }
  loadSaves();
}

// autoSave — debounced silent save. Only fires for sheets that already have a
// currentSaveId (i.e. have been manually saved at least once). New unsaved
// sheets are never auto-saved. Waits 1.5s after the last change before writing
// so rapid edits (typing, clicking dots) are batched into a single write.
// _autoSaveWarnActive prevents repeated storage-full toasts while the quota
// remains exceeded; cleared on any successful save.
let _autoSaveTimer=null;
let _autoSaveWarnActive=false;
function autoSave(){
  if(!currentSaveId||!STATE.id)return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer=setTimeout(async()=>{
    // FSS write first if connected
    if(_fssCharsHandle)await _fssWriteChar(STATE);
    // localStorage write as fallback
    try{
      localStorage.setItem(LS_PREFIX+STATE.id,JSON.stringify(STATE));
      _autoSaveWarnActive=false;
      const idx=lsGetIndex();
      const existing=idx.findIndex(s=>s.id===STATE.id);
      const entry={id:STATE.id,name:STATE.name||'Unnamed',theme:STATE.theme||'neutral',tags:existing>=0?(idx[existing].tags||[]):[],last_modified:Date.now(),folder:existing>=0?(idx[existing].folder||null):(STATE.folder||null)};
      if(existing>=0)idx[existing]=entry;
      lsSaveIndex(idx);
    }catch(e){
      if(_isQuotaError(e)){
        if(_fssCharsHandle){
          // LS full but FSS is saving — warn once, non-blocking
          if(!_autoSaveWarnActive){_autoSaveWarnActive=true;showStatus('Browser storage is full — saving to folder only.',4000);}
        }else{
          if(!_autoSaveWarnActive){_autoSaveWarnActive=true;showStatus(LS_STORAGE_FULL_MSG,4000);}
        }
      }else{
        showStatus('Auto-save failed — unexpected error.');
      }
    }
  },1500);
}
// _buildSaveItemHTML — renders a single character save-item row.
// context: 'sidebar' (default) — full controls (tag editing, folder-move select).
//          'drawer' — tag pills read-only, no folder-move select, closes drawer on load.
function _buildSaveItemHTML(s,folders,context){
  const isDrawer=context==='drawer';
  const tagPills=(s.tags||[]).map(t=>isDrawer
    ?`<span class="si-tag">${escH(t)}</span>`
    :`<span class="si-tag" onclick="event.stopPropagation();removeTagFromSave('${s.id}','${escH(t)}')" title="Remove tag">${escH(t)} ✕</span>`
  ).join('');
  const addTagInput=isDrawer?'':`<span class="si-tag si-tag-add" onmousedown="event.stopPropagation()" onclick="event.stopPropagation();_showTagInput('${s.id}',this)" title="Add tag">+</span>`;
  // Folder move select — sidebar only
  const folderOpts=(!isDrawer&&folders.length)?`<option value="">— Ungrouped —</option>`+folders.map(f=>
    `<option value="${escH(f.id)}"${s.folder===f.id?' selected':''}>${escH(f.name)}</option>`
  ).join(''):'';
  const folderMove=(!isDrawer&&folders.length)?`<select class="si-move-select" title="Move to folder" onclick="event.stopPropagation()" onchange="setCharFolder('${s.id}',this.value||null)">${folderOpts}</select>`:'';
  const onclick=isDrawer?`loadCharacter('${s.id}');closeDrawer()`:`loadCharacter('${s.id}')`;
  return `<div class="save-item ${s.id===currentSaveId?'active':''}" onclick="${onclick}">
    <span class="si-body">
      <span class="si-name-row">
        <span class="si-name">${escH(s.name||'Unnamed')}</span>
      </span>
      <span class="si-tags">${tagPills}${addTagInput}${folderMove}</span>
    </span>
    <button class="sm danger" onclick="event.stopPropagation();deleteSave('${s.id}')" title="Delete">Del</button>
  </div>`;
}
async function loadSaves(){
  const lsList=lsGetIndex().map(_patchIndexEntry);
  // Merge FSS characters with localStorage index.
  // FSS wins on file content (id, name, theme, last_modified).
  // localStorage index wins on metadata (tags, folder) — these are browser-local
  // and never written into the character files themselves.
  // Characters that exist only in FSS (no matching LS entry) appear ungrouped
  // with no tags, which is the documented behaviour.
  let rawList=lsList;
  if(_fssCharsHandle){
    const fssEntries=await _fssReadAllChars();
    if(fssEntries.length){
      const lsById=new Map(lsList.map(e=>[e.id,e]));
      const lsByName=new Map(lsList.map(e=>[(e.name||'').toLowerCase(),e]));
      // Build merged FSS entries: carry tags and folder from LS where available
      const mergedFSS=fssEntries.map(fssEntry=>{
        // Match by id first (most reliable), then fall back to name
        const lsMatch=lsById.get(fssEntry.id)||lsByName.get((fssEntry.name||'').toLowerCase());
        return{
          ...fssEntry,
          tags:lsMatch?(lsMatch.tags||[]):[],
          folder:lsMatch?(lsMatch.folder||null):null,
        };
      });
      // Remove LS entries that have a corresponding FSS entry (FSS is authoritative)
      const fssIds=new Set(mergedFSS.map(e=>e.id));
      const fssNames=new Set(mergedFSS.map(e=>(e.name||'').toLowerCase()));
      const filteredLS=lsList.filter(s=>!fssIds.has(s.id)&&!fssNames.has((s.name||'').toLowerCase()));
      rawList=[...filteredLS,...mergedFSS];
      rawList.sort((a,b)=>(a.name||'').toLowerCase().localeCompare((b.name||'').toLowerCase()));
    }
  }
  const folders=lsGetFolders();
  const f=_saveListFilter;
  const list=f?rawList.filter(s=>{
    const nameMatch=(s.name||'').toLowerCase().includes(f);
    const tagMatch=(s.tags||[]).some(t=>t.toLowerCase().includes(f));
    return nameMatch||tagMatch;
  }):rawList;

  // ── Storage usage indicator ───────────────────────────────────────────────
  let lsUsed=0;
  try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('mortals_plus'))lsUsed+=((localStorage.getItem(k)||'').length*2);}}catch(e){}
  const lsMax=5*1024*1024;
  const lsPct=Math.min(100,Math.round(lsUsed/lsMax*100));
  const lsUsedMB=(lsUsed/1048576).toFixed(1);
  const lsMaxMB='5.0';
  const barColour=lsPct>80?'var(--danger)':lsPct>60?'var(--info)':'var(--accent)';
  const fssRow=_fssCharsHandle
    ?`<div style="display:flex;justify-content:space-between;font-family:sans-serif;font-size:.68rem;color:var(--info);margin-top:4px"><span>📁 Folder connected</span><span>${_fssCharsHandle.name}</span></div>`
    :'';
  const storageHTML=`<div style="margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;font-family:sans-serif;font-size:.68rem;color:var(--faint);margin-bottom:3px">
      <span>Browser storage</span><span>${lsUsedMB} / ${lsMaxMB} MB</span>
    </div>
    <div style="height:4px;background:var(--border-light);border-radius:2px;overflow:hidden">
      <div style="height:100%;width:${lsPct}%;background:${barColour};border-radius:2px;transition:width .3s"></div>
    </div>
    ${fssRow}
  </div>`;

  // ── Save items with folder grouping ───────────────────────────────────────
  let itemsHTML='';
  if(!rawList.length){
    itemsHTML='<span style="font-size:.8rem;color:var(--faint);font-family:sans-serif">No saved characters yet.</span>';
  } else if(!list.length){
    itemsHTML='<span style="font-size:.8rem;color:var(--faint);font-family:sans-serif">No characters match your filter.</span>';
  } else {
    // When filtering, show flat list (folders not useful when searching)
    if(f){
      itemsHTML=list.map(s=>_buildSaveItemHTML(s,folders)).join('');
    } else {
      // Group by folder; ungrouped at bottom
      const folderSections=folders.map(folder=>{
        const chars=list.filter(s=>s.folder===folder.id);
        if(!chars.length)return'';
        const chevClass='si-folder-chevron'+(folder.collapsed?'':' open');
        const bodyClass='si-folder-body'+(folder.collapsed?' collapsed':'');
        return `<div class="si-folder">
          <div class="si-folder-hdr" onclick="toggleFolderCollapsed('${folder.id}')">
            <span class="${chevClass}">▶</span>
            <span class="si-folder-name">${escH(folder.name)}</span>
            <span class="si-folder-count">${chars.length}</span>
            <span class="si-folder-actions" onclick="event.stopPropagation()">
              <button class="si-folder-btn" onclick="_renameFolderPrompt('${folder.id}','${escH(folder.name).replace(/'/g,"\'")}')" title="Rename">✏</button>
              <button class="si-folder-btn danger" onclick="deleteFolder('${folder.id}')" title="Delete folder">🗑</button>
            </span>
          </div>
          <div class="${bodyClass}">${chars.map(s=>_buildSaveItemHTML(s,folders)).join('')}</div>
        </div>`;
      }).join('');
      const ungrouped=list.filter(s=>!s.folder||!folders.find(f=>f.id===s.folder));
      const ungroupedHTML=ungrouped.length?`<div class="si-ungrouped">${ungrouped.map(s=>_buildSaveItemHTML(s,folders)).join('')}</div>`:'';
      // New folder input
      const newFolderHTML=`<div class="si-folder-new">
        <input id="newFolderInp" placeholder="New folder name…" onkeydown="if(event.key==='Enter'){createFolder(this.value);this.value='';}" style="font-family:sans-serif;font-size:.72rem;padding:.2rem .4rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);flex:1">
        <button class="sm" onclick="createFolder(document.getElementById('newFolderInp').value);document.getElementById('newFolderInp').value=''">+ Folder</button>
      </div>`;
      itemsHTML=folderSections+ungroupedHTML+newFolderHTML;
    }
  }

  const fullHTML=storageHTML+`<div class="save-list">${itemsHTML}</div>`;

  // Update desktop sidebar
  const el=document.getElementById('saveListWrap');
  if(el)el.innerHTML=fullHTML;

  // Also refresh drawer save list, passing the already-merged data
  _refreshDrawerSaveList(rawList,list,folders);
}
function _renameFolderPrompt(fid,currentName){
  const name=prompt('Rename folder:',currentName);
  if(name&&name.trim())renameFolder(fid,name.trim());
}

// _showTagInput — inline tag add with custom autocomplete dropdown
// Replaces the + span with a small input and a DOM dropdown for existing tags.
// Dropdown is appended to body with fixed positioning to escape scroll containers.
function _showTagInput(id,btn){
  const allTags=_getAllTags();

  // Build input
  const inp=document.createElement('input');
  inp.className='si-tag-inp';
  inp.placeholder='Tag…';
  inp.style.cssText='font-family:sans-serif;font-size:.68rem;padding:1px 4px;border:1px solid var(--border);border-radius:10px;width:70px;outline:none;background:var(--surface);color:var(--text)';
  btn.replaceWith(inp);
  inp.focus();

  // Build dropdown appended to body — escapes overflow:hidden/auto stacking contexts
  const drop=document.createElement('div');
  drop.className='si-tag-drop';
  drop.style.display='none';
  drop.style.position='fixed';
  document.body.appendChild(drop);

  const positionDrop=()=>{
    const r=inp.getBoundingClientRect();
    drop.style.top=(r.bottom+2)+'px';
    drop.style.left=r.left+'px';
    drop.style.minWidth=Math.max(100,r.width)+'px';
  };

  const removeDrop=()=>{if(drop.parentNode)drop.parentNode.removeChild(drop);};

  const commit=(val)=>{
    removeDrop();
    const v=(val||inp.value).trim();
    if(v)addTagToSave(id,v);
    else loadSaves();
  };

  const renderDrop=(filter)=>{
    const matches=filter
      ?allTags.filter(t=>t.toLowerCase().startsWith(filter.toLowerCase())&&t.toLowerCase()!==filter.toLowerCase())
      :allTags;
    if(!matches.length){drop.style.display='none';return;}
    drop.innerHTML=matches.map(t=>`<div class="si-tag-drop-item" data-val="${escH(t)}">${escH(t)}</div>`).join('');
    positionDrop();
    drop.style.display='';
    drop.querySelectorAll('.si-tag-drop-item').forEach(item=>{
      item.addEventListener('mousedown',e=>{
        e.preventDefault(); // prevent input blur
        commit(item.dataset.val);
      });
    });
  };

  inp.addEventListener('input',()=>renderDrop(inp.value));
  inp.addEventListener('focus',()=>renderDrop(inp.value));
  inp.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();commit();}
    if(e.key==='Escape'){removeDrop();loadSaves();}
    if(e.key==='ArrowDown'){
      const items=drop.querySelectorAll('.si-tag-drop-item');
      if(items.length){e.preventDefault();items[0].focus();}
    }
  });
  inp.addEventListener('blur',()=>{
    setTimeout(()=>{if(document.activeElement!==inp)commit();},150);
  });

  // Keyboard navigation within dropdown
  drop.addEventListener('keydown',e=>{
    const items=[...drop.querySelectorAll('.si-tag-drop-item')];
    const idx=items.indexOf(document.activeElement);
    if(e.key==='ArrowDown'&&idx<items.length-1){e.preventDefault();items[idx+1].focus();}
    if(e.key==='ArrowUp'){e.preventDefault();if(idx>0)items[idx-1].focus();else inp.focus();}
    if(e.key==='Enter'&&idx>=0){e.preventDefault();commit(items[idx].dataset.val);}
    if(e.key==='Escape'){removeDrop();loadSaves();}
  });

  // Show suggestions immediately if tags exist
  if(allTags.length)renderDrop('');
}
async function loadCharacter(id){
  try{
    let state=null;
    // FSS folder takes priority if connected
    if(_fssCharsHandle)state=await _fssReadChar(id);
    // Fall back to localStorage
    if(!state){
      const raw=localStorage.getItem(LS_PREFIX+id);
      if(raw)state=JSON.parse(raw);
    }
    if(!state){showStatus('Character not found.');return;}
    STATE=state;currentSaveId=id;patchState();showEditor();renderEditor();loadSaves();
  }catch(e){showStatus('Load failed: '+e.message);}
}
async function deleteSave(id){
  const idx=lsGetIndex();
  const entry=idx.find(s=>s.id===id);
  const name=entry?entry.name||'Unnamed':'this character';
  if(!confirm(`Delete "${name}"? This cannot be undone.`))return;
  // Warn if this character has active scene instances
  const scene=_stGetScene();
  const hasInstances=scene.some(inst=>inst.source_id===id);
  if(hasInstances&&!confirm('This character has active instances in the current Storyteller scene. Delete anyway?'))return;
  localStorage.removeItem(LS_PREFIX+id);
  if(_fssCharsHandle)await _fssDeleteChar(id);
  const newIdx=idx.filter(s=>s.id!==id);
  lsSaveIndex(newIdx);
  if(id===currentSaveId){currentSaveId=null;}
  loadSaves();
}

async function cloneCharacter(){
  // Clone the currently loaded character — must be saved at least once
  if(!STATE.id||!currentSaveId){showStatus('Save the character first before cloning.');return;}
  // Deep-copy current STATE and assign new identity
  const clone=JSON.parse(JSON.stringify(STATE));
  clone.id=_uuid();
  clone.name=(STATE.name||'Unnamed')+' (Copy)';
  // Dual-write clone — does not touch STATE or currentSaveId
  let fssSaved=false;
  if(_fssCharsHandle){
    fssSaved=await _fssWriteChar(clone);
    if(!fssSaved)showStatus('Folder save failed for clone — saving to browser only.',4000);
  }
  try{
    localStorage.setItem(LS_PREFIX+clone.id,JSON.stringify(clone));
    const idx=lsGetIndex();
    idx.push({id:clone.id,name:clone.name,theme:clone.theme||'neutral',tags:[],last_modified:Date.now(),folder:null});
    idx.sort((a,b)=>(a.name||'').toLowerCase().localeCompare((b.name||'').toLowerCase()));
    lsSaveIndex(idx);
    showStatus(`Cloned as "${clone.name}".`);
  }catch(e){
    if(_isQuotaError(e)){
      if(fssSaved)showStatus('Cloned to folder. Browser storage full — browser backup unavailable.',4000);
      else showStatus(LS_STORAGE_FULL_MSG,4000);
    }else{
      if(!fssSaved)showStatus('Clone failed — unexpected error.');
      else showStatus('Cloned to folder. Browser save failed — unexpected error.',4000);
    }
  }
  loadSaves();
}

function exportSheet(){
  if(!STATE.name&&!STATE.id){showStatus('Nothing to export — load or create a sheet first.');return;}
  const filename=(STATE.name||'character').replace(/[^a-z0-9_\-\s]/gi,'').trim()||'character';
  downloadJSON(STATE,filename+'.json');
}
// _showImportResult — shows inline feedback on an import result element
// elId: the id of the .import-result div; ok: true=success, false=error; msg: text to show
function _showImportResult(elId,ok,msg){
  const el=document.getElementById(elId);if(!el)return;
  el.textContent=msg;
  el.className='import-result '+(ok?'ok':'err');
  clearTimeout(el._hideTimer);
  // Success messages fade after 6s; errors stay until next interaction
  if(ok)el._hideTimer=setTimeout(()=>{el.className='import-result';el.textContent='';},6000);
}
function importSheet(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      STATE=JSON.parse(e.target.result);patchState();currentSaveId=STATE.id||null;
      showEditor();renderEditor();
      showStatus('Sheet imported.');
      _showImportResult('sheetImportResult',true,`✓ "${STATE.name||'Unnamed'}" imported successfully.`);
    }catch{
      showStatus('Import failed — invalid JSON file.');
      _showImportResult('sheetImportResult',false,'✕ Import failed — not a valid sheet file.');
    }
  };
  reader.readAsText(file);input.value='';
}
function getDataKeys(){
  return [...new Set(SECTION_DEFS.filter(s=>s.db_key&&s.type!=='forms-block').map(s=>s.db_key))];
}
async function downloadJSON(obj,filename){
  const json=JSON.stringify(obj,null,2);
  if(window.showSaveFilePicker){
    try{
      const handle=await window.showSaveFilePicker({
        suggestedName:filename,
        types:[{description:'JSON file',accept:{'application/json':['.json']}}]
      });
      const writable=await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    }catch(e){
      if(e.name==='AbortError')return; // user cancelled — do nothing
      // fall through to legacy download on any other error
    }
  }
  // Fallback for Firefox, Safari, and any unsupported browser
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();
  URL.revokeObjectURL(url);
}

// ══════════════════════════════════════════════════════════════════════════════
// SUPPLEMENTAL DATA LIBRARY — v30
// User-created entries stored in localStorage under LS_SUPPLEMENT.
// Merged into DB arrays at loadDB() time, before alphabetical sort.
// Never modifies data.json. Base library always recoverable via reset.
// ══════════════════════════════════════════════════════════════════════════════

function _getSupplementRaw(){
  try{const s=localStorage.getItem(LS_SUPPLEMENT);return s?JSON.parse(s):{};}catch(e){return{};}
}
function _saveSupplementRaw(obj){
  try{localStorage.setItem(LS_SUPPLEMENT,JSON.stringify(obj));}catch(e){
    if(_isQuotaError(e))showStatus(LS_STORAGE_FULL_MSG,4000);
    else showStatus('Supplement save failed.');
  }
  // FSS dual-write — fire-and-forget; failures are silent (LS is the primary)
  if(_fssSuppHandle)_fssWriteSuppJson(obj).catch(()=>{});
}
// _suppGetArray — returns the supplement entries for a given db_key
function _suppGetArray(dbKey){
  const raw=_getSupplementRaw();
  return raw[dbKey]||[];
}
// _suppSaveArray — writes the entries for a db_key back to localStorage
function _suppSaveArray(dbKey,arr){
  const raw=_getSupplementRaw();
  raw[dbKey]=arr;
  _saveSupplementRaw(raw);
}
// _reloadDBFromSupplement — re-merges supplement into DB and refreshes all dropdowns
function _reloadDBFromSupplement(){
  // Reset DB arrays to base data.json values
  const d=window._DB_RAW||{};
  const preserve=new Set(SECTION_DEFS.filter(s=>s.db_key&&s.preserve_order).map(s=>s.db_key));
  SECTION_DEFS.forEach(sd=>{
    if(sd.db_key)DB[sd.db_key]=Array.isArray(d[sd.db_key])?[...d[sd.db_key]]:[];
  });
  // Merge supplement — supplement entries override base entries of the same name
  const rawSupp=_getSupplementRaw();
  Object.keys(rawSupp).forEach(k=>{
    if(Array.isArray(rawSupp[k])&&rawSupp[k].length){
      if(!DB[k])DB[k]=[];
      const suppNames=new Set(rawSupp[k].map(e=>e.name));
      // Remove base entries whose name is overridden by supplement
      DB[k]=DB[k].filter(e=>!suppNames.has(e.name));
      DB[k]=[...DB[k],...rawSupp[k]];
    }
  });
  // Re-sort
  SECTION_DEFS.filter(s=>s.db_key&&!preserve.has(s.db_key)).forEach(s=>{
    if(Array.isArray(DB[s.db_key]))DB[s.db_key].sort((a,b)=>(a.name||'').toLowerCase().localeCompare((b.name||'').toLowerCase()));
  });
  // Refresh dropdowns
  SECTION_DEFS.forEach(sd=>{
    if(sd.db_key&&secVisible(sd.key)){
      if(sd.type==='rated-list'&&sd.special_renderer==='merits')refillSelect('meritDrop',DB.merits);
      else if(sd.db_key)refillSelect(`${sd.key}-drop`,DB[sd.db_key]);
    }
  });
  refillSelect('weaponDrop',DB.weapons||[]);
  refillSelect('armorDrop',DB.armor||[]);
  refillSelect('equipDrop',DB.equipment||[]);
}

// ── Add-to-library from sheet ─────────────────────────────────────────────────
// Called when the user clicks "+ lib" on a sheet entry that isn't in DB.
// ── Library entry comparison helpers ─────────────────────────────────────────
// ── Lib sync button ───────────────────────────────────────────────────────────
// Always visible on sheet entries with a db_key. One button, one behaviour:
// writes the current entry to the supplement unconditionally — add if new,
// update in place if already in supplement, override if only in base library.

// _libRerender — re-renders the section after a lib sync operation
function _libRerender(dbKey){
  const sd=SECTION_DEFS.find(s=>s.db_key===dbKey);
  if(sd){
    if(sd.type==='rated-list')renderGenericRatedList(sd);
    else if(sd.type==='named-list'){const listId=`${sd.key}-named-list`;renderNamedList(sd.state_key||sd.key,listId);}
  }
  if(dbKey==='weapons')renderWeaponList();
  else if(dbKey==='armor')renderArmorList();
  else if(dbKey==='equipment')renderEquipList();
}
// libSyncFromState — reads live STATE at click time (captures inline edits after render)
function libSyncFromState(dbKey,stateKey,idx,btn){
  const arr=STATE[stateKey];
  if(!arr||!arr[idx]){showStatus('Could not find entry.');return;}
  _libSync(dbKey,arr[idx],btn);
}
// _libSync — unconditional write to supplement
function _libSync(dbKey,entry,btn){
  const stripped={...entry};
  delete stripped.equipped;
  if(!stripped.name){showStatus('Entry needs a name first.');return;}
  const suppArr=_suppGetArray(dbKey);
  const existing=suppArr.findIndex(e=>e.name===stripped.name);
  if(existing>=0){
    stripped._added=suppArr[existing]._added||Date.now();
    suppArr[existing]=stripped;
    showStatus(`"${stripped.name}" synced to library.`);
  } else {
    stripped._added=Date.now();
    suppArr.push(stripped);
    showStatus(`"${stripped.name}" added to library.`);
  }
  // Flash button: show confirmed state, restore label after 1s, rerender after 1.2s
  if(btn){
    btn.textContent='✓ synced';
    btn.classList.add('synced');
    setTimeout(()=>{
      btn.textContent='sync';
      btn.classList.remove('synced');
    },1000);
  }
  _suppSaveArray(dbKey,suppArr);
  _reloadDBFromSupplement();
  setTimeout(()=>_libRerender(dbKey),1200);
}
// _libSyncBtn — returns the lib sync button HTML; always shown when dbKey is set and entry has a name
function _libSyncBtn(dbKey,entry,stateKey,idx){
  if(!dbKey||!entry||!entry.name)return'';
  if(stateKey!=null&&idx!=null){
    return`<button class="sm lib-add-btn" title="Sync to library" onclick="event.stopPropagation();libSyncFromState('${escH(dbKey)}','${escH(stateKey)}',${idx},this)">sync</button>`;
  }
  const encoded=encodeURIComponent(JSON.stringify(entry));
  return`<button class="sm lib-add-btn" title="Sync to library" onclick="event.stopPropagation();_libSync('${escH(dbKey)}',JSON.parse(decodeURIComponent('${encoded}')),this)">sync</button>`;
}
let _libEditorKey=null; // currently selected db_key in editor
let _libEditorFilter='';  // current search filter string
function _libSortPref(){
  try{return localStorage.getItem(LS_LIB_SORT)||'alpha';}catch(e){return'alpha';}
}
function _libSetSortPref(v){
  try{localStorage.setItem(LS_LIB_SORT,v);}catch(e){}
}

function openLibEditor(){
  let modal=document.getElementById('libEditorModal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='libEditorModal';
    modal.style.cssText='position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.55);display:flex;align-items:stretch;justify-content:center;padding:0;overflow:hidden';
    modal.innerHTML=`<div style="background:var(--surface);border-left:1px solid var(--border);border-right:1px solid var(--border);width:100%;max-width:700px;display:flex;flex-direction:column;font-family:sans-serif;height:100vh;overflow:hidden">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
        <span style="font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">Library Editor</span>
        <div style="display:flex;gap:6px;align-items:center">
          <button onclick="exportSupplement()">&#8615; Export</button>
          <button onclick="document.getElementById('importSuppFile').click()">&#8613; Import</button>
          <input type="file" id="importSuppFile" accept=".json" style="display:none" onchange="importSupplement(this)">
          <button class="sm danger" onclick="closeLibEditor()">✕ Close</button>
        </div>
      </div>
      <div id="suppImportResult" class="import-result" style="margin:0 16px;border-radius:4px;flex-shrink:0"></div>
      <!-- Section type selector -->
      <div style="padding:10px 16px;border-bottom:1px solid var(--border-light);flex-shrink:0;display:flex;gap:8px;align-items:center">
        <select id="libEditorKeySelect" style="flex:1;font-size:.78rem;padding:.3rem .5rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)" onchange="libEditorSelectKey(this.value)">
          <option value="">— Select a library section —</option>
        </select>
        <button class="primary" id="libEditorAddBtn" style="display:none" onclick="libEditorShowAddForm()">+ New entry</button>
      </div>
      <!-- Search + sort toolbar — shown once a section is selected -->
      <div id="libEditorToolbar" style="display:none;padding:6px 16px;border-bottom:1px solid var(--border-light);flex-shrink:0;display:none;gap:8px;align-items:center">
        <input id="libEditorSearch" type="text" placeholder="Search entries…" style="flex:1;font-size:.78rem;padding:.25rem .5rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)" oninput="_libEditorFilter=this.value;_libEditorRenderList(_libEditorKey)">
        <span style="font-size:.7rem;color:var(--faint);flex-shrink:0">Sort:</span>
        <button id="libSortAlpha" class="sm" style="font-size:.68rem;padding:2px 7px" onclick="_libSetSortPref('alpha');_libEditorRenderList(_libEditorKey);_libUpdateSortBtns()">A–Z</button>
        <button id="libSortRecent" class="sm" style="font-size:.68rem;padding:2px 7px" onclick="_libSetSortPref('recent');_libEditorRenderList(_libEditorKey);_libUpdateSortBtns()">Recent</button>
      </div>
      <div id="libEditorDupWarning" style="display:none;font-size:.72rem;color:var(--accent);padding:6px 16px;border-bottom:1px solid var(--accent);background:rgba(40,72,128,.08);flex-shrink:0"></div>
      <!-- Scrollable body: list + form -->
      <div style="flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px">
        <div style="font-size:.7rem;color:var(--faint);line-height:1.5">
          Base library entries can be overridden by adding a supplement entry with the same name.
          <strong style="color:var(--text)">Export your supplement regularly</strong> — browser data loss will erase it.
        </div>
        <div id="libEditorList" style="display:flex;flex-direction:column;gap:5px"></div>
        <div id="libEditorAddForm" style="display:none"></div>
      </div>
      <!-- Footer -->
      <div style="padding:8px 16px;border-top:1px solid var(--border-light);flex-shrink:0;display:flex;justify-content:flex-end">
        <button class="danger sm" id="libEditorResetBtn" style="display:none" onclick="libEditorResetSupplement()">⚠ Reset all supplemental data</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    _libEditorPopulateSelect();
  }
  modal.style.display='flex';
  _libEditorPopulateSelect();
  if(_libEditorKey)libEditorSelectKey(_libEditorKey);
}
function closeLibEditor(){
  const modal=document.getElementById('libEditorModal');
  if(modal)modal.style.display='none';
}
function _libEditorPopulateSelect(){
  const sel=document.getElementById('libEditorKeySelect');if(!sel)return;
  const keys=getDataKeys().slice().sort((a,b)=>a.localeCompare(b));
  sel.innerHTML='<option value="">— Select a library section —</option>'+keys.map(k=>`<option value="${escH(k)}"${k===_libEditorKey?' selected':''}>${escH(k)}</option>`).join('');
}

// ── Field schema — full field definitions for every db_key ────────────────────
// Each field: { key, label, type, options?, min?, max?, rows?, nested? }
// type: 'text' | 'number' | 'textarea' | 'select' | 'checkboxes'
const LIB_FIELD_SCHEMAS={
  // Generic shapes (inferred from section type if db_key not listed below)
  _named:    [{key:'name',label:'Name',type:'text'},{key:'desc',label:'Description',type:'textarea',rows:5}],
  _rated:    [{key:'name',label:'Name',type:'text'},{key:'rating',label:'Rating',type:'number',min:0,max:10},{key:'desc',label:'Description',type:'textarea',rows:5}],
  // Specific schemas
  weapons:[
    {key:'name',label:'Name',type:'text'},
    {key:'weapon_type',label:'Type',type:'select',options:['melee','ranged','thrown']},
    {key:'damage',label:'Damage',type:'number',min:-5,max:10},
    {key:'initiative_mod',label:'Initiative Mod',type:'number',min:-10,max:10},
    {key:'strength_req',label:'Strength Req',type:'number',min:1,max:10},
    {key:'size',label:'Size',type:'number',min:1,max:10},
    {key:'availability',label:'Availability',type:'number',min:1,max:10},
    {key:'ranges',label:'Ranges (short/med/long)',type:'text'},
    {key:'clip',label:'Clip',type:'number',min:0,max:100},
    {key:'notes',label:'Notes',type:'textarea',rows:3},
  ],
  armor:[
    {key:'name',label:'Name',type:'text'},
    {key:'armor_general',label:'Armor (General)',type:'number',min:0,max:10},
    {key:'armor_ballistic',label:'Armor (Ballistic)',type:'number',min:0,max:10},
    {key:'defense_penalty',label:'Defense Penalty',type:'number',min:0,max:10},
    {key:'strength_req',label:'Strength Req',type:'number',min:1,max:10},
    {key:'availability',label:'Availability',type:'number',min:1,max:10},
    {key:'notes',label:'Notes',type:'textarea',rows:3},
    {key:'coverage',label:'Coverage',type:'checkboxes',options:['head','torso','arms','legs']},
  ],
  equipment:[
    {key:'name',label:'Name',type:'text'},
    {key:'dice_bonus',label:'Dice Bonus',type:'number',min:0,max:10},
    {key:'durability',label:'Durability',type:'number',min:0,max:10},
    {key:'size',label:'Size',type:'number',min:1,max:10},
    {key:'structure',label:'Structure',type:'number',min:1,max:20},
    {key:'availability',label:'Availability',type:'number',min:1,max:10},
    {key:'desc',label:'Description',type:'textarea',rows:4},
  ],
};
// _libSchema(key) — returns the field schema for a db_key
function _libSchema(key){
  if(LIB_FIELD_SCHEMAS[key])return LIB_FIELD_SCHEMAS[key];
  // Infer from first DB entry or section type
  const sample=(window._DB_RAW&&window._DB_RAW[key]&&window._DB_RAW[key][0])||null;
  if(sample&&'rating' in sample)return LIB_FIELD_SCHEMAS._rated;
  const sd=SECTION_DEFS.find(s=>s.db_key===key);
  if(sd&&sd.type==='rated-list')return LIB_FIELD_SCHEMAS._rated;
  return LIB_FIELD_SCHEMAS._named;
}
// _libDefaultEntry(key) — blank entry with all fields at zero/empty
function _libDefaultEntry(key){
  const out={};
  _libSchema(key).forEach(f=>{
    if(f.type==='number')out[f.key]=f.min!=null?Math.max(0,f.min):0;
    else if(f.type==='checkboxes')out[f.key]=Object.fromEntries((f.options||[]).map(o=>[o,false]));
    else out[f.key]='';
  });
  return out;
}

// ── List rendering ────────────────────────────────────────────────────────────
function _libUpdateSortBtns(){
  const pref=_libSortPref();
  const a=document.getElementById('libSortAlpha');
  const r=document.getElementById('libSortRecent');
  if(a)a.style.fontWeight=pref==='alpha'?'700':'400';
  if(r)r.style.fontWeight=pref==='recent'?'700':'400';
}
function libEditorSelectKey(key){
  _libEditorKey=key||null;
  _libEditorFilter='';
  const toolbar=document.getElementById('libEditorToolbar');
  const searchInp=document.getElementById('libEditorSearch');
  const addBtn=document.getElementById('libEditorAddBtn');
  const resetBtn=document.getElementById('libEditorResetBtn');
  const addForm=document.getElementById('libEditorAddForm');
  const dupWarn=document.getElementById('libEditorDupWarning');
  if(addForm){addForm.style.display='none';addForm.innerHTML='';}
  if(searchInp)searchInp.value='';
  if(!key){
    const listEl=document.getElementById('libEditorList');
    if(listEl)listEl.innerHTML='<span style="font-size:.8rem;color:var(--faint)">Select a section type above to browse and edit entries.</span>';
    if(addBtn)addBtn.style.display='none';
    if(resetBtn)resetBtn.style.display='none';
    if(toolbar)toolbar.style.display='none';
    if(dupWarn)dupWarn.style.display='none';
    return;
  }
  if(addBtn)addBtn.style.display='';
  if(resetBtn)resetBtn.style.display='';
  if(toolbar)toolbar.style.display='flex';
  _libUpdateSortBtns();
  _libEditorRenderList(key);
  if(dupWarn){
    const suppArr=_suppGetArray(key);
    const baseNames=new Set((window._DB_RAW&&Array.isArray(window._DB_RAW[key]))?window._DB_RAW[key].map(e=>e.name):[]);
    const dups=suppArr.filter(e=>baseNames.has(e.name)).map(e=>escH(e.name));
    if(dups.length){
      dupWarn.innerHTML=`✓ ${dups.length} supplement entr${dups.length>1?'ies':'y'} overriding base entries: ${dups.join(', ')}`;
      dupWarn.style.display='';
    }else{dupWarn.style.display='none';}
  }
}
function _libEditorRenderList(key){
  const listEl=document.getElementById('libEditorList');if(!listEl)return;
  const baseArr=(window._DB_RAW&&Array.isArray(window._DB_RAW[key]))?window._DB_RAW[key]:[];
  const suppArr=_suppGetArray(key);
  const suppNames=new Set(suppArr.map(e=>e.name));
  const f=(_libEditorFilter||'').toLowerCase().trim();

  // Apply filter to both arrays
  const filteredSupp=f?suppArr.filter(e=>(e.name||'').toLowerCase().includes(f)):suppArr;
  const filteredBase=f?baseArr.filter(e=>(e.name||'').toLowerCase().includes(f)):baseArr;

  // Sort supplement by preference
  const pref=_libSortPref();
  const sortedSupp=filteredSupp.slice().sort((a,b)=>{
    if(pref==='recent'){
      const ta=a._added||0,tb=b._added||0;
      return tb-ta; // newest first; fall through to alpha if equal
    }
    return(a.name||'').toLowerCase().localeCompare((b.name||'').toLowerCase());
  });

  // Populate cache for Override buttons
  _libBaseEntryCache.length=0;
  baseArr.forEach(e=>_libBaseEntryCache.push(e));

  let html='';
  if(!suppArr.length&&!baseArr.length){
    listEl.innerHTML='<span style="font-size:.8rem;color:var(--faint)">No entries for this section.</span>';return;
  }
  if(f&&!filteredSupp.length&&!filteredBase.length){
    listEl.innerHTML='<span style="font-size:.8rem;color:var(--faint)">No entries match your search.</span>';return;
  }

  if(sortedSupp.length){
    html+=`<div style="font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin-bottom:2px">Supplement entries</div>`;
    // For sorted supp, we need the original index in suppArr for edit/delete
    html+=sortedSupp.map(entry=>{
      const idx=suppArr.indexOf(entry);
      return _libEntryRowHTML(key,entry,idx,'supp');
    }).join('');
  } else if(suppArr.length&&f){
    html+=`<div style="font-size:.62rem;color:var(--faint);margin-bottom:4px">No supplement entries match.</div>`;
  }

  if(filteredBase.length){
    html+=`<div style="font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin-top:${suppArr.length?'10px':'0'};margin-bottom:2px">Base library${(!f&&suppArr.length)?' (click Override on any entry to create a supplement override)':''}</div>`;
    html+=filteredBase.map(entry=>{
      const idx=baseArr.indexOf(entry);
      return _libEntryRowHTML(key,entry,idx,'base',suppNames.has(entry.name));
    }).join('');
  } else if(baseArr.length&&f){
    html+=`<div style="font-size:.62rem;color:var(--faint);margin-top:6px">No base entries match.</div>`;
  }

  listEl.innerHTML=html;
}

const _libBaseEntryCache=[];
function _libEntryRowHTML(key,entry,idx,source,isOverridden){
  const schema=_libSchema(key);
  const summaryFields=schema.filter(f=>f.key!=='name'&&f.key!=='desc'&&f.key!=='notes'&&f.type!=='textarea'&&f.type!=='checkboxes');
  const summaryStr=summaryFields.filter(f=>entry[f.key]!=null&&entry[f.key]!=='').map(f=>`${f.label}: ${entry[f.key]}`).join(' · ');
  const descStr=entry.desc||entry.notes||'';
  const isSupp=source==='supp';
  const overrideBadge=isOverridden?`<span style="font-size:.6rem;background:var(--accent);color:#f5f0e8;border-radius:3px;padding:1px 5px;margin-left:4px">overridden</span>`:'';
  const editBtn=isSupp
    ?`<button class="sm" onclick="libEditorEditEntry('${escH(key)}',${idx})" style="font-size:.65rem;padding:2px 7px">Edit</button>`
    :isOverridden?'':`<button class="sm" onclick="libEditorOverrideBase('${escH(key)}',${idx})" style="font-size:.65rem;padding:2px 7px">Override</button>`;
  const delBtn=isSupp?`<button class="sm danger" onclick="libEditorDeleteEntry('${escH(key)}',${idx})" style="font-size:.65rem;padding:2px 7px">Del</button>`:'';
  return `<div style="display:flex;align-items:flex-start;gap:6px;padding:7px 8px;border:1px solid ${isSupp?'var(--accent)':'var(--border-light)'};border-radius:4px;background:var(--surface);margin-bottom:4px">
    <div style="flex:1;min-width:0">
      <div style="font-size:.8rem;font-weight:700;color:var(--text)">${escH(entry.name||'Unnamed')}${overrideBadge}</div>
      ${summaryStr?`<div style="font-size:.7rem;color:var(--muted);margin-top:1px">${escH(summaryStr)}</div>`:''}
      ${descStr?`<div style="font-size:.7rem;color:var(--faint);margin-top:1px;overflow:hidden;max-height:36px;text-overflow:ellipsis">${escH(descStr.substring(0,100))}${descStr.length>100?'…':''}</div>`:''}
    </div>
    <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0">
      ${editBtn}${delBtn}
    </div>
  </div>`;
}


function _libEditorBuildForm(key,entry,isEdit,suppIdx){
  const schema=_libSchema(key);
  const saveCall=isEdit?`libEditorSaveEdit('${escH(key)}',${suppIdx})`:`libEditorSaveNew('${escH(key)}')`;
  const fields=schema.map(f=>{
    const val=entry&&entry[f.key]!=null?entry[f.key]:(f.type==='number'?(f.min!=null?Math.max(0,f.min):0):(f.type==='checkboxes'?null:''));
    const inputStyle='flex:1;font-size:.78rem;padding:.25rem .4rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)';
    const labelHTML=`<label style="font-size:.72rem;color:var(--muted);flex-shrink:0;width:130px">${escH(f.label)}</label>`;
    if(f.type==='text'){
      return `<div style="display:flex;gap:6px;align-items:center">${labelHTML}<input id="libEd_${f.key}" style="${inputStyle}" value="${escH(String(val||''))}" placeholder="${escH(f.label)}"></div>`;
    }
    if(f.type==='number'){
      return `<div style="display:flex;gap:6px;align-items:center">${labelHTML}<input id="libEd_${f.key}" type="number" min="${f.min!=null?f.min:-999}" max="${f.max!=null?f.max:999}" style="width:70px;font-size:.78rem;padding:.25rem .4rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)" value="${val}"></div>`;
    }
    if(f.type==='select'){
      const opts=(f.options||[]).map(o=>`<option value="${escH(o)}"${val===o?' selected':''}>${escH(o)}</option>`).join('');
      return `<div style="display:flex;gap:6px;align-items:center">${labelHTML}<select id="libEd_${f.key}" style="font-size:.78rem;padding:.25rem .4rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)">${opts}</select></div>`;
    }
    if(f.type==='textarea'){
      return `<div style="display:flex;gap:6px;align-items:flex-start">${labelHTML}<textarea id="libEd_${f.key}" rows="${f.rows||4}" style="${inputStyle};resize:vertical">${escH(String(val||''))}</textarea></div>`;
    }
    if(f.type==='checkboxes'){
      const cov=val||{};
      const boxes=(f.options||[]).map(o=>`<label style="display:flex;align-items:center;gap:3px;font-size:.75rem;color:var(--text);cursor:pointer"><input type="checkbox" id="libEd_${f.key}_${o}"${cov[o]?' checked':''}> ${escH(o)}</label>`).join('');
      return `<div style="display:flex;gap:6px;align-items:center">${labelHTML}<div style="display:flex;gap:10px;flex-wrap:wrap">${boxes}</div></div>`;
    }
    return '';
  }).join('');
  return `<div style="border:1px solid var(--accent);border-radius:4px;padding:12px;background:var(--surface);display:flex;flex-direction:column;gap:8px">
    <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--accent)">${isEdit?'Edit supplement entry':'New supplement entry'}</div>
    ${fields}
    <div style="display:flex;gap:5px;margin-top:4px">
      <button class="primary" onclick="${saveCall}">Save</button>
      <button onclick="libEditorCancelForm()">Cancel</button>
    </div>
  </div>`;
}
function libEditorDeleteEntry(key,i){
  const arr=_suppGetArray(key);
  if(!confirm(`Delete "${arr[i]&&arr[i].name||'this entry'}"?`))return;
  arr.splice(i,1);
  _suppSaveArray(key,arr);
  _reloadDBFromSupplement();
  libEditorSelectKey(key);
}
function libEditorShowAddForm(){
  const addForm=document.getElementById('libEditorAddForm');if(!addForm||!_libEditorKey)return;
  addForm.innerHTML=_libEditorBuildForm(_libEditorKey,null,false,null);
  addForm.style.display='';
  addForm.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function libEditorEditEntry(key,i){
  const arr=_suppGetArray(key);
  const entry=arr[i];if(!entry)return;
  const addForm=document.getElementById('libEditorAddForm');if(!addForm)return;
  addForm.innerHTML=_libEditorBuildForm(key,entry,true,i);
  addForm.style.display='';
  addForm.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function libEditorOverrideBase(key,idx){
  const entry=_libBaseEntryCache[idx];
  if(!entry)return;
  const addForm=document.getElementById('libEditorAddForm');if(!addForm)return;
  addForm.innerHTML=_libEditorBuildForm(key,entry,false,null);
  addForm.style.display='';
  addForm.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function libEditorCancelForm(){
  const addForm=document.getElementById('libEditorAddForm');
  if(addForm){addForm.style.display='none';addForm.innerHTML='';}
}
function _libEditorReadForm(key){
  const schema=_libSchema(key);
  const nameEl=document.getElementById('libEd_name');
  const name=(nameEl&&nameEl.value||'').trim();
  if(!name){showStatus('Entry name is required.');return null;}
  const entry={};
  schema.forEach(f=>{
    const el=document.getElementById(`libEd_${f.key}`);
    if(f.type==='number'){entry[f.key]=el?parseFloat(el.value)||0:0;}
    else if(f.type==='checkboxes'){
      const cov={};
      (f.options||[]).forEach(o=>{const cb=document.getElementById(`libEd_${f.key}_${o}`);cov[o]=cb?cb.checked:false;});
      entry[f.key]=cov;
    }
    else{entry[f.key]=el?el.value:'';}
  });
  return entry;
}
function libEditorSaveNew(key){
  const entry=_libEditorReadForm(key);if(!entry)return;
  entry._added=Date.now();
  const arr=_suppGetArray(key);
  arr.push(entry);
  _suppSaveArray(key,arr);
  _reloadDBFromSupplement();
  libEditorCancelForm();
  libEditorSelectKey(key);
  showStatus('Entry added.');
}
function libEditorSaveEdit(key,i){
  const entry=_libEditorReadForm(key);if(!entry)return;
  const arr=_suppGetArray(key);
  arr[i]=entry;
  _suppSaveArray(key,arr);
  _reloadDBFromSupplement();
  libEditorCancelForm();
  libEditorSelectKey(key);
  showStatus('Entry updated.');
}
function libEditorResetSupplement(){
  if(!confirm('Delete all supplemental library entries? This cannot be undone. Export first if you want a backup.'))return;
  try{localStorage.removeItem(LS_SUPPLEMENT);}catch(e){}
  _reloadDBFromSupplement();
  libEditorSelectKey(_libEditorKey);
  showStatus('Supplemental library cleared.');
}
function exportSupplement(){
  const raw=_getSupplementRaw();
  const hasData=Object.values(raw).some(v=>Array.isArray(v)&&v.length);
  if(!hasData){showStatus('No supplemental entries to export.');return;}
  downloadJSON(raw,'supplement.json');
}
function importSupplement(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const incoming=JSON.parse(e.target.result);
      const keys=getDataKeys();
      if(!keys.some(k=>Array.isArray(incoming[k]))){
        showStatus('Not a valid supplement file.');
        _showImportResult('suppImportResult',false,'✕ Not a valid supplement file.');
        return;
      }
      const existing=_getSupplementRaw();
      let added=0,skipped=0;
      keys.forEach(k=>{
        if(!Array.isArray(incoming[k]))return;
        const cur=existing[k]||[];
        const curNames=new Set(cur.map(x=>x.name));
        incoming[k].forEach(entry=>{
          if(!curNames.has(entry.name)){cur.push(entry);curNames.add(entry.name);added++;}else skipped++;
        });
        existing[k]=cur;
      });
      _saveSupplementRaw(existing);
      _reloadDBFromSupplement();
      if(_libEditorKey)libEditorSelectKey(_libEditorKey);
      const msg=`✓ ${added} entr${added!==1?'ies':'y'} added${skipped?`, ${skipped} skipped (already present)`:'.'}`
      showStatus(`Supplement imported: ${added} added, ${skipped} skipped.`);
      _showImportResult('suppImportResult',true,msg);
    }catch{
      showStatus('Import failed — invalid JSON file.');
      _showImportResult('suppImportResult',false,'✕ Import failed — not a valid JSON file.');
    }
  };
  reader.readAsText(file);input.value='';
}
function showStatus(msg,duration){
  // Inline status bar — retained for backward compatibility and print context
  const el=document.getElementById('statusBar');
  if(el){el.textContent=msg;el.classList.add('show');clearTimeout(el._hideTimer);el._hideTimer=setTimeout(()=>el.classList.remove('show'),duration||2500);}
  // Fixed toast — always visible regardless of scroll position
  const toast=document.getElementById('toast');
  if(toast){
    toast.textContent=msg;
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer=setTimeout(()=>toast.classList.remove('show'),duration||2500);
  }
}

// showWarning — persistent fixed banner requiring manual dismiss.
// Use for conditions that need user attention and may not be noticed
// if auto-dismissed (e.g. data.json fallback, unrecoverable FSS errors).
function showWarning(msg){
  const banner=document.getElementById('warningBanner');
  const msgEl=document.getElementById('warningBannerMsg');
  if(!banner||!msgEl)return;
  msgEl.textContent=msg;
  banner.classList.add('show');
}
function dismissWarning(){
  const banner=document.getElementById('warningBanner');
  if(banner)banner.classList.remove('show');
}

// ── Save list resize handle ───────────────────────────────────────────────────
(function(){
  const MIN_H=120,DEFAULT_H=360;
  function getSaveList(){return document.querySelector('#saveListWrap .save-list');}
  function applyHeight(h){
    const sl=getSaveList();
    if(sl)sl.style.maxHeight=h+'px';
  }
  // Restore persisted height on load
  try{
    const stored=localStorage.getItem(LS_SAVE_LIST_H);
    if(stored){const h=parseInt(stored);if(h>=MIN_H)applyHeight(h);}
  }catch(e){}
  // Wire resize handle — desktop only
  const handle=document.getElementById('saveListResize');
  if(!handle)return;
  handle.addEventListener('mousedown',e=>{
    e.preventDefault();
    const sl=getSaveList();if(!sl)return;
    const startY=e.clientY;
    const startH=sl.offsetHeight||DEFAULT_H;
    handle.classList.add('dragging');
    const onMove=ev=>{
      const h=Math.max(MIN_H,startH+(ev.clientY-startY));
      sl.style.maxHeight=h+'px';
    };
    const onUp=ev=>{
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove',onMove);
      document.removeEventListener('mouseup',onUp);
      const h=Math.max(MIN_H,startH+(ev.clientY-startY));
      try{localStorage.setItem(LS_SAVE_LIST_H,h);}catch(err){}
    };
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onUp);
  });
  // Re-apply height after loadSaves rerenders the save-list div
  const _origLoadSaves=loadSaves;
  loadSaves=function(){
    _origLoadSaves.apply(this,arguments);
    try{
      const stored=localStorage.getItem(LS_SAVE_LIST_H);
      if(stored){const h=parseInt(stored);if(h>=MIN_H)applyHeight(h);}
    }catch(e){}
  };
})();

if(window.matchMedia('(pointer:coarse)').matches)document.body.classList.add('touch-device');

// ══════════════════════════════════════════════════════════════════════════════
// FILE SYSTEM SAVE (FSS) — v35
// Allows users to connect device folders for character and library storage.
// Uses the File System Access API (Chrome/Edge only) for folder handles.
// Handles are persisted in IndexedDB between sessions.
// All saves write to both FSS folder and localStorage (dual-write fallback).
// Users who connect no folders see zero behaviour change.
// ══════════════════════════════════════════════════════════════════════════════

// ── IndexedDB helpers ─────────────────────────────────────────────────────────
function _idbOpen(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(IDB_DB_NAME,1);
    req.onupgradeneeded=e=>{
      const db=e.target.result;
      if(!db.objectStoreNames.contains(IDB_STORE))db.createObjectStore(IDB_STORE);
    };
    req.onsuccess=e=>resolve(e.target.result);
    req.onerror=e=>reject(e.target.error);
  });
}
async function _idbGet(key){
  try{
    const db=await _idbOpen();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(IDB_STORE,'readonly');
      const req=tx.objectStore(IDB_STORE).get(key);
      req.onsuccess=e=>resolve(e.target.result||null);
      req.onerror=e=>reject(e.target.error);
    });
  }catch(e){return null;}
}
async function _idbSet(key,value){
  try{
    const db=await _idbOpen();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(IDB_STORE,'readwrite');
      const req=tx.objectStore(IDB_STORE).put(value,key);
      req.onsuccess=()=>resolve(true);
      req.onerror=e=>reject(e.target.error);
    });
  }catch(e){return false;}
}
async function _idbDelete(key){
  try{
    const db=await _idbOpen();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(IDB_STORE,'readwrite');
      const req=tx.objectStore(IDB_STORE).delete(key);
      req.onsuccess=()=>resolve(true);
      req.onerror=e=>reject(e.target.error);
    });
  }catch(e){return false;}
}

// ── FSS support detection ─────────────────────────────────────────────────────
function fssSupported(){return typeof window.showDirectoryPicker==='function';}

// ── Permission helper ─────────────────────────────────────────────────────────
// Returns true if handle has (or is granted) readwrite permission.
// Only call from a user gesture context — browser may show a prompt.
async function _fssVerifyPermission(handle){
  try{
    const perm=await handle.queryPermission({mode:'readwrite'});
    if(perm==='granted')return true;
    const req=await handle.requestPermission({mode:'readwrite'});
    return req==='granted';
  }catch(e){return false;}
}

// ── Restore handles at startup ────────────────────────────────────────────────
// Reads stored handles from IndexedDB. Checks permission state without prompting.
// Sets module-level variables for handles that are already granted.
// Handles in 'prompt' state are stored but not set — _fssMaybeReconnectPrompt()
// will nudge the user to click once to restore them.
async function _fssRestoreHandles(){
  if(!fssSupported())return;
  const keys=[
    [IDB_KEY_CHARS,'_fssCharsHandle'],
    [IDB_KEY_DATA,'_fssDataHandle'],
    [IDB_KEY_SUPP,'_fssSuppHandle'],
  ];
  for(const [idbKey,varName] of keys){
    try{
      const handle=await _idbGet(idbKey);
      if(!handle)continue;
      const perm=await handle.queryPermission({mode:'readwrite'});
      if(perm==='granted'){
        if(varName==='_fssCharsHandle')_fssCharsHandle=handle;
        else if(varName==='_fssDataHandle')_fssDataHandle=handle;
        else if(varName==='_fssSuppHandle')_fssSuppHandle=handle;
      }
      // 'prompt' state: handle exists but needs user gesture — handled by reconnect prompt
    }catch(e){/* handle unreadable — ignore */}
  }
}

// ── Reconnect prompt ──────────────────────────────────────────────────────────
// If any stored handles are in 'prompt' state, shows a status bar nudge.
// User clicks once; _fssReconnectAll() requests permission for each.
async function _fssMaybeReconnectPrompt(){
  if(!fssSupported())return;
  const keys=[IDB_KEY_CHARS,IDB_KEY_DATA,IDB_KEY_SUPP];
  const pending=[];
  for(const key of keys){
    try{
      const handle=await _idbGet(key);
      if(!handle)continue;
      const perm=await handle.queryPermission({mode:'readwrite'});
      if(perm==='prompt')pending.push({key,handle});
    }catch(e){}
  }
  if(!pending.length)return;
  // Show via the fixed toast so it's visible regardless of scroll position.
  // Override auto-dismiss — this stays until the user clicks.
  const toast=document.getElementById('toast');
  if(!toast)return;
  toast.textContent='Folder connection needs approval — click to reconnect.';
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast.style.cursor='pointer';
  toast._fssReconnect=true;
  toast.onclick=async()=>{
    if(!toast._fssReconnect)return;
    toast.onclick=null;toast._fssReconnect=false;toast.style.cursor='';
    toast.classList.remove('show');
    await _fssReconnectAll(pending);
    _fssUpdateUI();
    loadSaves();
  };
}
async function _fssReconnectAll(pending){
  for(const {key,handle} of pending){
    try{
      const granted=await _fssVerifyPermission(handle);
      if(granted){
        if(key===IDB_KEY_CHARS)_fssCharsHandle=handle;
        else if(key===IDB_KEY_DATA)_fssDataHandle=handle;
        else if(key===IDB_KEY_SUPP)_fssSuppHandle=handle;
      }
    }catch(e){}
  }
}

// ── Character file operations ─────────────────────────────────────────────────
// _fssSafeFilename — sanitises a character name for use as a filename,
// mirroring the logic used by exportSheet(). Falls back to the character id.
function _fssSafeFilename(state){
  const name=(state.name||'').replace(/[^a-z0-9_\-\s]/gi,'').trim();
  return(name||state.id)+'.json';
}

async function _fssWriteChar(state){
  if(!_fssCharsHandle)return false;
  try{
    const filename=_fssSafeFilename(state);
    // Delete any existing file for this id that has a different name (rename case).
    // Without this, renaming a character leaves an orphan file under the old name,
    // which causes duplicate entries in the save list.
    try{
      for await(const [name,handle] of _fssCharsHandle.entries()){
        if(!name.endsWith('.json')||name===filename)continue;
        try{
          const file=await handle.getFile();
          const parsed=JSON.parse(await file.text());
          if(parsed&&parsed.id===state.id){await _fssCharsHandle.removeEntry(name);break;}
        }catch(e){}
      }
    }catch(e){}
    const fileHandle=await _fssCharsHandle.getFileHandle(filename,{create:true});
    const writable=await fileHandle.createWritable();
    await writable.write(JSON.stringify(state,null,2));
    await writable.close();
    return true;
  }catch(e){return false;}
}
async function _fssReadChar(id){
  if(!_fssCharsHandle)return null;
  // Scan all JSON files to find the one with matching id.
  // Cannot derive filename from id since character names can change.
  try{
    for await(const [name,handle] of _fssCharsHandle.entries()){
      if(!name.endsWith('.json'))continue;
      try{
        const file=await handle.getFile();
        const text=await file.text();
        const parsed=JSON.parse(text);
        if(parsed&&parsed.id===id)return parsed;
      }catch(e){}
    }
  }catch(e){}
  return null;
}
async function _fssReadAllChars(){
  if(!_fssCharsHandle)return[];
  const entries=[];
  try{
    for await(const [name,handle] of _fssCharsHandle.entries()){
      if(!name.endsWith('.json'))continue;
      try{
        const file=await handle.getFile();
        const text=await file.text();
        const parsed=JSON.parse(text);
        if(parsed&&parsed.id){
          entries.push({
            id:parsed.id,
            name:parsed.name||'Unnamed',
            theme:parsed.theme||'neutral',
            tags:[],
            last_modified:parsed._last_modified||0,
            folder:null,
            _fromFSS:true,
          });
        }
      }catch(e){}
    }
  }catch(e){}
  return entries;
}
async function _fssDeleteChar(id){
  if(!_fssCharsHandle)return;
  // Find by scanning, then remove by filename
  try{
    for await(const [name,handle] of _fssCharsHandle.entries()){
      if(!name.endsWith('.json'))continue;
      try{
        const file=await handle.getFile();
        const text=await file.text();
        const parsed=JSON.parse(text);
        if(parsed&&parsed.id===id){
          await _fssCharsHandle.removeEntry(name);
          return;
        }
      }catch(e){}
    }
  }catch(e){}
}

// ── Data library file operations ──────────────────────────────────────────────
async function _fssReadDataJson(){
  if(!_fssDataHandle)return null;
  try{
    const fileHandle=await _fssDataHandle.getFileHandle('data.json');
    const file=await fileHandle.getFile();
    const text=await file.text();
    return JSON.parse(text);
  }catch(e){return null;}
}
async function _fssWriteSuppJson(obj){
  if(!_fssSuppHandle)return false;
  try{
    const fileHandle=await _fssSuppHandle.getFileHandle('supplemental.json',{create:true});
    const writable=await fileHandle.createWritable();
    await writable.write(JSON.stringify(obj,null,2));
    await writable.close();
    return true;
  }catch(e){return false;}
}
async function _fssReadSuppJson(){
  if(!_fssSuppHandle)return null;
  try{
    const fileHandle=await _fssSuppHandle.getFileHandle('supplemental.json');
    const file=await fileHandle.getFile();
    const text=await file.text();
    return JSON.parse(text);
  }catch(e){return null;}
}

// ── data.json structural validation ──────────────────────────────────────────
// Checks the minimum required structure before using an FSS data.json.
// Does not validate content arrays — only configuration keys.
function _fssValidateDataJson(d){
  if(!d||typeof d!=='object')return{ok:false,reason:'Not a valid JSON object.'};
  if(!Array.isArray(d.section_definitions)||!d.section_definitions.length)
    return{ok:false,reason:'Missing or empty section_definitions.'};
  if(!Array.isArray(d.skill_definitions)||!d.skill_definitions.length)
    return{ok:false,reason:'Missing or empty skill_definitions.'};
  if(!Array.isArray(d.sheet_presets))
    return{ok:false,reason:'Missing sheet_presets.'};
  return{ok:true};
}

// ── Migration ─────────────────────────────────────────────────────────────────
// Called when user first connects a folder. Writes existing localStorage data
// into the folder. Never removes localStorage data.
async function _fssMigrateCharsToFolder(){
  const idx=lsGetIndex();
  if(!idx.length)return;
  let migrated=0;
  for(const entry of idx){
    try{
      const raw=localStorage.getItem(LS_PREFIX+entry.id);
      if(!raw)continue;
      const state=JSON.parse(raw);
      const ok=await _fssWriteChar(state);
      if(ok)migrated++;
    }catch(e){}
  }
  if(migrated)showStatus(`${migrated} character${migrated===1?'':'s'} migrated to folder.`,3000);
}
async function _fssMigrateSupplementToFolder(){
  const raw=_getSupplementRaw();
  if(!Object.keys(raw).length)return;
  await _fssWriteSuppJson(raw);
}

// ── Connect / disconnect ──────────────────────────────────────────────────────
// ── One-time folder warning ───────────────────────────────────────────────────
// Shown the first time a user connects each folder type. Recommends using a
// dedicated subfolder. Resolves true (proceed) or false (cancelled).
// Once acknowledged, the LS flag is set and the warning never appears again.
function _fssShowFolderWarning(lsFlag,typeLabel){
  // Check if already acknowledged — skip modal entirely
  let alreadySeen=false;
  try{alreadySeen=!!localStorage.getItem(lsFlag);}catch(e){}
  if(alreadySeen)return Promise.resolve(true);

  return new Promise(resolve=>{
    const modal=document.createElement('div');
    modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center';
    modal.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1.5rem;max-width:400px;font-family:sans-serif;color:var(--text);box-shadow:0 4px 24px rgba(0,0,0,.3)">
      <div style="font-weight:700;margin-bottom:.75rem;font-size:1rem">📁 Connect ${typeLabel}</div>
      <div style="font-size:.85rem;line-height:1.6;color:var(--faint);margin-bottom:1.25rem">Mortals+ will be able to read and write files in the folder you choose.<br><br><strong style="color:var(--text)">Use a dedicated folder</strong> — do not point this at a general-purpose folder like Documents or a cloud storage root. Mortals+ may overwrite existing <code>.json</code> files whose names match your characters or library files.<br><br>A folder named <em>Mortals+</em> or similar, inside your preferred sync location, is recommended.</div>
      <div style="display:flex;gap:.5rem;justify-content:flex-end">
        <button id="_fssWarnCancel" style="min-width:80px">Cancel</button>
        <button id="_fssWarnProceed" class="primary" style="min-width:120px">Choose folder</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#_fssWarnProceed').onclick=()=>{
      modal.remove();
      try{localStorage.setItem(lsFlag,'1');}catch(e){}
      resolve(true);
    };
    modal.querySelector('#_fssWarnCancel').onclick=()=>{modal.remove();resolve(false);};
    modal.addEventListener('click',e=>{if(e.target===modal){modal.remove();resolve(false);}});
  });
}

async function fssConnectChars(){
  if(!fssSupported())return;
  if(!await _fssShowFolderWarning(LS_FSS_WARNED_CHARS,'characters folder'))return;
  try{
    const handle=await window.showDirectoryPicker({mode:'readwrite'});
    _fssCharsHandle=handle;
    await _idbSet(IDB_KEY_CHARS,handle);
    await _fssMigrateCharsToFolder();
    _fssUpdateUI();
    loadSaves();
  }catch(e){
    if(e.name!=='AbortError')showStatus('Could not connect characters folder.');
  }
}
async function fssConnectData(){
  if(!fssSupported())return;
  if(!await _fssShowFolderWarning(LS_FSS_WARNED_DATA,'data.json folder'))return;
  try{
    const handle=await window.showDirectoryPicker({mode:'readwrite'});
    _fssDataHandle=handle;
    await _idbSet(IDB_KEY_DATA,handle);
    _fssUpdateUI();
    showStatus('Data folder connected. Reload the page to apply the new library.',4000);
  }catch(e){
    if(e.name!=='AbortError')showStatus('Could not connect data folder.');
  }
}
async function fssConnectSupp(){
  if(!fssSupported())return;
  if(!await _fssShowFolderWarning(LS_FSS_WARNED_SUPP,'supplement folder'))return;
  try{
    const handle=await window.showDirectoryPicker({mode:'readwrite'});
    _fssSuppHandle=handle;
    await _idbSet(IDB_KEY_SUPP,handle);
    await _fssMigrateSupplementToFolder();
    _fssUpdateUI();
    showStatus('Supplement folder connected.',2500);
  }catch(e){
    if(e.name!=='AbortError')showStatus('Could not connect supplement folder.');
  }
}
async function fssDisconnectChars(){
  _fssCharsHandle=null;
  await _idbDelete(IDB_KEY_CHARS);
  _fssUpdateUI();
  loadSaves();
}
async function fssDisconnectData(){
  _fssDataHandle=null;
  await _idbDelete(IDB_KEY_DATA);
  _fssUpdateUI();
  showStatus('Data folder disconnected. Reload the page to revert to built-in library.',4000);
}
async function fssDisconnectSupp(){
  _fssSuppHandle=null;
  await _idbDelete(IDB_KEY_SUPP);
  _fssUpdateUI();
  showStatus('Supplement folder disconnected.',2500);
}

// ── UI update ─────────────────────────────────────────────────────────────────
// Renders the current connection state into all six button sets
// (3 connections × desktop sidebar + mobile drawer).
async function _fssUpdateUI(){
  const supported=fssSupported();
  const configs=[
    {
      idbKey:IDB_KEY_CHARS,
      handle:_fssCharsHandle,
      btnIds:['fssCharsBtn','fssCharsBtnDrawer'],
      hintIds:['fssCharsHint','fssCharsHintDrawer'],
      connectFn:'fssConnectChars()',
      disconnectFn:'fssDisconnectChars()',
      label:'Connect characters folder',
    },
    {
      idbKey:IDB_KEY_DATA,
      handle:_fssDataHandle,
      btnIds:['fssDataBtn','fssDataBtnDrawer'],
      hintIds:['fssDataHint','fssDataHintDrawer'],
      connectFn:'fssConnectData()',
      disconnectFn:'fssDisconnectData()',
      label:'Connect data.json folder',
    },
    {
      idbKey:IDB_KEY_SUPP,
      handle:_fssSuppHandle,
      btnIds:['fssSuppBtn','fssSuppBtnDrawer'],
      hintIds:['fssLibHint','fssLibHintDrawer'],
      connectFn:'fssConnectSupp()',
      disconnectFn:'fssDisconnectSupp()',
      label:'Connect supplement folder',
    },
  ];

  for(const cfg of configs){
    // Check for stored-but-not-yet-granted handles (prompt state)
    let pendingHandle=null;
    if(!cfg.handle){
      try{
        const stored=await _idbGet(cfg.idbKey);
        if(stored){
          const perm=await stored.queryPermission({mode:'readwrite'});
          if(perm==='prompt')pendingHandle=stored;
        }
      }catch(e){}
    }

    for(const btnId of cfg.btnIds){
      const btn=document.getElementById(btnId);
      if(!btn)continue;
      if(!supported){
        btn.disabled=false;
        btn.textContent='📁 '+cfg.label;
        btn.title='';
        btn.onclick=_fssUnsupportedPopup;
        btn.className=btn.className.replace(/\s*fss-btn-connected|\s*fss-btn-warn/g,'');
        btn.classList.add('fss-btn-unsupported');
        continue;
      }
      btn.disabled=false;
      btn.title='';
      if(cfg.handle){
        // Connected — show folder name and disconnect option
        btn.textContent='📁 '+cfg.handle.name+' ✕';
        btn.onclick=new Function(cfg.disconnectFn);
        btn.classList.add('fss-btn-connected');
        btn.classList.remove('fss-btn-warn');
      }else if(pendingHandle){
        // Stored but needs permission
        btn.textContent='⚠ Reconnect '+cfg.label.replace('Connect ','');
        btn.onclick=async()=>{
          const granted=await _fssVerifyPermission(pendingHandle);
          if(granted){
            if(cfg.idbKey===IDB_KEY_CHARS)_fssCharsHandle=pendingHandle;
            else if(cfg.idbKey===IDB_KEY_DATA)_fssDataHandle=pendingHandle;
            else if(cfg.idbKey===IDB_KEY_SUPP)_fssSuppHandle=pendingHandle;
            _fssUpdateUI();
            if(cfg.idbKey===IDB_KEY_CHARS)loadSaves();
          }else{
            showStatus('Permission denied — folder not reconnected.');
          }
        };
        btn.classList.add('fss-btn-warn');
        btn.classList.remove('fss-btn-connected');
      }else{
        // Not connected
        btn.textContent='📁 '+cfg.label;
        btn.onclick=new Function(cfg.connectFn);
        btn.classList.remove('fss-btn-connected','fss-btn-warn');
      }
    }

    // Update hints
    for(const hintId of cfg.hintIds){
      const hint=document.getElementById(hintId);
      if(!hint)continue;
      if(cfg.handle){
        if(cfg.idbKey===IDB_KEY_DATA){
          hint.textContent='Connected: '+cfg.handle.name+' (reload page to apply)';
        }else{
          hint.textContent='Connected: '+cfg.handle.name;
        }
        hint.classList.add('fss-hint-active');
      }else{
        hint.textContent='';
        hint.classList.remove('fss-hint-active');
      }
    }
  }
}
// ── FSS unsupported popup ─────────────────────────────────────────────────────
function _fssUnsupportedPopup(){
  const existing=document.getElementById('fssUnsupportedModal');
  if(existing){existing.remove();return;}
  const modal=document.createElement('div');
  modal.id='fssUnsupportedModal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1.5rem;max-width:360px;font-family:sans-serif;color:var(--text)">
    <div style="font-weight:700;margin-bottom:.75rem;font-size:1rem">Folder storage not available</div>
    <div style="font-size:.85rem;line-height:1.5;color:var(--faint);margin-bottom:1rem">The File System Storage feature requires a browser that supports the File System Access API. Currently supported browsers are <strong style="color:var(--text)">Chrome</strong> and <strong style="color:var(--text)">Edge</strong>.<br><br>Your characters and data are still saved safely in browser storage.</div>
    <button onclick="document.getElementById('fssUnsupportedModal').remove()" style="width:100%">OK</button>
  </div>`;
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
  document.body.appendChild(modal);
}

_fssRestoreHandles().then(()=>{
  loadDB().then(()=>{
    loadSaves();
    _fssUpdateUI();
    _fssMaybeReconnectPrompt();
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// STORYTELLER MODE — v29
// Desktop-only. Reads source characters from localStorage non-destructively.
// Spawns lightweight instances that own only mutable fields; all stat/section
// reference data is read live from the source template via source_id.
//
// Key localStorage entries:
//   mortals_plus_scene  — JSON array of instance objects for the active scene
//
// Instance object shape:
//   { id, source_id, display_name, health_track, willpower_spent,
//     resource_track, tilts, conditions, weapons, armor, equipment }
//
// Public API:
//   toggleStoryteller()      — toggle ST mode on/off
//   stNewScene()             — confirm and clear current scene
//   stAddToScene(id, count)  — spawn N instances from saved character id
//   stDeleteInstance(iid)    — remove instance from scene
//   stRenameInstance(iid, v) — set instance display_name
//   stRenderPanel()          — rebuild the full ST panel DOM
//   stRenderAddToScene()     — rebuild the Add to Scene sidebar
// ══════════════════════════════════════════════════════════════════════════════

let _stModeActive=false;

// ── Scene persistence ─────────────────────────────────────────────────────────
function _stGetScene(){
  try{const s=localStorage.getItem(LS_SCENE);return s?JSON.parse(s):[];}catch(e){return[];}
}
function _stSaveScene(scene){
  try{localStorage.setItem(LS_SCENE,JSON.stringify(scene));}catch(e){
    if(_isQuotaError(e))showStatus(LS_STORAGE_FULL_MSG,4000);
  }
}

// ── Non-destructive character read ───────────────────────────────────────────
// Reads a character from localStorage without touching global STATE.
function _stReadChar(id){
  try{
    const raw=localStorage.getItem(LS_PREFIX+id);
    if(!raw)return null;
    const c=JSON.parse(raw);
    // Run patchState logic on the loaded object without touching global STATE
    // We only need attributes, skills, section config — a light patch is enough
    if(!c.attributes)c.attributes={};
    if(!c.skills)c.skills={};
    if(!c.sectionConfig)c.sectionConfig={};
    return c;
  }catch(e){return null;}
}

let _stCols=1;
function stSetCols(n){
  _stCols=Math.max(1,Math.min(5,n));
  const val=document.getElementById('st-cols-val');
  if(val)val.textContent=_stCols;
  stRenderPanel();
  try{localStorage.setItem('mortals_plus_st_cols',_stCols);}catch(e){}
}
function _stLoadCols(){
  try{const v=localStorage.getItem('mortals_plus_st_cols');if(v)_stCols=Math.max(1,Math.min(5,parseInt(v)||1));}catch(e){}
}

// ── Mode toggle ───────────────────────────────────────────────────────────────
function toggleStoryteller(){
  _stModeActive=!_stModeActive;
  document.body.classList.toggle('st-mode',_stModeActive);
  const btn=document.getElementById('stModeToggleBtn');
  if(btn){btn.classList.toggle('active',_stModeActive);btn.textContent=_stModeActive?'✕ Exit Storyteller Mode':'⚔ Storyteller Mode';}
  // Toggle main toolbar visibility
  const toolbar=document.querySelector('.toolbar');
  if(toolbar)toolbar.style.display=_stModeActive?'none':'';
  // Toggle gen bar visibility
  const genBar=document.querySelector('.gen-bar');
  if(genBar)genBar.style.display=_stModeActive?'none':'';
  // Toggle editor/ST panel
  const editorWrap=document.getElementById('editorWrap');
  const emptyState=document.getElementById('emptyState');
  const stPanel=document.getElementById('stPanel');
  if(_stModeActive){
    if(editorWrap)editorWrap.style.display='none';
    if(emptyState)emptyState.style.display='none';
    if(stPanel)stPanel.style.display='block';
  } else {
    if(stPanel)stPanel.style.display='none';
    // Restore editor state
    if(currentSaveId||STATE.id){if(editorWrap)editorWrap.style.display='block';}
    else{if(emptyState)emptyState.style.display='';}
  }
  // Toggle sidebar panels
  const normal=document.getElementById('normalSidebarContent');
  const stSide=document.getElementById('stSidebarContent');
  if(normal)normal.style.display=_stModeActive?'none':'';
  if(stSide)stSide.style.display=_stModeActive?'block':'none';
  if(_stModeActive){_stLoadCols();stRenderPanel();stRenderAddToScene();stSetCols(_stCols);stRenderInitTracker();}
  else{_stInitResizeWired=false;}
}

// ── New scene ─────────────────────────────────────────────────────────────────
function stNewScene(){
  const scene=_stGetScene();
  if(scene.length&&!confirm('Clear the current scene and start a new one?'))return;
  _stSaveScene([]);
  stRenderPanel();stRenderAddToScene();stRenderInitTracker();
  showStatus('New scene started.');
}

// ── Spawn instances ───────────────────────────────────────────────────────────
function stAddToScene(sourceId,countVal){
  const count=Math.max(1,Math.min(20,parseInt(countVal)||1));
  const src=_stReadChar(sourceId);
  if(!src){showStatus('Character not found.');return;}
  const scene=_stGetScene();
  const existing=scene.filter(i=>i.source_id===sourceId).length;
  const baseName=src.name||'Unnamed';
  const cfg=src.sectionConfig||{};
  const isEntity=SECTION_DEFS.some(s=>s.type==='derived-traits-entity'&&cfg[s.key]!==false);
  // Health track size depends on sheet type
  let healthMax;
  if(isEntity){
    const res=(src.entity_attrs||{}).resistance||1;
    const sz=src.entity_size||5;
    healthMax=src.corpus_max_override!=null?src.corpus_max_override:(res+sz);
  } else {
    healthMax=getHealthMax(src);
  }
  for(let n=0;n<count;n++){
    const num=existing+n+1;
    const displayName=count===1&&existing===0?baseName:`${baseName} ${num}`;
    const inst={
      id:_uuid(),
      source_id:sourceId,
      display_name:displayName,
      col:0,
      notes:'',
      health_track:Array(healthMax).fill(''),
      willpower_spent:0,
      resource_tracks:_stGetSourceResourceTracks(src),
      clarity_track:_stGetCustomTrack(src,'clarity-track'),
      stability_track:_stGetCustomTrack(src,'stability-track'),
      tilts:[],
      conditions:[],
      weapons:JSON.parse(JSON.stringify(src.weapons||[])),
      armor:JSON.parse(JSON.stringify(src.armor||[])),
      equipment:JSON.parse(JSON.stringify(src.equipment||[])),
    };
    scene.push(inst);
  }
  _stSaveScene(scene);
  stRenderPanel();stRenderAddToScene();stRenderInitTracker();
  showStatus(`Added ${count} instance${count>1?'s':''} to scene.`);
}

function stSetInstNotes(iid,val){
  _stMutate(iid,inst=>{inst.notes=val;});
}

// Toggle whether an entire section (arcana-block, pillars-block, pool-list) is
// pinned as a block in the card header. Uses inst.pinned_sections {[sdKey]:bool}.
function stTogglePinSection(iid,sdKey){
  _stMutate(iid,inst=>{
    if(!inst.pinned_sections)inst.pinned_sections={};
    inst.pinned_sections[sdKey]=!inst.pinned_sections[sdKey];
  });
  const inst=_stGetScene().find(i=>i.id===iid);
  const src=inst?_stReadChar(inst.source_id):null;
  if(inst&&src)_stRenderCardBody(iid,inst,src);
  _stRefreshCardItems(iid);
}



// Returns an object keyed by state_key for every enabled resource-track section.
// Also handles entity Essence: the 'entity-traits' (derived-traits-entity) section
// stores essence differently — we read entity_essence_max/current from src and
// store it as a numeric value in resource_tracks under the key 'entity_essence'.
function _stGetSourceResourceTracks(src){
  const cfg=src.sectionConfig||{};
  const tracks={};
  SECTION_DEFS.forEach(sd=>{
    if(sd.type!=='resource-track')return;
    if(cfg[sd.key]===false)return;
    const sk=sd.state_key||sd.key;
    const srcMaxes=src.resource_track_maxes||{};
    const max=srcMaxes[sk]!=null?srcMaxes[sk]:(sd.max||20);
    tracks[sk]=Array.isArray(src[sk])?JSON.parse(JSON.stringify(src[sk])):Array(max).fill(false);
  });
  // Entity Essence: stored as a numeric value, not a boolean array
  const hasEntityTraits=SECTION_DEFS.some(s=>s.type==='derived-traits-entity'&&cfg[s.key]!==false);
  if(hasEntityTraits){
    tracks['entity_essence']=src.entity_essence_current||0;
  }
  return tracks;
}



// Returns a fresh empty track array for a custom track section (clarity/stability),
// sized to match the source character's max override or default 5.
function _stGetCustomTrack(src,type){
  const sd=SECTION_DEFS.find(s=>s.type===type);
  if(!sd)return[];
  const sk=sd.state_key||sd.key;
  const max=(src&&src[sk+'_max_override']!=null)?src[sk+'_max_override']:5;
  return Array(Math.max(1,max)).fill('');
}

// ── Instance mutations ────────────────────────────────────────────────────────
function stDeleteInstance(iid){
  const scene=_stGetScene().filter(i=>i.id!==iid);
  _stSaveScene(scene);stRenderPanel();stRenderInitTracker();
}
function stRenameInstance(iid,val){
  const scene=_stGetScene();
  const inst=scene.find(i=>i.id===iid);
  if(inst)inst.display_name=val||inst.display_name;
  _stSaveScene(scene);
}
function _stMutate(iid,fn){
  const scene=_stGetScene();
  const inst=scene.find(i=>i.id===iid);
  if(!inst)return;
  fn(inst);
  _stSaveScene(scene);
}

// ── Instance health/willpower/resource track handlers ─────────────────────────
function stCycleHealth(iid,idx){
  _stMutate(iid,inst=>{
    if(!inst.health_track)return;
    inst.health_track[idx]=DAMAGE_CYCLE[inst.health_track[idx]||'']||'';
  });
  _stRefreshCardTracks(iid);
  _stRefreshDerived(iid);
}
function stCycleClarityBox(iid,idx){
  _stMutate(iid,inst=>{
    if(!inst.clarity_track)inst.clarity_track=[];
    if(idx<inst.clarity_track.length)
      inst.clarity_track[idx]=CLARITY_CYCLE[inst.clarity_track[idx]||'']||'';
  });
  _stRefreshCardTracks(iid);
}
function stCycleStabilityBox(iid,idx){
  _stMutate(iid,inst=>{
    if(!inst.stability_track)inst.stability_track=[];
    if(idx<inst.stability_track.length)
      inst.stability_track[idx]=STABILITY_CYCLE[inst.stability_track[idx]||'']||'';
  });
  _stRefreshCardTracks(iid);
}
function stToggleWp(iid,idx){
  _stMutate(iid,inst=>{
    const src=_stReadChar(inst.source_id);if(!src)return;
    const max=getWpMax(src);
    const avail=max-(inst.willpower_spent||0);
    inst.willpower_spent=idx<avail?max-idx:max-(idx+1);
    inst.willpower_spent=Math.max(0,Math.min(max,inst.willpower_spent));
  });
  _stRefreshCardTracks(iid);
}
function stToggleResource(iid,sk,idx){
  _stMutate(iid,inst=>{
    // Support both new resource_tracks object and legacy resource_track array
    if(!inst.resource_tracks)inst.resource_tracks={};
    if(!Array.isArray(inst.resource_tracks[sk])){
      // Migrate legacy single track
      if(Array.isArray(inst.resource_track)&&!Object.keys(inst.resource_tracks).length){
        // Find the first resource track key from source
        const src=_stReadChar(inst.source_id);
        const cfg=src?src.sectionConfig||{}:{};
        const firstSd=SECTION_DEFS.find(s=>s.type==='resource-track'&&cfg[s.key]!==false);
        if(firstSd)inst.resource_tracks[firstSd.state_key||firstSd.key]=inst.resource_track;
      }
      const src=_stReadChar(inst.source_id);
      const sd=SECTION_DEFS.find(s=>(s.state_key||s.key)===sk&&s.type==='resource-track');
      const srcMaxes=(src&&src.resource_track_maxes)||{};
      const rtMax=srcMaxes[sk]!=null?srcMaxes[sk]:(sd&&sd.max||20);
      inst.resource_tracks[sk]=Array(rtMax).fill(false);
    }
    inst.resource_tracks[sk][idx]=!inst.resource_tracks[sk][idx];
  });
  // Refresh just this track's DOM
  const inst=_stGetScene().find(i=>i.id===iid);if(!inst)return;
  const domId=`st-res-${iid}-${sk}`;
  const el=document.getElementById(domId);
  if(el&&Array.isArray((inst.resource_tracks||{})[sk])){
    el.innerHTML=(inst.resource_tracks[sk]).map((on,i)=>
      `<span class="st-rsquare${on?' on':''}" onclick="stToggleResource('${iid}','${sk}',${i})"></span>`
    ).join('');
  }
}

// Set the current clip value on a ranged weapon instance
function stSetClip(iid,wIdx,delta){
  _stMutate(iid,inst=>{
    if(Array.isArray(inst.weapons)&&inst.weapons[wIdx]){
      const cur=inst.weapons[wIdx].clip!=null?inst.weapons[wIdx].clip:0;
      inst.weapons[wIdx].clip=Math.max(0,cur+delta);
    }
  });
  // Update the value span in-place
  const inst=_stGetScene().find(i=>i.id===iid);if(!inst)return;
  const el=document.getElementById(`st-clip-${iid}-${wIdx}`);
  if(el&&inst.weapons&&inst.weapons[wIdx])el.textContent=inst.weapons[wIdx].clip!=null?inst.weapons[wIdx].clip:0;
}


let _stDragId=null;

function stCardDragStart(e,iid){
  _stDragId=iid;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',iid);
  const card=document.getElementById(`st-card-${iid}`);
  if(card)card.classList.add('st-card-dragging');
}

function stCardDragEnd(e){
  _stDragId=null;
  document.querySelectorAll('.st-card').forEach(c=>c.classList.remove('st-card-dragging'));
  document.querySelectorAll('.st-instance-col').forEach(c=>c.classList.remove('st-col-drag-over'));
}

function stColDragEnter(e,colIdx){
  e.preventDefault();
  document.querySelectorAll('.st-instance-col').forEach(c=>c.classList.remove('st-col-drag-over'));
  const col=document.getElementById(`st-col-${colIdx}`);
  if(col)col.classList.add('st-col-drag-over');
}

function stColDragOver(e){
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
}

function stColDrop(e,colIdx){
  e.preventDefault();
  document.querySelectorAll('.st-instance-col').forEach(c=>c.classList.remove('st-col-drag-over'));
  if(!_stDragId)return;
  const scene=_stGetScene();
  const inst=scene.find(i=>i.id===_stDragId);
  if(!inst)return;
  inst.col=colIdx;
  _stDragId=null;
  _stSaveScene(scene);
  stRenderPanel();
}

// ── Essence adjust ─────────────────────────────────────────────────────────────
function stAdjEssence(iid,delta){
  _stMutate(iid,inst=>{
    const src=_stReadChar(inst.source_id);
    const max=(src&&src.entity_essence_max)||10;
    if(!inst.resource_tracks)inst.resource_tracks={};
    const cur=inst.resource_tracks.entity_essence!=null?inst.resource_tracks.entity_essence:(src&&src.entity_essence_current)||0;
    inst.resource_tracks.entity_essence=Math.max(0,Math.min(max,cur+delta));
  });
  const inst=_stGetScene().find(i=>i.id===iid);if(!inst)return;
  const el=document.getElementById(`st-ess-${iid}`);
  if(el){
    const valEl=el.querySelector('span[style*="font-weight"]');
    const cur=(inst.resource_tracks||{}).entity_essence;
    if(valEl)valEl.textContent=cur!=null?cur:0;
  }
}


// Re-render body track boxes when clicked from inside the card body.
function _stRefreshBodyTrack(iid,trackType){
  const scene=_stGetScene();
  const inst=scene.find(i=>i.id===iid);if(!inst)return;
  const el=document.getElementById(`st-body-${trackType}-${iid}`);if(!el)return;
  if(trackType==='clarity'){
    el.innerHTML=(inst.clarity_track||[]).map((s,i)=>
      `<div class="st-hbox" onclick="stCycleClarityBox('${iid}',${i});_stRefreshBodyTrack('${iid}','clarity')">${_clarityBoxSVG(s)}</div>`
    ).join('');
  } else if(trackType==='stability'){
    el.innerHTML=(inst.stability_track||[]).map((s,i)=>
      `<div class="st-hbox" onclick="stCycleStabilityBox('${iid}',${i});_stRefreshBodyTrack('${iid}','stability')">${_stabilityBoxSVG(s)}</div>`
    ).join('');
  }
}

function _stRefreshCardTracks(iid){
  const scene=_stGetScene();
  const inst=scene.find(i=>i.id===iid);if(!inst)return;
  const src=_stReadChar(inst.source_id);
  // Health/Corpus
  const hEl=document.getElementById(`st-health-${iid}`);
  if(hEl&&src){
    const cfg=src.sectionConfig||{};
    const isEntity=SECTION_DEFS.some(s=>s.type==='derived-traits-entity'&&cfg[s.key]!==false);
    let max;
    if(isEntity){const res=(src.entity_attrs||{}).resistance||1,sz=src.entity_size||5;max=src.corpus_max_override!=null?src.corpus_max_override:(res+sz);}
    else{max=getHealthMax(src);}
    hEl.innerHTML=Array.from({length:max},(_,i)=>{
      const s=(inst.health_track||[])[i]||'';
      return `<div class="st-hbox" onclick="stCycleHealth('${iid}',${i})">${healthSVG(s)}</div>`;
    }).join('');
  }
  // Willpower
  const wpEl=document.getElementById(`st-wp-${iid}`);
  if(wpEl&&src){
    const cfg=src.sectionConfig||{};
    const isEntity=SECTION_DEFS.some(s=>s.type==='derived-traits-entity'&&cfg[s.key]!==false);
    let max;
    if(isEntity){const res=(src.entity_attrs||{}).resistance||1,fin=(src.entity_attrs||{}).finesse||1;max=src.entity_wp_max_override!=null?src.entity_wp_max_override:(res+fin);}
    else{max=getWpMax(src);}
    const avail=max-(inst.willpower_spent||0);
    wpEl.innerHTML=Array.from({length:max},(_,i)=>
      `<span class="st-tsquare${i<avail?' on':''}" onclick="stToggleWp('${iid}',${i})"></span>`
    ).join('');
  }
  // All resource tracks (by key)
  const tracks=inst.resource_tracks||{};
  Object.entries(tracks).forEach(([sk,track])=>{
    if(!Array.isArray(track))return; // skip entity_essence (numeric)
    const el=document.getElementById(`st-res-${iid}-${sk}`);
    if(el)el.innerHTML=track.map((on,i)=>
      `<span class="st-rsquare${on?' on':''}" onclick="stToggleResource('${iid}','${sk}',${i})"></span>`
    ).join('');
  });
  // Clarity track
  const clEl=document.getElementById(`st-clarity-${iid}`);
  if(clEl&&src){
    const clSd=SECTION_DEFS.find(s=>s.type==='clarity-track');
    const cfg=src.sectionConfig||{};
    if(clSd&&cfg[clSd.key]!==false){
      const max=src[(clSd.state_key||clSd.key)+'_max_override']!=null?src[(clSd.state_key||clSd.key)+'_max_override']:5;
      const clTrack=inst.clarity_track||[];
      clEl.innerHTML=Array.from({length:max},(_,i)=>{
        const s=clTrack[i]||'';
        return `<div class="st-hbox" onclick="stCycleClarityBox('${iid}',${i})">${_clarityBoxSVG(s)}</div>`;
      }).join('');
    }
  }
  // Stability track
  const stbEl=document.getElementById(`st-stability-${iid}`);
  if(stbEl&&src){
    const stbSd=SECTION_DEFS.find(s=>s.type==='stability-track');
    const cfg=src.sectionConfig||{};
    if(stbSd&&cfg[stbSd.key]!==false){
      const max=src[(stbSd.state_key||stbSd.key)+'_max_override']!=null?src[(stbSd.state_key||stbSd.key)+'_max_override']:5;
      const stbTrack=inst.stability_track||[];
      stbEl.innerHTML=Array.from({length:max},(_,i)=>{
        const s=stbTrack[i]||'';
        return `<div class="st-hbox" onclick="stCycleStabilityBox('${iid}',${i})">${_stabilityBoxSVG(s)}</div>`;
      }).join('');
    }
  }
}

// Build a labelled items group with a top-border divider for the card header.
// label: string shown as small caps above the group (pass '' for unlabelled).
// content: HTML string of st-item-line rows.
function _stItemsGroup(label,content){
  const lbl=label?`<div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);font-family:sans-serif;margin-bottom:2px">${escH(label)}</div>`:'';
  return `<div class="st-items-group">${lbl}${content}</div>`;
}

// Refresh the items summary section in the card header (conditions/tilts/gear)
function _stRefreshCardItems(iid){
  const inst=_stGetScene().find(i=>i.id===iid);if(!inst)return;
  const card=document.getElementById(`st-card-${iid}`);if(!card)return;
  const nameWrap=card.querySelector('.st-card-name-wrap');if(!nameWrap)return;
  let itemsEl=nameWrap.querySelector('.st-card-items');
  const src=_stReadChar(inst.source_id);
  const pinnedLines=_stPinnedItemsHTML(iid,src,inst);
  const weaponLines=_stWeaponLinesHTML(iid,inst.weapons||[]);
  const{linesHTML:armorLinesHTML}=_stArmorParts(inst.armor||[],iid||inst.id);
  const equipLines=(inst.equipment||[]).filter(e=>e.equipped).map(e=>
    `<div class="st-item-line"><span class="st-item-line-name">${escH(e.name||'Item')}</span></div>`
  ).join('');
  const condLines=(inst.conditions||[]).map(c=>`<div class="st-item-line st-item-cond"><span class="st-item-line-name">${escH(c.name)}</span></div>`).join('');
  const tiltLines=(inst.tilts||[]).map(t=>`<div class="st-item-line st-item-tilt"><span class="st-item-line-name">${escH(t.name)}</span></div>`).join('');
  const notesLine=inst.notes&&inst.notes.trim()
    ?`<div class="st-inst-notes" style="font-style:italic">${escH(inst.notes)}</div>`:'';
  if(weaponLines||armorLinesHTML||equipLines||pinnedLines||condLines||tiltLines||notesLine){
    const html=`<div class="st-card-items">
      ${pinnedLines?_stItemsGroup('',pinnedLines):''}
      ${weaponLines?_stItemsGroup('Weapons',weaponLines):''}
      ${armorLinesHTML?_stItemsGroup('Armor',armorLinesHTML):''}
      ${equipLines?_stItemsGroup('Equipment',equipLines):''}
      ${condLines||tiltLines?_stItemsGroup('Conditions & Tilts',condLines+tiltLines):''}
      ${notesLine?_stItemsGroup('Notes',notesLine):''}
    </div>`;
    if(itemsEl){itemsEl.outerHTML=html;}
    else{const derivedEl=nameWrap.querySelector('.st-card-derived');if(derivedEl)derivedEl.insertAdjacentHTML('afterend',html);}
  } else if(itemsEl){
    itemsEl.remove();
  }
}

// Weapon lines for the compact card header — equipped weapons only.
// Ranged weapons show a − N + spinner for clip instead of static text.
// ── Pinned items ──────────────────────────────────────────────────────────────
// inst.pinned_items = { [state_key]: [itemName, ...] }
// Pin state lives only on the instance — source character is never touched.

function stTogglePin(iid,sk,name){
  _stMutate(iid,inst=>{
    if(!inst.pinned_items)inst.pinned_items={};
    if(!Array.isArray(inst.pinned_items[sk]))inst.pinned_items[sk]=[];
    const arr=inst.pinned_items[sk];
    const idx=arr.indexOf(name);
    if(idx>=0)arr.splice(idx,1);else arr.push(name);
  });
  const inst=_stGetScene().find(i=>i.id===iid);
  const src=inst?_stReadChar(inst.source_id):null;
  if(inst&&src)_stRenderCardBody(iid,inst,src);
  _stRefreshCardItems(iid);
}

// Returns combined HTML for all pinned items and pinned sections, for the card header.
// TODO (future): The ST card pin system has grown case-by-case across pinned_items
// (rated-list/named-list per-item) and pinned_sections (arcana-block/pillars-block/
// pool-list whole-section). A rework into a single unified pin model (e.g. a flat
// ordered list of {type, key, name?} pins) would simplify both the toggle functions
// and this renderer, and make it easier to add new pinnable things without touching
// multiple code paths. Any rework must include a migration step to convert old
// pinned_items/pinned_sections fields to the new format.
function _stPinnedItemsHTML(iid,src,inst){
  if(!src||!inst)return'';
  const cfg=src.sectionConfig||{};
  let lines='';

  const pinnedSecs=inst.pinned_sections||{};

  SECTION_DEFS.forEach(sd=>{
    if(cfg[sd.key]===false)return;
    const t=sd.type;

    // ── Pinned arcana-block / renown-block sections (whole section as dot grid) ──
    if(t==='arcana-block'||t==='renown-block'){
      if(!pinnedSecs[sd.key])return;
      const vals=src[sd.state_key||sd.key]||{};
      const rows=(sd.fields||[]).filter(f=>(vals[f.key]||0)>0).map(f=>{
        const val=vals[f.key]||0;
        const dots=Array.from({length:5},(_,i)=>`<span class="st-ref-dot${val>=i+1?' filled':''}"></span>`).join('');
        return `<div class="st-ref-skill-row"><span class="st-ref-skill-name" style="font-size:.75rem">${escH(f.label)}</span><span class="st-ref-skill-dots">${dots}</span></div>`;
      }).join('');
      if(!rows)return;
      lines+=`<div class="st-item-line" style="flex-direction:column;align-items:flex-start;width:100%">
        <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-family:sans-serif;margin-bottom:1px">${escH(sd.label)}</div>
        ${rows}
      </div>`;
      return;
    }

    // ── Pinned pillars-block sections (whole section as dot grid) ──────────
    if(t==='pillars-block'){
      if(!pinnedSecs[sd.key])return;
      const vals=src[sd.state_key||sd.key]||{};
      const rows=(sd.fields||[]).map(f=>{
        const entry=vals[f.key]||{};
        const dots=entry.dots||0;
        const dotHtml=Array.from({length:5},(_,i)=>`<span class="st-ref-dot${dots>=i+1?' filled':''}"></span>`).join('');
        const note=entry.note?`<span style="font-size:.65rem;color:var(--faint);margin-left:4px;font-style:italic">${escH(entry.note)}</span>`:'';
        return `<div class="st-ref-skill-row"><span class="st-ref-skill-name" style="font-size:.75rem">${escH(f.label)}${note}</span><span class="st-ref-skill-dots">${dotHtml}</span></div>`;
      }).join('');
      if(!rows)return;
      lines+=`<div class="st-item-line" style="flex-direction:column;align-items:flex-start;width:100%">
        <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-family:sans-serif;margin-bottom:1px">${escH(sd.label)}</div>
        ${rows}
      </div>`;
      return;
    }

    // ── Pinned pool-list sections (whole section as name/value rows) ────────
    if(t==='pool-list'){
      if(!pinnedSecs[sd.key])return;
      const sk=sd.state_key||sd.key;
      const items=src[sk]||[];
      if(!items.length)return;
      const rows=items.map(item=>
        `<div class="st-item-line"><span class="st-item-line-name">${escH(item.name)}</span><span style="font-size:.82rem;font-weight:700;font-family:sans-serif;color:var(--text);flex-shrink:0">${item.value||0}</span></div>`
      ).join('');
      lines+=`<div class="st-item-line" style="flex-direction:column;align-items:flex-start;width:100%">
        <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-family:sans-serif;margin-bottom:1px">${escH(sd.label)}</div>
        ${rows}
      </div>`;
      return;
    }

    // ── Pinned individual rated-list / named-list items — grouped by section ─
    if(t!=='rated-list'&&t!=='named-list')return;
    if(!inst.pinned_items)return;
    const sk=sd.special_renderer==='merits'?'merits':(sd.state_key||sd.key);
    const pinned=(inst.pinned_items||{})[sk];
    if(!Array.isArray(pinned)||!pinned.length)return;
    const items=src[sk]||[];
    let secRows='';
    pinned.forEach((name,pi)=>{
      const item=items.find(x=>x.name===name);
      if(!item)return;
      const dots=item.rating?Array.from({length:item.rating},()=>'●').join(''):'';
      const ratingPart=dots?`<span style="color:var(--muted);font-size:.68rem;margin-left:3px">${dots}</span>`:'';
      const hasDesc=!!(item.desc&&item.desc.trim());
      if(hasDesc){
        const descId=`st-pin-desc-${iid}-${sk}-${pi}`;
        const toggleBtn=`<span class="st-ref-expand-btn" onclick="event.stopPropagation();_stToggleDesc('${descId}',this)" style="font-size:.6rem;color:var(--faint);cursor:pointer;flex-shrink:0;margin-left:4px;user-select:none">▶</span>`;
        secRows+=`<div class="st-item-line" style="flex-direction:column;align-items:flex-start">
          <div style="display:flex;align-items:baseline;justify-content:space-between;width:100%">
            <span class="st-item-line-name">${escH(item.name)}</span>
            <span style="display:flex;align-items:center">${ratingPart}${toggleBtn}</span>
          </div>
          <div id="${descId}" style="display:none;font-family:sans-serif;font-size:.72rem;color:var(--muted);line-height:1.45;margin-top:1px;padding-left:2px">${mdH(item.desc)}</div>
        </div>`;
      } else {
        secRows+=`<div class="st-item-line" style="flex-direction:column;align-items:flex-start"><div style="display:flex;align-items:baseline;justify-content:space-between;width:100%"><span class="st-item-line-name">${escH(item.name)}</span>${ratingPart}</div></div>`;
      }
    });
    if(!secRows)return;
    // Wrap the section's pinned items under its label
    lines+=`<div class="st-item-line" style="flex-direction:column;align-items:flex-start;width:100%">
      <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-family:sans-serif;margin-bottom:1px">${escH(sd.label)}</div>
      ${secRows}
    </div>`;
  });
  return lines;
}

function _stWeaponLinesHTML(iid,weapons){
  return (weapons||[]).filter(w=>w.equipped).map((w,wIdx)=>{
    const isRanged=(w.weapon_type||'melee')==='ranged';
    const origIdx=(weapons||[]).indexOf(w);
    let stats;
    if(isRanged){
      const clipVal=w.clip!=null?w.clip:0;
      const spinner=`Clip <span class="st-clip-spin" onclick="event.stopPropagation()"><button class="spin" style="width:14px;height:14px;font-size:10px;padding:0" onclick="stSetClip('${iid}',${origIdx},-1)">−</button><span class="st-clip-val" id="st-clip-${iid}-${origIdx}">${clipVal}</span><button class="spin" style="width:14px;height:14px;font-size:10px;padding:0" onclick="stSetClip('${iid}',${origIdx},1)">+</button></span>`;
      stats=`Dmg +${w.damage||0} | Rng ${w.ranges||'—'} | ${spinner} | Init ${w.initiative_mod>=0?'+':''}${w.initiative_mod||0}`;
    } else {
      stats=`Dmg +${w.damage||0} | Init ${w.initiative_mod>=0?'+':''}${w.initiative_mod||0} | Str ${w.strength_req||0}`;
    }
    const hasDesc=!!(w.notes&&w.notes.trim());
    if(hasDesc){
      const descId=`st-wdesc-${iid}-${origIdx}`;
      const toggleBtn=`<span class="st-ref-expand-btn" onclick="event.stopPropagation();_stToggleDesc('${descId}',this)" style="font-size:.6rem;color:var(--faint);cursor:pointer;flex-shrink:0;margin-left:4px;user-select:none">▶</span>`;
      return `<div class="st-item-line" style="flex-direction:column;align-items:flex-start">
        <div style="display:flex;align-items:baseline;justify-content:space-between;width:100%">
          <span class="st-item-line-name">${escH(w.name||'Weapon')}</span>
          <span class="st-item-line-stats" style="display:flex;align-items:center;gap:3px">${stats}${toggleBtn}</span>
        </div>
        <div id="${descId}" style="display:none;font-family:sans-serif;font-size:.72rem;color:var(--muted);line-height:1.45;margin-top:1px;padding-left:2px">${mdH(w.notes)}</div>
      </div>`;
    }
    return `<div class="st-item-line"><span class="st-item-line-name">${escH(w.name||'Weapon')}</span><span class="st-item-line-stats">${stats}</span></div>`;
  }).join('');
}


// Returns {linesHTML, coverageRowHTML} for the armor array.
function _stArmorParts(armorArr,iid){
  if(!armorArr||!armorArr.length)return{linesHTML:'',coverageRowHTML:''};
  const equippedArmor=armorArr.filter(a=>a.equipped);
  const linesHTML=equippedArmor.map((a,ai)=>{
    const stats=`${a.armor_general||0}/${a.armor_ballistic||0} | Def ${a.defense_penalty>=0?'+':''}${a.defense_penalty||0}`;
    const hasDesc=!!(a.notes&&a.notes.trim());
    if(hasDesc&&iid){
      const origIdx=armorArr.indexOf(a);
      const descId=`st-adesc-${iid}-${origIdx}`;
      const toggleBtn=`<span class="st-ref-expand-btn" onclick="event.stopPropagation();_stToggleDesc('${descId}',this)" style="font-size:.6rem;color:var(--faint);cursor:pointer;flex-shrink:0;margin-left:4px;user-select:none">▶</span>`;
      return `<div class="st-item-line" style="flex-direction:column;align-items:flex-start">
        <div style="display:flex;align-items:baseline;justify-content:space-between;width:100%">
          <span class="st-item-line-name">${escH(a.name||'Armor')}</span>
          <span class="st-item-line-stats" style="display:flex;align-items:center;gap:3px">${stats}${toggleBtn}</span>
        </div>
        <div id="${descId}" style="display:none;font-family:sans-serif;font-size:.72rem;color:var(--muted);line-height:1.45;margin-top:1px;padding-left:2px">${mdH(a.notes)}</div>
      </div>`;
    }
    return `<div class="st-item-line"><span class="st-item-line-name">${escH(a.name||'Armor')}</span><span class="st-item-line-stats">${stats}</span></div>`;
  }).join('');
  // Aggregate coverage across equipped pieces
  const coverage={head:{g:0,b:0},torso:{g:0,b:0},arms:{g:0,b:0},legs:{g:0,b:0}};
  let anyEquipped=false;
  armorArr.forEach(a=>{
    if(!a.equipped)return;
    anyEquipped=true;
    const cov=a.coverage||{};
    ['head','torso','arms','legs'].forEach(loc=>{
      if(cov[loc]){coverage[loc].g+=(a.armor_general||0);coverage[loc].b+=(a.armor_ballistic||0);}
    });
  });
  let coverageRowHTML='';
  if(anyEquipped){
    const cells=['head','torso','arms','legs'].map(loc=>{
      const c=coverage[loc];
      const label=loc[0].toUpperCase()+loc.slice(1);
      const active=c.g>0||c.b>0;
      return `<span class="st-armor-loc${active?' st-armor-loc-active':''}"><span class="st-armor-loc-lbl">${label}</span> <b>${c.g}/${c.b}</b></span>`;
    }).join('');
    coverageRowHTML=`<div class="st-armor-coverage">${cells}</div>`;
  }
  return{linesHTML,coverageRowHTML};
}


function stStartRename(iid){
  const nameEl=document.getElementById(`st-name-${iid}`);
  const inpEl=document.getElementById(`st-name-inp-${iid}`);
  if(!nameEl||!inpEl)return;
  nameEl.style.display='none';
  inpEl.style.display='block';
  inpEl.focus();inpEl.select();
}
function stCommitRename(iid,val){
  stRenameInstance(iid,val);
  const nameEl=document.getElementById(`st-name-${iid}`);
  const inpEl=document.getElementById(`st-name-inp-${iid}`);
  if(nameEl){nameEl.textContent=val||nameEl.textContent;nameEl.style.display='';}
  if(inpEl)inpEl.style.display='none';
}

// ── Instance gear mutations ───────────────────────────────────────────────────
function stToggleGearEquipped(iid,gearType,idx){
  _stMutate(iid,inst=>{
    if(Array.isArray(inst[gearType])&&inst[gearType][idx])
      inst[gearType][idx].equipped=!inst[gearType][idx].equipped;
  });
  const src=_stReadChar((_stGetScene().find(i=>i.id===iid)||{}).source_id);
  const inst=_stGetScene().find(i=>i.id===iid);
  if(inst)_stRenderCardBody(iid,inst,src);
  _stRefreshDerived(iid);
  _stRefreshCardItems(iid);
}
function stAddCondition(iid,name){
  name=(name||'').trim();if(!name)return;
  _stMutate(iid,inst=>{inst.conditions=inst.conditions||[];inst.conditions.push({name,desc:''});});
  const inst=_stGetScene().find(i=>i.id===iid);
  const src=_stReadChar((inst||{}).source_id);
  if(inst)_stRenderCardBody(iid,inst,src);
  _stRefreshCardItems(iid);
}
function stRemoveCondition(iid,idx){
  _stMutate(iid,inst=>{if(Array.isArray(inst.conditions))inst.conditions.splice(idx,1);});
  const inst=_stGetScene().find(i=>i.id===iid);
  const src=_stReadChar((inst||{}).source_id);
  if(inst)_stRenderCardBody(iid,inst,src);
  _stRefreshCardItems(iid);
}
function stAddTilt(iid,name){
  name=(name||'').trim();if(!name)return;
  _stMutate(iid,inst=>{inst.tilts=inst.tilts||[];inst.tilts.push({name,desc:''});});
  const inst=_stGetScene().find(i=>i.id===iid);
  const src=_stReadChar((inst||{}).source_id);
  if(inst)_stRenderCardBody(iid,inst,src);
  _stRefreshCardItems(iid);
}
function stRemoveTilt(iid,idx){
  _stMutate(iid,inst=>{if(Array.isArray(inst.tilts))inst.tilts.splice(idx,1);});
  const inst=_stGetScene().find(i=>i.id===iid);
  const src=_stReadChar((inst||{}).source_id);
  if(inst)_stRenderCardBody(iid,inst,src);
  _stRefreshCardItems(iid);
}

// ── Derived stats for an instance (entity-aware) ─────────────────────────────
function _stCalcInstanceDerived(inst,src,isEntity){
  if(!src)return{defense:0,initiative:0,speed:0};
  const merged={...src,weapons:inst.weapons||[],armor:inst.armor||[]};
  const gm=calcGearMods(merged);
  if(isEntity){
    // Use entity attr-based formulas, reading from src.entity_attrs
    const p=(src.entity_attrs||{}).power||1;
    const f=(src.entity_attrs||{}).finesse||1;
    const r=(src.entity_attrs||{}).resistance||1;
    const rank=src.entity_rank_num||1;
    const ov=src.entityDerivedOverrides||{};
    const baseDefense=rank===1?Math.max(p,f):Math.min(p,f);
    return{
      defense:baseDefense+(ov.entity_defense||0)+gm.defPenalty,
      initiative:f+r+(ov.entity_initiative||0)+gm.initMod,
      speed:p+f+5+(ov.entity_speed||0)+gm.speedPenalty,
    };
  }
  // Mortal derived
  const ov=src.derivedOverrides||{};
  return{
    defense:calcBaseDefense(src)+(ov.defense||0)+gm.defPenalty,
    initiative:calcBaseInitiative(src)+(ov.initiative||0)+gm.initMod,
    speed:calcBaseSpeed(src)+(ov.speed||0)+gm.speedPenalty,
  };
}
// Returns the wound penalty (0–3) for an instance's health track.
// Mirrors renderHealthTrack(): count filled boxes in the last 3 slots.
function _stWoundPenalty(inst,healthMax){
  const track=inst.health_track||[];
  const max=healthMax||track.length||1;
  let wp=0;
  for(let o=0;o<Math.min(3,max);o++){if(track[max-1-o]&&track[max-1-o]!=='')wp++;}
  return wp;
}

// Build the derived stats HTML string including wound penalty if non-zero
function _stDerivedHTML(d,woundPenalty){
  let html=`<span>Def <b>${d.defense}</b></span><span>Init <b>${d.initiative}</b></span><span>Spd <b>${d.speed}</b></span>`;
  if(woundPenalty>0)html+=`<span style="color:var(--danger);font-weight:700">−${woundPenalty} wound${woundPenalty>1?'s':''}</span>`;
  return html;
}

function _stRefreshDerived(iid){
  const inst=_stGetScene().find(i=>i.id===iid);if(!inst)return;
  const src=_stReadChar(inst.source_id);if(!src)return;
  const cfg=src.sectionConfig||{};
  const isEntity=SECTION_DEFS.some(s=>s.type==='derived-traits-entity'&&cfg[s.key]!==false);
  const d=_stCalcInstanceDerived(inst,src,isEntity);
  let healthMax;
  if(isEntity){const res=(src.entity_attrs||{}).resistance||1,sz=src.entity_size||5;healthMax=src.corpus_max_override!=null?src.corpus_max_override:(res+sz);}
  else{healthMax=getHealthMax(src);}
  const wp=_stWoundPenalty(inst,healthMax);
  const{coverageRowHTML}=_stArmorParts(inst.armor||[],iid||inst.id);
  const el=document.getElementById(`st-derived-${iid}`);
  if(el)el.innerHTML=_stDerivedHTML(d,wp)+coverageRowHTML;
}

// Toggle a collapsible section within a card body
function _stToggleBodySection(el){
  const section=el.closest('.st-body-section');
  if(section)section.classList.toggle('collapsed');
}

// Toggle expandable description row in card body
function _stToggleDesc(descId,btn){
  const el=document.getElementById(descId);if(!el)return;
  const open=el.style.display!=='none';
  el.style.display=open?'none':'block';
  btn.textContent=open?'▶':'▼';
  btn.style.color=open?'var(--faint)':'var(--accent)';
}

// ── Card toggle ───────────────────────────────────────────────────────────────
function stToggleCard(iid){
  const card=document.getElementById(`st-card-${iid}`);
  if(!card)return;
  card.classList.toggle('open');
  if(card.classList.contains('open')){
    // Render the expanded body if not yet rendered
    const inst=_stGetScene().find(i=>i.id===iid);
    const src=inst?_stReadChar(inst.source_id):null;
    if(inst)_stRenderCardBody(iid,inst,src);
  }
}

// ── Render expanded card body ─────────────────────────────────────────────────
// Helper: wraps content in a collapsible st-body-section
function _stBodySection(label,contentHtml){
  return `<div class="st-body-section">
    <div class="st-body-hd" onclick="_stToggleBodySection(this)">
      <span>${escH(label)}</span><span class="st-body-chevron">▼</span>
    </div>
    <div class="st-body-content">${contentHtml}</div>
  </div>`;
}

function _stRenderCardBody(iid,inst,src){
  const bodyEl=document.getElementById(`st-body-${iid}`);if(!bodyEl)return;
  let html='';

  // ── Instance Notes (always first, always visible) ─────────────────────────
  html+=`<div class="st-body-section">
    <div class="st-body-hd" onclick="_stToggleBodySection(this)">
      <span>Instance Notes</span><span class="st-body-chevron">▼</span>
    </div>
    <div class="st-body-content">
      <textarea class="st-notes-area" placeholder="Notes for this instance…"
        onclick="event.stopPropagation()"
        oninput="stSetInstNotes('${iid}',this.value);_stRefreshCardItems('${iid}')"
      >${escH(inst.notes||'')}</textarea>
    </div>
  </div>`;

  if(src){
    const cfg=src.sectionConfig||{};
    const hasAttrs9=SECTION_DEFS.some(s=>s.type==='attributes-9'&&cfg[s.key]!==false);
    const hasAttrs3=SECTION_DEFS.some(s=>s.type==='attributes-3'&&cfg[s.key]!==false);

    // ── Clarity track (Changeling) ─────────────────────────────────────────
    const clSd=SECTION_DEFS.find(s=>s.type==='clarity-track');
    if(clSd&&cfg[clSd.key]!==false){
      const clSk=clSd.state_key||clSd.key;
      const clMax=src[clSk+'_max_override']!=null?src[clSk+'_max_override']:5;
      if(!Array.isArray(inst.clarity_track)||inst.clarity_track.length!==clMax)
        inst.clarity_track=Array(Math.max(1,clMax)).fill('');
      const boxes=Array.from({length:clMax},(_,i)=>{
        const s=(inst.clarity_track||[])[i]||'';
        return `<div class="st-hbox" onclick="stCycleClarityBox('${iid}',${i});_stRefreshBodyTrack('${iid}','clarity')">${_clarityBoxSVG(s)}</div>`;
      }).join('');
      html+=`<div class="st-body-section">
        <div class="st-body-hd" onclick="_stToggleBodySection(this)">
          <span>Clarity</span><span class="st-body-chevron">▼</span>
        </div>
        <div class="st-body-content">
          <div id="st-body-clarity-${iid}" style="display:flex;flex-wrap:wrap;gap:3px;padding:4px 0">${boxes}</div>
        </div>
      </div>`;
    }

    // ── Stability track (Deviant) ──────────────────────────────────────────
    const stbSd=SECTION_DEFS.find(s=>s.type==='stability-track');
    if(stbSd&&cfg[stbSd.key]!==false){
      const stbSk=stbSd.state_key||stbSd.key;
      const stbMax=src[stbSk+'_max_override']!=null?src[stbSk+'_max_override']:5;
      if(!Array.isArray(inst.stability_track)||inst.stability_track.length!==stbMax)
        inst.stability_track=Array(Math.max(1,stbMax)).fill('');
      const boxes=Array.from({length:stbMax},(_,i)=>{
        const s=(inst.stability_track||[])[i]||'';
        return `<div class="st-hbox" onclick="stCycleStabilityBox('${iid}',${i});_stRefreshBodyTrack('${iid}','stability')">${_stabilityBoxSVG(s)}</div>`;
      }).join('');
      html+=`<div class="st-body-section">
        <div class="st-body-hd" onclick="_stToggleBodySection(this)">
          <span>Stability</span><span class="st-body-chevron">▼</span>
        </div>
        <div class="st-body-content">
          <div id="st-body-stability-${iid}" style="display:flex;flex-wrap:wrap;gap:3px;padding:4px 0">${boxes}</div>
        </div>
      </div>`;
    }

    if(hasAttrs9){
      const maxD=src.attrMaxDots||5;
      const _dots=(val)=>{
        const displayMax=Math.max(maxD,val); // show all dots if value exceeds max
        return Array.from({length:displayMax},(_,i)=>
          `<span class="st-ref-dot${val>=i+1?' filled':''}"></span>`).join('');
      };
      // Layout: 3 rows × 3 cols matching the main sheet — no category labels
      const cats=Object.entries(ATTRIBUTES);
      let attrHtml='<div class="st-ref-attr-grid-full">';
      for(let row=0;row<3;row++){
        cats.forEach(([,attrs])=>{
          const a=attrs[row];
          const val=getAttr(a,src)||1;
          attrHtml+=`<div class="st-ref-attr-cell"><span class="st-ref-attr-name">${ATTR_LABELS[a]}</span><span class="st-ref-attr-dots">${_dots(val)}</span></div>`;
        });
      }
      attrHtml+='</div>';
      html+=_stBodySection('Attributes',attrHtml);
    }
    if(hasAttrs3&&src.entity_attrs){
      const maxD=src.attr3MaxDots||5;
      const _dots=(val)=>{
        const displayMax=Math.max(maxD,val);
        return Array.from({length:displayMax},(_,i)=>
          `<span class="st-ref-dot${val>=i+1?' filled':''}"></span>`).join('');
      };
      let attrHtml=`<div class="st-ref-attr-grid">`;
      ENTITY_ATTRS.forEach(a=>{
        const val=(src.entity_attrs||{})[a.key]||1;
        attrHtml+=`<div class="st-ref-attr-cell"><span class="st-ref-attr-name">${a.label}</span><span class="st-ref-attr-dots">${_dots(val)}</span></div>`;
      });
      attrHtml+='</div>';
      html+=_stBodySection('Attributes',attrHtml);
    }

    // ── Reference: Skills ──────────────────────────────────────────────────
    const hasSk=SECTION_DEFS.some(s=>s.type==='skills'&&cfg[s.key]!==false);
    if(hasSk){
      let skHtml='';
      Object.entries(SKILLS).forEach(([cat,skillList])=>{
        const nonZero=skillList.filter(sk=>getSkill(sk,src)>0);
        if(!nonZero.length)return;
        skHtml+=`<div style="font-size:.58rem;font-family:sans-serif;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:4px 0 2px">${cat}</div>`;
        nonZero.forEach(sk=>{
          const rating=getSkill(sk,src);
          const dotMax=Math.max(5,rating);
          const dots=Array.from({length:dotMax},(_,i)=>`<span class="st-ref-dot${rating>=i+1?' filled':''}"></span>`).join('');
          const label=(src.skills&&src.skills[sk]&&src.skills[sk].label)||SKILL_LABELS[sk];
          skHtml+=`<div class="st-ref-skill-row"><span class="st-ref-skill-name">${escH(label)}</span><span class="st-ref-skill-dots">${dots}</span></div>`;
        });
      });
      if(skHtml)html+=_stBodySection('Skills',skHtml);
    }

    // ── Reference: Splat abilities ────────────────────────────────────────
    SECTION_DEFS.forEach(sd=>{
      if(cfg[sd.key]===false)return;
      const t=sd.type;
      if(t==='arcana-block'){
        const sk=sd.state_key||sd.key;
        const vals=src[sk]||{};
        const rows=(sd.fields||[]).filter(f=>(vals[f.key]||0)>0).map(f=>{
          const val=vals[f.key]||0;
          const dots=Array.from({length:5},(_,i)=>`<span class="st-ref-dot${val>=i+1?' filled':''}"></span>`).join('');
          return `<div class="st-ref-arcana-row"><span class="st-ref-arcana-name">${escH(f.label)}</span><span class="st-ref-skill-dots">${dots}</span></div>`;
        }).join('');
        if(!rows)return;
        const isPinned=!!(inst.pinned_sections||{})[sd.key];
        const pinBtn=`<span class="st-pin-btn${isPinned?' st-pin-active':''}" title="${isPinned?'Remove from header':'Pin to header'}" onclick="event.stopPropagation();stTogglePinSection('${iid}','${escH(sd.key)}')">${isPinned?'★':'☆'}</span>`;
        html+=`<div class="st-body-section">
          <div class="st-body-hd" onclick="_stToggleBodySection(this)">
            <span>${escH(sd.label)}</span><span style="display:flex;align-items:center;gap:4px">${pinBtn}<span class="st-body-chevron">▼</span></span>
          </div>
          <div class="st-body-content">${rows}</div>
        </div>`;
      } else if(t==='renown-block'){
        const vals=src[sd.state_key||sd.key]||{};
        const rows=(sd.fields||[]).filter(f=>(vals[f.key]||0)>0).map(f=>{
          const val=vals[f.key]||0;
          const dots=Array.from({length:5},(_,i)=>`<span class="st-ref-dot${val>=i+1?' filled':''}"></span>`).join('');
          return `<div class="st-ref-arcana-row"><span class="st-ref-arcana-name">${escH(f.label)}</span><span class="st-ref-skill-dots">${dots}</span></div>`;
        }).join('');
        if(rows)html+=_stBodySection(sd.label,rows);
      } else if(t==='rated-list'||t==='named-list'){
        const sk=sd.special_renderer==='merits'?'merits':(sd.state_key||sd.key);
        const items=src[sk]||[];
        if(!items.length)return;
        const secId=`st-ref-sec-${iid}-${sd.key}`;
        const pinnedNames=(inst.pinned_items||{})[sk]||[];
        const rows=items.map((item,idx)=>{
          const dots=item.rating?Array.from({length:item.rating},()=>'●').join(''):'';
          const hasDesc=!!(item.desc&&item.desc.trim());
          const descId=`st-desc-${iid}-${sd.key}-${idx}`;
          const descHtml=hasDesc
            ?`<div id="${descId}" style="display:none;font-size:.72rem;color:var(--muted);line-height:1.45;padding:2px 0 3px 8px;font-family:sans-serif">${mdH(item.desc)}</div>`
            :'';
          const expandBtn=hasDesc
            ?`<span class="st-ref-expand-btn" onclick="event.stopPropagation();_stToggleDesc('${descId}',this)" title="Show description" style="font-size:.6rem;color:var(--faint);cursor:pointer;flex-shrink:0;margin-left:3px;user-select:none">▶</span>`
            :'';
          const isPinned=pinnedNames.includes(item.name||'');
          const pinBtn=`<span class="st-pin-btn${isPinned?' st-pin-active':''}" title="${isPinned?'Remove from header':'Pin to header'}" data-iid="${escH(iid)}" data-sk="${escH(sk)}" data-name="${escH(item.name||'')}" onclick="event.stopPropagation();stTogglePin(this.dataset.iid,this.dataset.sk,this.dataset.name)">${isPinned?'★':'☆'}</span>`;
          return `<div>
            <div class="st-ref-skill-row">
              <span class="st-ref-skill-name">${escH(item.name||'')}</span>
              <span style="display:flex;align-items:center;gap:2px"><span style="font-size:.68rem;color:var(--muted)">${dots}</span>${expandBtn}${pinBtn}</span>
            </div>
            ${descHtml}
          </div>`;
        }).join('');
        html+=_stBodySection(sd.label,`<div id="${secId}">${rows}</div>`);
      } else if(t==='pool-list'){
        const sk=sd.state_key||sd.key;
        const items=src[sk]||[];
        if(!items.length)return;
        const isPinned=!!(inst.pinned_sections||{})[sd.key];
        const pinBtn=`<span class="st-pin-btn${isPinned?' st-pin-active':''}" title="${isPinned?'Remove from header':'Pin to header'}" onclick="event.stopPropagation();stTogglePinSection('${iid}','${escH(sd.key)}')">${isPinned?'★':'☆'}</span>`;
        const rows=items.map(item=>
          `<div class="st-ref-skill-row"><span class="st-ref-skill-name">${escH(item.name||'')}</span><span style="font-size:.82rem;font-weight:700;font-family:sans-serif;color:var(--text)">${item.value||0}</span></div>`
        ).join('');
        html+=`<div class="st-body-section">
          <div class="st-body-hd" onclick="_stToggleBodySection(this)">
            <span>${escH(sd.label)}</span><span style="display:flex;align-items:center;gap:4px">${pinBtn}<span class="st-body-chevron">▼</span></span>
          </div>
          <div class="st-body-content">${rows}</div>
        </div>`;
      } else if(t==='pillars-block'){
        const vals=src[sd.state_key||sd.key]||{};
        const rows=(sd.fields||[]).map(f=>{
          const entry=vals[f.key]||{};
          const dots=entry.dots||0;
          const maxD=5;
          const dotHtml=Array.from({length:maxD},(_,i)=>`<span class="st-ref-dot${dots>=i+1?' filled':''}"></span>`).join('');
          const note=entry.note?`<span style="font-size:.68rem;color:var(--faint);margin-left:4px;font-style:italic">${escH(entry.note)}</span>`:'';
          return `<div class="st-ref-skill-row"><span class="st-ref-skill-name">${escH(f.label)}${note}</span><span class="st-ref-skill-dots">${dotHtml}</span></div>`;
        }).join('');
        if(!rows)return;
        const isPinned=!!(inst.pinned_sections||{})[sd.key];
        const pinBtn=`<span class="st-pin-btn${isPinned?' st-pin-active':''}" title="${isPinned?'Remove from header':'Pin to header'}" onclick="event.stopPropagation();stTogglePinSection('${iid}','${escH(sd.key)}')">${isPinned?'★':'☆'}</span>`;
        html+=`<div class="st-body-section">
          <div class="st-body-hd" onclick="_stToggleBodySection(this)">
            <span>${escH(sd.label)}</span><span style="display:flex;align-items:center;gap:4px">${pinBtn}<span class="st-body-chevron">▼</span></span>
          </div>
          <div class="st-body-content">${rows}</div>
        </div>`;
      }
    });
  }

  // ── Editable: Weapons ─────────────────────────────────────────────────────
  const weaponRows=(inst.weapons||[]).map((w,i)=>{
    const isRanged=(w.weapon_type||'melee')==='ranged';
    const stats=isRanged
      ?`Dmg +${w.damage||0} | Rng ${w.ranges||'—'} | Clip ${w.clip||0} | Init ${w.initiative_mod>=0?'+':''}${w.initiative_mod||0} | Str ${w.strength_req||0}`
      :`Dmg +${w.damage||0} | Init ${w.initiative_mod>=0?'+':''}${w.initiative_mod||0} | Str ${w.strength_req||0} | Sz ${w.size||0}`;
    return `<div class="st-inst-gear-item">
      <input type="checkbox" ${w.equipped?'checked':''} title="Equipped"
        style="width:13px;height:13px;cursor:pointer;accent-color:var(--accent)"
        onchange="stToggleGearEquipped('${iid}','weapons',${i})">
      <span class="st-inst-gear-name">${escH(w.name||'Weapon')}</span>
      <span class="st-inst-gear-stats">${stats}</span>
      <button class="sm danger" style="font-size:.65rem;padding:1px 5px" onclick="_stRemoveGear('${iid}','weapons',${i})">✕</button>
    </div>`;
  }).join('');
  const weaponSel=src?(DB.weapons||[]).map(w=>`<option value="${escH(w.name)}">${escH(w.name)}</option>`).join(''):'';
  html+=_stBodySection('Weapons',`
    ${weaponRows||'<span style="font-size:.75rem;color:var(--faint);font-family:sans-serif">None</span>'}
    <div class="st-inst-add-row">
      <select id="st-wadd-${iid}" style="flex:2"><option value="">— Add weapon —</option>${weaponSel}</select>
      <button class="sm" onclick="_stAddGear('${iid}','weapons')">Add</button>
    </div>`);

  // ── Editable: Armor ───────────────────────────────────────────────────────
  const armorRows=(inst.armor||[]).map((a,i)=>{
    const cov=a.coverage||{};
    const covStr=['head','torso','arms','legs'].filter(l=>cov[l]).map(l=>l[0].toUpperCase()+l.slice(1)).join(', ');
    return `<div class="st-inst-gear-item">
      <input type="checkbox" ${a.equipped?'checked':''} title="Equipped"
        style="width:13px;height:13px;cursor:pointer;accent-color:var(--accent)"
        onchange="stToggleGearEquipped('${iid}','armor',${i})">
      <span class="st-inst-gear-name">${escH(a.name||'Armor')}</span>
      <span class="st-inst-gear-stats">${a.armor_general||0}/${a.armor_ballistic||0} | Def ${a.defense_penalty>=0?'+':''}${a.defense_penalty||0}${covStr?' | '+covStr:''}</span>
      <button class="sm danger" style="font-size:.65rem;padding:1px 5px" onclick="_stRemoveGear('${iid}','armor',${i})">✕</button>
    </div>`;
  }).join('');
  // Aggregate coverage row for equipped armor
  const{coverageRowHTML:armorCovRow}=_stArmorParts(inst.armor||[],iid||inst.id);
  const armorSel=src?(DB.armor||[]).map(a=>`<option value="${escH(a.name)}">${escH(a.name)}</option>`).join(''):'';
  html+=_stBodySection('Armor',`
    ${armorRows||'<span style="font-size:.75rem;color:var(--faint);font-family:sans-serif">None</span>'}
    ${armorCovRow?`<div style="margin-top:4px">${armorCovRow}</div>`:''}
    <div class="st-inst-add-row">
      <select id="st-aadd-${iid}" style="flex:2"><option value="">— Add armor —</option>${armorSel}</select>
      <button class="sm" onclick="_stAddGear('${iid}','armor')">Add</button>
    </div>`);

  // ── Editable: Equipment ───────────────────────────────────────────────────
  const equipRows=(inst.equipment||[]).map((e,i)=>{
    const stats=`Bonus +${e.dice_bonus||0} | Dur ${e.durability||0} | Sz ${e.size||0} | Str ${e.structure||0}`;
    return `<div class="st-inst-gear-item">
      <input type="checkbox" ${e.equipped?'checked':''} title="Equipped"
        style="width:13px;height:13px;cursor:pointer;accent-color:var(--accent)"
        onchange="stToggleGearEquipped('${iid}','equipment',${i})">
      <span class="st-inst-gear-name">${escH(e.name||'Item')}</span>
      <span class="st-inst-gear-stats">${stats}</span>
      <button class="sm danger" style="font-size:.65rem;padding:1px 5px" onclick="_stRemoveGear('${iid}','equipment',${i})">✕</button>
    </div>`;
  }).join('');
  const equipSel=src?(DB.equipment||[]).map(e=>`<option value="${escH(e.name)}">${escH(e.name)}</option>`).join(''):'';
  html+=_stBodySection('Equipment',`
    ${equipRows||'<span style="font-size:.75rem;color:var(--faint);font-family:sans-serif">None</span>'}
    <div class="st-inst-add-row">
      <select id="st-eadd-${iid}" style="flex:2"><option value="">— Add equipment —</option>${equipSel}</select>
      <button class="sm" onclick="_stAddGear('${iid}','equipment')">Add</button>
    </div>`);

  // ── Editable: Conditions ──────────────────────────────────────────────────
  const condRows=(inst.conditions||[]).map((c,i)=>
    `<div class="st-inst-gear-item">
      <span class="st-inst-gear-name">${escH(c.name)}</span>
      <button class="sm danger" style="font-size:.65rem;padding:1px 5px" onclick="stRemoveCondition('${iid}',${i})">✕</button>
    </div>`).join('');
  const condOpts=(DB.conditions||[]).map(c=>`<option value="${escH(c.name)}">`).join('');
  html+=_stBodySection('Conditions',`
    ${condRows||'<span style="font-size:.75rem;color:var(--faint);font-family:sans-serif">None</span>'}
    <datalist id="st-cond-list-${iid}">${condOpts}</datalist>
    <div class="st-inst-add-row">
      <input id="st-cadd-${iid}" list="st-cond-list-${iid}" placeholder="Add condition…" style="flex:1"
        onkeydown="if(event.key==='Enter'){stAddCondition('${iid}',this.value);this.value='';}">
      <button class="sm" onclick="stAddCondition('${iid}',document.getElementById('st-cadd-${iid}').value);document.getElementById('st-cadd-${iid}').value=''">Add</button>
    </div>`);

  // ── Editable: Tilts ───────────────────────────────────────────────────────
  const tiltRows=(inst.tilts||[]).map((t,i)=>
    `<div class="st-inst-gear-item">
      <span class="st-inst-gear-name">${escH(t.name)}</span>
      <button class="sm danger" style="font-size:.65rem;padding:1px 5px" onclick="stRemoveTilt('${iid}',${i})">✕</button>
    </div>`).join('');
  const tiltOpts=(DB.tilts||[]).map(t=>`<option value="${escH(t.name)}">`).join('');
  html+=_stBodySection('Tilts',`
    ${tiltRows||'<span style="font-size:.75rem;color:var(--faint);font-family:sans-serif">None</span>'}
    <datalist id="st-tilt-list-${iid}">${tiltOpts}</datalist>
    <div class="st-inst-add-row">
      <input id="st-tadd-${iid}" list="st-tilt-list-${iid}" placeholder="Add tilt…" style="flex:1"
        onkeydown="if(event.key==='Enter'){stAddTilt('${iid}',this.value);this.value='';}">
      <button class="sm" onclick="stAddTilt('${iid}',document.getElementById('st-tadd-${iid}').value);document.getElementById('st-tadd-${iid}').value=''">Add</button>
    </div>`);

  bodyEl.innerHTML=html;
}

// Gear helpers
function _stAddGear(iid,gearType){
  const selId=`st-${gearType==='weapons'?'w':gearType==='armor'?'a':'e'}add-${iid}`;
  const sel=document.getElementById(selId);if(!sel||!sel.value)return;
  const dbKey=gearType==='weapons'?'weapons':gearType==='armor'?'armor':'equipment';
  const template=(DB[dbKey]||[]).find(x=>x.name===sel.value);
  if(!template)return;
  _stMutate(iid,inst=>{
    if(!Array.isArray(inst[gearType]))inst[gearType]=[];
    inst[gearType].push({...template,equipped:false});
  });
  sel.value='';
  const inst=_stGetScene().find(i=>i.id===iid);
  const src=inst?_stReadChar(inst.source_id):null;
  if(inst)_stRenderCardBody(iid,inst,src);
  _stRefreshDerived(iid);
  _stRefreshCardItems(iid);
}
function _stRemoveGear(iid,gearType,idx){
  _stMutate(iid,inst=>{if(Array.isArray(inst[gearType]))inst[gearType].splice(idx,1);});
  const inst=_stGetScene().find(i=>i.id===iid);
  const src=inst?_stReadChar(inst.source_id):null;
  if(inst)_stRenderCardBody(iid,inst,src);
  _stRefreshDerived(iid);
  _stRefreshCardItems(iid);
}

// ── Render full ST panel ──────────────────────────────────────────────────────
function stRenderPanel(){
  const scene=_stGetScene();
  const listEl=document.getElementById('stInstanceList');
  const emptyEl=document.getElementById('stEmptyState');
  if(!listEl)return;
  if(!scene.length){
    listEl.innerHTML='';
    if(emptyEl)emptyEl.style.display='';
    return;
  }
  if(emptyEl)emptyEl.style.display='none';
  const cardHTMLs=scene.map(inst=>{
    const src=_stReadChar(inst.source_id);
    const accent=_themeAccent((src&&src.theme)||'neutral');
    const cfg=src?src.sectionConfig||{}:{};

    // Entity detection (used for health/WP formulas and derived stats)
    const isEntity=!!(src&&SECTION_DEFS.some(s=>s.type==='derived-traits-entity'&&cfg[s.key]!==false));

    // ── Health / Corpus ────────────────────────────────────────────────────
    let healthMax;
    if(isEntity&&src){
      const res=(src.entity_attrs||{}).resistance||1,sz=src.entity_size||5;
      healthMax=src.corpus_max_override!=null?src.corpus_max_override:(res+sz);
    } else {
      healthMax=src?getHealthMax(src):1;
    }
    const healthTrack=inst.health_track||Array(healthMax).fill('');
    const healthBoxes=Array.from({length:healthMax},(_,i)=>{
      const s=healthTrack[i]||'';
      return `<div class="st-hbox" onclick="stCycleHealth('${inst.id}',${i})">${healthSVG(s)}</div>`;
    }).join('');

    // ── Derived stats (after healthMax so woundPenalty is accurate) ────────
    const derived=_stCalcInstanceDerived(inst,src,isEntity);
    const woundPenalty=_stWoundPenalty(inst,healthMax);
    const derivedHTML=_stDerivedHTML(derived,woundPenalty);

    // ── Willpower ──────────────────────────────────────────────────────────
    let wpMax;
    if(isEntity&&src){
      const res=(src.entity_attrs||{}).resistance||1,fin=(src.entity_attrs||{}).finesse||1;
      wpMax=src.entity_wp_max_override!=null?src.entity_wp_max_override:(res+fin);
    } else {
      wpMax=src?getWpMax(src):0;
    }
    const wpAvail=wpMax-(inst.willpower_spent||0);
    const wpSquares=Array.from({length:wpMax},(_,i)=>
      `<span class="st-tsquare${i<wpAvail?' on':''}" onclick="stToggleWp('${inst.id}',${i})"></span>`
    ).join('');

    // ── Clarity track (Changeling) ─────────────────────────────────────────
    let clarityHTML='';
    {
      const clSd=SECTION_DEFS.find(s=>s.type==='clarity-track');
      if(clSd&&src&&cfg[clSd.key]!==false){
        const clSk=clSd.state_key||clSd.key;
        const clMax=src[clSk+'_max_override']!=null?src[clSk+'_max_override']:5;
        if(!Array.isArray(inst.clarity_track)||inst.clarity_track.length!==clMax){
          inst.clarity_track=Array(Math.max(1,clMax)).fill('');
          const scene2=_stGetScene();const inst2=scene2.find(i=>i.id===inst.id);
          if(inst2){inst2.clarity_track=inst.clarity_track;_stSaveScene(scene2);}
        }
        const boxes=Array.from({length:clMax},(_,i)=>{
          const s=(inst.clarity_track||[])[i]||'';
          return `<div class="st-hbox" onclick="stCycleClarityBox('${inst.id}',${i})">${_clarityBoxSVG(s)}</div>`;
        }).join('');
        clarityHTML=`<div class="st-card-track-grp">
          <span class="st-card-track-lbl">Clarity</span>
          <span class="st-card-track-row" id="st-clarity-${inst.id}">${boxes}</span>
        </div>`;
      }
    }

    // ── Stability track (Deviant) ──────────────────────────────────────────
    let stabilityHTML='';
    {
      const stbSd=SECTION_DEFS.find(s=>s.type==='stability-track');
      if(stbSd&&src&&cfg[stbSd.key]!==false){
        const stbSk=stbSd.state_key||stbSd.key;
        const stbMax=src[stbSk+'_max_override']!=null?src[stbSk+'_max_override']:5;
        if(!Array.isArray(inst.stability_track)||inst.stability_track.length!==stbMax){
          inst.stability_track=Array(Math.max(1,stbMax)).fill('');
          const scene2=_stGetScene();const inst2=scene2.find(i=>i.id===inst.id);
          if(inst2){inst2.stability_track=inst.stability_track;_stSaveScene(scene2);}
        }
        const boxes=Array.from({length:stbMax},(_,i)=>{
          const s=(inst.stability_track||[])[i]||'';
          return `<div class="st-hbox" onclick="stCycleStabilityBox('${inst.id}',${i})">${_stabilityBoxSVG(s)}</div>`;
        }).join('');
        stabilityHTML=`<div class="st-card-track-grp">
          <span class="st-card-track-lbl">Stability</span>
          <span class="st-card-track-row" id="st-stability-${inst.id}">${boxes}</span>
        </div>`;
      }
    }

    // ── All enabled resource tracks (data-driven, all splats) ─────────────
    // Migrate legacy single resource_track to resource_tracks map on first render
    if(!inst.resource_tracks&&src){
      const newTracks=_stGetSourceResourceTracks(src);
      // If old resource_track exists, slot it into the first matching key
      if(Array.isArray(inst.resource_track)&&inst.resource_track.length){
        const firstSd=SECTION_DEFS.find(s=>s.type==='resource-track'&&cfg[s.key]!==false);
        if(firstSd)newTracks[firstSd.state_key||firstSd.key]=inst.resource_track;
      }
      inst.resource_tracks=newTracks;
      // Persist migration
      const scene2=_stGetScene();
      const inst2=scene2.find(i=>i.id===inst.id);
      if(inst2){inst2.resource_tracks=newTracks;_stSaveScene(scene2);}
    }
    // Build a track group for each enabled resource-track section
    const allResourceTrackGroups=src?SECTION_DEFS.filter(sd=>{
      if(sd.type!=='resource-track')return false;
      if(cfg[sd.key]===false)return false;
      return true;
    }).map(sd=>{
      const sk=sd.state_key||sd.key;
      const srcMaxes=src.resource_track_maxes||{};
      const rtMax=srcMaxes[sk]!=null?srcMaxes[sk]:(sd.max||20);
      const tracks=inst.resource_tracks||{};
      let track=Array.isArray(tracks[sk])?tracks[sk]:Array(rtMax).fill(false);
      const squares=track.slice(0,rtMax).map((on,i)=>
        `<span class="st-rsquare${on?' on':''}" onclick="stToggleResource('${inst.id}','${sk}',${i})"></span>`
      ).join('');
      return `<div class="st-card-track-grp">
        <span class="st-card-track-lbl">${escH(sd.label)}</span>
        <span class="st-card-track-row" id="st-res-${inst.id}-${sk}">${squares}</span>
      </div>`;
    }).join('') : '';

    // Essence (entity only) — stored as numeric value in resource_tracks.entity_essence
    let essenceHTML='';
    if(isEntity&&src){
      const essMax=src.entity_essence_max||10;
      const essCur=(inst.resource_tracks||{}).entity_essence!=null
        ?(inst.resource_tracks||{}).entity_essence
        :(src.entity_essence_current||0);
      // Initialise on instance if needed
      if((inst.resource_tracks||{}).entity_essence==null){
        const scene2=_stGetScene();
        const inst2=scene2.find(i=>i.id===inst.id);
        if(inst2){if(!inst2.resource_tracks)inst2.resource_tracks={};inst2.resource_tracks.entity_essence=essCur;_stSaveScene(scene2);}
      }
      essenceHTML=`<div class="st-card-track-grp">
        <span class="st-card-track-lbl">Essence</span>
        <span class="st-card-track-row" id="st-ess-${inst.id}" style="font-family:sans-serif;font-size:.78rem;align-items:center;gap:3px">
          <button class="spin" style="width:16px;height:16px;font-size:11px;flex-shrink:0" onclick="stAdjEssence('${inst.id}',-1)">−</button>
          <span style="font-weight:700;min-width:18px;text-align:center;font-size:.85rem">${essCur}</span>
          <span style="color:var(--faint);font-size:.72rem">/${essMax}</span>
          <button class="spin" style="width:16px;height:16px;font-size:11px;flex-shrink:0" onclick="stAdjEssence('${inst.id}',1)">+</button>
        </span>
      </div>`;
    }

    // ── Compact items (weapons/armor: equipped; equipment: equipped; pinned abilities) ──
    const pinnedLines=_stPinnedItemsHTML(inst.id,src,inst);
    const weaponLines=_stWeaponLinesHTML(inst.id,inst.weapons||[]);
    const{linesHTML:armorLinesHTML,coverageRowHTML}=_stArmorParts(inst.armor||[],inst.id);
    const equipLines=(inst.equipment||[]).filter(e=>e.equipped).map(e=>
      `<div class="st-item-line"><span class="st-item-line-name">${escH(e.name||'Item')}</span></div>`
    ).join('');
    const condLines=(inst.conditions||[]).map(c=>`<div class="st-item-line st-item-cond"><span class="st-item-line-name">${escH(c.name)}</span></div>`).join('');
    const tiltLines=(inst.tilts||[]).map(t=>`<div class="st-item-line st-item-tilt"><span class="st-item-line-name">${escH(t.name)}</span></div>`).join('');
    const notesLine=inst.notes&&inst.notes.trim()
      ?`<div class="st-inst-notes" style="font-style:italic">${escH(inst.notes)}</div>`:'';
    const itemsSection=(pinnedLines||weaponLines||armorLinesHTML||equipLines||condLines||tiltLines||notesLine)?
      `<div class="st-card-items">
        ${pinnedLines?_stItemsGroup('',pinnedLines):''}
        ${weaponLines?_stItemsGroup('Weapons',weaponLines):''}
        ${armorLinesHTML?_stItemsGroup('Armor',armorLinesHTML):''}
        ${equipLines?_stItemsGroup('Equipment',equipLines):''}
        ${condLines||tiltLines?_stItemsGroup('Conditions & Tilts',condLines+tiltLines):''}
        ${notesLine?_stItemsGroup('Notes',notesLine):''}
      </div>`:'';

    return `<div class="st-card" id="st-card-${inst.id}" draggable="true" ondragstart="stCardDragStart(event,'${inst.id}')" ondragend="stCardDragEnd(event)">
      <div class="st-card-hd">
        <div class="st-card-accent" style="background:${accent}"></div>
        <div class="st-card-name-wrap">
          <div class="st-card-name-row" style="display:flex;align-items:center;gap:5px">
            <span class="st-card-name" id="st-name-${inst.id}">${escH(inst.display_name)}</span>
            <input class="st-card-name-inp" id="st-name-inp-${inst.id}"
              value="${escH(inst.display_name)}"
              onclick="event.stopPropagation()"
              onkeydown="if(event.key==='Enter'){stCommitRename('${inst.id}',this.value);}"
              onblur="stCommitRename('${inst.id}',this.value)">
            <button class="sm" style="font-size:.6rem;padding:1px 5px;flex-shrink:0" title="Rename"
              onclick="event.stopPropagation();stStartRename('${inst.id}')">✎</button>
          </div>
          <div class="st-card-tracks" onclick="event.stopPropagation()">
            <div class="st-card-track-grp">
              <span class="st-card-track-lbl">${isEntity?'Corpus':'Health'}</span>
              <span class="st-card-track-row" id="st-health-${inst.id}">${healthBoxes}</span>
            </div>
            <div class="st-card-track-grp">
              <span class="st-card-track-lbl">Willpower</span>
              <span class="st-card-track-row" id="st-wp-${inst.id}">${wpSquares}</span>
            </div>
            ${clarityHTML}
            ${stabilityHTML}
            ${allResourceTrackGroups}
            ${essenceHTML}
          </div>
          <div class="st-card-derived" id="st-derived-${inst.id}">
            ${derivedHTML}
            ${coverageRowHTML}
          </div>
          ${itemsSection}
        </div>
        <div class="st-card-actions">
          <button class="sm danger" style="font-size:.65rem;padding:2px 6px" title="Remove instance"
            onclick="stDeleteInstance('${inst.id}')">✕</button>
          <span class="st-card-toggle" onclick="stToggleCard('${inst.id}')">&#9654;</span>
        </div>
      </div>
      <div class="st-card-body" id="st-body-${inst.id}"></div>
    </div>`;
  });

  // Group cards by their assigned column (default 0 for legacy instances)
  const cols=_stCols||1;
  const colGroups=Array.from({length:cols},()=>[]);
  cardHTMLs.forEach((html,i)=>{
    const inst=scene[i];
    const c=Math.min(cols-1,Math.max(0,inst.col||0));
    colGroups[c].push(html);
  });
  listEl.innerHTML=colGroups.map((cards,ci)=>
    `<div class="st-instance-col" id="st-col-${ci}"
       ondragenter="stColDragEnter(event,${ci})"
       ondragover="stColDragOver(event)"
       ondrop="stColDrop(event,${ci})">
      ${cards.join('')}
      ${!cards.length?`<div class="st-col-empty">Drop cards here</div>`:''}
    </div>`
  ).join(cols>1?'<div class="st-col-divider"></div>':'');
}

// _stRedistributeCols removed — columns are now assigned per-instance via inst.col field.

// _stGetResourceLabel removed in v29 patch — resource track labels now read
// directly from SECTION_DEFS in stRenderPanel and _stRefreshCardTracks.

// ── Render Add to Scene sidebar ───────────────────────────────────────────────
function stRenderAddToScene(){
  const panel=document.getElementById('stAddToScenePanel');if(!panel)return;
  const allIdx=lsGetIndex().map(_patchIndexEntry);
  const folders=lsGetFolders();
  if(!allIdx.length){
    panel.innerHTML='<span style="font-size:.8rem;color:var(--faint);font-family:sans-serif">No saved characters. Build and save a character first, then return to Storyteller Mode.</span>';
    return;
  }
  const filterBar=`<div style="margin-bottom:8px">
    <input placeholder="Filter…" style="width:100%;font-family:sans-serif;font-size:.75rem;padding:.25rem .4rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)"
      value="${escH(_saveListFilter)}" oninput="setSaveFilter(this.value);stRenderAddToScene()">
  </div>`;
  const f=_saveListFilter;
  const list=f?allIdx.filter(s=>(s.name||'').toLowerCase().includes(f)||(s.tags||[]).some(t=>t.toLowerCase().includes(f))):allIdx;
  const _stAddItem=s=>{
    const tagPills=(s.tags||[]).map(t=>`<span class="si-tag" style="pointer-events:none">${escH(t)}</span>`).join('');
    return `<div class="st-add-item">
      <div class="st-add-item-body">
        <div class="st-add-item-name">${escH(s.name||'Unnamed')}</div>
        ${tagPills?`<div class="st-add-item-tags">${tagPills}</div>`:''}
      </div>
      <input type="text" inputmode="numeric" pattern="[0-9]*" class="st-add-count" id="st-count-${s.id}" value="1" title="Count">
      <button class="sm primary st-add-btn" onclick="stAddToScene('${s.id}',document.getElementById('st-count-${s.id}').value)">Add</button>
    </div>`;
  };
  if(f){
    panel.innerHTML=filterBar+list.map(_stAddItem).join('');
    return;
  }
  // Folder grouping
  const folderSections=folders.map(folder=>{
    const chars=list.filter(s=>s.folder===folder.id);
    if(!chars.length)return'';
    const chevClass='si-folder-chevron'+(folder.collapsed?'':' open');
    const bodyClass='si-folder-body'+(folder.collapsed?' collapsed':'');
    return `<div class="si-folder">
      <div class="si-folder-hdr" onclick="toggleFolderCollapsed('${folder.id}')">
        <span class="${chevClass}">▶</span>
        <span class="si-folder-name">${escH(folder.name)}</span>
        <span class="si-folder-count">${chars.length}</span>
      </div>
      <div class="${bodyClass}">${chars.map(_stAddItem).join('')}</div>
    </div>`;
  }).join('');
  const ungrouped=list.filter(s=>!s.folder||!folders.find(fd=>fd.id===s.folder));
  panel.innerHTML=filterBar+folderSections+(ungrouped.length?`<div class="si-ungrouped">${ungrouped.map(_stAddItem).join('')}</div>`:'');
}
// ── End Storyteller Mode ──────────────────────────────────────────────────────


// Catches all input/change/click events bubbling up from #editorCol and
// debounces autoSave(). This covers all inline oninput/onchange/onclick
// handlers on the sheet without them needing to call autoSave() individually.
// Scoped to #editorCol so sidebar and toolbar interactions do not trigger it.
// File inputs are excluded to avoid firing on the import-file dialog.
// JS-driven mutations that bypass the DOM (e.g. dot clicks that call setState)
// should call autoSave() directly — setState() does this automatically.
document.addEventListener('DOMContentLoaded',()=>{
  const col=document.getElementById('editorCol');
  if(!col)return;
  const handler=e=>{
    if(e.target.type==='file')return;
    autoSave();
  };
  col.addEventListener('input',handler);
  col.addEventListener('change',handler);
  col.addEventListener('click',handler);
});

// ── Compact print renderers ───────────────────────────────────────────────────
// Called in beforeprint; restored in afterprint. Zero live sheet impact.
// Attributes and Skills are sheet-specific. Rated-list and named-list renderers
// are generic — they handle every section of that type automatically.

function renderAttrBlockCompact(){
  const el=document.getElementById('attrBlock');if(!el)return;
  const maxD=STATE.attrMaxDots||5;
  const cats=Object.entries(ATTRIBUTES);
  const ROW_LABELS=['Power','Finesse','Resistance'];
  const _dots=(val,max)=>Array.from({length:max},(_,i)=>
    `<span class="dot${val>=i+1?' filled':''}" style="width:9px;height:9px;border-width:1px"></span>`
  ).join('');
  let rows='';
  for(let row=0;row<3;row++){
    const cells=cats.map(([,attrs])=>{
      const a=attrs[row],val=getAttr(a)||1;
      return `<td class="print-attr-cell"><div class="print-attr-cell-inner">
        <span class="print-attr-name">${ATTR_LABELS[a]}</span>
        <span class="print-attr-dots">${_dots(val,maxD)}</span>
      </div></td>`;
    }).join('');
    rows+=`<tr><td class="print-attr-row-lbl">${ROW_LABELS[row]}</td>${cells}</tr>`;
  }
  const catHeaders=cats.map(([cat])=>`<th class="print-attr-cat">${cat}</th>`).join('');
  el.innerHTML=`<table class="print-attr-table">
    <thead><tr><th></th>${catHeaders}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderSkillBlockCompact(){
  const el=document.getElementById('skillBlock');if(!el)return;
  const rows=[];
  Object.entries(SKILLS).forEach(([cat,skillList])=>{
    rows.push(`<div class="print-skill-cat">${cat}</div>`);
    skillList.forEach(sk=>{
      const sd=STATE.skills[sk]||{rating:0,rote:false,specialty:'',label:SKILL_LABELS[sk]};
      const rating=sd.rating||0;
      const dots=Array.from({length:5},(_,i)=>
        `<span class="dot${rating>=i+1?' filled':''}" style="width:9px;height:9px;border-width:1px"></span>`
      ).join('');
      const spec=sd.specialty
        ?`<span class="print-skill-spec">${escH(sd.specialty)}</span>`
        :`<span class="print-skill-spec-blank"></span>`;
      // Only show rote marker when the skill is actually marked as rote
      const rote=sd.rote?'<span class="print-skill-rote">●</span>':'<span class="print-skill-rote-empty"></span>';
      rows.push(`<div class="print-skill-row">${rote}<span class="print-skill-name">${escH(sd.label||SKILL_LABELS[sk])}</span><span class="print-skill-dots">${dots}</span>${spec}</div>`);
    });
  });
  el.innerHTML=`<div class="print-skill-col">${rows.join('')}</div>`;
}

// Generic compact renderer for rated-list sections (Merits, Disciplines,
// Gifts, Endowments, Haunts, Rotes, etc.). Targets the list container by
// section definition, so all rated-list types are handled automatically.
function renderRatedListCompact(sd){
  const isMerits=sd.special_renderer==='merits';
  const sk=isMerits?'merits':(sd.state_key||sd.key);
  const listId=isMerits?'meritList':`${sd.key}-rated-list`;
  const el=document.getElementById(listId);if(!el)return;
  const items=STATE[sk]||[];
  if(!items.length){el.innerHTML='';return;}
  const max=isMerits?(STATE.meritMaxDots||5):(sd.max_rating||5);
  el.innerHTML=items.map(m=>{
    const rating=m.rating||0;
    const dots=Array.from({length:max},(_,i)=>
      `<span class="dot${rating>=i+1?' filled':''}" style="width:9px;height:9px;border-width:1px"></span>`
    ).join('');
    const desc=m.desc?`<div class="print-item-desc">${mdH(m.desc)}</div>`:'';
    return `<div class="print-item-row">
      <div class="print-item-hd"><span class="print-item-name">${escH(m.name||'')}</span><span class="print-item-dots">${dots}</span></div>
      ${desc}
    </div>`;
  }).join('');
}

// Generic compact renderer for named-list sections (Atavisms, Numina,
// Embeds, Exploits, Transmutations, etc.).
// Sections in FILL_LINE_KEYS always print with at least FILL_MIN_LINES total
// rows (filled entries + blank ruled lines), so the sheet can be written on
// in pencil at the table.
const FILL_LINE_KEYS=new Set(['tilts','conditions']);
const FILL_MIN_LINES=3;

function renderNamedListCompact(sd){
  const sk=sd.state_key||sd.key;
  const listId=`${sd.key}-list`;
  const el=document.getElementById(listId);if(!el)return;
  const items=STATE[sk]||[];
  const useFillLines=FILL_LINE_KEYS.has(sd.key);
  // If no entries and no fill lines needed, clear and bail
  if(!items.length&&!useFillLines){el.innerHTML='';return;}
  const filled=items.map(item=>{
    const desc=item.desc?`<div class="print-item-desc">${mdH(item.desc)}</div>`:'';
    return `<div class="print-item-row">
      <div class="print-item-hd"><span class="print-item-name">${escH(item.name||'')}</span></div>
      ${desc}
    </div>`;
  });
  // Append blank ruled lines to reach FILL_MIN_LINES total for designated sections
  const blankCount=useFillLines?Math.max(0,FILL_MIN_LINES-items.length):0;
  const blanks=Array.from({length:blankCount},()=>'<div class="print-fill-line"></div>');
  el.innerHTML=[...filled,...blanks].join('');
}

// Generic compact renderer for line-list sections (Aspirations, Touchstones,
// Goblin Debt, Flesh/Spirit Touchstones, etc.). Each item prints as a plain
// text line — no input chrome, no remove buttons.
function renderLineListCompact(sd){
  const sk=sd.state_key||sd.key;
  const listId=`${sd.key}-lines`;
  const el=document.getElementById(listId);if(!el)return;
  const items=STATE[sk]||[];
  if(!items.length){el.innerHTML='';return;}
  el.innerHTML=items.map(item=>
    `<div class="print-line-item">${escH(item)}</div>`
  ).join('');
}

// Compact renderer for pool-list sections (General/Combat Dice Pools).
// Each entry renders as "Name  N" — name left, value right, inline.
function renderPoolListCompact(sd){
  const sk=sd.state_key||sd.key;
  const listId=`${sd.key}-pool-list`;
  const el=document.getElementById(listId);if(!el)return;
  const items=STATE[sk]||[];
  if(!items.length){el.innerHTML='';return;}
  el.innerHTML=items.map(entry=>
    `<div class="print-pool-row">
      <span class="print-pool-name">${escH(entry.name||'')}</span>
      <span class="print-pool-val">${entry.value||0}</span>
    </div>`
  ).join('');
}

// Generic compact renderer for arcana-block sections (Mage Arcana,
// Mage Ascension Spheres). Renders as two columns of 5, label + dots inline.
function renderArcanaBlockCompact(sd){
  const sk=sd.state_key||sd.key;
  const vals=STATE[sk]||{};
  const fields=sd.fields||[];
  const half=Math.ceil(fields.length/2);
  const renderCol=slice=>slice.map(f=>{
    const val=vals[f.key]||0;
    const dots=Array.from({length:5},(_,i)=>
      `<span class="dot${val>=i+1?' filled':''}" style="width:9px;height:9px;border-width:1px"></span>`
    ).join('');
    return `<div class="print-arcana-row"><span class="print-arcana-name">${escH(f.label)}</span><span class="print-skill-dots">${dots}</span></div>`;
  }).join('');
  const inner=document.getElementById(`arcana-inner-${sd.key}`);if(!inner)return;
  inner.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">
    <div>${renderCol(fields.slice(0,half))}</div>
    <div>${renderCol(fields.slice(half))}</div>
  </div>`;
}

// Compact renderer for Entity attributes (Power/Finesse/Resistance).
// Same pattern as renderAttrBlockCompact but for the 3-attribute entity block.
function renderAttr3BlockCompact(){
  const el=document.getElementById('attr3Block');if(!el)return;
  const maxD=STATE.attr3MaxDots||5;
  const _dots=(val,max)=>Array.from({length:max},(_,i)=>
    `<span class="dot${val>=i+1?' filled':''}" style="width:9px;height:9px;border-width:1px"></span>`
  ).join('');
  el.innerHTML=`<div style="display:flex;gap:8px">
    ${ENTITY_ATTRS.map(a=>{
      const val=(STATE.entity_attrs&&STATE.entity_attrs[a.key])||1;
      return `<div class="print-attr-cell" style="flex:1"><div class="print-attr-cell-inner">
        <span class="print-attr-name">${a.label}</span>
        <span class="print-attr-dots">${_dots(val,maxD)}</span>
      </div></div>`;
    }).join('')}
  </div>`;
}

// Compact renderer for renown-block sections (Werewolf Renown).
// Same pattern as arcana — two columns of fields, label + dots inline.
function renderRenownBlockCompact(sd){
  const sk=sd.state_key||sd.key;
  const vals=STATE[sk]||{};
  const fields=sd.fields||[];
  const half=Math.ceil(fields.length/2);
  const renderCol=slice=>slice.map(f=>{
    const val=vals[f.key]||0;
    const dots=Array.from({length:5},(_,i)=>
      `<span class="dot${val>=i+1?' filled':''}" style="width:9px;height:9px;border-width:1px"></span>`
    ).join('');
    return `<div class="print-arcana-row"><span class="print-arcana-name">${escH(f.label)}</span><span class="print-skill-dots">${dots}</span></div>`;
  }).join('');
  const inner=document.getElementById(`renown-inner-${sd.key}`);if(!inner)return;
  inner.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 12px">
    <div>${renderCol(fields.slice(0,half))}</div>
    <div>${renderCol(fields.slice(half))}</div>
  </div>`;
}

// Compact renderer for pillars-block sections (Mummy Pillars).
// Each pillar: label + 5 permanent dots (tcircle) + 5 temporary squares (tsquare) + note inline.
function renderPillarsBlockCompact(sd){
  const sk=sd.state_key||sd.key;
  const inner=document.getElementById(`pillars-inner-${sd.key}`);if(!inner)return;
  inner.innerHTML=(sd.fields||[]).map(f=>{
    const pf=(STATE[sk]&&STATE[sk][f.key])||{dots:0,squares:Array(5).fill(false),note:''};
    const rating=pf.dots||0;
    const squares=Array.isArray(pf.squares)?pf.squares:Array(5).fill(false);
    const filled=squares.filter(Boolean).length;
    const dots=Array.from({length:5},(_,i)=>
      `<span class="tcircle" style="width:9px;height:9px;${i>=rating?'opacity:0.2':''}"></span>`
    ).join('');
    const sqs=Array.from({length:5},(_,i)=>
      `<span class="tsquare${i<filled?' on':''}" style="width:9px;height:9px;border-width:1px"></span>`
    ).join('');
    const note=pf.note?`<span class="print-pillars-note">${escH(pf.note)}</span>`:'';
    return `<div class="print-pillars-row">
      <div class="print-pillars-left">
        <span class="print-pillars-lbl">${escH(f.label)}</span>
        ${note}
      </div>
      <div class="print-pillars-tracks">
        <span style="display:flex;gap:2px">${dots}</span>
        <span style="display:flex;gap:2px">${sqs}</span>
      </div>
    </div>`;
  }).join('');
}

// Compact renderer for covers and forms — defined below.
// Each cover prints as: name + rating dots on one line, notes below if
// present, then cover merits as compact name + dots rows.
function renderCoversCompact(sd){
  const sk=sd.state_key||sd.key;
  const listId=`${sd.key}-list`;
  const el=document.getElementById(listId);if(!el)return;
  const covers=STATE[sk]||[];
  if(!covers.length){el.innerHTML='';return;}
  el.innerHTML=covers.map(c=>{
    const rating=c.cover_rating||0;
    const ratingDots=Array.from({length:10},(_,i)=>
      `<span class="dot${rating>=i+1?' filled':''}" style="width:9px;height:9px;border-width:1px"></span>`
    ).join('');
    const notes=c.notes?`<div class="print-item-desc">${mdH(c.notes)}</div>`:'';
    const merits=(c.merits||[]).map(m=>{
      const mDots=Array.from({length:5},(_,i)=>
        `<span class="dot${(m.rating||0)>=i+1?' filled':''}" style="width:9px;height:9px;border-width:1px"></span>`
      ).join('');
      return `<div class="print-cover-merit"><span class="print-cover-merit-name">${escH(m.name||'')}</span><span class="print-item-dots">${mDots}</span></div>`;
    }).join('');
    return `<div class="print-item-row">
      <div class="print-item-hd">
        <span class="print-item-name">${escH(c.name||'')}</span>
        <span class="print-item-dots">${ratingDots}</span>
      </div>
      ${notes}
      ${merits}
    </div>`;
  }).join('');
}

// Compact renderer for Werewolf Forms block.
// The live renderer already produces a dense reference table — the compact
// version removes the min-width constraint and tightens font/padding so it
// fits cleanly in a narrow print column without horizontal overflow.
// Rather than replacing the HTML, we apply a .print-forms-compact class to
// the forms-wrap and let print CSS do the work.
function renderFormsBlockCompact(sd){
  const block=document.getElementById(`secblock-${sd.key}`);if(!block)return;
  const wrap=block.querySelector('.forms-wrap');if(!wrap)return;
  wrap.classList.add('print-forms-compact');
}

// Restore: remove the compact class added to forms-wrap.
function _restoreFormsBlocks(){
  SECTION_DEFS.forEach(sd=>{
    if(sd.type==='forms-block'&&secVisible(sd.key)){
      const block=document.getElementById(`secblock-${sd.key}`);if(!block)return;
      const wrap=block.querySelector('.forms-wrap');if(!wrap)return;
      wrap.classList.remove('print-forms-compact');
    }
  });
}

// Generic compact renderer for weapons, armor, and equipment.
// Renders each item as: name — stats summary, notes/desc below if present.
function renderGearCompact(){
  // Weapons
  const wEl=document.getElementById('weaponList');
  if(wEl) wEl.innerHTML=(STATE.weapons||[]).map(w=>{
    const isRanged=(w.weapon_type||'melee')==='ranged';
    const stats=isRanged
      ?`Dmg +${w.damage||0} | Rng ${w.ranges||'—'} | Clip ${w.clip||0} | Init ${w.initiative_mod>=0?'+':''}${w.initiative_mod||0} | Str ${w.strength_req||0} | Sz ${w.size||0}`
      :`Dmg +${w.damage||0} | Init ${w.initiative_mod>=0?'+':''}${w.initiative_mod||0} | Str ${w.strength_req||0} | Sz ${w.size||0}`;
    const equipped=w.equipped?` <span class="print-gear-equipped">Equipped</span>`:'';
    const notes=w.notes?`<div class="print-item-desc">${mdH(w.notes)}</div>`:'';
    return `<div class="print-item-row"><div class="print-item-hd">
      <span class="print-item-name">${escH(w.name)}</span>
      <span class="print-gear-stats">${stats}${equipped}</span>
    </div>${notes}</div>`;
  }).join('');

  // Armor
  const aEl=document.getElementById('armorList');
  if(aEl) aEl.innerHTML=(STATE.armor||[]).map(a=>{
    const stats=`Armor ${a.armor_general||0}/${a.armor_ballistic||0} | Def ${a.defense_penalty>=0?'+':''}${a.defense_penalty||0} | Spd ${a.speed_penalty>=0?'+':''}${a.speed_penalty||0} | Str ${a.strength_req||0}`;
    const cov=a.coverage||{};
    const covStr=['head','torso','arms','legs'].filter(l=>cov[l]).map(l=>l[0].toUpperCase()+l.slice(1)).join(', ');
    const covPart=covStr?` | Covers: ${covStr}`:'';
    const equipped=a.equipped?` <span class="print-gear-equipped">Equipped</span>`:'';
    const notes=a.notes?`<div class="print-item-desc">${mdH(a.notes)}</div>`:'';
    return `<div class="print-item-row"><div class="print-item-hd">
      <span class="print-item-name">${escH(a.name)}</span>
      <span class="print-gear-stats">${stats}${covPart}${equipped}</span>
    </div>${notes}</div>`;
  }).join('');

  // Equipment
  const eEl=document.getElementById('equipList');
  if(eEl) eEl.innerHTML=(STATE.equipment||[]).map(e=>{
    const stats=`Bonus +${e.dice_bonus||0} | Dur ${e.durability||0} | Sz ${e.size||0} | Str ${e.structure||0}`;
    const desc=e.desc?`<div class="print-item-desc">${mdH(e.desc)}</div>`:'';
    return `<div class="print-item-row"><div class="print-item-hd">
      <span class="print-item-name">${escH(e.name)}</span>
      <span class="print-gear-stats">${stats}</span>
    </div>${desc}</div>`;
  }).join('');
}
function _restoreListSections(){
  SECTION_DEFS.forEach(sd=>{
    if(!secVisible(sd.key))return;
    if(sd.type==='rated-list'){
      if(sd.special_renderer==='merits') renderMeritList();
      else renderGenericRatedList(sd);
    } else if(sd.type==='named-list'){
      renderNamedList(sd.state_key||sd.key,`${sd.key}-list`);
    } else if(sd.type==='line-list'){
      renderLineItems(sd.state_key||sd.key,`${sd.key}-lines`);
    } else if(sd.type==='pool-list'){
      renderPoolList(sd);
    } else if(sd.type==='arcana-block'){
      const inner=document.getElementById(`arcana-inner-${sd.key}`);
      if(inner){
        inner.innerHTML=(sd.fields||[]).map(f=>`
          <div class="arcana-row">
            <span class="arcana-lbl">${escH(f.label)}</span>
            <div class="dot-row" id="arcana-dots-${sd.key}-${f.key}"></div>
          </div>`).join('');
      }
      renderArcanaBlock(sd);
    } else if(sd.type==='renown-block'){
      const inner=document.getElementById(`renown-inner-${sd.key}`);
      if(inner){
        inner.innerHTML=(sd.fields||[]).map(f=>`
          <div class="renown-row">
            <span class="renown-lbl">${escH(f.label)}</span>
            <div class="dot-row" id="renown-dots-${sd.key}-${f.key}"></div>
          </div>`).join('');
      }
      renderRenownBlock(sd);
    } else if(sd.type==='pillars-block'){
      const sk=sd.state_key||sd.key;
      const inner=document.getElementById(`pillars-inner-${sd.key}`);
      if(inner){
        inner.innerHTML=(sd.fields||[]).map(f=>{
          const pf=(STATE[sk]&&STATE[sk][f.key])||{};
          return `<div class="pillars-row">
            <div class="pillars-left">
              <span class="pillars-lbl">${escH(f.label)}</span>
              <input class="pillars-inp" value="${escH(pf.note||'')}" placeholder=""
                oninput="setPillarNote('${sk}','${f.key}',this.value)">
            </div>
            <div class="pillars-tracks">
              <div class="pillars-dots" id="pillars-dots-${sd.key}-${f.key}"></div>
              <div class="pillars-squares" id="pillars-squares-${sd.key}-${f.key}"></div>
            </div>
          </div>`;
        }).join('');
      }
      renderPillarsBlock(sd);
    } else if(sd.type==='attributes-3'){
      renderAttr3Block();
    }
  });
}
// ── End compact print renderers ───────────────────────────────────────────────

// ── Print expand/restore ───────────────────────────────────────────────────────
// Before printing: swap in compact renderers and expand all collapsed sections.
// After printing: restore exactly the state the user had.
(function(){
  let _printCollapsedKeys=null;
  let _printClosedCards=null;

  window.addEventListener('beforeprint',function(){
    // Set document title to character name so the browser uses it as the PDF filename
    if(STATE.name) document.title=STATE.name;
    // Compact structural sections
    renderAttrBlockCompact();
    renderSkillBlockCompact();
    // Compact all visible rated-list and named-list sections generically
    SECTION_DEFS.forEach(sd=>{
      if(!secVisible(sd.key))return;
      if(sd.type==='rated-list') renderRatedListCompact(sd);
      else if(sd.type==='named-list') renderNamedListCompact(sd);
      else if(sd.type==='line-list') renderLineListCompact(sd);
      else if(sd.type==='pool-list') renderPoolListCompact(sd);
      else if(sd.type==='arcana-block') renderArcanaBlockCompact(sd);
      else if(sd.type==='renown-block') renderRenownBlockCompact(sd);
      else if(sd.type==='pillars-block') renderPillarsBlockCompact(sd);
      else if(sd.type==='covers') renderCoversCompact(sd);
      else if(sd.type==='forms-block') renderFormsBlockCompact(sd);
      else if(sd.type==='attributes-3') renderAttr3BlockCompact();
    });
    renderGearCompact();

    _printCollapsedKeys=[];
    document.querySelectorAll('.sec-block.sec-collapsed').forEach(block=>{
      _printCollapsedKeys.push(block.id);
      block.classList.remove('sec-collapsed');
    });
    _printClosedCards=[];
    document.querySelectorAll('.item-card:not(.open),.cover-card:not(.open)').forEach(card=>{
      _printClosedCards.push(card);
      card.classList.add('open');
    });
  });

  window.addEventListener('afterprint',function(){
    // Restore original page title
    document.title='Mortals+ — Chronicles of Darkness';
    // Restore live renderers
    renderAttrBlock();
    renderSkillBlock();
    _restoreListSections();
    renderWeaponList();renderArmorList();renderEquipList();
    // Restore covers and forms
    SECTION_DEFS.forEach(sd=>{
      if(!secVisible(sd.key))return;
      if(sd.type==='covers') renderCovers(sd.state_key||sd.key,`${sd.key}-list`);
    });
    _restoreFormsBlocks();

    if(_printCollapsedKeys){
      _printCollapsedKeys.forEach(id=>{
        const block=document.getElementById(id);
        if(block)block.classList.add('sec-collapsed');
      });
      _printCollapsedKeys=null;
    }
    if(_printClosedCards){
      _printClosedCards.forEach(card=>card.classList.remove('open'));
      _printClosedCards=null;
    }
  });
})();
// ── End print expand/restore ──────────────────────────────────────────────────
