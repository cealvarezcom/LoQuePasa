const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(u,o={})=>{const r=await fetch(u,{headers:{'Content-Type':'application/json'},...o,body:o.body&&JSON.stringify(o.body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Ocurrió un error');return d;};
const toHtml=t=>/^\s*</.test(t||'')?t:esc(t).split(/\n{2,}/).map(p=>`<p>${p.replace(/\n/g,'<br>')}</p>`).join('');
let ED=null,ME=null;
const upload=async f=>{const r=await fetch('/api/upload',{method:'POST',headers:{'Content-Type':f.type},body:f});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'No se pudo subir la foto');return d.url;};
function setImg(u){$('#image').value=u||'';$('#prev').hidden=!u;$('#pimg').src=u||'';}
function initEditor(){
  if(ED)return;
  if(!window.Quill){$('#msg').textContent='No se pudo cargar el editor (revisa tu conexión a internet).';return;}
  ED=new Quill('#body',{theme:'snow',placeholder:'Escribe la noticia aquí...',modules:{toolbar:{
    container:[[{header:[2,3,false]}],['bold','italic','underline'],['link','blockquote'],[{list:'ordered'},{list:'bullet'}],['image','clean']],
    handlers:{image(){const i=document.createElement('input');i.type='file';i.accept='image/jpeg,image/png,image/webp';
      i.onchange=async()=>{const f=i.files[0];if(!f)return;$('#msg').textContent='Subiendo foto...';
        try{const u=await upload(f),r=ED.getSelection(true);ED.insertEmbed(r.index,'image',u,'user');ED.setSelection(r.index+1);$('#msg').textContent='Foto agregada';}catch(x){$('#msg').textContent=x.message;}};
      i.click();}}}}});
  $('#file').onchange=async e=>{const f=e.target.files[0];if(!f)return;$('#msg').textContent='Subiendo foto...';
    try{setImg(await upload(f));$('#msg').textContent='Foto lista';}catch(x){$('#msg').textContent=x.message;}e.target.value='';};
  $('#rm').onclick=()=>setImg('');
}
/* Inicio de sesión: role = 'admin' o 'journalist' */
function start(role,ready){
  const show=on=>{$('#login').hidden=on;$('#panel').hidden=!on;$('#out').hidden=!on;};
  const enter=async()=>{
    try{ME=await api('/api/me');}catch{show(false);return;}
    if(ME.role!==role){show(false);$('#lerr').textContent=role==='admin'?'Esa cuenta es de periodista. Los periodistas entran por /periodista.html':'Esa cuenta es de administrador. Entra por /admin.html';return;}
    show(true);ready();};
  $('#login').onsubmit=async e=>{e.preventDefault();$('#lerr').textContent='';
    try{await api('/api/login',{method:'POST',body:{user:$('#u').value,pass:$('#p').value}});$('#p').value='';await enter();}catch(x){$('#lerr').textContent=x.message;}};
  $('#out').onclick=async()=>{await api('/api/logout',{method:'POST'});show(false);};
  enter();
}
/* Formulario de noticias (compartido) */
const F=['title','category','image','photo_credit','summary'];
function resetForm(){$('#f').reset();$('#id').value='';setImg('');ED&&ED.setText('');$('#save').textContent='Publicar noticia';$('#cancel').hidden=true;if(typeof hookReset==='function')hookReset();}
async function fillForm(id){const a=await api('/api/articles/'+id);F.forEach(k=>$('#'+k).value=a[k]||'');$('#id').value=a.id;setImg(a.image);
  ED&&ED.setContents(ED.clipboard.convert({html:toHtml(a.body)}),'silent');
  $('#save').textContent='Guardar cambios';$('#cancel').hidden=false;if(typeof hookFill==='function')hookFill(a);scrollTo(0,0);}
function bindForm(extra,after){
  $('#cancel').onclick=resetForm;
  $('#f').onsubmit=async e=>{e.preventDefault();const id=$('#id').value,body={};F.forEach(k=>body[k]=$('#'+k).value);
    body.body=ED?ED.getSemanticHTML().replace(/&nbsp;/g,' '):'';if(extra)Object.assign(body,extra());
    if(ED&&!ED.getText().trim()&&!/<img/.test(body.body)){$('#msg').textContent='Escribe el texto de la noticia';return;}
    if(/src="data:/.test(body.body)){$('#msg').textContent='Agrega las fotos con el botón de imagen de la barra del editor, no pegándolas.';return;}
    try{await api(id?'/api/articles/'+id:'/api/articles',{method:id?'PUT':'POST',body});$('#msg').textContent=id?'Cambios guardados':'Noticia publicada';resetForm();if(after)after();}catch(x){$('#msg').textContent=x.message;}};
}
