import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const at=n=>path.join(root,n);
const textKeys=['id','kind','ministry','title','description','url','date','author','topic','category','image'];
const allowedOrigin='https://www.yourlivingword.com';
function validate(input, previous){
 assert(input?.schemaVersion===1 && Array.isArray(input.items),'Invalid catalog schema');
 assert(input.items.length>0 && input.items.length<=10000,'Unexpected catalog size');
 assert(input.sync?.status==='imported' && Number.isFinite(Date.parse(input.sync.at)), 'Missing successful sync timestamp');
 const seenIds=new Set(),seenUrls=new Set(),seenVideos=new Set(), counts={study:0,BD:0,YLW:0};
 const items=input.items.map(x=>{
  assert(x && typeof x==='object' && !Array.isArray(x),'Invalid row');
  const out={}; for(const k of textKeys){const v=x[k]??'';assert(typeof v==='string' && v.length<=4000,`Invalid ${k}`);out[k]=v;}
  assert(/^[A-Za-z0-9_-]{1,200}$/.test(out.id)&&!seenIds.has(out.id),'Invalid or duplicate ID');seenIds.add(out.id);
  assert(out.title.trim() && ['BD','YLW','unknown'].includes(out.ministry),'Invalid title or source');
  const u=new URL(out.url);assert(u.origin===allowedOrigin && !u.username && !u.password && !u.search && !u.hash && !seenUrls.has(u.href),'Invalid or duplicate original URL');seenUrls.add(u.href);
  assert(!out.date||/^\d{4}-\d{2}-\d{2}$/.test(out.date),'Invalid date');
  assert(Array.isArray(x.topics)&&x.topics.length<=200&&x.topics.every(t=>typeof t==='string'&&t.length<=4000),'Invalid topics');out.topics=x.topics;
  assert(typeof x.featured==='boolean','Invalid featured flag');out.featured=x.featured;
  if(out.image){const i=new URL(out.image);assert(i.protocol==='https:'&&!i.username&&!i.password&&!i.port&&/(^|\.)squarespace-cdn\.com$|(^|\.)squarespace\.com$|^i\.ytimg\.com$/.test(i.hostname),'Unexpected image host');}
  if(out.kind==='study'){assert(/^\/study-page-master\/.+/.test(u.pathname),'Invalid study path');counts.study++;}
  else{assert(out.kind==='videos','Invalid kind');const bd=u.pathname.startsWith('/bibledaze-video-teachings/v/');assert(bd?out.ministry==='BD':u.pathname.startsWith('/sermons/v/')&&out.ministry==='YLW','Invalid video source');counts[out.ministry]++;
   const y=x.youtubeId??'';assert(typeof y==='string'&&(!y||/^[A-Za-z0-9_-]{11}$/.test(y)),'Invalid YouTube ID');if(y){assert(!seenVideos.has(y),'Duplicate YouTube ID: manual review required');seenVideos.add(y);out.youtubeId=y;}
   const channel=x.channel??'';assert(typeof channel==='string'&&(!channel||/^@[A-Za-z0-9_.-]+$/.test(channel)),'Invalid channel');out.channel=channel;
  }
  return out;
 });
 assert(Object.values(counts).every(n=>n>0),'Missing collection');
 if(previous){const byUrl=new Map(items.map(x=>[x.url,x]));for(const old of previous.items){const x=byUrl.get(old.url);assert(x&&x.id===old.id,'Missing content or changed bookmark ID: '+old.id);assert(!old.youtubeId||x.youtubeId,'Previously known video ID missing: '+old.id);}}
 const sync={status:'imported',at:new Date(input.sync.at).toISOString(),note:`3/3 collections imported; ${seenVideos.size}/${counts.BD+counts.YLW} video sources recognized.`};
 console.log(`Validated ${counts.study} studies, ${counts.BD} BibleDaze videos, ${counts.YLW} YLW videos; ${seenVideos.size} unique YouTube IDs.`);
 return {schemaVersion:1,sync,items};
}
const baseline=JSON.parse(await fs.readFile(at('catalog.json'),'utf8'));
const mode=process.argv[2];
if(mode==='prepare'){
 const data=validate(baseline);await fs.mkdir(at('public'),{recursive:true});await fs.writeFile(at('public/content.js'),'window.YLW_CONTENT = '+JSON.stringify(data.items,null,2)+';\nwindow.YLW_SYNC = '+JSON.stringify(data.sync)+';\n');
}else if(mode==='publish'){
 const raw=await fs.readFile(at('public/content.js'),'utf8');const m=/^window\.YLW_CONTENT = ([\s\S]+?);\r?\nwindow\.YLW_SYNC = ([^\r\n]+);\s*$/.exec(raw);assert(m,'Invalid imported catalog format');
 const data=validate({schemaVersion:1,items:JSON.parse(m[1]),sync:JSON.parse(m[2])},baseline);const output=JSON.stringify(data,null,2)+'\n';
 await fs.mkdir(at('pages'),{recursive:true});await fs.writeFile(at('pages/catalog.json'),output);await fs.writeFile(at('catalog.json.tmp'),output);await fs.rename(at('catalog.json.tmp'),at('catalog.json'));
 console.log('Prepared JSON only; no Firebase deployment.');
}else if(mode==='check'){validate(baseline);}else throw Error('Use check, prepare, or publish.');
