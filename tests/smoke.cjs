const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('https://reading-test.github.io/reading-practice/**',route=>{const pathname=new URL(route.request().url()).pathname.replace('/reading-practice','');const file=path.join(root,pathname==='/'?'index.html':pathname);route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});});
 await page.goto('https://reading-test.github.io/reading-practice/');
 await page.getByRole('button',{name:'Paste text',exact:true}).click();await page.locator('#title').fill('A small journey');await page.locator('#text').fill('We left after they arrived. It was sunny.');await page.locator('#parse').click();assert.equal(await page.locator('.unit').count(),2);
 await page.getByRole('button',{name:'Confirm units & start practice'}).click();assert.equal(await page.locator('.passage-unit').count(),2);assert.equal(await page.locator('#review-activity').isVisible(),false);
 await page.locator('.passage-unit').first().click();await page.locator('[data-clause-action="step2"]').click();await page.locator('[data-clause-input="sentence"]').fill('他們抵達後，我們離開。');await page.locator('[data-clause-action="finish"]').click();await page.locator('[data-clause-action="finish-back"]').click();assert.equal(await page.locator('.passage-unit.completed').count(),1);
 await page.reload();await page.getByRole('button',{name:'Open passage'}).click();assert.equal(await page.locator('.passage-unit.completed').count(),1);
 await page.locator('.passage-unit').first().click();assert.equal(await page.locator('[data-clause-input="sentence"]').inputValue(),'他們抵達後，我們離開。');await page.locator('[data-clause-action="back"]').click();assert.equal(await page.locator('.passage-unit.completed').count(),1);
 const data=await page.evaluate(()=>backup());await page.evaluate(data=>restore(data),data);assert.equal(await page.locator('.practice-card').count(),2);
 assert.equal(await page.evaluate(()=>{try{validateBackup({version:1,practices:[]});return false;}catch{return true;}}),true);
 await page.getByRole('button',{name:'Backup & restore'}).click();assert.equal(await page.locator('#client').count(),0);
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export backup',exact:true}).click();assert.match((await downloadEvent).suggestedFilename(),/^reading-practice-A small journey \+ 1 more-.*\.json$/);
 // Exercise Drive integration without real account access.
 const uploads=[];await page.evaluate(()=>{window.google={accounts:{oauth2:{initTokenClient:opts=>{if(opts.client_id!==window.READING_GOOGLE_CLIENT_ID)throw Error('Wrong OAuth client');return {requestAccessToken:()=>opts.callback({access_token:'test-only-token',expires_in:3600})};}}}};});
 await page.route('https://www.googleapis.com/**',async route=>{if(route.request().method()==='POST'){uploads.push(route.request().postData());await route.fulfill({json:{id:'test-backup',name:'reading-practice-test.json'}});}else if(route.request().url().includes('alt=media'))await route.fulfill({json:data});else await route.fulfill({json:{files:[{id:'test-backup',name:'reading-practice-test.json',modifiedTime:new Date().toISOString()}]}});});
 await page.getByRole('button',{name:'Back up to Google Drive',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Backup saved'));assert.equal(uploads.length,1);assert.match(uploads[0],/appDataFolder/);assert.match(uploads[0],/reading-practice-A small journey \+ 1 more-/);
 await page.getByRole('button',{name:'Find Drive backups'}).click();await page.waitForFunction(()=>document.querySelector('#remote').textContent.includes('A small journey — 1 / 2 completed'));assert.match(await page.locator('#remote').textContent(),/A small journey/);await page.getByRole('button',{name:'Restore backup',exact:true}).click();await page.waitForSelector('.practice-card');assert.equal(await page.locator('.practice-card').count(),3);

 // Deletion: cancellation, individual removal, partial batch failure, and retry.
 let remaining=['one','two','three'],deleted=[],fail=true;
 await page.route('https://www.googleapis.com/**',async route=>{
   const request=route.request(),id=new URL(request.url()).pathname.split('/').pop();
   if(request.method()==='DELETE'){
     if(id==='three'&&fail){await route.fulfill({status:500,json:{error:'test failure'}});return;}
     deleted.push(id);remaining=remaining.filter(x=>x!==id);await route.fulfill({status:204});return;
   }
   if(request.url().includes('alt=media')){await route.fulfill({json:data});return;}
   await route.fulfill({json:{files:remaining.map(id=>({id,name:'reading-practice-'+id+'.json',modifiedTime:new Date().toISOString()}))}});
 });
 await page.getByRole('button',{name:'Backup & restore',exact:true}).click();
 await page.getByRole('button',{name:'Find Drive backups',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.backup-card').length===3);
 page.removeAllListeners('dialog');page.once('dialog',d=>d.dismiss());
 await page.getByRole('button',{name:'Delete backup',exact:true}).first().click();
 assert.equal(deleted.length,0);
 page.on('dialog',d=>d.accept());
 await page.getByRole('button',{name:'Delete backup',exact:true}).first().click();
 await page.waitForFunction(()=>document.querySelectorAll('.backup-card').length===2);assert.deepEqual(deleted,['one']);
 await page.getByLabel('Select all backups',{exact:true}).check();
 await page.getByRole('button',{name:'Delete selected (2)',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Could not delete 1'));
 assert.deepEqual(deleted,['one','two']);assert.equal(await page.locator('.backup-card').count(),1);
 fail=false;
 await page.getByRole('button',{name:'Delete selected (1)',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#remote').textContent.includes('No backups found'));
 assert.deepEqual(deleted,['one','two','three']);
 await page.getByRole('button',{name:'My practices',exact:true}).click();assert.equal(await page.locator('.practice-card').count(),3);
 await page.screenshot({path:path.join(root,'tests','library.png'),fullPage:true});assert.deepEqual(errors,[]);console.log('PASS: paste/parse, passage, translation completion, reload/resume, JSON validation/restore, configured Drive upload/list/restore (mocked).');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
