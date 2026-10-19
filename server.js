const express=require('express'),{DatabaseSync}=require('node:sqlite'),crypto=require('crypto'),fs=require('fs'),sanitizeHtml=require('sanitize-html'),path=require('path');
const PORT=process.env.PORT||3000;
const USER=process.env.ADMIN_USER||'admin',PASS=process.env.ADMIN_PASS||'cambia-esta-clave';
const SECRET=process.env.SECRET||crypto.randomBytes(32).toString('hex');
const db=new DatabaseSync(process.env.DB_PATH||path.join(__dirname,'noticias.db'));
db.exec(`CREATE TABLE IF NOT EXISTS articles(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,summary TEXT,body TEXT NOT NULL,category TEXT DEFAULT 'General',image TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
db.exec(`CREATE TABLE IF NOT EXISTS widgets(k TEXT PRIMARY KEY,v TEXT NOT NULL DEFAULT '')`);
if(!db.prepare('PRAGMA table_info(articles)').all().some(c=>c.name==='author'))db.exec('ALTER TABLE articles ADD COLUMN author TEXT');
db.exec("UPDATE articles SET body=REPLACE(REPLACE(body,'&nbsp;',' '),char(160),' ') WHERE body LIKE '%&nbsp;%' OR instr(body,char(160))>0");
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,bio TEXT NOT NULL DEFAULT '',pass TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
if(!db.prepare('PRAGMA table_info(articles)').all().some(c=>c.name==='author_id'))db.exec('ALTER TABLE articles ADD COLUMN author_id INTEGER');
if(!db.prepare('PRAGMA table_info(articles)').all().some(c=>c.name==='featured'))db.exec('ALTER TABLE articles ADD COLUMN featured INTEGER NOT NULL DEFAULT 0');
if(!db.prepare('PRAGMA table_info(articles)').all().some(c=>c.name==='photo_credit'))db.exec('ALTER TABLE articles ADD COLUMN photo_credit TEXT');
db.exec('CREATE TABLE IF NOT EXISTS hits(article_id INTEGER,day TEXT,n INTEGER DEFAULT 0,PRIMARY KEY(article_id,day))');
if(!db.prepare('SELECT COUNT(*) n FROM articles').get().n){
  const ins=db.prepare('INSERT INTO articles(title,summary,body,category) VALUES(?,?,?,?)');
  [['Bienvenido a LoQuePasa','Esta es una noticia de ejemplo para ver el diseño.','Entra a /admin.html para publicar, editar o eliminar noticias.\n\nPuedes borrar estas notas de ejemplo cuando quieras.','Selección'],
   ['Así se actualiza el marcador','El marcador, las tablas y los fichajes se editan desde el panel.','En el panel, abre la sección "Marcador, tablas y fichajes" y pega tus datos.','Fútbol Nacional'],
   ['Cómo funciona el termómetro de fichajes','Cada rumor tiene un estado: Rumor, Avanzado o Confirmado.','El termómetro se llena según el estado que elijas para cada fichaje.','Rumores de Fichajes']].forEach(a=>ins.run(...a));
}
const app=express();app.set('trust proxy',1);app.use(express.json({limit:'100kb'}));
const UP=process.env.UPLOADS_DIR||path.join(__dirname,'uploads');fs.mkdirSync(UP,{recursive:true});
app.use('/uploads',express.static(UP,{maxAge:'7d',setHeaders:r=>r.setHeader('X-Content-Type-Options','nosniff')}));
app.use(express.static(path.join(__dirname,'public'),{index:false}));
const h=s=>crypto.createHash('sha256').update(String(s)).digest();
const same=(a,b)=>crypto.timingSafeEqual(h(a),h(b));
const sign=v=>crypto.createHmac('sha256',SECRET).update(v).digest('hex');
const hashPw=p=>{const s=crypto.randomBytes(16).toString('hex');return s+':'+crypto.scryptSync(String(p),s,64).toString('hex');};
const okPw=(p,st)=>{const[s,k]=String(st||'').split(':');if(!s||!k)return false;const a=crypto.scryptSync(String(p),s,64),b=Buffer.from(k,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b);};
const mk=(role,uid)=>{const b=`${role}.${uid}.${Date.now()+7*864e5}`;return b+'.'+sign(b);};
const who=req=>{const m=/(?:^|; )token=([^;]+)/.exec(req.headers.cookie||'');if(!m)return null;const p=m[1].split('.');if(p.length!==4)return null;
  const[role,uid,exp,sig]=p;if(!(Number(exp)>Date.now())||!same(sig,sign(`${role}.${uid}.${exp}`)))return null;
  if(role==='admin')return{role,id:0,name:'Administrador'};
  const u=role==='journalist'&&db.prepare('SELECT id,name FROM users WHERE id=? AND active=1').get(Number(uid));
  return u?{role,id:u.id,name:u.name}:null;};
const auth=(req,res,next)=>{const u=who(req);if(!u)return res.status(401).json({error:'No autorizado'});req.user=u;next();};
const adminOnly=(req,res,next)=>auth(req,res,()=>req.user.role==='admin'?next():res.status(403).json({error:'Solo el administrador puede hacer esto'}));
const KINDS={'image/jpeg':['jpg',b=>b[0]===0xFF&&b[1]===0xD8],'image/png':['png',b=>b.slice(1,4).toString()==='PNG'],'image/webp':['webp',b=>b.slice(0,4).toString()==='RIFF'&&b.slice(8,12).toString()==='WEBP']};
app.post('/api/upload',auth,express.raw({type:Object.keys(KINDS),limit:'8mb'}),(req,res)=>{
  const k=KINDS[req.headers['content-type']];
  if(!k||!Buffer.isBuffer(req.body)||!req.body.length||!k[1](req.body))return res.status(400).json({error:'Sube una imagen JPG, PNG o WebP de hasta 8 MB'});
  const name=crypto.randomBytes(12).toString('hex')+'.'+k[0];
  fs.writeFileSync(path.join(UP,name),req.body);
  res.json({url:'/uploads/'+name});
});
app.post('/api/login',(req,res)=>{
  const{user,pass}=req.body||{};
  setTimeout(()=>{
    let role=null,uid=0;
    if(same(user,USER)&same(pass,PASS))role='admin';
    else{const u=db.prepare('SELECT id,pass FROM users WHERE username=? AND active=1').get(String(user||'').trim().toLowerCase());
      if(u&&okPw(pass,u.pass)){role='journalist';uid=u.id;}}
    if(!role)return res.status(401).json({error:'Usuario o contraseña incorrectos'});
    res.setHeader('Set-Cookie',`token=${mk(role,uid)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${req.secure?'; Secure':''}`);
    res.json({ok:true,role});
  },600);
});
app.post('/api/logout',(req,res)=>{res.setHeader('Set-Cookie','token=; Path=/; Max-Age=0');res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>res.json(req.user));
app.get('/api/categories',(req,res)=>res.json(db.prepare('SELECT DISTINCT category c FROM articles ORDER BY c').all().map(r=>r.c)));
const COLS='id,title,summary,category,image,created_at,featured';
app.get('/api/articles',(req,res)=>{const c=req.query.category;
  res.json(c?db.prepare(`SELECT ${COLS} FROM articles WHERE category=? ORDER BY id DESC`).all(c):db.prepare(`SELECT ${COLS} FROM articles ORDER BY id DESC`).all());});
app.get('/api/articles/:id',(req,res)=>{const a=db.prepare('SELECT a.*,u.name AS author_name FROM articles a LEFT JOIN users u ON u.id=a.author_id WHERE a.id=?').get(Number(req.params.id));a?res.json(a):res.status(404).json({error:'No encontrada'});});
const SAN={allowedTags:['p','br','strong','b','em','i','u','s','a','ul','ol','li','blockquote','h2','h3','h4','figure','figcaption','img'],
  allowedAttributes:{a:['href','target','rel'],img:['src','alt','width','height']},
  allowedClasses:{figure:['image','image-style-*','image_resized']},
  allowedSchemes:['http','https','mailto'],allowedSchemesByTag:{img:['http','https']},
  transformTags:{a:sanitizeHtml.simpleTransform('a',{rel:'noopener noreferrer',target:'_blank'})}};
const clean=b=>{const t=(v,n)=>String(v||'').trim().slice(0,n);const img=t(b.image,500);
  return{title:t(b.title,200),photo_credit:t(b.photo_credit,120),summary:t(b.summary,400),body:sanitizeHtml(t(b.body,60000).replace(/&nbsp;|\u00a0/g,' '),SAN).trim(),category:t(b.category,40)||'General',image:/^(https?:\/\/|\/)/.test(img)?img:''};};
const SQL_SET='title=@title,summary=@summary,body=@body,category=@category,image=@image,photo_credit=@photo_credit';
const authorOf=(req,b)=>{if(req.user.role==='journalist')return{author_id:req.user.id,author:req.user.name};
  const id=Number(b.author_id)||null,u=id&&db.prepare('SELECT name FROM users WHERE id=?').get(id);
  return u?{author_id:id,author:u.name}:{author_id:null,author:String(b.author||'').trim().slice(0,80)};};
app.post('/api/articles',auth,(req,res)=>{const a=clean(req.body||{});if(!a.title||!a.body)return res.status(400).json({error:'El título y el texto son obligatorios'});
  const f=req.user.role==='admin'&&(req.body||{}).featured?1:0;
  const r=db.prepare('INSERT INTO articles(title,summary,body,category,image,photo_credit,author,author_id,featured) VALUES(@title,@summary,@body,@category,@image,@photo_credit,@author,@author_id,@featured)').run({...a,...authorOf(req,req.body||{}),featured:f});
  const id=Number(r.lastInsertRowid);if(f)db.prepare('UPDATE articles SET featured=0 WHERE id<>?').run(id);res.json({id});});
app.put('/api/articles/:id',auth,(req,res)=>{const a=clean(req.body||{});if(!a.title||!a.body)return res.status(400).json({error:'El título y el texto son obligatorios'});
  const id=Number(req.params.id),cur=db.prepare('SELECT author_id FROM articles WHERE id=?').get(id);if(!cur)return res.status(404).json({error:'No encontrada'});
  if(req.user.role==='journalist'){if(cur.author_id!==req.user.id)return res.status(403).json({error:'Solo puedes editar tus propias noticias'});
    db.prepare(`UPDATE articles SET ${SQL_SET} WHERE id=@id`).run({...a,id});}
  else{const f=(req.body||{}).featured?1:0;
    db.prepare(`UPDATE articles SET ${SQL_SET},author=@author,author_id=@author_id,featured=@featured WHERE id=@id`).run({...a,...authorOf(req,req.body||{}),featured:f,id});
    if(f)db.prepare('UPDATE articles SET featured=0 WHERE id<>?').run(id);}
  res.json({ok:true});});
app.delete('/api/articles/:id',adminOnly,(req,res)=>{db.prepare('DELETE FROM articles WHERE id=?').run(Number(req.params.id));res.json({ok:true});});
app.post('/api/articles/:id/view',(req,res)=>{const id=Number(req.params.id);
  if(Number.isInteger(id)&&db.prepare('SELECT 1 FROM articles WHERE id=?').get(id))db.prepare("INSERT INTO hits(article_id,day,n) VALUES(?,date('now'),1) ON CONFLICT(article_id,day) DO UPDATE SET n=n+1").run(id);
  res.json({ok:true});});
app.get('/api/popular',(req,res)=>res.json(db.prepare("SELECT a.id,a.title,a.category,a.created_at,SUM(h.n) v FROM hits h JOIN articles a ON a.id=h.article_id WHERE h.day>=date('now','-7 days') GROUP BY a.id ORDER BY v DESC,a.id DESC LIMIT 5").all()));
app.get('/api/search',(req,res)=>{const t=String(req.query.q||'').trim().slice(0,60);if(!t)return res.json([]);
  const q='%'+t.replace(/[\\%_]/g,'\\$&')+'%';
  res.json(db.prepare(`SELECT ${COLS} FROM articles WHERE title LIKE ?1 ESCAPE '\\' OR summary LIKE ?1 ESCAPE '\\' OR body LIKE ?1 ESCAPE '\\' ORDER BY id DESC LIMIT 30`).all(q));});
const WK=['marcador','tabla-nacional','tabla-premier','tabla-laliga','fichajes-nacional','fichajes-europeo'];
app.get('/api/widgets',(req,res)=>{const o={};WK.forEach(k=>o[k]='');db.prepare('SELECT k,v FROM widgets').all().forEach(r=>{if(WK.includes(r.k))o[r.k]=r.v;});res.json(o);});
app.put('/api/widgets/:k',adminOnly,(req,res)=>{if(!WK.includes(req.params.k))return res.status(404).json({error:'No existe'});
  const v=String((req.body||{}).v||'').slice(0,6000);
  db.prepare('INSERT INTO widgets(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(req.params.k,v);res.json({ok:true});});
const UN=/^[a-z0-9._-]{3,30}$/,cl=(v,n)=>String(v||'').trim().slice(0,n);
app.get('/api/users',adminOnly,(req,res)=>res.json(db.prepare('SELECT id,username,name,bio,active FROM users ORDER BY name').all()));
app.post('/api/users',adminOnly,(req,res)=>{const b=req.body||{},un=cl(b.username,30).toLowerCase(),name=cl(b.name,80),pw=String(b.password||'');
  if(!UN.test(un)||un===USER.toLowerCase())return res.status(400).json({error:'Usuario no válido: usa de 3 a 30 letras minúsculas, números, punto o guion'});
  if(!name)return res.status(400).json({error:'El nombre es obligatorio'});
  if(pw.length<8)return res.status(400).json({error:'La contraseña debe tener al menos 8 caracteres'});
  try{const r=db.prepare('INSERT INTO users(username,name,bio,pass) VALUES(?,?,?,?)').run(un,name,cl(b.bio,600),hashPw(pw));res.json({id:Number(r.lastInsertRowid)});}
  catch{res.status(400).json({error:'Ese nombre de usuario ya existe'});}});
app.put('/api/users/:id',adminOnly,(req,res)=>{const b=req.body||{},id=Number(req.params.id),name=cl(b.name,80),pw=String(b.password||'');
  if(!name)return res.status(400).json({error:'El nombre es obligatorio'});
  if(pw&&pw.length<8)return res.status(400).json({error:'La contraseña debe tener al menos 8 caracteres'});
  db.prepare('UPDATE users SET name=?,bio=?,active=? WHERE id=?').run(name,cl(b.bio,600),b.active?1:0,id);
  if(pw)db.prepare('UPDATE users SET pass=? WHERE id=?').run(hashPw(pw),id);
  res.json({ok:true});});
app.get('/api/authors/:id',(req,res)=>{const u=db.prepare('SELECT id,name,bio FROM users WHERE id=?').get(Number(req.params.id));if(!u)return res.status(404).json({error:'No encontrado'});
  res.json({id:u.id,name:u.name,bio:u.bio,articles:db.prepare(`SELECT ${COLS} FROM articles WHERE author_id=? ORDER BY id DESC LIMIT 60`).all(u.id)});});
/* ===== Páginas con URL limpia, etiquetas para Google y redes, sitemap ===== */
const CATS=['Selección','Fútbol Nacional','Premier League','La Liga','Rumores de Fichajes'];
const SOC={ig:'https://www.instagram.com/LoQuePasa/',x:'https://x.com/LoQuePasa'};
const slug=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80).replace(/-+$/,'');
const ws=(id,t)=>id+(slug(t)?'-'+slug(t):'');
const eh=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const baseUrl=req=>(process.env.SITE_URL||`${req.protocol}://${req.get('host')}`).replace(/\/+$/,'');
const absUrl=(b,u)=>!u?b+'/logo.png':/^https?:/i.test(u)?u:b+u;
const plain=h=>String(h||'').replace(/<[^>]+>/g,' ').replace(/&[a-z#0-9]+;/gi,' ').replace(/\s+/g,' ').trim();
const iso=d=>String(d).replace(' ','T')+'Z';
const aurl=a=>'/noticia/'+ws(a.id,a.title);
const lista=rows=>`<ul>${rows.map(a=>`<li><a href="${aurl(a)}">${eh(a.title)}</a></li>`).join('')}</ul>`;
let TPL={t:0,s:''};
const shell=()=>{const f=path.join(__dirname,'public','index.html'),m=fs.statSync(f).mtimeMs;if(m!==TPL.t)TPL={t:m,s:fs.readFileSync(f,'utf8')};return TPL.s;};
const orgLd=b=>({'@type':'Organization',name:'LoQuePasa',url:b+'/',logo:{'@type':'ImageObject',url:b+'/logo.png'},sameAs:[SOC.ig,SOC.x]});
function page(req,res,o){const b=baseUrl(req),url=b+(o.url||'/'),img=absUrl(b,o.image),ot=o.ogTitle||o.title;
  const m=[`<title>${eh(o.title)}</title>`,`<meta name="description" content="${eh(o.desc)}">`,`<link rel="canonical" href="${eh(url)}">`];
  if(o.robots)m.push(`<meta name="robots" content="${o.robots}">`);
  m.push('<meta property="og:site_name" content="LoQuePasa">','<meta property="og:locale" content="es_CL">',`<meta property="og:type" content="${o.type||'website'}">`,`<meta property="og:title" content="${eh(ot)}">`,`<meta property="og:description" content="${eh(o.desc)}">`,`<meta property="og:url" content="${eh(url)}">`,`<meta property="og:image" content="${eh(img)}">`,
    '<meta name="twitter:card" content="summary_large_image">','<meta name="twitter:site" content="@LoQuePasa">',`<meta name="twitter:title" content="${eh(ot)}">`,`<meta name="twitter:description" content="${eh(o.desc)}">`,`<meta name="twitter:image" content="${eh(img)}">`);
  if(o.extra)m.push(...o.extra);
  if(o.ld)m.push(`<script type="application/ld+json">${JSON.stringify(o.ld).replace(/</g,'\\u003c')}</script>`);
  res.status(o.status||200).type('html').send(shell().replace(/<title>[\s\S]*?<\/title>/,()=>m.join('\n')).replace('<!--APP-->',()=>o.body||''));}
const nf=(req,res)=>page(req,res,{status:404,title:'No encontrada | LoQuePasa',desc:'La página que buscas no existe.',robots:'noindex',url:req.path});
app.get('/',(req,res)=>{const b=baseUrl(req),rows=db.prepare(`SELECT ${COLS} FROM articles ORDER BY id DESC LIMIT 20`).all();
  page(req,res,{title:'LoQuePasa | Noticias de fútbol',desc:'Noticias de fútbol: Selección, fútbol nacional, Premier League, La Liga y rumores de fichajes.',url:'/',
    ld:{'@context':'https://schema.org','@type':'WebSite',name:'LoQuePasa',url:b+'/',publisher:orgLd(b)},body:`<h1>LoQuePasa</h1>${lista(rows)}`});});
app.get('/noticia/:slug',(req,res)=>{const id=parseInt(req.params.slug,10);
  const a=id&&db.prepare('SELECT a.*,u.name AS author_name FROM articles a LEFT JOIN users u ON u.id=a.author_id WHERE a.id=?').get(id);
  if(!a)return nf(req,res);
  const want=ws(a.id,a.title);if(req.params.slug!==want)return res.redirect(301,'/noticia/'+want);
  const b=baseUrl(req),au=a.author_name||a.author||'',txt=plain(a.body),desc=(a.summary||txt).slice(0,200),img=a.image?absUrl(b,a.image):'';
  const body=/^\s*</.test(a.body)?a.body:eh(a.body).split(/\n{2,}/).map(p=>'<p>'+p.replace(/\n/g,'<br>')+'</p>').join('');
  page(req,res,{title:`${a.title} | LoQuePasa`,ogTitle:a.title,desc,url:'/noticia/'+want,image:a.image,type:'article',
    extra:[`<meta property="article:published_time" content="${iso(a.created_at)}">`,`<meta property="article:section" content="${eh(a.category)}">`,...(au?[`<meta property="article:author" content="${eh(au)}">`]:[])],
    ld:{'@context':'https://schema.org','@type':'NewsArticle',headline:a.title.slice(0,110),description:desc,mainEntityOfPage:b+'/noticia/'+want,datePublished:iso(a.created_at),articleSection:a.category,
      ...(img?{image:[img]}:{}),...(au?{author:[{'@type':'Person',name:au}]}:{}),publisher:orgLd(b)},
    body:`<article><h1>${eh(a.title)}</h1><p>${eh(a.summary)}</p>${img?`<img src="${eh(img)}" alt="${eh(a.title)}">`:''}${body}</article>`});});
app.get('/categoria/:slug',(req,res)=>{const cats=[...new Set([...CATS,...db.prepare('SELECT DISTINCT category c FROM articles').all().map(r=>r.c)])],cat=cats.find(c=>slug(c)===req.params.slug);
  if(!cat)return nf(req,res);
  const rows=db.prepare(`SELECT ${COLS} FROM articles WHERE category=? ORDER BY id DESC LIMIT 30`).all(cat);
  page(req,res,{title:`${cat} | LoQuePasa`,desc:`Últimas noticias de ${cat}.`,url:'/categoria/'+slug(cat),body:`<h1>${eh(cat)}</h1>${lista(rows)}`});});
app.get('/periodista/:slug',(req,res)=>{const id=parseInt(req.params.slug,10),u=id&&db.prepare('SELECT id,name,bio FROM users WHERE id=?').get(id);
  if(!u)return nf(req,res);
  const want=ws(u.id,u.name);if(req.params.slug!==want)return res.redirect(301,'/periodista/'+want);
  const rows=db.prepare(`SELECT ${COLS} FROM articles WHERE author_id=? ORDER BY id DESC LIMIT 30`).all(u.id),b=baseUrl(req);
  page(req,res,{title:`${u.name} | LoQuePasa`,desc:(u.bio||`Noticias escritas por ${u.name}.`).slice(0,200),url:'/periodista/'+want,
    ld:{'@context':'https://schema.org','@type':'ProfilePage',mainEntity:{'@type':'Person',name:u.name,description:u.bio||undefined,worksFor:orgLd(b)}},
    body:`<h1>${eh(u.name)}</h1><p>${eh(u.bio)}</p>${lista(rows)}`});});
app.get('/buscar',(req,res)=>page(req,res,{title:'Buscar | LoQuePasa',desc:'Busca noticias en LoQuePasa.',robots:'noindex,follow',url:'/buscar'}));
app.get('/sitemap.xml',(req,res)=>{const b=baseUrl(req),u=[{l:b+'/'},...CATS.map(c=>({l:b+'/categoria/'+slug(c)})),
    ...db.prepare('SELECT id,title,created_at FROM articles ORDER BY id DESC LIMIT 2000').all().map(a=>({l:b+aurl(a),t:String(a.created_at).slice(0,10)})),
    ...db.prepare('SELECT id,name FROM users').all().map(x=>({l:b+'/periodista/'+ws(x.id,x.name)}))];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u.map(x=>`<url><loc>${eh(x.l)}</loc>${x.t?`<lastmod>${x.t}</lastmod>`:''}</url>`).join('')}</urlset>`);});
app.get('/robots.txt',(req,res)=>res.type('text/plain').send(`User-agent: *\nDisallow: /admin.html\nDisallow: /periodista.html\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`));
app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.status===413?'La imagen pesa más de 8 MB':'Ocurrió un error'}));
app.listen(PORT,()=>console.log('Listo en http://localhost:'+PORT));
