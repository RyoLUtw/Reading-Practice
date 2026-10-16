'use strict';
const STORE='reading-standalone-v1';
let practices=[], active=null, storageFailed=false;
const notice=(message,error=false)=>{$('#notice').textContent=message;$('#notice').classList.toggle('error',error);};
function persist(){try{localStorage.setItem(STORE,JSON.stringify(practices));storageFailed=false;}catch(e){storageFailed=true;notice('Browser save failed. Export a backup before closing this tab.',true);throw e;}}
function validateBackup(data){
  if(data?.app!=='reading-practice-standalone'||data.version!==1||!Array.isArray(data.practices))throw Error('This is not a supported Reading practice backup.');
  const ids=new Set();
  for(const p of data.practices){
    if(!p||typeof p.id!=='string'||ids.has(p.id)||typeof p.title!=='string'||typeof p.passage!=='string'||!Array.isArray(p.units)||!p.units.length)throw Error('Invalid practice in backup.');ids.add(p.id);
    for(const u of p.units){if(typeof u.text!=='string'||!u.text.trim()||!['unanswered','draft','completed'].includes(u.status))throw Error('Invalid practice unit in backup.');if(u.savedState&&(!u.savedState.clauseTree||u.savedState.format_version!==1))throw Error('Unsupported saved activity.');}
  }return data.practices;
}
try{const raw=localStorage.getItem(STORE);if(raw)practices=validateBackup({app:'reading-practice-standalone',version:1,practices:JSON.parse(raw)});}catch(e){storageFailed=true;notice('Saved data could not be loaded. Export the stored data before restoring a backup.',true);}
function backup(){return {app:'reading-practice-standalone',version:1,exportedAt:new Date().toISOString(),practices};}
function backupName(data){
  const title=Array.from((data.practices[0]?.title||'empty-library').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g,'-').replace(/\s+/g,' ').trim()).slice(0,80).join('').replace(/[. ]+$/g,'')||'Untitled practice';
  const more=data.practices.length>1?` + ${data.practices.length-1} more`:'';
  return `reading-practice-${title}${more}-${data.exportedAt.replace(/[:.]/g,'-')}.json`;
}
function download(data,name=backupName(data)){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function restore(data){const incoming=validateBackup(data);if(!confirm(`Import ${incoming.length} practices as new copies? Existing practices will be kept.`))return;const old=practices;practices=[...practices,...incoming.map(p=>({...structuredClone(p),id:crypto.randomUUID(),title:p.title+' (restored)'}))];try{persist();}catch(e){practices=old;throw e;}home();notice('Backup restored. Existing practices were kept.');}
function shell(html){state.game=null;active=null;$('#review-activity').hidden=true;$('#review-activity').replaceChildren();$('#main').hidden=false;$('#main').innerHTML=html;}
function button(label,fn){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>Promise.resolve().then(fn).catch(e=>notice(e.message,true));return b;}
function home(){shell('<h2>My practices</h2><p class="muted">Paste a passage, confirm its practice units, and begin. Progress is saved in this browser.</p><div id="library"></div>');if(!practices.length)$('#library').textContent='No practices yet. Choose Paste text to begin.';for(const p of practices){const card=document.createElement('article');card.className='practice-card';card.innerHTML=`<h3>${escapeHtml(p.title)}</h3><p>${p.units.filter(u=>u.status==='completed').length} / ${p.units.length} completed</p>`;card.append(button('Open passage',()=>passage(p)),button('Delete',()=>{if(confirm(`Delete “${p.title}” and its progress?`)){practices=practices.filter(x=>x.id!==p.id);persist();home();}}));$('#library').append(card);}}
function editor(){shell('<h2>Start with a text</h2><label>Practice title (optional)<input id="title" type="text" maxlength="100" placeholder="My reading practice"></label><label>Paste your text<textarea id="text" rows="10" maxlength="100000" placeholder="Paste an English passage here…"></textarea></label><button id="parse" class="primary-button">Parse practice units</button><div id="units"></div>');let ranges=[],source='';$('#parse').onclick=()=>{source=$('#text').value;if(!source.trim()){notice('Paste some text first.',true);return;}ranges=ReadingCore.proposeUnits(source);preview();};$('#text').oninput=()=>{ranges=[];$('#units').replaceChildren();};function preview(){const chars=Array.from(source);$('#units').innerHTML='<h3>Confirm practice units</h3><p>Edit practice wording, exclude headings, or split and merge units. The original text is kept.</p>';ranges.forEach((r,i)=>{const row=document.createElement('div');row.className='unit';row.innerHTML=`<label><input type="checkbox" ${r.included?'checked':''}> Include unit ${i+1}</label><textarea aria-label="Unit ${i+1}">${escapeHtml(r.text??ReadingCore.singleLineUnit(chars.slice(r.start_offset,r.end_offset).join('')))}</textarea><div class="actions"></div>`;const input=row.querySelector('textarea');row.querySelector('input').onchange=e=>r.included=e.target.checked;input.oninput=()=>r.text=input.value;row.querySelector('.actions').append(button('Split at cursor',()=>{const at=input.selectionStart,t=input.value;if(!t.slice(0,at).trim()||!t.slice(at).trim())throw Error('Place the cursor inside the unit.');ranges.splice(i,1,{...r,text:t.slice(0,at).trim()},{...r,text:t.slice(at).trim()});preview();}));if(i<ranges.length-1)row.querySelector('.actions').append(button('Merge with next',()=>{const next=ranges[i+1];r.text=input.value+' '+(next.text??ReadingCore.singleLineUnit(chars.slice(next.start_offset,next.end_offset).join('')));ranges.splice(i+1,1);preview();}));$('#units').append(row);});$('#units').append(button('Confirm units & start practice',()=>{const units=ranges.filter(r=>r.included).map(r=>({text:(r.text??ReadingCore.singleLineUnit(chars.slice(r.start_offset,r.end_offset).join(''))).trim(),status:'unanswered',savedState:null}));if(!units.length||units.some(u=>!u.text))throw Error('Include at least one nonempty practice unit.');const p={id:crypto.randomUUID(),title:$('#title').value.trim()||'Untitled practice',passage:source,createdAt:new Date().toISOString(),units};practices.push(p);persist();passage(p);}));}}
function passage(p){shell(`<h2>${escapeHtml(p.title)}</h2><p>${p.units.filter(u=>u.status==='completed').length} / ${p.units.length} completed · Choose a unit to practice.</p><details><summary>Original pasted text</summary><p class="original">${escapeHtml(p.passage)}</p></details><div id="passage"></div>`);p.units.forEach((u,i)=>{const b=button(`${i+1}. ${u.text} — ${u.status}`,()=>practice(p,i));b.className='passage-unit '+u.status;$('#passage').append(b);});}
function practice(p,index){active={p,index};$('#main').hidden=true;$('#review-activity').hidden=false;const unit=p.units[index];initializeReadingSentence({sentence:unit.text,title:p.title,position:index+1,total:p.units.length,savedState:unit.savedState,onChange:s=>{if(JSON.stringify(unit.savedState)!==JSON.stringify(s))unit.status='draft';unit.savedState=s;try{persist();}catch{}},onCheckpoint:async()=>persist(),onFinish:async s=>{unit.savedState=s;unit.status='completed';persist();notice('Sentence completed and saved in this browser.');},onBack:async()=>passage(p),onNext:async()=>index+1<p.units.length?practice(p,index+1):passage(p),completedCount:()=>p.units.filter(u=>u.status==='completed').length});}
renderSentenceTranslationTop=prompt=>`<div class="panel sentence-comic-header"><div><p class="eyebrow">${escapeHtml(state.game.reading.title)} · Unit ${state.game.reading.position} / ${state.game.reading.total}</p><h2>${escapeHtml(prompt.sourceText)}</h2><p>Subject / Predicate / Adverbial</p></div></div>`;
function backups(){shell('<h2>Backup & restore</h2><p>Export all practices and saved progress, or keep a backup in your personal Google Drive. Clause dialogs must be saved before backing up.</p><div id="local" class="actions"></div><label>Import a JSON backup<input id="import" type="file" accept=".json,application/json"></label><hr><h3>Personal Google Drive</h3><p>Uses a private app-data folder in your Google Drive. Sign in when you back up or restore. No client secret or API key is needed.</p><div id="cloud" class="actions"></div><div id="remote"></div>');$('#local').append(button('Export backup',()=>download(backup())));$('#import').onchange=async e=>{try{const file=e.target.files[0];if(file.size>20000000)throw Error('Backup is too large (maximum 20 MB).');restore(JSON.parse(await file.text()));}catch(e){notice(e.message,true);}};$('#cloud').append(button('Back up to Google Drive',async()=>{await ReadingDrive.upload(backup());notice('Backup saved to your personal Google Drive.');}),button('Find Drive backups',findDriveBackups));}
async function findDriveBackups(){
  const remote=$('#remote');
  remote.textContent='Finding backups…';
  const files=await ReadingDrive.list();
  if(!remote.isConnected)return;
  remote.replaceChildren();
  if(!files.length){remote.textContent='No backups found for this Google account and app.';return;}
  let busy=false;
  const toolbar=document.createElement('div');toolbar.className='actions';
  const selectLabel=document.createElement('label'),selectAll=document.createElement('input');selectAll.type='checkbox';
  selectLabel.append(selectAll,' Select all backups');
  const deleteSelected=button('Delete selected',()=>removeRows(rows.filter(row=>row.card.isConnected&&row.selected.checked)));
  toolbar.append(selectLabel,deleteSelected);remote.append(toolbar);
  function updateSelection(){
    const remaining=rows.filter(row=>row.card.isConnected),count=remaining.filter(row=>row.selected.checked).length;
    selectAll.checked=remaining.length>0&&count===remaining.length;
    selectAll.indeterminate=count>0&&count<remaining.length;
    deleteSelected.textContent='Delete selected ('+count+')';deleteSelected.disabled=busy||count===0;
  }
  selectAll.onchange=()=>{for(const row of rows)row.selected.checked=selectAll.checked;updateSelection();};
  async function removeRows(targets){
    if(busy||!targets.length)return;
    const names=targets.map(row=>row.heading.textContent+' ('+new Date(row.file.modifiedTime).toLocaleString()+')').join('\n');
    if(!confirm('Permanently delete '+targets.length+' Drive backup(s)? This cannot be undone. Your local practices will be kept.\n\n'+names))return;
    busy=true;remote.querySelectorAll('button,input').forEach(el=>el.disabled=true);
    let removed=0;const failures=[];
    for(const row of targets){
      try{await ReadingDrive.remove(row.file.id);row.card.remove();removed++;}
      catch(error){failures.push(row.file.name+': '+error.message);}
    }
    busy=false;remote.querySelectorAll('button,input').forEach(el=>el.disabled=false);updateSelection();
    if(!rows.some(row=>row.card.isConnected))remote.textContent='No backups found for this Google account and app.';
    notice(removed+' backup(s) deleted.'+(failures.length?' Could not delete '+failures.length+' backup(s). '+failures.join(' '):''),failures.length>0);
  }
  const rows=files.map(file=>{
    const card=document.createElement('article');card.className='backup-card';
    const heading=document.createElement('h4');heading.textContent='Loading practice titles…';
    const date=document.createElement('p');date.className='muted';date.textContent=new Date(file.modifiedTime).toLocaleString();
    const contents=document.createElement('ul');
    const restoreButton=button('Restore backup',async()=>restore(await ReadingDrive.read(file.id)));
    const selected=document.createElement('input');selected.type='checkbox';selected.onchange=updateSelection;
    const label=document.createElement('label');label.append(selected,' Select backup');
    const row={file,card,heading,contents,selected};
    const deleteButton=button('Delete backup',()=>removeRows([row]));
    card.append(label,heading,date,contents,restoreButton,deleteButton);remote.append(card);
    return row;
  });
  updateSelection();
  for(const {file,card,heading,contents} of rows){
    if(!remote.isConnected)return;
    if(!card.isConnected)continue;
    try{
      const saved=validateBackup(await ReadingDrive.read(file.id));
      heading.textContent=saved.length===1?saved[0].title||'Untitled practice':saved.length+' practices';
      for(const practice of saved){
        const item=document.createElement('li');
        item.textContent=(practice.title||'Untitled practice')+' — '+practice.units.filter(unit=>unit.status==='completed').length+' / '+practice.units.length+' completed';
        contents.append(item);
      }
      if(!saved.length)heading.textContent='Empty backup';
    }catch(error){
      heading.textContent=file.name;
      const message=document.createElement('li');message.textContent='Could not load practice titles: '+error.message;contents.append(message);
    }
  }
}
function navigate(fn){if(document.querySelector('[data-clause-input="natural"], [data-clause-input="revision"]')&&!confirm('Leave this dialog? Unsaved dialog changes will be discarded.'))return;fn();}
$('#home').onclick=()=>navigate(home);$('#new').onclick=()=>navigate(editor);$('#backups').onclick=()=>navigate(backups);
document.addEventListener('click',e=>{if(state.game)Promise.resolve(handleSentenceTranslationClick(e)).catch(error=>notice(error.message,true));});document.addEventListener('input',e=>{if(state.game)handleSentenceTranslationInput(e);});
window.addEventListener('beforeunload',e=>{if(storageFailed||document.querySelector('[data-clause-input="natural"], [data-clause-input="revision"]')){e.preventDefault();e.returnValue='';}});
home();
