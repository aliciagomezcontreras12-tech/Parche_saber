'use strict';

const runtimeConfig = window.PARCHE_SABER_CONFIG;
if (!runtimeConfig?.supabaseUrl || !runtimeConfig?.supabasePublishableKey) {
  throw new Error('Falta la configuración pública de Supabase. Revisa config.js.');
}
const SUPABASE_URL = runtimeConfig.supabaseUrl;
const SUPABASE_PUBLISHABLE_KEY = runtimeConfig.supabasePublishableKey;
window.parcheSupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
const supabaseClient = window.parcheSupabaseClient;

const BUCKETS = { avatar:'profile-images', question:'question-images', resource:'learning-materials' };
const GRADES_FALLBACK = ['6°','7°','8°','9°','10°','11°'];
const LEVELS = [
  {min:0,name:'Novato',icon:'🌱'},
  {min:120,name:'Aprendiz',icon:'📗'},
  {min:300,name:'Explorador',icon:'🧭'},
  {min:550,name:'Pro',icon:'🚀'},
  {min:850,name:'Crack Saber',icon:'🏆'}
];
const ACHIEVEMENTS = [
  {id:'first-q',icon:'🥇',title:'Primera pregunta',desc:'Respondiste tu primera pregunta.',check:p=>Object.keys(p.answered||{}).length>=1},
  {id:'10-q',icon:'🔟',title:'10 preguntas',desc:'Respondiste 10 preguntas.',check:p=>Object.keys(p.answered||{}).length>=10},
  {id:'50-q',icon:'💯',title:'50 preguntas',desc:'Respondiste 50 preguntas.',check:p=>Object.keys(p.answered||{}).length>=50},
  {id:'100-q',icon:'💎',title:'100 preguntas',desc:'Respondiste 100 preguntas.',check:p=>Object.keys(p.answered||{}).length>=100},
  {id:'10-correct',icon:'✅',title:'10 aciertos',desc:'Lograste 10 respuestas correctas.',check:p=>(p.correct_count||0)>=10},
  {id:'50-correct',icon:'🏅',title:'50 aciertos',desc:'Lograste 50 respuestas correctas.',check:p=>(p.correct_count||0)>=50},
  {id:'first-topic',icon:'📘',title:'Primer tema',desc:'Estudiaste un tema.',check:p=>Object.keys(p.visitedSections||{}).length>=1},
  {id:'first-test',icon:'📝',title:'Primer test',desc:'Completaste un test.',check:p=>Object.keys(p.testsCompleted||{}).length>=1},
  {id:'first-exam',icon:'📑',title:'Primer examen',desc:'Completaste un examen.',check:p=>Object.keys(p.examsCompleted||{}).length>=1},
  {id:'first-sim',icon:'⏱️',title:'Primer simulacro',desc:'Terminaste un simulacro.',check:p=>(p.simulacroHistory||[]).length>=1},
  {id:'all-subjects',icon:'🧭',title:'Explorador completo',desc:'Respondiste al menos una pregunta en todas las materias.',check:p=>SUBJECTS.length>0&&SUBJECTS.every(s=>questionsBySubject(s.id).some(q=>p.answered[q.id]!==undefined))},
];

let CURRENT_USER=null;
let PROFILE=null;
let PROGRESS=defaultProgress();
let SUBJECTS=[];let TOPICS=[];let CONCEPTS=[];let QUESTIONS=[];let RESOURCES=[];let TESTS=[];let EXAMS=[];let SIMULACROS=[];let GRADES=[];
const CONCEPT_INDEX={};
let currentView='inicio';
let regRole='student';
let feedbackState={pool:[],idx:0,answers:{},mode:'practica',meta:{}};
let deferredState={pool:[],idx:0,answers:{},mode:'exam',meta:{},finished:false};
let reviewState={pool:[],idx:0,filter:'all'};
let examGuard=null;

function defaultProgress(){return {name:'Estudiante',grade_id:null,studied_concepts:{},answered:{},correct_count:0,wrong_count:0,wrong_ids:{},mastered_questions:{},last_topic:null,simulacro_history:[],tests_completed:{},exams_completed:{},visited_sections:{},achievements:{},xp:0,activity_log:[],review_attempts:{}};}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function userFriendlyError(err,fallback='Ocurrió un problema.'){const msg=String(err?.message||'').toLowerCase();if(msg.includes('invalid login credentials'))return 'El correo o la contraseña son incorrectos.';if(msg.includes('user already registered')||msg.includes('already been registered'))return 'Ese correo ya tiene una cuenta registrada.';if(msg.includes('password'))return 'La contraseña no cumple los requisitos solicitados.';if(msg.includes('email'))return 'Revisa que el correo electrónico esté escrito correctamente.';if(msg.includes('row-level security')||msg.includes('permission denied')||msg.includes('forbidden')||msg.includes('403'))return 'No tienes permiso para realizar esta acción.';if(msg.includes('duplicate key'))return 'Ese registro ya existe.';if(msg.includes('failed to fetch')||msg.includes('network'))return 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente.';return fallback}

function uid(prefix){return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;}
function materialDedupeKey(row){return [row.subject_id,row.grade_id,row.topic_id||'',row.type||'',String(row.title||'').trim().toLowerCase(),String(row.url||'').trim(),String(row.file_url||'').trim()].join('|');}
function toast(msg){const el=document.createElement('div');el.className='toast';el.textContent=msg;document.getElementById('toastStack').appendChild(el);setTimeout(()=>el.remove(),3200)}
function notify(title,message,type='success'){const box=document.getElementById('notifyBox');box.innerHTML=`<h3>${esc(title)}</h3><p>${esc(message)}</p><button class="btn btn-primary" id="notifyOk">Entendido</button>`;document.getElementById('notifyBackdrop').classList.add('show');document.getElementById('notifyOk').onclick=()=>document.getElementById('notifyBackdrop').classList.remove('show');}
function closeModal(){document.getElementById('modalBackdrop').classList.remove('show')}
function openModal(html){document.getElementById('modalBox').innerHTML=`<button class="modal-close" id="modalClose">✕</button>${html}`;document.getElementById('modalBackdrop').classList.add('show');document.getElementById('modalClose').onclick=closeModal}
function confirmBox(title,message){return new Promise(resolve=>{openModal(`<h3>${esc(title)}</h3><p class="muted">${esc(message)}</p><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button class="btn btn-ghost" id="noBtn">Cancelar</button><button class="btn btn-danger" id="yesBtn">Confirmar</button></div>`);document.getElementById('noBtn').onclick=()=>{closeModal();resolve(false)};document.getElementById('yesBtn').onclick=()=>{closeModal();resolve(true)}})}
function getLevel(xp){let out=LEVELS[0],i=0;LEVELS.forEach((l,n)=>{if(xp>=l.min){out=l;i=n}});return {index:i,...out,next:LEVELS[i+1]||null}}
function overallAccuracy(){const t=(PROGRESS.correct_count||0)+(PROGRESS.wrong_count||0);return t?Math.round(PROGRESS.correct_count/t*100):0}
function subjectById(id){return SUBJECTS.find(s=>s.id===id)}
function topicById(id){return TOPICS.find(t=>t.id===id)}
function topicsBySubject(id){return TOPICS.filter(t=>t.subject_id===id)}
function questionsBySubject(id){return QUESTIONS.filter(q=>q.subject_id===id)}
function questionsByTopic(id){return QUESTIONS.filter(q=>q.topic_id===id)}
function resourcesBySubject(id){return RESOURCES.filter(r=>r.subject_id===id)}
function testsBySubject(id){return TESTS.filter(t=>t.subject_id===id&&t.published)}
function examsBySubject(id){return EXAMS.filter(e=>e.subject_id===id&&e.published)}
function getGrade(id){return GRADES.find(g=>g.id===id)}
function normalizeGradeName(id){return getGrade(id)?.name||''}
// Global: lo usan los renderers del docente (tInicio, tGrupos) que viven fuera del IIFE donde antes estaba definida.
function gradeName(id){return normalizeGradeName(id)||id||''}

async function dbList(table, queryCb){let q=supabaseClient.from(table).select('*');if(queryCb)q=queryCb(q);const {data,error}=await q;if(error){console.error('dbList('+table+'):',error);return []}return data||[]}
async function reloadContent(){
  [GRADES,SUBJECTS,TOPICS,CONCEPTS,QUESTIONS,RESOURCES,TESTS,EXAMS,SIMULACROS]=await Promise.all([
    dbList('grades',q=>q.order('sort_order')),
    dbList('subjects',q=>q.order('sort_order')),
    dbList('topics',q=>q.order('sort_order')),
    dbList('concepts'),
    dbList('questions',q=>q.is('deleted_at',null).order('created_at',{ascending:false})),
    dbList('learning_resources',q=>q.is('deleted_at',null).order('created_at',{ascending:false})),
    dbList('tests',q=>q.order('created_at',{ascending:false})),
    dbList('exams',q=>q.order('created_at',{ascending:false})),
    dbList('simulacros',q=>q.order('created_at',{ascending:false}))
  ]);
  Object.keys(CONCEPT_INDEX).forEach(k=>delete CONCEPT_INDEX[k]);CONCEPTS.forEach(c=>CONCEPT_INDEX[c.id]=c);
  seedLocalQuestions();
}
// Mezcla preguntas incluidas en preguntas_semilla.js (si el archivo está presente) dentro de
// TOPICS/QUESTIONS en memoria, emparejando por nombre real de materia/grado ya cargados desde
// Supabase. No escribe nada en la base de datos: son preguntas "de fábrica" que vienen con el
// código, así que aparecen aunque nadie las haya cargado a Supabase. Seguro llamarlo varias veces
// (no duplica).
function seedLocalQuestions(){
  const seed = window.PARCHE_SABER_SEED_QUESTIONS;
  if(!seed) return;
  const normTxt = s => (s||'').toLowerCase().trim();
  function findSubjectId(materiaPdf){
    let exact = SUBJECTS.find(s=>normTxt(s.name)===normTxt(materiaPdf));
    if(exact) return exact.id;
    if(normTxt(materiaPdf)==='lengua castellana'){
      let lc = SUBJECTS.find(s=>normTxt(s.name).includes('lectura')||normTxt(s.name).includes('lengua'));
      if(lc) return lc.id;
    }
    let partial = SUBJECTS.find(s=>normTxt(s.name).includes(normTxt(materiaPdf))||normTxt(materiaPdf).includes(normTxt(s.name)));
    return partial?partial.id:null;
  }
  function findGradeId(gradoLabel){
    let g = GRADES.find(g=>normTxt(g.name)===normTxt(gradoLabel));
    if(g) return g.id;
    const digits = (s)=>(String(s||'').match(/\d+/)||[])[0];
    const wanted = digits(gradoLabel);
    if(wanted){
      g = GRADES.find(g=>digits(g.name)===wanted);
      if(g) return g.id;
    }
    return null;
  }
  Object.keys(seed).forEach(key=>{
    (seed[key]||[]).forEach(r=>{
      const subject_id = findSubjectId(r.materia_pdf);
      const grade_id = findGradeId(r.grado);
      if(!subject_id||!grade_id) return;
      let topic = TOPICS.find(t=>t.subject_id===subject_id&&t.grade_id===grade_id&&normTxt(t.title)===normTxt(r.tema));
      if(!topic){
        topic = {id:'seed-topic-'+Math.random().toString(36).slice(2,10),subject_id,grade_id,title:r.tema,description:'',content:'',sort_order:0,_seed:true};
        TOPICS.push(topic);
      }
      const already = QUESTIONS.some(q=>q.subject_id===subject_id&&q.grade_id===grade_id&&normTxt(q.question)===normTxt(r.enunciado)&&JSON.stringify(q.options)===JSON.stringify(r.opciones));
      if(already) return;
      QUESTIONS.push({
        id:'seed-question-'+Math.random().toString(36).slice(2,10),
        subject_id, grade_id, topic_id:topic.id,
        difficulty:r.dificultad, question:r.enunciado, options:r.opciones, correct:r.correcta,
        why:r.explicacion, why_wrong:r.why_wrong||{}, created_by:'seed-local', image_url:null, deleted_at:null,
        _seed:true
      });
    });
  });
}
async function getSignedUrl(bucket,path){if(!path)return null;const {data,error}=await supabaseClient.storage.from(bucket).createSignedUrl(path,3600);if(error){console.error(error);return null}return data?.signedUrl||null}
async function loadProfile(userId){const {data,error}=await supabaseClient.from('profiles').select('*').eq('id',userId).maybeSingle();if(error)throw error;if(data)return data;return null}
async function ensureProfile(user){
  let p=await loadProfile(user.id);
  const meta=user.user_metadata||{};
  const requestedRole=meta.role==='teacher'?'teacher':'student';
  if(!p){
    const row={id:user.id,name:meta.name||user.email?.split('@')[0]||'Usuario',role:requestedRole,
      grade_id:requestedRole==='student'?(meta.grade_id||null):null,
      section:requestedRole==='student'?(meta.section||null):null,
      first_name:meta.first_name||null,last_name:meta.last_name||null};
    const {data,error}=await supabaseClient.from('profiles').insert(row).select().single();
    if(error)throw error;p=data;
  }else{
    const patch={};
    if(!p.first_name&&meta.first_name)patch.first_name=meta.first_name;
    if(!p.last_name&&meta.last_name)patch.last_name=meta.last_name;
    if((!p.name||p.name===user.email?.split('@')[0])&&meta.name)patch.name=meta.name;
    if(p.role==='student'){
      if(!p.grade_id&&meta.grade_id)patch.grade_id=meta.grade_id;
      if(!p.section&&meta.section)patch.section=meta.section;
    }else if(p.role==='teacher'){
      if(p.grade_id!==null)patch.grade_id=null;
      if(p.section!==null)patch.section=null;
    }
    if(Object.keys(patch).length){const {data,error}=await supabaseClient.from('profiles').update(patch).eq('id',user.id).select().single();if(error)throw error;p=data;}
  }
  return p;
}
function progressFromRow(row){if(!row)return defaultProgress();return {name:row.name||PROFILE?.name||'Estudiante',grade_id:row.grade_id||PROFILE?.grade_id||null,studied_concepts:row.studied_concepts||{},answered:row.answered||{},correct_count:row.correct_count||0,wrong_count:row.wrong_count||0,wrong_ids:row.wrong_ids||{},mastered_questions:row.mastered_questions||{},last_topic:row.last_topic||null,simulacro_history:row.simulacro_history||[],tests_completed:row.tests_completed||{},exams_completed:row.exams_completed||{},visited_sections:row.visited_sections||{},achievements:row.achievements||{},xp:row.xp||0,activity_log:row.activity_log||[],review_attempts:row.review_attempts||{}}}
async function loadProgress(){if(!CURRENT_USER||CURRENT_USER.role!=='student'){PROGRESS=defaultProgress();return}const {data,error}=await supabaseClient.from('student_progress').select('*').eq('user_id',CURRENT_USER.id).maybeSingle();if(error)throw error;PROGRESS=progressFromRow(data)}
async function saveProgress(){if(!CURRENT_USER||CURRENT_USER.role!=='student')return;const row={user_id:CURRENT_USER.id,grade_id:PROGRESS.grade_id,name:PROGRESS.name,studied_concepts:PROGRESS.studied_concepts,answered:PROGRESS.answered,correct_count:PROGRESS.correct_count,wrong_count:PROGRESS.wrong_count,wrong_ids:PROGRESS.wrong_ids,mastered_questions:PROGRESS.mastered_questions,last_topic:PROGRESS.last_topic,simulacro_history:PROGRESS.simulacro_history,tests_completed:PROGRESS.tests_completed,exams_completed:PROGRESS.exams_completed,visited_sections:PROGRESS.visited_sections,achievements:PROGRESS.achievements,xp:PROGRESS.xp,activity_log:PROGRESS.activity_log,review_attempts:PROGRESS.review_attempts};const {error}=await supabaseClient.from('student_progress').upsert(row,{onConflict:'user_id'});if(error)throw error}
async function updateProfile(fields){const {data,error}=await supabaseClient.from('profiles').update(fields).eq('id',CURRENT_USER.id).select().single();if(error)throw error;PROFILE=data}
async function ensureStudentData(){await loadProgress();if(!PROGRESS.grade_id&&PROFILE?.grade_id){PROGRESS.grade_id=PROFILE.grade_id;await saveProgress()}}
async function syncStudentAnswer(q,chosen,contextType,contextId){const row={user_id:CURRENT_USER.id,question_id:q.id,selected_option:chosen,is_correct:chosen===q.correct,context_type:contextType||null,context_id:contextId||null};const {error}=await supabaseClient.from('student_answers').insert(row);if(error)console.error('student_answers:',error)}
function activity(label,icon='✏️'){PROGRESS.activity_log=[{label,icon,date:Date.now()},...(PROGRESS.activity_log||[])].slice(0,20)}
async function addXP(_amount,reason){if(reason)activity(reason,'📚');try{await saveProgress()}catch(e){console.error('Progreso:',e)}try{await checkAchievements()}catch(e){console.error('Logros:',e)}}
async function checkAchievements(){let changed=false;for(const a of ACHIEVEMENTS){if(!PROGRESS.achievements[a.id]&&a.check(PROGRESS)){PROGRESS.achievements[a.id]=Date.now();changed=true;activity(`Logro desbloqueado: ${a.title}`,a.icon)}}if(changed){await saveProgress();toast('🏆 Nuevo logro desbloqueado')}}
async function setTheme(theme){document.documentElement.setAttribute('data-theme',theme);document.getElementById('themeBtn').textContent=`Tema: ${theme==='dark'?'Oscuro':'Claro'}`;try{localStorage.setItem('parche_saber_theme',theme)}catch{} }
function initTheme(){let t;try{t=localStorage.getItem('parche_saber_theme')}catch{};setTheme(t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'))}
function renderGradeOptions(selected=''){const opts=GRADES.length?GRADES:GRADES_FALLBACK.map((name,i)=>({id:name,name,sort_order:i}));return opts.map(g=>`<option value="${esc(g.id)}" ${g.id===selected?'selected':''}>${esc(g.name)}</option>`).join('')}

const STUDENT_NAV=[['inicio','🏠','Inicio'],['materias','📚','Mis materias'],['repaso','🔁','Repasar errores'],['simulacro','⏱️','Simulacro Saber 11'],['progreso','📈','Progreso'],['logros','🏆','Logros'],['perfil','👤','Perfil']];
const TEACHER_NAV=[['tInicio','🏠','Inicio'],['tTemas','🧠','Temas'],['tMaterial','📄','Material de aprendizaje'],['tPreguntas','❓','Banco de preguntas'],['tEvaluaciones','📝','Evaluaciones'],['tResultados','📊','Resultados'],['tPerfil','👤','Perfil']];
const ADMIN_NAV=[['aInicio','🏠','Inicio'],['aUsuarios','👥','Usuarios'],['tPerfil','👤','Perfil']];
function renderNav(){const list=document.getElementById('navList');const nav=CURRENT_USER?.role==='admin'?ADMIN_NAV:CURRENT_USER?.role==='teacher'?TEACHER_NAV:STUDENT_NAV;list.innerHTML=nav.map(([id,icon,label])=>`<button class="navbtn ${id===currentView?'active':''}" data-nav="${id}"><span>${icon}</span>${esc(label)}</button>`).join('');list.querySelectorAll('.navbtn').forEach(b=>b.onclick=()=>guarded(()=>{showView(b.dataset.nav);document.body.classList.remove('sidebar-open');}))}
function guarded(action){if(examGuard&&examGuard()){confirmBox('¿Salir de la evaluación?','Tus respuestas no enviadas podrían perderse.').then(ok=>{if(ok){examGuard=null;action()}})}else action()}
function setMobileSidebar(open){
  if(open) { if(window.openMobileSidebar) window.openMobileSidebar(); else document.body.classList.add('sidebar-open'); }
  else { if(window.closeMobileSidebar) window.closeMobileSidebar(); else document.body.classList.remove('sidebar-open'); }
}
function showView(id,params={}){currentView=id;renderNav();const host=document.getElementById('viewsHost');host.innerHTML='';const v=document.createElement('section');v.className='view';host.appendChild(v);const fn=RENDERERS[id];if(!fn){v.innerHTML='<div class="empty-state">Vista no encontrada.</div>';return}fn(v,params)}
function updateSidebar(){if(!CURRENT_USER)return;const roleFlag=document.getElementById('roleFlag');if(roleFlag)roleFlag.textContent=CURRENT_USER.role==='teacher'?'Panel Docente':`Estudiante${PROGRESS.grade_id?' · Grado '+normalizeGradeName(PROGRESS.grade_id):''}`;const levelMini=document.getElementById('levelMini');if(levelMini)levelMini.classList.toggle('hidden',CURRENT_USER.role==='teacher');if(CURRENT_USER.role==='student'){const l=getLevel(PROGRESS.xp||0);const lmLabel=document.getElementById('lmLabel');const lmXP=document.getElementById('lmXP');const lmFill=document.getElementById('lmFill');if(lmLabel)lmLabel.textContent=`Nivel ${l.index+1} · ${l.name}`;if(lmXP)lmXP.textContent=`${PROGRESS.xp||0} XP`;const pct=l.next?Math.min(100,Math.round(((PROGRESS.xp-l.min)/(l.next.min-l.min))*100)):100;if(lmFill)lmFill.style.width=pct+'%'}const topName=document.getElementById('topName');const topRole=document.getElementById('topRole');if(topName)topName.textContent=fullProfileName();if(topRole)topRole.textContent=CURRENT_USER.role==='teacher'?'Docente':`Nivel ${(getLevel(PROGRESS.xp||0).index+1)}`;loadAvatarInto(document.getElementById('topAvatar'))}
async function loadAvatarInto(el){if(!PROFILE?.avatar_url){el.textContent=fullProfileName().charAt(0).toUpperCase();return}const url=await getSignedUrl(BUCKETS.avatar,PROFILE.avatar_url);if(url)el.innerHTML=`<img alt="Foto de perfil" src="${url}">`;else el.textContent=fullProfileName().charAt(0).toUpperCase()}
function fullProfileName(){const first=String(PROFILE?.first_name||'').trim(),last=String(PROFILE?.last_name||'').trim();return [first,last].filter(Boolean).join(' ')||String(PROFILE?.name||CURRENT_USER?.email?.split('@')[0]||'Usuario');}
async function deleteCurrentAccount(){if(!(await confirmBox('¿Eliminar tu cuenta?','Esta acción es definitiva y eliminará tus datos asociados.')))return;try{let r=await supabaseClient.rpc('delete_my_account');if(r.error){const f=await supabaseClient.functions.invoke('delete-account');if(f.error)throw f.error}await supabaseClient.auth.signOut();CURRENT_USER=null;PROFILE=null;PROGRESS=defaultProgress();document.getElementById('app').classList.add('hidden');document.getElementById('authScreen').classList.remove('hidden');notify('Cuenta eliminada','Tu cuenta y datos asociados fueron eliminados.')}catch(e){console.error(e);toast(userFriendlyError(e,'No se pudo eliminar la cuenta. Verifica delete_my_account en Supabase.'))}}
async function loginUser(user){
  CURRENT_USER=user;
  PROFILE=await ensureProfile(user);
  CURRENT_USER.role=PROFILE?.role==='teacher'?'teacher':'student';
  if(CURRENT_USER.role==='student') await ensureStudentData();
  else PROGRESS=defaultProgress();
  await reloadContent();
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  updateSidebar();
  renderNav();
  showView(CURRENT_USER.role==='teacher'?'tInicio':'inicio');
}
async function logout(){await supabaseClient.auth.signOut();CURRENT_USER=null;PROFILE=null;PROGRESS=defaultProgress();document.getElementById('app').classList.add('hidden');document.getElementById('authScreen').classList.remove('hidden');document.getElementById('loginForm').reset();if(window.closeMobileSidebar)window.closeMobileSidebar();}
function openGradeModal(first=false){
  openModal(`
    <h3>${first?'Selecciona tu grado y sección':'Cambiar grado y sección'}</h3>
    <p class="muted small">El grado y la sección determinan qué material y evaluaciones específicas aparecen para ti.</p>
    <div class="field"><label for="gradePick">Grado</label><select id="gradePick">${renderGradeOptions(PROGRESS.grade_id||PROFILE?.grade_id||'')}</select></div>
    <div class="field"><label for="sectionPick">Sección</label>
      <select id="sectionPick">
        <option value="">Selecciona una sección</option>
        <option value="A" ${PROFILE?.section==='A'?'selected':''}>A</option>
        <option value="B" ${PROFILE?.section==='B'?'selected':''}>B</option>
        <option value="C" ${PROFILE?.section==='C'?'selected':''}>C</option>
        <option value="D" ${PROFILE?.section==='D'?'selected':''}>D</option>
      </select>
    </div>
    <button class="btn btn-primary btn-block" id="saveGradeBtn">Guardar</button>
  `);
  document.getElementById('saveGradeBtn').onclick=async()=>{
    try{
      const grade_id=document.getElementById('gradePick').value;
      const section=document.getElementById('sectionPick').value;
      if(!grade_id||!['A','B','C','D'].includes(section)){
        toast('Selecciona un grado y una sección válida.');
        return;
      }
      await updateProfile({grade_id,section});
      PROGRESS.grade_id=grade_id;
      await saveProgress();
      closeModal();
      updateSidebar();
      showView(currentView);
    }catch(e){
      console.error('Guardar grado/sección:',e);
      toast(userFriendlyError(e,'No se pudo guardar el grado y la sección.'));
    }
  };
}
function setAuthMode(mode){document.getElementById('tabLogin').classList.toggle('active',mode==='login');document.getElementById('tabRegister').classList.toggle('active',mode==='register');document.getElementById('loginForm').classList.toggle('hidden',mode!=='login');document.getElementById('registerForm').classList.toggle('hidden',mode!=='register')}

function validPersonName(v){return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÖØ-öø-ÿ]+(?:[ '-][A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÖØ-öø-ÿ]+)*$/.test(String(v||'').trim())}
function validPassword(v){return /^(?=.{8,}$)(?=.*[A-ZÁÉÍÓÚÜÑ])(?=.*[a-záéíóúüñ])(?=.*\d).*$/.test(String(v||''))}
function setupPasswordToggles(){document.querySelectorAll('[data-toggle-password]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.onclick=()=>{const i=document.getElementById(b.dataset.togglePassword);if(!i)return;const show=i.type==='password';i.type=show?'text':'password';b.textContent=show?'🙈':'👁'}})}
function logTeacherActivity(action,entity_type=null,entity_id=null,metadata={}){if(CURRENT_USER?.role==='teacher')return supabaseClient.from('teacher_activity').insert({user_id:CURRENT_USER.id,action,entity_type,entity_id,metadata}).then(()=>{}).catch(console.error)}
function validPersonName(value){return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÖØ-öø-ÿ]+(?:[ '\\-][A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÖØ-öø-ÿ]+)*$/.test(String(value||'').trim())}
function validPassword(value){return /^(?=.{8,}$)(?=.*[A-ZÁÉÍÓÚÜÑ])(?=.*[a-záéíóúüñ])(?=.*\d).*$/.test(String(value||''))}
function setupPasswordToggles(){document.querySelectorAll('[data-toggle-password]').forEach(btn=>{if(btn.dataset.bound)return;btn.dataset.bound='1';btn.onclick=()=>{const i=document.getElementById(btn.dataset.togglePassword);if(!i)return;const show=i.type==='password';i.type=show?'text':'password';btn.textContent=show?'🙈':'👁'}})}
function logTeacherActivity(action,entity_type=null,entity_id=null,metadata={}){if(CURRENT_USER?.role==='teacher')return supabaseClient.from('teacher_activity').insert({user_id:CURRENT_USER.id,action,entity_type,entity_id,metadata}).then(()=>{}).catch(console.error)}

async function loadPublicRegistrationData(){
  const {data,error}=await supabaseClient.from('grades').select('id,name,sort_order').order('sort_order',{ascending:true});
  if(error)throw error;
  GRADES=Array.isArray(data)?data:[];
  if(!GRADES.length)throw new Error('No hay grados configurados en Supabase.');
  const grade=document.getElementById('regGrade');
  if(grade){
    grade.innerHTML='<option value="" selected disabled>Selecciona un grado</option>'+
      GRADES.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
  }
  const tGrades=document.getElementById('regTeacherGrades');
  if(tGrades){
    tGrades.innerHTML=GRADES.map(g=>`<label class="checkbox-opt"><input type="checkbox" value="${esc(g.id)}"> ${esc(g.name)}</label>`).join('');
  }
  try{
    const {data:subs,error:sErr}=await supabaseClient.from('subjects').select('id,name').order('sort_order',{ascending:true});
    if(!sErr && Array.isArray(subs)){
      SUBJECTS=subs;
      const tSubj=document.getElementById('regTeacherSubject');
      if(tSubj)tSubj.innerHTML='<option value="" selected disabled>Selecciona una materia</option>'+subs.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    }
  }catch(e){console.error('No se pudieron cargar materias para el registro:',e)}
}


function renderTop(view,title,subtitle=''){view.innerHTML=`<div class="breadcrumb">Parche Saber</div><h1>${title}</h1>${subtitle?`<p class="muted">${subtitle}</p>`:''}`} 
const RENDERERS={};

RENDERERS.inicio=function(v){const l=getLevel(PROGRESS.xp||0);const recent=(PROGRESS.activity_log||[]).slice(0,6);v.innerHTML=`<div class="breadcrumb">Inicio</div><h1>¡Qué más, ${esc(fullProfileName())}! 👋</h1><p class="muted">Tu panel de estudio está conectado a Supabase.</p><div class="grid cols-4" style="margin:18px 0"><div class="stat-card" style="--accent:var(--blue-600)"><div class="sval">${l.icon} ${l.index+1}</div><div class="slabel">${l.name}</div></div><div class="stat-card"><div class="sval">${Object.keys(PROGRESS.answered||{}).length}</div><div class="slabel">Preguntas respondidas</div></div><div class="stat-card"><div class="sval">${overallAccuracy()}%</div><div class="slabel">Aciertos</div></div><div class="stat-card"><div class="sval">${PROGRESS.xp||0}</div><div class="slabel">XP</div></div></div><div class="page-card"><span class="section-eyebrow">Mis materias</span><div class="grid cols-5">${SUBJECTS.map(s=>{const qs=questionsBySubject(s.id);const a=qs.filter(q=>PROGRESS.answered[q.id]!==undefined);const c=a.filter(q=>PROGRESS.answered[q.id]===q.correct).length;const pct=a.length?Math.round(c/a.length*100):0;return`<div class="subject-card" style="--accent:var(--blue-500)" onclick="guarded(()=>showView('subjectHome',{subjectId:'${s.id}'}))"><div class="sc-icon">${esc(s.icon||'📘')}</div><h3>${esc(s.name)}</h3><p class="small muted">${esc(s.description||'')}</p><div class="pbar"><div style="width:${pct}%"></div></div><span class="small muted">${pct}% de aciertos</span></div>`}).join('')}</div></div><div class="page-card"><span class="section-eyebrow">Actividad reciente</span>${recent.length?recent.map(a=>`<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--bg-2)"><span>${a.icon||'✏️'}</span><span class="small">${esc(a.label)}</span></div>`).join(''):`<div class="empty-state">Aún no hay actividad.</div>`}</div>`}

RENDERERS.materias=function(v){renderTop(v,'Mis materias','Elige una materia y entra a todos sus módulos.');v.insertAdjacentHTML('beforeend',`<div class="grid cols-5">${SUBJECTS.map(s=>`<div class="subject-card" style="--accent:var(--blue-500)" data-s="${s.id}"><div class="sc-icon">${esc(s.icon||'📘')}</div><h3>${esc(s.name)}</h3><p class="small muted">${esc(s.description||'')}</p></div>`).join('')}</div>`);v.querySelectorAll('[data-s]').forEach(c=>c.onclick=()=>guarded(()=>showView('subjectHome',{subjectId:c.dataset.s})))};

async function signedResourceUrl(r){if(!r.file_url)return r.url||null;return await getSignedUrl(BUCKETS.resource,r.file_url)}
async function signedQuestionImage(q){return q.image_url?await getSignedUrl(BUCKETS.question,q.image_url):null}
const MODULES=[['material','📚 Material'],['contenidos','🧠 Contenidos'],['tests','📝 Tests'],['examenes','📑 Evaluaciones'],['practica','🎯 Práctica'],['progreso','📊 Progreso']];
RENDERERS.subjectHome=function(v,p){const s=subjectById(p.subjectId)||SUBJECTS[0];const tab=p.tab||'material';v.innerHTML=`<div class="breadcrumb">Mis materias / ${esc(s.name)}</div><h1>${esc(s.icon||'📘')} ${esc(s.name)}</h1><p class="muted">${esc(s.description||'')}</p><div class="module-tabs">${MODULES.map(([id,l])=>`<button class="module-tab ${id===tab?'active':''}" data-tab="${id}">${l}</button>`).join('')}</div><div id="moduleArea"></div>`;v.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>guarded(()=>showView('subjectHome',{subjectId:s.id,tab:b.dataset.tab})));const a=v.querySelector('#moduleArea');const fn={material:renderMaterial,contenidos:renderContents,tests:renderTests,examenes:renderExams,practica:renderPractice,progreso:renderSubjectProgress}[tab]||renderMaterial;fn(a,s,v,p)};

async function renderMaterial(a,s){const items=resourcesBySubject(s.id).filter(r=>!r.grade_id||r.grade_id===PROGRESS.grade_id);if(!items.length){a.innerHTML='<div class="empty-state">📭 No hay material para esta materia y grado.</div>';return}a.innerHTML='<div class="grid cols-2" id="resourceGrid"></div>';const grid=a.querySelector('#resourceGrid');for(const r of items){const url=await signedResourceUrl(r);const label={document:'📄 Documento',video:'🎬 Video',reading:'📖 Lectura',workshop:'🛠️ Taller',image:'🖼️ Imagen',pdf:'📑 PDF'}[r.type]||'📎 Material';grid.insertAdjacentHTML('beforeend',`<div class="res-card"><span class="tag tag-blue">${label}</span><h3>${esc(r.title)}</h3><p class="small muted">${esc(r.description||'')}</p>${url?`<a class="btn btn-outline btn-sm" href="${esc(url)}" target="_blank" rel="noopener">Abrir material</a>`:'<span class="small muted">Archivo no disponible.</span>'}</div>`)}}
function renderContents(a,s){const ts=topicsBySubject(s.id).filter(t=>t.grade_id===PROFILE?.grade_id);a.innerHTML=ts.length?`<div class="grid cols-3">${ts.map(t=>`<div class="topic-card" data-t="${t.id}"><span class="tag tag-blue">Grado ${esc(normalizeGradeName(t.grade_id))}</span><h3>${esc(t.title)}</h3><p class="small muted">${esc(t.description||'')}</p></div>`).join('')}</div><div id="topicDetail" style="margin-top:16px"></div>`:'<div class="empty-state"><span class="es-emoji">🧠</span>No hay temas publicados para tu grado en esta materia.</div>';a.querySelectorAll('[data-t]').forEach(c=>c.onclick=()=>{const t=topicById(c.dataset.t);PROGRESS.visited_sections[t.id]=Date.now();PROGRESS.last_topic=t.id;saveProgress().catch(console.error);a.querySelector('#topicDetail').innerHTML=`<div class="page-card"><span class="section-eyebrow">${esc(s.name)} · Grado ${esc(normalizeGradeName(t.grade_id))}</span><h2>${esc(t.title)}</h2><p>${esc(t.content||t.description||'')}</p></div>`;})}

function renderTestList(a,s){const tests=testsBySubject(s.id).filter(t=>!t.grade_id||t.grade_id===PROGRESS.grade_id);a.innerHTML=tests.length?`<div class="grid cols-3">${tests.map(t=>`<div class="list-card"><h3>${esc(t.title)}</h3><p class="small muted">${t.question_ids?.length||0} preguntas</p><button class="btn btn-primary btn-sm btn-block" data-id="${t.id}">Iniciar</button></div>`).join('')}</div>`:'<div class="empty-state">No hay tests publicados para este grado.</div>';a.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>guarded(()=>showView('testRunner',{id:b.dataset.id}))) }
function renderTests(a,s){renderTestList(a,s)}
function renderExams(a,s){const exams=examsBySubject(s.id).filter(e=>!e.grade_id||e.grade_id===PROGRESS.grade_id);a.innerHTML=exams.length?`<div class="grid cols-3">${exams.map(e=>`<div class="list-card"><h3>${esc(e.title)}</h3><p class="small muted">${e.question_ids?.length||0} preguntas</p><button class="btn btn-primary btn-sm btn-block" data-id="${e.id}">Iniciar</button></div>`).join('')}</div>`:'<div class="empty-state">No hay exámenes publicados para este grado.</div>';a.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>guarded(()=>showView('examRunner',{id:b.dataset.id}))) }
function renderSubjectProgress(a,s){const qs=questionsBySubject(s.id);const ans=qs.filter(q=>PROGRESS.answered[q.id]!==undefined);const c=ans.filter(q=>PROGRESS.answered[q.id]===q.correct).length;const pct=ans.length?Math.round(c/ans.length*100):0;const ts=topicsBySubject(s.id).filter(t=>PROGRESS.visited_sections[t.id]).length;a.innerHTML=`<div class="grid cols-3"><div class="stat-card"><div class="sval">${pct}%</div><div class="slabel">Aciertos</div></div><div class="stat-card"><div class="sval">${ans.length}/${qs.length}</div><div class="slabel">Preguntas</div></div><div class="stat-card"><div class="sval">${ts}/${topicsBySubject(s.id).length}</div><div class="slabel">Temas</div></div></div>`}
function renderPractice(a,s){feedbackState={pool:questionsBySubject(s.id).filter(q=>!q.grade_id||q.grade_id===PROGRESS.grade_id),idx:0,answers:{},mode:'practica',meta:{title:`Práctica · ${s.name}`,subjectName:s.name}};renderFeedback(a,()=>showView('subjectHome',{subjectId:s.id,tab:'practica'}))}
function renderFeedback(a,back){
  const pool=feedbackState.pool;
  if(!pool.length){a.innerHTML='<div class="empty-state">No hay preguntas disponibles.</div>';return}
  if(feedbackState.idx>=pool.length){
    const currentAnswers=feedbackState.answers||{};
    const correct=pool.filter(q=>currentAnswers[q.id]===q.correct).length;
    if(feedbackState.mode==='test'&&!feedbackState.completed){
      feedbackState.completed=true;
      const record={score:correct,total:pool.length,percentage:Math.round(correct/pool.length*100),answers:currentAnswers};
      PROGRESS.tests_completed[feedbackState.meta.testId]=record;
      activity(`Completaste "${feedbackState.meta.title}": ${correct}/${pool.length}`,'📝');
      saveProgress().catch(console.error);
      if(CURRENT_USER){
        supabaseClient.from('test_attempts').insert({user_id:CURRENT_USER.id,test_id:feedbackState.meta.testId,score:correct,total:pool.length,percentage:record.percentage,answers:currentAnswers}).then(({error})=>{if(error)console.error('test_attempts:',error)});
      }
      addXP(20+correct*2,'Test completado').catch(console.error);
    }
    a.innerHTML=`<div class="page-card center"><h2>🎉 Ronda completada</h2><div class="grid cols-3" style="margin:18px 0"><div class="stat-card"><div class="sval">${correct}/${pool.length}</div><div class="slabel">Correctas</div></div><div class="stat-card"><div class="sval">${Math.round(correct/pool.length*100)}%</div><div class="slabel">Aciertos</div></div><div class="stat-card"><div class="sval">${pool.length-correct}</div><div class="slabel">Incorrectas</div></div></div><div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="restart">Repetir</button><button class="btn btn-outline btn-sm" id="back">Volver</button><button class="btn btn-ghost btn-sm" id="review">Repasar errores</button></div></div>`;
    a.querySelector('#restart').onclick=()=>{feedbackState.idx=0;feedbackState.answers={};feedbackState.completed=false;renderFeedback(a,back)};
    a.querySelector('#back').onclick=back;
    a.querySelector('#review').onclick=()=>showView('repaso');
    return;
  }
  const q=pool[feedbackState.idx];
  const chosen=feedbackState.answers[q.id];
  a.innerHTML=`<div class="quiz-card"><div class="quiz-meta"><span class="quiz-progress">Pregunta ${feedbackState.idx+1} de ${pool.length}</span><span class="tag ${q.difficulty==='facil'?'tag-facil':q.difficulty==='dificil'?'tag-dificil':'tag-media'}">${esc(q.difficulty)}</span></div><div class="pbar" style="margin-top:12px"><div style="width:${Math.round((feedbackState.idx+1)/pool.length*100)}%"></div></div><div class="quiz-question">${esc(q.question)}</div><div id="qImage"></div><div id="opts"></div><div id="explain"></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn btn-outline btn-sm" id="prev" ${feedbackState.idx===0?'disabled':''}>← Anterior</button><button class="btn btn-primary btn-sm" id="next" ${chosen===undefined?'disabled':''}>${feedbackState.idx===pool.length-1?'Finalizar':'Siguiente →'}</button></div></div>`;
  if(q.image_url){signedQuestionImage(q).then(url=>{if(url&&a.querySelector('#qImage'))a.querySelector('#qImage').innerHTML=`<div class="page-card center"><img src="${esc(url)}" alt="Imagen de la pregunta" style="max-width:100%;max-height:360px;border-radius:10px"></div>`})}
  const opts=a.querySelector('#opts');
  opts.innerHTML=(q.options||[]).map((o,i)=>`<button class="qoption" data-i="${i}"><span class="qletter">${String.fromCharCode(65+i)}</span><span>${esc(o)}</span></button>`).join('');
  const paint=(choice)=>{opts.querySelectorAll('.qoption').forEach((b,i)=>{b.disabled=true;if(i===q.correct)b.classList.add('correct');else if(i===choice)b.classList.add('wrong')});const good=choice===q.correct;a.querySelector('#explain').innerHTML=`<div class="feedback-box ${good?'correct':'wrong'}"><b>${good?'✅ ¡Correcto!':'❌ Respuesta incorrecta'}</b><p><b>¿Por qué?</b> ${esc(q.why||'Sin explicación disponible.')}</p>${!good&&q.why_wrong?.[choice]?`<p><b>Tu opción:</b> ${esc(q.why_wrong[choice])}</p>`:''}</div>`;a.querySelector('#next').disabled=false};
  if(chosen!==undefined)paint(chosen);
  opts.querySelectorAll('.qoption').forEach(b=>b.onclick=async()=>{
    if(feedbackState.answers[q.id]!==undefined)return;
    const choice=Number(b.dataset.i);
    feedbackState.answers[q.id]=choice;
    const firstGlobalAnswer=PROGRESS.answered[q.id]===undefined;
    if(firstGlobalAnswer){
      PROGRESS.answered[q.id]=choice;
      if(choice===q.correct)PROGRESS.correct_count=(PROGRESS.correct_count||0)+1;
      else{PROGRESS.wrong_count=(PROGRESS.wrong_count||0)+1;PROGRESS.wrong_ids[q.id]=true}
      activity(`Respondió “${(q.question||'').slice(0,50)}”`,choice===q.correct?'✅':'❌');
      saveProgress().catch(console.error);
    }else if(choice===q.correct){delete PROGRESS.wrong_ids[q.id];saveProgress().catch(console.error)}
    syncStudentAnswer(q,choice,feedbackState.mode,feedbackState.meta.testId||null).catch(console.error);
    await addXP(choice===q.correct?15:5,choice===q.correct?'Respuesta correcta':'Participación');
    paint(choice);
  });
  a.querySelector('#prev').onclick=()=>{if(feedbackState.idx>0){feedbackState.idx--;renderFeedback(a,back)}};
  a.querySelector('#next').onclick=()=>{if(feedbackState.answers[q.id]===undefined)return;feedbackState.idx++;renderFeedback(a,back)};
}

RENDERERS.testRunner=function(v,p){const t=TESTS.find(x=>x.id===p.id);if(!t){v.innerHTML='<div class="empty-state">Test no encontrado.</div>';return}const s=subjectById(t.subject_id);feedbackState={pool:t.question_ids.map(id=>QUESTIONS.find(q=>q.id===id)).filter(Boolean),idx:0,answers:{},completed:false,mode:'test',meta:{title:t.title,subjectName:s?.name||'',testId:t.id}};renderFeedback(v,()=>showView('subjectHome',{subjectId:t.subject_id,tab:'tests'}));}

function renderDeferred(v,back){const total=deferredState.pool.length;if(!total){v.innerHTML='<div class="empty-state">No hay preguntas en esta evaluación.</div>';return}if(deferredState.finished){renderDeferredResults(v,back);return}const q=deferredState.pool[deferredState.idx];const chosen=deferredState.answers[q.id];v.innerHTML=`<div class="quiz-card"><div class="quiz-meta"><span class="quiz-progress">Pregunta ${deferredState.idx+1} de ${total}</span><span class="tag tag-blue">Evaluación</span></div><div class="pbar" style="margin-top:12px"><div style="width:${Math.round((deferredState.idx+1)/total*100)}%"></div></div><div class="quiz-question">${esc(q.question)}</div><div id="dImage"></div><div id="dOpts"></div><div style="display:flex;justify-content:space-between;gap:8px;margin-top:16px;flex-wrap:wrap"><button class="btn btn-outline btn-sm" id="dPrev" ${deferredState.idx===0?'disabled':''}>← Anterior</button><span class="small muted">${Object.keys(deferredState.answers).length}/${total} respondidas</span>${deferredState.idx===total-1?'<button class="btn btn-primary btn-sm" id="dFinish">Enviar y finalizar</button>':'<button class="btn btn-primary btn-sm" id="dNext">Siguiente →</button>'}</div></div>`;if(q.image_url)signedQuestionImage(q).then(url=>{if(url)v.querySelector('#dImage').innerHTML=`<div class="page-card center"><img src="${esc(url)}" style="max-width:100%;max-height:340px;border-radius:10px" alt="Imagen de la pregunta"></div>`});v.querySelector('#dOpts').innerHTML=(q.options||[]).map((o,i)=>`<button class="qoption ${chosen===i?'selected-deferred':''}" data-i="${i}"><span class="qletter">${String.fromCharCode(65+i)}</span><span>${esc(o)}</span></button>`).join('');v.querySelectorAll('.qoption').forEach(b=>b.onclick=()=>{deferredState.answers[q.id]=Number(b.dataset.i);renderDeferred(v,back)});v.querySelector('#dPrev').onclick=()=>{if(deferredState.idx>0){deferredState.idx--;renderDeferred(v,back)}};if(v.querySelector('#dNext'))v.querySelector('#dNext').onclick=()=>{deferredState.idx++;renderDeferred(v,back)};if(v.querySelector('#dFinish'))v.querySelector('#dFinish').onclick=async()=>finishDeferred(v,back)}
async function finishDeferred(v,back){const unanswered=deferredState.pool.filter(q=>deferredState.answers[q.id]===undefined).length;if(unanswered){notify('Faltan respuestas',`Todavía tienes ${unanswered} pregunta(s) sin responder.`,'warning');return}let correct=0;const bySubject={};const answerRows=[];for(const q of deferredState.pool){const chosen=deferredState.answers[q.id];const ok=chosen===q.correct;if(ok)correct++;if(!bySubject[q.subject_id])bySubject[q.subject_id]={correct:0,total:0};bySubject[q.subject_id].total++;if(ok)bySubject[q.subject_id].correct++;answerRows.push({question_id:q.id,selected_option:chosen,is_correct:ok})}const total=deferredState.pool.length;const pct=Math.round(correct/total*100);for(const row of answerRows){if(PROGRESS.answered[row.question_id]===undefined){PROGRESS.answered[row.question_id]=row.selected_option;if(row.is_correct)PROGRESS.correct_count++;else{PROGRESS.wrong_count++;PROGRESS.wrong_ids[row.question_id]=true}}}await saveProgress();await supabaseClient.from('student_answers').insert(answerRows.map(r=>({...r,user_id:CURRENT_USER.id,context_type:deferredState.mode,context_id:deferredState.meta.examId||null})));const record={score:correct,total,percentage:pct,by_subject:bySubject,answers:deferredState.answers};if(deferredState.mode==='simulacro'){PROGRESS.simulacro_history=[...(PROGRESS.simulacro_history||[]),{date:Date.now(),score:correct,total,pct,bySubject}];await addXP(30+Math.round(pct/5),'Simulacro completado')}else{PROGRESS.exams_completed[deferredState.meta.examId]=record;await supabaseClient.from('exam_attempts').insert({user_id:CURRENT_USER.id,exam_id:deferredState.meta.examId,score:correct,total,percentage:pct,by_subject:bySubject,answers:deferredState.answers});await addXP(25+Math.round(pct/4),'Examen completado')}deferredState.finished=true;examGuard=null;await saveProgress();await checkAchievements();renderDeferredResults(v,back)}
function renderDeferredResults(v,back){let correct=0;for(const q of deferredState.pool)if(deferredState.answers[q.id]===q.correct)correct++;const total=deferredState.pool.length;const pct=total?Math.round(correct/total*100):0;v.innerHTML=`<div class="page-card center"><h2>🎉 Resultados</h2><div class="grid cols-3"><div class="stat-card"><div class="sval">${correct}/${total}</div><div class="slabel">Correctas</div></div><div class="stat-card"><div class="sval">${pct}%</div><div class="slabel">Puntaje</div></div><div class="stat-card"><div class="sval">${total-correct}</div><div class="slabel">Incorrectas</div></div></div><div style="margin-top:16px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="again">Intentar de nuevo</button><button class="btn btn-outline btn-sm" id="back">Volver</button><button class="btn btn-ghost btn-sm" id="rev">Repasar mis errores</button></div></div>`;v.querySelector('#again').onclick=()=>{deferredState.answers={};deferredState.idx=0;deferredState.finished=false;examGuard=()=>Object.keys(deferredState.answers).length>0;renderDeferred(v,back)};v.querySelector('#back').onclick=back;v.querySelector('#rev').onclick=()=>showView('repaso')}
RENDERERS.examRunner=function(v,p){const e=EXAMS.find(x=>x.id===p.id);if(!e){v.innerHTML='<div class="empty-state">Examen no encontrado.</div>';return}deferredState={pool:e.question_ids.map(id=>QUESTIONS.find(q=>q.id===id)).filter(Boolean),idx:0,answers:{},mode:'exam',meta:{title:e.title,examId:e.id},finished:false};examGuard=()=>Object.keys(deferredState.answers).length>0;renderDeferred(v,()=>showView('subjectHome',{subjectId:e.subject_id,tab:'examenes'}))}

RENDERERS.repaso=function(v){reviewState.pool=QUESTIONS.filter(q=>PROGRESS.wrong_ids[q.id]&&!PROGRESS.mastered_questions[q.id]);reviewState.idx=0;v.innerHTML=`<div class="breadcrumb">Repaso</div><h1>Repasa tus errores</h1><p class="muted">Después de varios intentos, la pregunta sale de la ronda y te indica qué tema reforzar.</p><div class="tabs"><button class="tab active" data-filter="all">Todas</button>${SUBJECTS.map(s=>`<button class="tab" data-filter="${s.id}">${esc(s.name)}</button>`).join('')}</div><div id="reviewArea"></div>`;v.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{reviewState.filter=b.dataset.filter;reviewState.pool=QUESTIONS.filter(q=>PROGRESS.wrong_ids[q.id]&&!PROGRESS.mastered_questions[q.id]&&(b.dataset.filter==='all'||q.subject_id===b.dataset.filter));reviewState.idx=0;v.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderReviewArea(v)});renderReviewArea(v)};
function renderReviewArea(v){
  const a=v.querySelector('#reviewArea');
  if(!reviewState.pool.length){a.innerHTML='<div class="empty-state">🙌 No tienes errores pendientes en este filtro.</div>';return}
  if(reviewState.idx>=reviewState.pool.length){a.innerHTML='<div class="empty-state">🎉 Terminaste esta ronda de repaso.</div>';return}
  const q=reviewState.pool[reviewState.idx];
  const attempts=Number(PROGRESS.review_attempts[q.id]||0);
  a.innerHTML=`<div class="quiz-card"><div class="quiz-meta"><span class="quiz-progress">Repaso ${reviewState.idx+1} de ${reviewState.pool.length}</span><span class="tag tag-media">Intentos de repaso: ${attempts}/3</span></div><div class="quiz-question">${esc(q.question)}</div><div id="ro"></div><div id="rx"></div><button class="btn btn-primary btn-sm" id="rn" style="display:none;margin-top:14px">Siguiente →</button></div>`;
  a.querySelector('#ro').innerHTML=(q.options||[]).map((o,i)=>`<button class="qoption" data-i="${i}"><span class="qletter">${String.fromCharCode(65+i)}</span><span>${esc(o)}</span></button>`).join('');
  a.querySelectorAll('.qoption').forEach(b=>b.onclick=async()=>{
    const choice=Number(b.dataset.i);
    a.querySelectorAll('.qoption').forEach((x,i)=>{x.disabled=true;if(i===q.correct)x.classList.add('correct');else if(i===choice)x.classList.add('wrong')});
    if(choice===q.correct){
      PROGRESS.mastered_questions[q.id]=true;
      delete PROGRESS.wrong_ids[q.id];
      delete PROGRESS.review_attempts[q.id];
      a.querySelector('#rx').innerHTML='<div class="feedback-box correct"><b>✅ ¡Dominada!</b><p>La pregunta sale de tu lista de repaso.</p></div>';
      await addXP(10,'Pregunta dominada');
    }else{
      const n=attempts+1;
      PROGRESS.review_attempts[q.id]=n;
      if(n>=3){
        a.querySelector('#rx').innerHTML='<div class="feedback-box wrong"><b>📘 Necesitas reforzar este tema</b><p>Ya hiciste tres intentos de repaso. Vamos a dejar esta pregunta fuera de esta ronda para que vuelvas al contenido del tema.</p></div>';
        delete PROGRESS.wrong_ids[q.id];
        activity(`Necesita refuerzo: ${topicById(q.topic_id)?.title||'tema'}`,'📘');
        await saveProgress();
      }else{
        a.querySelector('#rx').innerHTML=`<div class="feedback-box wrong"><b>❌ Aún no.</b><p>${esc(q.why_wrong?.[choice]||q.why||'Revisa el contenido del tema y vuelve a intentarlo.')}</p></div>`;
        await saveProgress();
      }
    }
    a.querySelector('#rn').style.display='inline-flex';
  });
  a.querySelector('#rn').onclick=()=>{
    reviewState.pool=QUESTIONS.filter(x=>PROGRESS.wrong_ids[x.id]&&!PROGRESS.mastered_questions[x.id]&&(reviewState.filter==='all'||x.subject_id===reviewState.filter));
    reviewState.idx=0;
    renderReviewArea(v);
  };
}

RENDERERS.progreso=function(v){const answered=Object.keys(PROGRESS.answered||{}).length;v.innerHTML=`<div class="breadcrumb">Progreso</div><h1>Tu progreso</h1><div class="grid cols-4"><div class="stat-card"><div class="sval">${answered}</div><div class="slabel">Preguntas</div></div><div class="stat-card"><div class="sval">${overallAccuracy()}%</div><div class="slabel">Aciertos</div></div><div class="stat-card"><div class="sval">${Object.keys(PROGRESS.tests_completed||{}).length}</div><div class="slabel">Tests</div></div><div class="stat-card"><div class="sval">${Object.keys(PROGRESS.exams_completed||{}).length}</div><div class="slabel">Exámenes</div></div></div><div class="page-card" style="margin-top:16px"><span class="section-eyebrow">Por materia</span>${SUBJECTS.map(s=>{const qs=questionsBySubject(s.id),ans=qs.filter(q=>PROGRESS.answered[q.id]!==undefined),c=ans.filter(q=>PROGRESS.answered[q.id]===q.correct).length,p=ans.length?Math.round(c/ans.length*100):0;return`<div style="margin:11px 0"><div style="display:flex;justify-content:space-between"><span>${esc(s.icon||'📘')} ${esc(s.name)}</span><span>${p}%</span></div><div class="pbar"><div style="width:${p}%"></div></div></div>`}).join('')}</div>`}
RENDERERS.logros=function(v){v.innerHTML=`<div class="breadcrumb">Logros</div><h1>🏆 Logros</h1><p class="muted">${Object.keys(PROGRESS.achievements||{}).length}/${ACHIEVEMENTS.length} desbloqueados.</p><div class="grid cols-4">${visibleAchievements.map(a=>`<div class="page-card center" style="opacity:${PROGRESS.achievements[a.id]?1:.42}"><div style="font-size:1.8rem">${a.icon}</div><b>${esc(a.title)}</b><p class="small muted">${esc(a.desc)}</p></div>`).join('')}</div>`}
RENDERERS.perfil=function(v){
  v.innerHTML=`
    <div class="breadcrumb">Perfil</div>
    <h1>Mi perfil</h1>
    <div class="page-card">
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div id="profilePhoto" class="pc-avatar" style="width:76px;height:76px;font-size:1.7rem">${esc(fullProfileName().charAt(0).toUpperCase())}</div>
        <div style="flex:1;min-width:240px">
          <h3>${esc(fullProfileName())}</h3>
          <p class="small muted">${esc(CURRENT_USER.email)} · ${CURRENT_USER.role==='teacher'?'Docente':'Estudiante'}</p>
          <div class="file-control">
            <button type="button" class="btn btn-outline btn-sm" id="chooseAvatarBtn">Elegir foto</button>
            <span class="file-name" id="avatarFileName">Ningún archivo seleccionado</span>
            <input id="avatarInput" type="file" accept="image/png,image/jpeg,image/webp">
          </div>
          <p class="small muted" style="margin-top:6px">Formatos: JPG, PNG o WEBP. Máximo 5 MB.</p>
        </div>
      </div>
      <div class="grid cols-2" style="margin-top:16px">
        <div class="field">
          <label for="profileName">Nombre</label>
          <input id="profileName" value="${esc(PROFILE?.name||'')}">
        </div>
        ${CURRENT_USER.role==='student'?`
        <div class="field">
          <label for="profileSection">Sección</label>
          <select id="profileSection">
            <option value="">Selecciona una sección</option>
            <option value="A" ${PROFILE?.section==='A'?'selected':''}>A</option>
            <option value="B" ${PROFILE?.section==='B'?'selected':''}>B</option>
            <option value="C" ${PROFILE?.section==='C'?'selected':''}>C</option>
            <option value="D" ${PROFILE?.section==='D'?'selected':''}>D</option>
          </select>
        </div>`:''}
      </div>
      ${CURRENT_USER.role==='student'?`
      <div class="field">
        <label for="profileGrade">Grado</label>
        <select id="profileGrade">${renderGradeOptions(PROFILE?.grade_id||'')}</select>
      </div>`:''}
      <button class="btn btn-primary" id="saveProfile">Guardar cambios</button>
    </div>
  `;
  const choose=v.querySelector('#chooseAvatarBtn'), file=v.querySelector('#avatarInput'), fileName=v.querySelector('#avatarFileName');
  choose.onclick=()=>file.click();
  v.querySelector('#saveProfile').onclick=async()=>{
    try{
      const fields={name:v.querySelector('#profileName').value.trim()};
      if(!fields.name){toast('El nombre no puede quedar vacío.');return}
      if(CURRENT_USER.role==='student'){
        const section=v.querySelector('#profileSection').value;
        const grade_id=v.querySelector('#profileGrade').value;
        if(!grade_id||!['A','B','C','D'].includes(section)){
          toast('Selecciona un grado y una sección válida.');
          return;
        }
        fields.grade_id=grade_id;
        fields.section=section;
        PROGRESS.grade_id=grade_id;
      }
      await updateProfile(fields);
      PROFILE=await loadProfile(CURRENT_USER.id);
      PROGRESS.name=fields.name;
      await saveProgress();
      toast('Perfil actualizado correctamente.');
      updateSidebar();
    }catch(e){
      console.error('Actualizar perfil:',e);
      toast(userFriendlyError(e,'No se pudo guardar el perfil.'));
    }
  };
  file.onchange=async()=>{
    const f=file.files?.[0];
    fileName.textContent=f?.name||'Ningún archivo seleccionado';
    if(!f)return;
    if(f.size>5*1024*1024){toast('La foto debe pesar menos de 5 MB.');return}
    try{
      const ext=f.name.split('.').pop().toLowerCase();
      const path=`${CURRENT_USER.id}/${uid('avatar')}.${ext}`;
      const {error}=await supabaseClient.storage.from(BUCKETS.avatar).upload(path,f,{upsert:false,contentType:f.type,cacheControl:'3600'});
      if(error)throw error;
      await updateProfile({avatar_url:path});
      PROFILE=await loadProfile(CURRENT_USER.id);
      toast('Foto de perfil actualizada correctamente.');
      updateSidebar();
      showView('perfil');
    }catch(err){
      console.error('Subir foto:',err);
      toast(userFriendlyError(err,'No se pudo subir la foto.'));
    }
  };
}

async function runTeacherAction(action,fallback='No se pudo completar la acción.'){
  try{
    await action();
  }catch(e){
    console.error('Docente:',e);
    toast(userFriendlyError(e,fallback));
  }
}
async function teacherQuery(table, filters={}){let q=supabaseClient.from(table).select('*');Object.entries(filters).forEach(([k,val])=>q=q.eq(k,val));const {data,error}=await q;if(error)throw error;return data||[]}
function buildSearch(){const items=[...SUBJECTS.map(s=>({label:s.name,type:'Materia',go:()=>showView('subjectHome',{subjectId:s.id})})),...TOPICS.map(t=>({label:t.title,type:'Tema',go:()=>showView('subjectHome',{subjectId:t.subject_id,tab:'contenidos',topicId:t.id})})),...QUESTIONS.map(q=>({label:q.question,type:'Pregunta',go:()=>showView('subjectHome',{subjectId:q.subject_id,tab:'practica'})})),...TESTS.map(t=>({label:t.title,type:'Test',go:()=>showView('testRunner',{id:t.id})})),...EXAMS.map(e=>({label:e.title,type:'Examen',go:()=>showView('examRunner',{id:e.id})})),...RESOURCES.map(r=>({label:r.title,type:'Material',go:()=>showView('subjectHome',{subjectId:r.subject_id,tab:'material'})}))];return items}
function initSearch(){const input=document.getElementById('globalSearch'),box=document.getElementById('searchResults');input.oninput=()=>{const x=input.value.trim().toLowerCase();if(x.length<2){box.style.display='none';return}const m=buildSearch().filter(i=>i.label.toLowerCase().includes(x)).slice(0,15);box.innerHTML=m.length?m.map((i,n)=>`<div class="search-result" data-i="${n}"><span class="search-tag">${esc(i.type)}</span>${esc(i.label)}</div>`).join(''):'<div class="search-result">Sin resultados.</div>';box.style.display='block';box.querySelectorAll('[data-i]').forEach(el=>el.onclick=()=>{m[Number(el.dataset.i)].go();box.style.display='none';input.value=''})};document.addEventListener('click',e=>{if(!e.target.closest('.searchbox'))box.style.display='none'})}

document.getElementById('modalBackdrop').onclick=e=>{if(e.target.id==='modalBackdrop')closeModal()};document.getElementById('notifyBackdrop').onclick=e=>{if(e.target.id==='notifyBackdrop')document.getElementById('notifyBackdrop').classList.remove('show')};


/* ============================================================
   PARCHE SABER V4 — FIXES INTEGRALES
   - Datos reales en Supabase; localStorage no se usa para datos de app.
   - Rol persistente desde profiles.
   - Grado y sección estrictos (A/B/C/D).
   - Recursos, preguntas y evaluaciones obligatoriamente por grado.
   - Sesión/ruta persistentes tras recarga.
   - Resultados por grado/sección/materia/tema + impresión PDF.
   - Simulacros por área/general, 25/50/100 preguntas y tiempos.
   - Sin XP visible.
   - Contraste/idioma y mensajes de error para usuario final.
   ============================================================ */
(function(){
  function validPersonName(value){return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÖØ-öø-ÿ]+(?:[ '\-][A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÖØ-öø-ÿ]+)*$/.test(String(value||'').trim())}
  function validPassword(value){return /^(?=.{8,}$)(?=.*[A-ZÁÉÍÓÚÜÑ])(?=.*[a-záéíóúüñ])(?=.*\d).*$/.test(String(value||''))}
  function setupPasswordToggles(){document.querySelectorAll('[data-toggle-password]').forEach(btn=>{if(btn.dataset.bound)return;btn.dataset.bound='1';btn.onclick=()=>{const i=document.getElementById(btn.dataset.togglePassword);if(!i)return;const show=i.type==='password';i.type=show?'text':'password';btn.textContent=show?'🙈':'👁';btn.setAttribute('aria-label',show?'Ocultar contraseña':'Mostrar contraseña')}})}
  setupPasswordToggles();
  document.getElementById('regPassword')?.addEventListener('input',e=>{const h=document.getElementById('regPasswordHint');if(h)h.textContent=validPassword(e.target.value)?'✓ Contraseña segura.':'Mínimo 8 caracteres, una mayúscula, una minúscula y un número.'});
  const V4_ROUTE_KEY='parche_saber_last_view_v4';
  const V4_PARAMS_KEY='parche_saber_last_params_v4';
  const SECTIONS=['A','B','C','D'];
  const SIM_SIZES=[25,50,100];
  const SIM_TIMES=[
    {minutes:45,label:'45 minutos'},
    {minutes:90,label:'90 minutos'},
    {minutes:180,label:'3 horas'},
    {minutes:540,label:'9 horas · modo extendido con pausas sugeridas'}
  ];
  let simTimer=null;

  function subjectIcon(s){return s?.id==='ingles'?'EN':(s?.icon||'📘')}
  function strictGrade(id){return id||''}
  function gradeName(id){return normalizeGradeName(id)||id||''}
  function gradeOptionsStrict(selected=''){
    const placeholder=selected?'':`<option value="" selected disabled>Selecciona un grado</option>`;
    return placeholder+(GRADES||[]).map(g=>`<option value="${esc(g.id)}" ${g.id===selected?'selected':''}>${esc(g.name)}</option>`).join('')
  }
  function sectionOptions(selected=''){
    return `<option value="">Selecciona una sección</option>${SECTIONS.map(x=>`<option value="${x}" ${selected===x?'selected':''}>${x}</option>`).join('')}`
  }
  function validPersonName(value){return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÖØ-öø-ÿ]+(?:[ '-][A-Za-zÁÉÍÓÚÜÑáéíóúüñÀ-ÖØ-öø-ÿ]+)*$/.test(String(value||'').trim())}
  function validPassword(value){return /^(?=.{8,254}$)(?=.*[A-ZÁÉÍÓÚÜÑ])(?=.*[a-záéíóúüñ])(?=.*\d).*$/.test(String(value||''))}
  function setupPasswordToggles(root=document){root.querySelectorAll('[data-toggle-password]').forEach(btn=>{if(btn.dataset.bound==='1')return;btn.dataset.bound='1';btn.onclick=()=>{const input=document.getElementById(btn.dataset.togglePassword);if(!input)return;const visible=input.type==='text';input.type=visible?'password':'text';btn.textContent=visible?'👁':'🙈';btn.setAttribute('aria-label',visible?'Mostrar contraseña':'Ocultar contraseña')}})}

  function friendly(msg,fallback='No se pudo completar la operación.'){
    const m=String(msg||'').toLowerCase();
    if(m.includes('row-level security')||m.includes('permission denied')||m.includes('not allowed')||m.includes('403'))return 'No tienes permisos para realizar esta acción.';
    if(m.includes('duplicate')||m.includes('already exists')||m.includes('unique'))return 'Ya existe un registro con esos datos.';
    if(m.includes('jwt')||m.includes('session'))return 'Tu sesión ya no es válida. Inicia sesión nuevamente.';
    if(m.includes('network')||m.includes('fetch'))return 'No pudimos comunicarnos con el servidor. Revisa tu conexión e inténtalo nuevamente.';
    if(m.includes('foreign key'))return 'El elemento seleccionado ya no está disponible.';
    return fallback;
  }
  function v4Toast(message,type='info'){try{notify(type==='error'?'Error':'Aviso',message,type)}catch{toast(message,type==='error'?'❌':'ℹ️')}}

  // ---- Persistencia de ruta (UI) en sessionStorage; auth sigue en Supabase Auth.
  function showView(id,params={}){
    currentView=id;
    renderNav();
    const host=document.getElementById('viewsHost');
    host.innerHTML='';
    const v=document.createElement('section');
    v.className='view active';
    host.appendChild(v);
    const fn=RENDERERS[id];
    if(!fn){v.innerHTML=`<div class="empty-state"><span class="es-emoji">🧭</span>Esta sección no está disponible todavía.</div>`;return}
    try{fn(v,params)}catch(e){console.error('Vista '+id,e);v.innerHTML='<div class="empty-state"><span class="es-emoji">⚠️</span>No se pudo cargar esta sección.</div>';}
    try{sessionStorage.setItem(V4_ROUTE_KEY,id);sessionStorage.setItem(V4_PARAMS_KEY,JSON.stringify(params||{}))}catch{}
    window.scrollTo({top:0,behavior:'auto'});
  }

  function updateSidebar(){
    if(!CURRENT_USER)return;
    const roleFlag=document.getElementById('roleFlag');
    if(roleFlag)roleFlag.textContent=CURRENT_USER.role==='teacher'?'Panel Docente':`Estudiante${PROFILE?.grade_id?' · Grado '+gradeName(PROFILE.grade_id):''}`;
    const topName=document.getElementById('topName');
    const topRole=document.getElementById('topRole');
    if(topName)topName.textContent=fullProfileName();
    if(topRole)topRole.textContent=CURRENT_USER.role==='teacher'?'Docente':'Estudiante';
    document.getElementById('levelMini')?.classList.add('hidden');
    loadAvatarInto(document.getElementById('topAvatar'));
  }

  async function addXP(_amount,reason){
    // XP queda como compatibilidad de esquema; no se muestra ni se acumula.
    if(reason)activity(reason,'📚');
    await saveProgressSafe();
    await checkAchievementsSafe();
  }
  async function saveProgressSafe(){
    try{await saveProgress()}catch(e){console.error('Progreso:',e);v4Toast(friendly(e?.message,'No se pudo guardar tu progreso.  Inténtalo nuevamente.'),'error')}
  }
  async function checkAchievementsSafe(){
    try{await checkAchievements()}catch(e){console.error('Logros:',e)}
  }
  async function syncStudentAnswer(q,chosen,contextType,contextId){
    try{
      const {error}=await supabaseClient.from('student_answers').insert({user_id:CURRENT_USER.id,question_id:q.id,selected_option:chosen,is_correct:chosen===q.correct,context_type:contextType||null,context_id:contextId||null});
      if(error)throw error;
    }catch(e){console.error('student_answers:',e);v4Toast(friendly(e?.message,'No pudimos guardar esa respuesta. Inténtalo nuevamente.'),'error')}
  }

  // ---- Perfil y sesión. Nunca se sobrescribe un rol existente.
  async function ensureProfile(user){
    let p=await loadProfile(user.id);
    const meta=user.user_metadata||{};
    const fullName=String(meta.name||'').trim();
    const first=String(meta.first_name||'').trim();
    const last=String(meta.last_name||'').trim();
    const requestedRole=meta.role==='teacher'?'teacher':'student';
    if(!p){
      const row={id:user.id,name:fullName||[first,last].filter(Boolean).join(' ')||user.email?.split('@')[0]||'Usuario',role:requestedRole,grade_id:requestedRole==='student'?(meta.grade_id||null):null,section:requestedRole==='student'?(SECTIONS.includes(meta.section)?meta.section:null):null,first_name:first||null,last_name:last||null};
      if(requestedRole==='teacher'){row.teacher_subject_id=meta.teacher_subject_id||null;row.teacher_grades=Array.isArray(meta.teacher_grades)?meta.teacher_grades:[];row.teacher_sections=Array.isArray(meta.teacher_sections)?meta.teacher_sections:[];row.approved=false}
      let {data,error}=await supabaseClient.from('profiles').insert(row).select().single();
      if(error && requestedRole==='teacher' && /teacher_subject_id|teacher_grades|teacher_sections|approved|column/i.test(error.message||'')){
        console.error('Faltan columnas teacher_subject_id/teacher_grades/teacher_sections/approved en profiles, reintentando sin ellas:',error);
        delete row.teacher_subject_id;delete row.teacher_grades;delete row.teacher_sections;delete row.approved;
        ({data,error}=await supabaseClient.from('profiles').insert(row).select().single());
      }
      if(error)throw error;
      return data;
    }
    const patch={};
    if(!p.first_name&&first)patch.first_name=first;
    if(!p.last_name&&last)patch.last_name=last;
    if((!p.name||p.name===user.email?.split('@')[0])&&fullName)patch.name=fullName;
    if(p.role==='student'){if(!p.grade_id&&meta.grade_id)patch.grade_id=meta.grade_id;if(!p.section&&SECTIONS.includes(meta.section))patch.section=meta.section;}
    if(!p.first_name&&!first&&fullName){const parts=fullName.split(/\s+/).filter(Boolean);if(parts.length)patch.first_name=parts[0];if(!p.last_name&&parts.length>1)patch.last_name=parts.slice(1).join(' ');}
    if(Object.keys(patch).length){const {data,error}=await supabaseClient.from('profiles').update(patch).eq('id',user.id).select().single();if(error)throw error;p={...p,...data}}
    return p;
  }

  async function loginUser(user,routeOverride=null){
    try{
      CURRENT_USER=user;
      PROFILE=await ensureProfile(user);
      CURRENT_USER.role=PROFILE?.role==='teacher'?'teacher':PROFILE?.role==='admin'?'admin':'student';
      if(PROFILE?.disabled){
        await supabaseClient.auth.signOut();
        CURRENT_USER=null;PROFILE=null;PROGRESS=defaultProgress();
        document.getElementById('app').classList.add('hidden');
        document.getElementById('authScreen').classList.remove('hidden');
        document.body.classList.add('auth-active');
        const x=document.getElementById('loginError');if(x)x.innerHTML='<div class="auth-error">Tu cuenta fue deshabilitada. Contacta a un administrador.</div>';
        return;
      }
      if(CURRENT_USER.role==='teacher'&&PROFILE?.approved===false){
        await supabaseClient.auth.signOut();
        CURRENT_USER=null;PROFILE=null;PROGRESS=defaultProgress();
        document.getElementById('app').classList.add('hidden');
        document.getElementById('authScreen').classList.remove('hidden');
        document.body.classList.add('auth-active');
        const x=document.getElementById('loginError');if(x)x.innerHTML='<div class="auth-error">Tu cuenta de docente está pendiente de aprobación por un administrador. Vuelve a intentar más tarde.</div>';
        return;
      }
      if(CURRENT_USER.role==='student'){await ensureStudentData();if(PROFILE?.grade_id)PROGRESS.grade_id=PROFILE.grade_id;}else PROGRESS=defaultProgress();
      await reloadContent();
      document.getElementById('authScreen').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      document.body.classList.remove('auth-active');
      updateSidebar();
      renderNav();
      let route=routeOverride,params={};
      if(!route){try{route=sessionStorage.getItem(V4_ROUTE_KEY)||null;params=JSON.parse(sessionStorage.getItem(V4_PARAMS_KEY)||'{}')}catch{}}
      if(CURRENT_USER.role==='admin')route=route&&route.startsWith('a')?route:'aInicio';
      else if(CURRENT_USER.role==='teacher')route=route?.startsWith('t')?route:'tInicio';
      else route=route&&!route.startsWith('t')&&!route.startsWith('a')?route:'inicio';
      showView(route||'inicio',params);
    }catch(e){
      console.error('loginUser:',e);
      CURRENT_USER=null;PROFILE=null;PROGRESS=defaultProgress();
      document.getElementById('app').classList.add('hidden');
      document.getElementById('authScreen').classList.remove('hidden');
      document.body.classList.add('auth-active');
      v4Toast(friendly(e?.message,'No pudimos cargar tu cuenta. Inténtalo nuevamente.'),'error');
      throw e;
    }
  }

  async function logout(){
    try{await supabaseClient.auth.signOut()}catch(e){console.error(e)}
    CURRENT_USER=null;PROFILE=null;PROGRESS=defaultProgress();
    try{sessionStorage.removeItem(V4_ROUTE_KEY);sessionStorage.removeItem(V4_PARAMS_KEY)}catch{}
    document.getElementById('app').classList.add('hidden');document.getElementById('authScreen').classList.remove('hidden');document.body.classList.add('auth-active');
    document.getElementById('loginForm')?.reset();
  }

  function showTerms(){
    openModal(`<h3>Términos y privacidad</h3><p class="muted small">Parche Saber usa tu nombre, grado, sección, respuestas y resultados para mostrar progreso académico. Si subes una foto o archivo, se guarda en el almacenamiento del proyecto.</p><p class="muted small">Esta es una aplicación educativa de proyecto. No compartas información personal que no sea necesaria.</p><button class="btn btn-primary btn-block" id="termsOk">Entendido</button>`);
    document.getElementById('termsOk').onclick=closeModal;
  }

  function openGradeModal(first=false){
    openModal(`<h3>${first?'Selecciona tu grado y sección':'Cambiar grado y sección'}</h3><p class="muted small">Esto determina qué materiales y evaluaciones específicas aparecen para ti.</p><div class="field"><label for="gradePick">Grado</label><select id="gradePick">${gradeOptionsStrict(PROFILE?.grade_id||PROGRESS.grade_id||'')}</select></div><div class="field"><label for="sectionPick">Sección</label><select id="sectionPick">${sectionOptions(PROFILE?.section||'')}</select></div><button class="btn btn-primary btn-block" id="saveGradeBtn">Guardar</button>`);
    document.getElementById('saveGradeBtn').onclick=async()=>{
      const grade_id=document.getElementById('gradePick').value;const section=document.getElementById('sectionPick').value;
      if(!grade_id||!SECTIONS.includes(section)){v4Toast('Selecciona un grado y una sección válida.','error');return}
      try{
        await updateProfile({grade_id,section});
        PROFILE=await loadProfile(CURRENT_USER.id);
        PROGRESS.grade_id=grade_id;
        await saveProgressSafe();
        closeModal();updateSidebar();showView(currentView||'inicio',{});v4Toast('Grado y sección actualizados.');
      }catch(e){console.error(e);v4Toast(friendly(e?.message,'No se pudo guardar el grado y la sección.'),'error')}
    };
  }

  // ---- Auth: no sobrescribe role in profiles. Sección solo A/B/C/D.
  function authBoot(){
    initTheme();
    document.getElementById('tabLogin').onclick=()=>setAuthMode('login');
    document.getElementById('tabRegister').onclick=()=>setAuthMode('register');
    document.querySelectorAll('.role-opt').forEach(b=>b.onclick=()=>{document.querySelectorAll('.role-opt').forEach(x=>x.classList.remove('active'));b.classList.add('active');regRole=b.dataset.role;document.getElementById('studentRegisterFields')?.classList.toggle('hidden',regRole!=='student');document.getElementById('teacherRegisterFields')?.classList.toggle('hidden',regRole!=='teacher')});
    const form=document.getElementById('registerForm');
    if(!document.getElementById('termsCheck'))form?.insertAdjacentHTML('beforeend',`<label class="small" style="display:flex;gap:8px;align-items:flex-start;margin:8px 0"><input type="checkbox" id="termsCheck" style="width:auto;margin-top:4px"><span>Acepto que la aplicación use mis datos académicos para mostrar mi progreso.</span></label><button type="button" class="btn btn-ghost btn-sm" id="termsBtn">Ver información</button>`);
    document.getElementById('termsBtn')?.addEventListener('click',showTerms);
    if(!GRADES.length)document.getElementById('regGrade').innerHTML=gradeOptionsStrict();
    setupPasswordToggles();
    document.getElementById('regPassword')?.addEventListener('input',e=>{const hint=document.getElementById('regPasswordHint');const ok=validPassword(e.target.value);if(hint){hint.textContent=ok?'✓ Contraseña segura.':'Mínimo 8 caracteres, una mayúscula, una minúscula y un número.';hint.style.color=ok?'var(--ok)':'var(--ink-soft)'}});
    document.getElementById('loginForm').onsubmit=async e=>{e.preventDefault();const box=document.getElementById('loginError');box.innerHTML='';const btn=e.currentTarget.querySelector('button[type="submit"]');btn.disabled=true;try{const email=document.getElementById('loginEmail').value.trim();const password=document.getElementById('loginPassword').value;if(!email||!password)throw new Error('missing');const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});if(error)throw error;if(!data.user)throw new Error('missing-user');if(!data.user.email_confirmed_at && !shouldSkipEmailConfirmation()){await supabaseClient.auth.signOut();notify('Correo sin verificar','Debes confirmar tu correo electrónico antes de usar Parche Saber. Revisa tu bandeja de entrada.','warning');return}await loginUser(data.user)}catch(err){console.error('Login:',err);box.innerHTML=`<div class="auth-error">${esc(userFriendlyError(err,'Correo o contraseña incorrectos.'))}</div>`}finally{btn.disabled=false}};
    document.getElementById('registerForm').onsubmit=async e=>{e.preventDefault();const box=document.getElementById('registerError');box.innerHTML='';const btn=e.currentTarget.querySelector('button[type="submit"]');btn.disabled=true;try{const name=document.getElementById('regName').value.trim();const lastName=document.getElementById('regLastName').value.trim();const email=document.getElementById('regEmail').value.trim();const password=document.getElementById('regPassword').value;const terms=document.getElementById('termsCheck')?.checked;if(!terms)throw new Error('terms');if(!name)throw new Error('Completa tu nombre para continuar.');if(!lastName)throw new Error('Completa tu apellido para continuar.');if(!validPersonName(name))throw new Error('El nombre solo puede contener letras y espacios.');if(!validPersonName(lastName))throw new Error('El apellido solo puede contener letras y espacios.');if(name.length>40||lastName.length>40)throw new Error('El nombre y el apellido pueden tener máximo 40 caracteres cada uno.');if(!email)throw new Error('Completa tu correo para continuar.');if(!validPassword(password))throw new Error('La contraseña debe tener mínimo 8 caracteres, una mayúscula, una minúscula y un número.');const grade_id=regRole==='student'?document.getElementById('regGrade').value:null;const section=regRole==='student'?document.getElementById('regSection').value:null;if(regRole==='student'&&(!grade_id||!SECTIONS.includes(section)))throw new Error('Selecciona un grado y una sección válida.');let teacher_subject_id=null,teacher_grades=[],teacher_sections=[];if(regRole==='teacher'){teacher_subject_id=document.getElementById('regTeacherSubject').value;teacher_grades=Array.from(document.querySelectorAll('#regTeacherGrades input:checked')).map(i=>i.value);teacher_sections=Array.from(document.querySelectorAll('#teacherRegisterFields .field:last-child input:checked')).map(i=>i.value);if(!teacher_subject_id)throw new Error('Selecciona la materia que enseñas.');if(!teacher_grades.length)throw new Error('Selecciona al menos un grado que manejas.');if(!teacher_sections.length)throw new Error('Selecciona al menos una sección que manejas.')}const fullName=`${name} ${lastName}`.trim();const {data,error}=await supabaseClient.auth.signUp({email,password,options:{data:{name:fullName,first_name:name,last_name:lastName,role:regRole,grade_id,section,teacher_subject_id,teacher_grades,teacher_sections}}});if(error)throw error;if(!data.user)throw new Error('No se pudo crear la cuenta.');if((data.session&&data.user.email_confirmed_at) || (data.session && shouldSkipEmailConfirmation())){await loginUser(data.user,'inicio')}else{notify('Cuenta creada','Te enviamos un correo de confirmación. Confirma tu correo antes de iniciar sesión.','success');setAuthMode('login')}}catch(err){console.error('Registro:',err);const msg=String(err?.message||'');box.innerHTML=`<div class="auth-error">${esc(msg==='terms'?'Debes aceptar la información de privacidad para crear la cuenta.':userFriendlyError(err,'No se pudo crear la cuenta.'))}</div>`}finally{btn.disabled=false}};
    supabaseClient.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'){CURRENT_USER=null;PROFILE=null;document.body.classList.add('auth-active');return}if(session?.user&&!CURRENT_USER&&(session.user.email_confirmed_at || shouldSkipEmailConfirmation()))setTimeout(()=>loginUser(session.user),0)});
    supabaseClient.auth.getSession().then(({data})=>{if(data.session?.user&&(data.session.user.email_confirmed_at || shouldSkipEmailConfirmation()))loginUser(data.session.user);else if(data.session?.user&&!data.session.user.email_confirmed_at&&!shouldSkipEmailConfirmation())supabaseClient.auth.signOut()}).catch(e=>console.error(e));
  }

  function shouldSkipEmailConfirmation(){const host=window.location.hostname;return window.location.protocol==='file:'||host==='localhost'||host==='127.0.0.1';}
  function setTheme(theme){const safe=theme==='dark'?'dark':'light';document.documentElement.setAttribute('data-theme',safe);const b=document.getElementById('themeBtn');if(b)b.textContent=safe==='dark'?'Tema: Claro':'Tema: Oscuro';const pl=document.getElementById('publicThemeLabel');if(pl)pl.textContent=safe==='dark'?'Oscuro':'Claro';const pi=document.querySelector('#publicThemeBtn .theme-switch-icon');if(pi)pi.textContent=safe==='dark'?'☾':'☼';try{localStorage.setItem('parche_saber_theme',safe)}catch{}}
  function initTheme(){let saved=null;try{saved=localStorage.getItem('parche_saber_theme')}catch{};const prefersDark=window.matchMedia?.('(prefers-color-scheme: dark)').matches;setTheme(saved||(prefersDark?'dark':'light'))}

  // ---- Student content with strict grade filtering.
  async function renderMaterial(a,s){
    const items=resourcesBySubject(s.id).filter(r=>r.grade_id===PROGRESS.grade_id);
    if(!items.length){a.innerHTML='<div class="empty-state"><span class="es-emoji">📭</span>No hay material publicado para tu grado en esta materia.</div>';return}
    a.innerHTML='<div class="grid cols-2" id="resourceGrid"></div>';
    for(const r of items){const url=await signedResourceUrl(r);const labels={pdf:'📑 PDF',document:'📄 Documento',image:'🖼️ Imagen',video:'🎬 Video',reading:'📖 Lectura',workshop:'🛠️ Taller',other:'📎 Material'};document.getElementById('resourceGrid').insertAdjacentHTML('beforeend',`<div class="res-card"><span class="tag tag-blue">${labels[r.type]||'📎 Material'}</span><h3>${esc(r.title)}</h3><p class="small muted">${esc(r.description||'')}</p>${url?`<a class="btn btn-outline btn-sm" href="${esc(url)}" target="_blank" rel="noopener">Abrir material</a>`:r.url?`<a class="btn btn-outline btn-sm" href="${esc(r.url)}" target="_blank" rel="noopener">Abrir enlace</a>`:'<span class="small muted">Archivo no disponible.</span>'}</div>`)}
  }
  function renderStudentTests(a,s){const items=testsBySubject(s.id).filter(t=>t.published===true&&t.grade_id===PROGRESS.grade_id);a.innerHTML=items.length?`<div class="grid cols-3">${items.map(t=>`<div class="list-card"><h3>${esc(t.title)}</h3><p class="small muted">${t.question_ids?.length||0} preguntas · Grado ${esc(gradeName(t.grade_id))}</p><p class="small muted">Tema: ${esc(topicById(t.topic_id)?.title||'Todos los temas')}</p><button class="btn btn-primary btn-sm btn-block" data-id="${t.id}">Iniciar test</button></div>`).join('')}</div>`:'<div class="empty-state"><span class="es-emoji">📝</span>No hay tests publicados para tu grado.</div>';a.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>guarded(()=>showView('testRunner',{id:b.dataset.id})))}
  function renderStudentExams(a,s){const items=examsBySubject(s.id).filter(t=>t.published===true&&t.grade_id===PROGRESS.grade_id);a.innerHTML=items.length?`<div class="grid cols-3">${items.map(t=>`<div class="list-card"><h3>${esc(t.title)}</h3><p class="small muted">${t.question_ids?.length||0} preguntas · Grado ${esc(gradeName(t.grade_id))}</p><p class="small muted">Tema: ${esc(topicById(t.topic_id)?.title||'Todos los temas')}</p><button class="btn btn-primary btn-sm btn-block" data-id="${t.id}">Iniciar examen</button></div>`).join('')}</div>`:'<div class="empty-state"><span class="es-emoji">📑</span>No hay exámenes publicados para tu grado.</div>';a.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>guarded(()=>showView('examRunner',{id:b.dataset.id})))}
  function renderPracticeStrict(a,s){const pool=questionsBySubject(s.id).filter(q=>q.grade_id===PROGRESS.grade_id);feedbackState={pool,idx:0,answers:{},completed:false,mode:'practica',meta:{title:`Práctica · ${s.name}`,subjectName:s.name}};renderFeedbackV4(a,()=>showView('subjectHome',{subjectId:s.id,tab:'practica'}))}
  function renderSubjectHomeV4(v,p){const s=subjectById(p.subjectId);if(!s){v.innerHTML='<div class="empty-state"><span class="es-emoji">📚</span>Materia no encontrada.</div>';return}const tab=p.tab||'material';v.innerHTML=`<div class="breadcrumb"><a href="#" id="backMat">Mis materias</a> / ${esc(s.name)}</div><h1>${esc(subjectIcon(s))} ${esc(s.name)}</h1><p class="muted">${esc(s.description||'')}</p><div class="module-tabs">${MODULES.map(([id,l])=>`<button class="module-tab ${id===tab?'active':''}" data-tab="${id}">${l}</button>`).join('')}</div><div id="moduleArea"></div>`;v.querySelector('#backMat').onclick=e=>{e.preventDefault();showView('materias')};v.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showView('subjectHome',{subjectId:s.id,tab:b.dataset.tab}));const area=v.querySelector('#moduleArea');if(tab==='material')renderMaterial(area,s);else if(tab==='contenidos')renderContents(area,s);else if(tab==='tests')renderStudentTests(area,s);else if(tab==='examenes')renderStudentExams(area,s);else if(tab==='practica')renderPracticeStrict(area,s);else renderSubjectProgress(area,s)}

  RENDERERS.subjectHome=renderSubjectHomeV4;
  RENDERERS.materias=function(v){v.innerHTML=`<div class="breadcrumb">Mis materias</div><h1>Mis materias</h1><p class="muted">Selecciona una materia para estudiar contenidos, material y evaluaciones de tu grado.</p><div class="grid cols-5">${SUBJECTS.map(s=>`<div class="subject-card" style="--accent:var(--blue-500)" data-s="${s.id}"><div class="sc-icon">${esc(subjectIcon(s))}</div><h3>${esc(s.name)}</h3><p class="small muted">${esc(s.description||'')}</p></div>`).join('')}</div>`;v.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>showView('subjectHome',{subjectId:b.dataset.s}))}
  RENDERERS.inicio=function(v){const ans=Object.keys(PROGRESS.answered||{}).length;const acc=overallAccuracy();const ach=Object.keys(PROGRESS.achievements||{}).length;v.innerHTML=`<div class="breadcrumb">Inicio</div><h1>¡Qué más, ${esc(fullProfileName())}! 👋</h1><p class="muted">Aquí tienes tu estudio organizado por grado y sección.</p><div class="grid cols-4" style="margin:18px 0"><div class="stat-card"><div class="sval">${ans}</div><div class="slabel">Preguntas respondidas</div></div><div class="stat-card"><div class="sval">${acc}%</div><div class="slabel">Aciertos</div></div><div class="stat-card"><div class="sval">${Object.keys(PROGRESS.tests_completed||{}).length}</div><div class="slabel">Tests realizados</div></div><div class="stat-card"><div class="sval">${ach}/${ACHIEVEMENTS.length}</div><div class="slabel">Logros</div></div></div><div class="page-card"><span class="section-eyebrow">Tu grupo</span><p><b>${esc(gradeName(PROFILE?.grade_id||''))}</b> · Sección <b>${esc(PROFILE?.section||'—')}</b></p></div><div class="page-card"><span class="section-eyebrow">Materias</span><div class="grid cols-5">${SUBJECTS.map(s=>`<div class="subject-card" data-s="${s.id}"><div class="sc-icon">${esc(subjectIcon(s))}</div><h3>${esc(s.name)}</h3></div>`).join('')}</div></div>`;v.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>showView('subjectHome',{subjectId:b.dataset.s}))}

  // ---- Feedback en español con imagen y persistencia inmediata.
  function renderFeedbackV4(a,back){const pool=feedbackState.pool||[];if(!pool.length){a.innerHTML='<div class="empty-state">No hay preguntas disponibles para esta materia y grado.</div>';return}if(feedbackState.idx>=pool.length){const current=feedbackState.answers||{};const c=pool.filter(q=>current[q.id]===q.correct).length;const pct=Math.round(c/pool.length*100);a.innerHTML=`<div class="page-card center"><h2>🎉 Ronda completada</h2><div class="grid cols-3"><div class="stat-card"><div class="sval">${c}/${pool.length}</div><div class="slabel">Correctas</div></div><div class="stat-card"><div class="sval">${pct}%</div><div class="slabel">Aciertos</div></div><div class="stat-card"><div class="sval">${pool.length-c}</div><div class="slabel">Incorrectas</div></div></div><div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="restart">Repetir</button><button class="btn btn-outline btn-sm" id="back">Volver</button><button class="btn btn-ghost btn-sm" id="review">Repasar errores</button></div></div>`;a.querySelector('#restart').onclick=()=>{feedbackState.idx=0;feedbackState.answers={};feedbackState.completed=false;renderFeedbackV4(a,back)};a.querySelector('#back').onclick=back;a.querySelector('#review').onclick=()=>showView('repaso');if(feedbackState.mode==='test'&&!feedbackState.completed){feedbackState.completed=true;PROGRESS.tests_completed[feedbackState.meta.testId]={score:c,total:pool.length,percentage:pct,answers:current};saveProgressSafe();supabaseClient.from('test_attempts').insert({user_id:CURRENT_USER.id,test_id:feedbackState.meta.testId,score:c,total:pool.length,percentage:pct,answers:current}).then(({error})=>{if(error)console.error(error)});checkAchievementsSafe()}return}const q=pool[feedbackState.idx],chosen=feedbackState.answers[q.id];a.innerHTML=`<div class="quiz-card"><div class="quiz-meta"><span class="quiz-progress">Pregunta ${feedbackState.idx+1} de ${pool.length}</span><span class="tag tag-blue">${esc(q.difficulty)}</span></div><div class="quiz-question">${esc(q.question)}</div><div id="fbImage"></div><div id="fbOptions"></div><div id="fbExplain"></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button class="btn btn-outline btn-sm" id="prev" ${feedbackState.idx===0?'disabled':''}>← Anterior</button><button class="btn btn-primary btn-sm" id="next" ${chosen===undefined?'disabled':''}>${feedbackState.idx===pool.length-1?'Finalizar':'Siguiente →'}</button></div></div>`;if(q.image_url)signedQuestionImage(q).then(url=>{if(url)a.querySelector('#fbImage').innerHTML=`<div class="page-card center"><img src="${esc(url)}" alt="Imagen de la pregunta" style="max-width:100%;max-height:340px;border-radius:10px"></div>`});a.querySelector('#fbOptions').innerHTML=(q.options||[]).map((o,i)=>`<button class="qoption" data-i="${i}" ${chosen!==undefined?'disabled':''}><span class="qletter">${String.fromCharCode(65+i)}</span><span>${esc(o)}</span></button>`).join('');const paint=(choice)=>{a.querySelectorAll('.qoption').forEach((b,i)=>{b.disabled=true;if(i===q.correct)b.classList.add('correct');else if(i===choice)b.classList.add('wrong')});const ok=choice===q.correct;a.querySelector('#fbExplain').innerHTML=`<div class="feedback-box ${ok?'correct':'wrong'}"><b>${ok?'✅ ¡Correcto!':'❌ Respuesta incorrecta'}</b><p><b>¿Por qué?</b> ${esc(q.why||'Revisa el contenido del tema.')}</p>${!ok&&q.why_wrong?.[choice]?`<p><b>Tu respuesta:</b> ${esc(q.why_wrong[choice])}</p>`:''}</div>`;a.querySelector('#next').disabled=false};if(chosen!==undefined)paint(chosen);a.querySelectorAll('.qoption').forEach(b=>b.onclick=async()=>{if(feedbackState.answers[q.id]!==undefined)return;const choice=Number(b.dataset.i);feedbackState.answers[q.id]=choice;if(PROGRESS.answered[q.id]===undefined){PROGRESS.answered[q.id]=choice;if(choice===q.correct)PROGRESS.correct_count=(PROGRESS.correct_count||0)+1;else{PROGRESS.wrong_count=(PROGRESS.wrong_count||0)+1;PROGRESS.wrong_ids[q.id]=true}activity(`Respuesta registrada en ${subjectById(q.subject_id)?.name||'materia'}` ,choice===q.correct?'✅':'❌');await saveProgressSafe()}else if(choice===q.correct){delete PROGRESS.wrong_ids[q.id];await saveProgressSafe()}await syncStudentAnswer(q,choice,feedbackState.mode,feedbackState.meta.testId||null);paint(choice);await checkAchievementsSafe()});a.querySelector('#prev').onclick=()=>{if(feedbackState.idx>0){feedbackState.idx--;renderFeedbackV4(a,back)}};a.querySelector('#next').onclick=()=>{if(feedbackState.answers[q.id]!==undefined){feedbackState.idx++;renderFeedbackV4(a,back)}}}
  RENDERERS.testRunner=function(v,p){const t=TESTS.find(x=>x.id===p.id);if(!t){v.innerHTML='<div class="empty-state">Test no encontrado o no disponible.</div>';return}const pool=t.question_ids.map(id=>QUESTIONS.find(q=>q.id===id)).filter(q=>q&&q.grade_id===PROFILE?.grade_id);feedbackState={pool,idx:0,answers:{},completed:false,mode:'test',meta:{title:t.title,testId:t.id,subjectName:subjectById(t.subject_id)?.name||''}};renderFeedbackV4(v,()=>showView('subjectHome',{subjectId:t.subject_id,tab:'tests'}))}

  // ---- Exámenes + simulacros diferidos con temporizador.
  function clearSimTimer(){if(simTimer){clearInterval(simTimer);simTimer=null}}
  function formatTime(sec){const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
  function buildDeferredPool(ids){return ids.map(id=>QUESTIONS.find(q=>q.id===id)).filter(Boolean)}
  function startDeferred(pool,mode,meta,timeSeconds){deferredState={pool,idx:0,answers:{},mode,meta,finished:false,endAt:timeSeconds?Date.now()+timeSeconds*1000:null};examGuard=()=>!deferredState.finished&&Object.keys(deferredState.answers).length>0;}
  function renderDeferredV4(v,back){const total=deferredState.pool.length;if(!total){v.innerHTML='<div class="empty-state">No hay preguntas disponibles.</div>';return}if(deferredState.finished){renderDeferredResultsV4(v,back);return}if(deferredState.endAt&&Date.now()>=deferredState.endAt){finishDeferredV4(v,back,true);return}const q=deferredState.pool[deferredState.idx],chosen=deferredState.answers[q.id],left=deferredState.endAt?Math.max(0,Math.ceil((deferredState.endAt-Date.now())/1000)):null;v.innerHTML=`<div class="quiz-card"><div class="quiz-meta"><span class="quiz-progress">Pregunta ${deferredState.idx+1} de ${total}</span>${left!==null?`<span id="simTimer" class="timer-chip ${left<300?'warning':''}">${formatTime(left)}</span>`:''}</div><div class="pbar"><div style="width:${Math.round((deferredState.idx+1)/total*100)}%"></div></div><div class="quiz-question">${esc(q.question)}</div><div id="dImage"></div><div id="dOpts"></div><div style="display:flex;justify-content:space-between;gap:8px;margin-top:16px;flex-wrap:wrap"><button class="btn btn-outline btn-sm" id="dPrev" ${deferredState.idx===0?'disabled':''}>← Anterior</button><span class="small muted">${Object.keys(deferredState.answers).length}/${total} respondidas</span>${deferredState.idx===total-1?'<button class="btn btn-primary btn-sm" id="dFinish">Enviar y finalizar</button>':'<button class="btn btn-primary btn-sm" id="dNext">Siguiente →</button>'}</div></div>`;if(q.image_url)signedQuestionImage(q).then(url=>{if(url)v.querySelector('#dImage').innerHTML=`<div class="page-card center"><img src="${esc(url)}" alt="Imagen de la pregunta" style="max-width:100%;max-height:340px;border-radius:10px"></div>`});v.querySelector('#dOpts').innerHTML=(q.options||[]).map((o,i)=>`<button class="qoption ${chosen===i?'selected-deferred':''}" data-i="${i}"><span class="qletter">${String.fromCharCode(65+i)}</span><span>${esc(o)}</span></button>`).join('');v.querySelectorAll('.qoption').forEach(b=>b.onclick=()=>{deferredState.answers[q.id]=Number(b.dataset.i);renderDeferredV4(v,back)});v.querySelector('#dPrev').onclick=()=>{if(deferredState.idx>0){deferredState.idx--;renderDeferredV4(v,back)}};if(v.querySelector('#dNext'))v.querySelector('#dNext').onclick=()=>{deferredState.idx++;renderDeferredV4(v,back)};if(v.querySelector('#dFinish'))v.querySelector('#dFinish').onclick=()=>finishDeferredV4(v,back,false);clearSimTimer();if(deferredState.endAt){simTimer=setInterval(()=>{const el=v.querySelector('#simTimer');const l=Math.max(0,Math.ceil((deferredState.endAt-Date.now())/1000));if(el){el.textContent=formatTime(l);el.classList.toggle('warning',l<300)}if(l<=0){clearSimTimer();finishDeferredV4(v,back,true)}},1000)}}
  async function finishDeferredV4(v,back,timeExpired=false){clearSimTimer();const unanswered=deferredState.pool.filter(q=>deferredState.answers[q.id]===undefined).length;if(unanswered&&!timeExpired){v4Toast(`Todavía tienes ${unanswered} pregunta(s) sin responder.`,'error');return}let correct=0;const bySubject={};const answers={...deferredState.answers};const answerRows=[];for(const q of deferredState.pool){const chosen=answers[q.id];const ok=chosen!==undefined&&chosen===q.correct;if(ok)correct++;if(!bySubject[q.subject_id])bySubject[q.subject_id]={correct:0,total:0};bySubject[q.subject_id].total++;if(ok)bySubject[q.subject_id].correct++;if(chosen!==undefined)answerRows.push({user_id:CURRENT_USER.id,question_id:q.id,selected_option:chosen,is_correct:ok,context_type:deferredState.mode,context_id:deferredState.meta.examId||deferredState.meta.simId||null})}const total=deferredState.pool.length,pct=total?Math.round(correct/total*100):0;for(const row of answerRows){if(PROGRESS.answered[row.question_id]===undefined){PROGRESS.answered[row.question_id]=row.selected_option;if(row.is_correct)PROGRESS.correct_count=(PROGRESS.correct_count||0)+1;else{PROGRESS.wrong_count=(PROGRESS.wrong_count||0)+1;PROGRESS.wrong_ids[row.question_id]=true}}}await saveProgressSafe();try{if(answerRows.length)await supabaseClient.from('student_answers').insert(answerRows)}catch(e){console.error(e)}const record={date:Date.now(),score:correct,total,pct,percentage:pct,bySubject,answers,title:deferredState.meta.title,mode:deferredState.meta.mode||deferredState.mode,size:total,timeExpired};if(deferredState.mode==='simulacro'){PROGRESS.simulacro_history=[...(PROGRESS.simulacro_history||[]),record]}else{PROGRESS.exams_completed[deferredState.meta.examId]=record;try{await supabaseClient.from('exam_attempts').insert({user_id:CURRENT_USER.id,exam_id:deferredState.meta.examId,score:correct,total,percentage:pct,by_subject:bySubject,answers})}catch(e){console.error(e)}}deferredState.finished=true;examGuard=null;await saveProgressSafe();await checkAchievementsSafe();renderDeferredResultsV4(v,back)}
  function renderDeferredResultsV4(v,back){const total=deferredState.pool.length,correct=deferredState.pool.filter(q=>deferredState.answers[q.id]===q.correct).length,pct=total?Math.round(correct/total*100):0;v.innerHTML=`<div class="page-card center"><h2>🎉 Resultados</h2><p class="muted">${esc(deferredState.meta.title||'Evaluación')} · ${esc(deferredState.meta.mode||'Evaluación')}</p><div class="grid cols-3"><div class="stat-card"><div class="sval">${correct}/${total}</div><div class="slabel">Correctas</div></div><div class="stat-card"><div class="sval">${pct}%</div><div class="slabel">Aciertos</div></div><div class="stat-card"><div class="sval">${total-correct}</div><div class="slabel">Incorrectas</div></div></div><p class="small muted">${deferredState.meta.timeExpired?'El tiempo terminó. Se calificaron las respuestas registradas.':'Evaluación enviada correctamente.'}</p><div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="again">Intentar de nuevo</button><button class="btn btn-outline btn-sm" id="back">Volver</button><button class="btn btn-ghost btn-sm" id="rev">Repasar mis errores</button></div></div>`;v.querySelector('#again').onclick=()=>{startDeferred(deferredState.pool.slice(),deferredState.mode,deferredState.meta,deferredState.meta.durationSec);renderDeferredV4(v,back)};v.querySelector('#back').onclick=back;v.querySelector('#rev').onclick=()=>showView('repaso')}
  RENDERERS.examRunner=function(v,p){const e=EXAMS.find(x=>x.id===p.id);if(!e){v.innerHTML='<div class="empty-state">Examen no encontrado o no disponible.</div>';return}const pool=buildDeferredPool(e.question_ids).filter(q=>q.grade_id===PROFILE?.grade_id);startDeferred(pool,'exam',{title:e.title,examId:e.id,mode:'Examen'},null);renderDeferredV4(v,()=>showView('subjectHome',{subjectId:e.subject_id,tab:'examenes'}))}

  function questionsForSim(subjectId,size){let qs=QUESTIONS.filter(q=>q.grade_id===PROFILE?.grade_id&&(subjectId==='all'||q.subject_id===subjectId));if(qs.length<size)return qs.sort(()=>Math.random()-.5);return qs.sort(()=>Math.random()-.5).slice(0,size)}
  RENDERERS.simulacro=function(v){if(deferredState.mode==='simulacro'&&deferredState.pool.length&&!deferredState.finished){renderDeferredV4(v,()=>showView('simulacro'));return}v.innerHTML=`<div class="breadcrumb">Simulacro Saber 11</div><h1>Simulacros</h1><p class="muted">Elige un área o una prueba general. En el modo extendido se recomienda hacer pausas.</p><div class="grid cols-2"><div class="page-card"><h3>Modalidad</h3><div class="field"><label>Tipo</label><select id="simArea"><option value="all">General · todas las áreas</option>${SUBJECTS.map(s=>`<option value="${s.id}">${esc(subjectIcon(s))} ${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label>Preguntas</label><select id="simSize">${SIM_SIZES.map(n=>`<option value="${n}">${n} preguntas</option>`).join('')}</select></div><div class="field"><label>Tiempo</label><select id="simTime">${SIM_TIMES.map(t=>`<option value="${t.minutes}">${esc(t.label)}</option>`).join('')}</select></div><button class="btn btn-primary btn-block" id="startSim">Iniciar simulacro</button></div><div class="page-card"><h3>Tu historial</h3>${(PROGRESS.simulacro_history||[]).slice().reverse().slice(0,8).map(h=>`<div style="padding:7px 0;border-bottom:1px solid var(--bg-2)"><b>${esc(h.title||'Simulacro')}</b><br><span class="small muted">${h.score}/${h.total} · ${h.pct||h.percentage||0}%</span></div>`).join('')||'<p class="small muted">Aún no has completado un simulacro.</p>'}</div></div><div class="page-card"><span class="section-eyebrow">Opciones disponibles</span><p class="small muted">25 preguntas: entrenamiento rápido · 50 preguntas: entrenamiento completo · 100 preguntas: prueba extensa. La opción de 9 horas es un modo extendido y debe hacerse con pausas.</p></div>`;v.querySelector('#startSim').onclick=()=>{const area=v.querySelector('#simArea').value,size=Number(v.querySelector('#simSize').value),mins=Number(v.querySelector('#simTime').value);const pool=questionsForSim(area,size);if(pool.length<size){v4Toast(`No hay suficientes preguntas para este simulacro. Se necesitan ${size} preguntas y solo hay ${pool.length} disponibles para tu grado.`,'error');return}const title=area==='all'?'Simulacro general Saber 11':`Simulacro · ${subjectById(area)?.name||'Área'}`;deferredState={pool:pool.slice(0,size),idx:0,answers:{},mode:'simulacro',meta:{title,mode:area==='all'?'General':'Por área',size,timeMinutes:mins,durationSec:mins*60,simId:'sim-'+Date.now(),timeExpired:false},finished:false,endAt:Date.now()+mins*60*1000};examGuard=()=>!deferredState.finished&&Object.keys(deferredState.answers).length>0;renderDeferredV4(v,()=>showView('simulacro'))}}

  // ---- Repaso sin bucle: máximo 3 intentos.
  RENDERERS.repaso=function(v){reviewState.pool=QUESTIONS.filter(q=>PROGRESS.wrong_ids[q.id]&&!PROGRESS.mastered_questions[q.id]);reviewState.idx=0;reviewState.filter='all';const render=()=>{const a=v.querySelector('#reviewArea');if(!reviewState.pool.length){a.innerHTML='<div class="empty-state"><span class="es-emoji">🙌</span>No tienes errores pendientes.</div>';return}const q=reviewState.pool[reviewState.idx],n=Number(PROGRESS.review_attempts[q.id]||0);a.innerHTML=`<div class="quiz-card"><div class="quiz-meta"><span>Repaso ${reviewState.idx+1} de ${reviewState.pool.length}</span><span class="tag tag-media">Intentos ${n}/3</span></div><div class="quiz-question">${esc(q.question)}</div><div id="ro"></div><div id="rx"></div></div>`;a.querySelector('#ro').innerHTML=(q.options||[]).map((o,i)=>`<button class="qoption" data-i="${i}"><span class="qletter">${String.fromCharCode(65+i)}</span><span>${esc(o)}</span></button>`).join('');a.querySelectorAll('.qoption').forEach(b=>b.onclick=async()=>{const choice=Number(b.dataset.i);a.querySelectorAll('.qoption').forEach((x,i)=>{x.disabled=true;if(i===q.correct)x.classList.add('correct');else if(i===choice)x.classList.add('wrong')});if(choice===q.correct){PROGRESS.mastered_questions[q.id]=true;delete PROGRESS.wrong_ids[q.id];delete PROGRESS.review_attempts[q.id];a.querySelector('#rx').innerHTML='<div class="feedback-box correct"><b>✅ Dominada</b><p>La pregunta salió de tu lista de repaso.</p></div>';activity('Pregunta dominada','🏅');await saveProgressSafe();await checkAchievementsSafe()}else{const next=n+1;PROGRESS.review_attempts[q.id]=next;if(next>=3){delete PROGRESS.wrong_ids[q.id];activity(`Refuerzo recomendado: ${topicById(q.topic_id)?.title||'tema'}`,'📘');a.querySelector('#rx').innerHTML='<div class="feedback-box wrong"><b>📘 Refuerzo recomendado</b><p>Después de tres intentos, esta pregunta sale de la ronda. Vuelve al contenido del tema y prueba otra vez más adelante.</p></div>'}else{a.querySelector('#rx').innerHTML=`<div class="feedback-box wrong"><b>❌ Revisa la explicación</b><p>${esc(q.why_wrong?.[choice]||q.why||'Repasa el tema y vuelve a intentarlo.')}</p></div>`}await saveProgressSafe()}setTimeout(()=>{reviewState.pool=QUESTIONS.filter(x=>PROGRESS.wrong_ids[x.id]&&!PROGRESS.mastered_questions[x.id]&&(reviewState.filter==='all'||x.subject_id===reviewState.filter));reviewState.idx=0;render()},700)});};v.innerHTML=`<div class="breadcrumb">Repaso</div><h1>Repasa tus errores</h1><p class="muted">Una pregunta no puede quedarse en un bucle infinito: después de tres intentos sin dominarla, sale de esta ronda.</p><div class="tabs"><button class="tab active" data-f="all">Todas</button>${SUBJECTS.map(s=>`<button class="tab" data-f="${s.id}">${esc(s.name)}</button>`).join('')}</div><div id="reviewArea"></div>`;v.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{reviewState.filter=b.dataset.f;reviewState.pool=QUESTIONS.filter(q=>PROGRESS.wrong_ids[q.id]&&!PROGRESS.mastered_questions[q.id]&&(b.dataset.f==='all'||q.subject_id===b.dataset.f));reviewState.idx=0;v.querySelectorAll('[data-f]').forEach(x=>x.classList.toggle('active',x===b));render()});render()}

  // ---- Perfil estudiante y docente con foto visible.
  async function renderProfileV4(v){
    v.innerHTML=`<div class="breadcrumb">Perfil</div><h1>Mi perfil</h1><div class="page-card"><div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><div id="profilePhoto" class="profile-photo-lg">${esc(fullProfileName().charAt(0).toUpperCase())}</div><div style="flex:1;min-width:220px"><h3>${esc(fullProfileName())}</h3><p class="small muted">${esc(CURRENT_USER.email)} · ${CURRENT_USER.role==='teacher'?'Docente':'Estudiante'}</p><div class="file-control"><button type="button" class="btn btn-outline btn-sm" id="chooseAvatarBtn">Elegir foto</button><span class="file-name" id="avatarFileName">Ningún archivo seleccionado</span><input id="avatarInput" type="file" accept="image/png,image/jpeg,image/webp"></div></div></div></div><div class="grid cols-2"><div class="page-card"><h3>Datos personales</h3><div class="field"><label>Nombre</label><input id="pFirst" maxlength="40" value="${esc(PROFILE?.first_name||'')}"></div><div class="field"><label>Apellido</label><input id="pLast" maxlength="40" value="${esc(PROFILE?.last_name||'')}"></div><button class="btn btn-primary btn-sm" id="saveProfileName">Guardar datos</button></div><div class="page-card"><h3>Información académica</h3><p><b>Grado:</b> ${esc(gradeName(PROFILE?.grade_id||''))||'Sin definir'}<br><b>Sección:</b> ${esc(PROFILE?.section||'Sin definir')}</p>${CURRENT_USER.role==='student'?'<button class="btn btn-outline btn-sm" id="changeGrade">Cambiar grado y sección</button>':''}</div></div><div class="page-card" style="margin-top:16px"><h3>Seguridad de la cuenta</h3><p class="small muted">Eliminar tu cuenta es una acción definitiva.</p><button class="btn btn-danger btn-sm" id="deleteMyAccount">Eliminar mi cuenta</button></div>`;
    const box=v.querySelector('#profilePhoto');
    if(PROFILE?.avatar_url){const url=await getSignedUrl(BUCKETS.avatar,PROFILE.avatar_url);if(url)box.innerHTML=`<img src="${esc(url)}" alt="Foto de perfil">`}
    v.querySelector('#chooseAvatarBtn').onclick=()=>v.querySelector('#avatarInput').click();
    v.querySelector('#avatarInput').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>5*1024*1024){v4Toast('La foto debe pesar 5 MB o menos.','error');return}try{const ext=f.name.split('.').pop().toLowerCase();const path=`${CURRENT_USER.id}/avatar.${ext}`;const {error}=await supabaseClient.storage.from(BUCKETS.avatar).upload(path,f,{upsert:true,contentType:f.type,cacheControl:'3600'});if(error)throw error;await updateProfile({avatar_url:path});PROFILE=await loadProfile(CURRENT_USER.id);await updateSidebar();v4Toast('Foto de perfil actualizada.')}catch(err){console.error(err);v4Toast(friendly(err?.message,'No se pudo guardar la foto de perfil.'),'error')}};
    v.querySelector('#saveProfileName').onclick=async()=>{try{const first=v.querySelector('#pFirst').value.trim(),last=v.querySelector('#pLast').value.trim();if(!first||!validPersonName(first))throw new Error('Completa un nombre válido.');if(!last||!validPersonName(last))throw new Error('Completa un apellido válido.');const name=`${first} ${last}`;await updateProfile({first_name:first,last_name:last,name});try{await supabaseClient.auth.updateUser({data:{first_name:first,last_name:last,name}})}catch(e){console.warn(e)}PROFILE=await loadProfile(CURRENT_USER.id);PROGRESS.name=name;if(CURRENT_USER.role==='student'){PROGRESS.grade_id=PROFILE?.grade_id||PROGRESS.grade_id;await saveProgressSafe()}updateSidebar();await renderProfileV4(v);v4Toast('Nombre y apellido actualizados correctamente.')}catch(e){console.error(e);v4Toast(userFriendlyError(e,'No se pudo actualizar el perfil.'),'error')}};
    v.querySelector('#changeGrade')?.addEventListener('click',()=>openGradeModal(false));
    v.querySelector('#deleteMyAccount').onclick=deleteCurrentAccount;
  }
  RENDERERS.perfil=renderProfileV4;
  RENDERERS.tPerfil=async function(v){await renderProfileV4(v)};

  // ---- Logros ampliados; XP fuera de la interfaz.
  ACHIEVEMENTS.push(
    {id:'ach-25-q',icon:'🎯',title:'25 preguntas',desc:'Respondiste 25 preguntas.',check:p=>Object.keys(p.answered||{}).length>=25},
    {id:'ach-100-q',icon:'💪',title:'100 preguntas',desc:'Respondiste 100 preguntas.',check:p=>Object.keys(p.answered||{}).length>=100},
    {id:'ach-25-correct',icon:'🧠',title:'25 aciertos',desc:'Lograste 25 respuestas correctas.',check:p=>(p.correct_count||0)>=25},
    {id:'ach-100-correct',icon:'🌟',title:'100 aciertos',desc:'Lograste 100 respuestas correctas.',check:p=>(p.correct_count||0)>=100},
    {id:'ach-10-topics',icon:'📚',title:'10 temas estudiados',desc:'Visitaste 10 temas.',check:p=>Object.keys(p.visited_sections||{}).length>=10},
    {id:'ach-sim25',icon:'🏃',title:'Simulacro de 25',desc:'Terminaste un simulacro de 25 preguntas.',check:p=>(p.simulacro_history||[]).some(x=>x.total===25)},
    {id:'ach-sim50',icon:'🏅',title:'Simulacro de 50',desc:'Terminaste un simulacro de 50 preguntas.',check:p=>(p.simulacro_history||[]).some(x=>x.total===50)},
    {id:'ach-sim100',icon:'🏆',title:'Prueba extensa',desc:'Terminaste un simulacro de 100 preguntas.',check:p=>(p.simulacro_history||[]).some(x=>x.total===100)},
    {id:'ach-extended',icon:'⏱️',title:'Modo extendido',desc:'Completaste un simulacro en modo extendido.',check:p=>(p.simulacro_history||[]).some(x=>String(x.mode||'').toLowerCase().includes('extendido'))}
  );
  RENDERERS.logros=function(v){const visibleAchievements=ACHIEVEMENTS.filter(a=>!String(a.id).includes('xp'));const done=visibleAchievements.filter(a=>PROGRESS.achievements[a.id]).length;v.innerHTML=`<div class="breadcrumb">Logros</div><h1>🏆 Logros</h1><p class="muted">${done}/${visibleAchievements.length} desbloqueados.</p><div class="grid cols-4">${ACHIEVEMENTS.map(a=>`<div class="page-card center" style="opacity:${PROGRESS.achievements[a.id]?1:.42}"><div style="font-size:1.8rem">${a.icon}</div><b>${esc(a.title)}</b><p class="small muted">${esc(a.desc)}</p></div>`).join('')}</div>`}

  // ---- Docente: temas, materiales, preguntas, evaluaciones, resultados.
  RENDERERS.tInicio=function(v){
    v.innerHTML=`<div class="breadcrumb">Panel docente</div><h1>¡Hola, ${esc(PROFILE?.name||'profe')}! 👩‍🏫</h1><p class="muted">Administra contenido por materia y grado.</p><div class="grid cols-4"><div class="stat-card"><div class="sval">${SUBJECTS.length}</div><div class="slabel">Materias</div></div><div class="stat-card"><div class="sval">${QUESTIONS.length}</div><div class="slabel">Preguntas</div></div><div class="stat-card"><div class="sval">${TESTS.length+EXAMS.length}</div><div class="slabel">Evaluaciones</div></div><div class="stat-card"><div class="sval">${TOPICS.length}</div><div class="slabel">Temas</div></div></div><div class="page-card" style="margin-top:16px"><span class="section-eyebrow">Estudiantes por grado y sección</span><div id="teacherStudentStats" class="table-wrap"><span class="small muted">Cargando…</span></div></div><div class="grid cols-2"><div class="page-card"><span class="section-eyebrow">Accesos rápidos</span><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-outline" onclick="showView('tTemas')">🧠 Temas</button><button class="btn btn-outline" onclick="showView('tPreguntas')">❓ Preguntas</button><button class="btn btn-outline" onclick="showView('tEvaluaciones')">📝 Evaluaciones</button><button class="btn btn-outline" onclick="showView('tResultados')">📊 Resultados</button></div></div><div class="page-card"><span class="section-eyebrow">Importante</span><p class="small muted">Todo lo que publiques debe tener un grado asignado para que llegue al grupo correcto.</p></div></div>`;
    (async()=>{try{const {data,error}=await supabaseClient.from('profiles').select('id,name,grade_id,section').eq('role','student').order('name');if(error)throw error;const rows=[];for(const g of GRADES){for(const s of SECTIONS){const n=(data||[]).filter(p=>p.grade_id===g.id&&p.section===s).length;rows.push(`<tr><td>${esc(g.name)}</td><td>${s}</td><td>${n}</td></tr>`)}}const total=(data||[]).length;v.querySelector('#teacherStudentStats').innerHTML=`<table class="datatable"><thead><tr><th>Grado</th><th>Sección</th><th>Estudiantes</th></tr></thead><tbody>${rows.join('')}</tbody><tfoot><tr><th colspan="2">Total general</th><th>${total}</th></tr></tfoot></table>`}catch(e){console.error('Student stats:',e);const el=v.querySelector('#teacherStudentStats');if(el)el.innerHTML='<span class="small muted">No se pudo consultar la cantidad de estudiantes.</span>'}})();
  }

  RENDERERS.tTemas=function(v){
    let activeSubject=SUBJECTS[0]?.id||'';
    let activeGrade=GRADES[0]?.id||'';
    v.innerHTML=`<div class="breadcrumb">Docente / Temas</div>
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div><h1>Temas por grado</h1><p class="muted">Cada tema pertenece a una materia y a un grado específico.</p></div>
        <button class="btn btn-primary btn-sm" id="addTopic">+ Nuevo tema</button>
      </div>
      <div class="grid cols-2 no-print">
        <div class="field"><label for="topicSubjectFilter">Materia</label><select id="topicSubjectFilter">${SUBJECTS.map(s=>`<option value="${esc(s.id)}">${esc(subjectIcon(s))} ${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="topicGradeFilter">Grado</label><select id="topicGradeFilter">${gradeOptionsStrict()}</select></div>
      </div>
      <div id="topicList"></div>`;

    const subjectEl=v.querySelector('#topicSubjectFilter');
    const gradeEl=v.querySelector('#topicGradeFilter');
    if(activeSubject)subjectEl.value=activeSubject;
    if(activeGrade)gradeEl.value=activeGrade;

    const render=()=>{
      activeSubject=subjectEl.value;
      activeGrade=gradeEl.value;
      const ts=TOPICS.filter(t=>t.subject_id===activeSubject&&t.grade_id===activeGrade);
      v.querySelector('#topicList').innerHTML=ts.length
        ? `<div class="grid cols-2">${ts.map(t=>`<div class="list-card">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
              <div><span class="tag tag-blue">Grado ${esc(gradeName(t.grade_id))}</span><h3 style="margin-top:8px">${esc(t.title)}</h3></div>
              <span class="small muted">${esc(subjectById(t.subject_id)?.name||'')}</span>
            </div>
            <p class="small muted">${esc(t.description||'')}</p>
            <div class="row-actions">
              <button class="btn btn-ghost btn-sm" data-edit="${esc(t.id)}">Editar</button>
              <button class="btn btn-danger btn-sm" data-del="${esc(t.id)}">Eliminar</button>
            </div>
          </div>`).join('')}</div>`
        : '<div class="empty-state"><span class="es-emoji">🧠</span>No hay temas para esta combinación de materia y grado.</div>';

      v.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openTopicForm(TOPICS.find(x=>x.id===b.dataset.edit)));
      v.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>runTeacherAction(async()=>{
        if(await confirmBox('Eliminar tema','Esta acción eliminará el tema de Supabase.')){
          const {error}=await supabaseClient.from('topics').delete().eq('id',b.dataset.del);
          if(error)throw error;
          await reloadContent();
          render();
          v4Toast('Tema eliminado correctamente.');
        }
      },'No se pudo eliminar el tema.'));
    };

    subjectEl.onchange=render;
    gradeEl.onchange=render;
    v.querySelector('#addTopic').onclick=()=>openTopicForm(null);
    render();

    function openTopicForm(existing){
      openModal(`<h3>${existing?'Editar':'Crear'} tema</h3>
        <div class="field"><label>Materia</label><select id="tfSubject">${SUBJECTS.map(s=>`<option value="${esc(s.id)}" ${existing?.subject_id===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Grado</label><select id="tfGrade">${gradeOptionsStrict(existing?.grade_id||'')}</select></div>
        <div class="field"><label>Título</label><input id="tfTitle" value="${esc(existing?.title||'')}"></div>
        <div class="field"><label>Descripción</label><textarea id="tfDesc">${esc(existing?.description||'')}</textarea></div>
        <div class="field"><label>Contenido</label><textarea id="tfContent" rows="5">${esc(existing?.content||'')}</textarea></div>
        <button class="btn btn-primary btn-block" id="tfSave">${existing?'Guardar cambios':'Crear tema'}</button>`);

      document.getElementById('tfSave').onclick=()=>runTeacherAction(async()=>{
        const subject_id=document.getElementById('tfSubject').value;
        const grade_id=document.getElementById('tfGrade').value;
        const title=document.getElementById('tfTitle').value.trim();
        if(!grade_id){v4Toast('Debes asignar un grado al tema.','error');return}
        if(!title){v4Toast('Escribe un título para el tema.','error');return}
        const row={
          id:existing?.id||uid('topic'),
          subject_id,grade_id,title,
          description:document.getElementById('tfDesc').value.trim(),
          content:document.getElementById('tfContent').value,
          sort_order:existing?.sort_order||0
        };
        const {error}=await supabaseClient.from('topics').upsert(row,{onConflict:'id'});
        if(error)throw error;
        closeModal();
        await reloadContent();
        render();
        v4Toast(existing?'Tema actualizado correctamente.':'Tema creado correctamente.');
      },'No se pudo guardar el tema.');
    }
  }

  RENDERERS.tPreguntas=function(v){let sf='all',gf='all';const render=()=>{const rows=QUESTIONS.filter(q=>q.created_by===CURRENT_USER.id&&(sf==='all'||q.subject_id===sf)&&(gf==='all'||q.grade_id===gf));v.innerHTML=`<div class="breadcrumb">Docente / Banco de preguntas</div><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h1>Banco de preguntas</h1><button class="btn btn-primary btn-sm" id="addQ">+ Crear pregunta</button></div><div class="tabs"><button class="tab ${sf==='all'?'active':''}" data-sf="all">Todas</button>${SUBJECTS.map(s=>`<button class="tab ${sf===s.id?'active':''}" data-sf="${s.id}">${esc(subjectIcon(s))} ${esc(s.name)}</button>`).join('')}</div><div class="field" style="max-width:260px"><label>Filtrar por grado</label><select id="gf"><option value="all">Todos los grados</option>${gradeOptionsStrict().replace('>',' selected>')}</select></div><div class="page-card"><div class="table-wrap"><table class="datatable"><thead><tr><th>Pregunta</th><th>Materia</th><th>Grado</th><th>Dificultad</th><th>Imagen</th><th></th></tr></thead><tbody>${rows.map(q=>`<tr><td>${esc((q.question||'').slice(0,80))}${(q.question||'').length>80?'…':''}</td><td>${esc(subjectById(q.subject_id)?.name||q.subject_id)}</td><td>${esc(gradeName(q.grade_id))}</td><td>${esc(q.difficulty)}</td><td>${q.image_url?'🖼️':'—'}</td><td class="row-actions"><button class="btn btn-ghost btn-sm" data-edit="${q.id}">Editar</button><button class="btn btn-danger btn-sm" data-del="${q.id}">Eliminar</button></td></tr>`).join('')}</tbody></table></div></div>`;const gs=v.querySelector('#gf');gs.value=gf;v.querySelectorAll('[data-sf]').forEach(b=>b.onclick=()=>{sf=b.dataset.sf;render()});gs.onchange=e=>{gf=e.target.value;render()};v.querySelector('#addQ').onclick=()=>openQuestionV4(null);v.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openQuestionV4(QUESTIONS.find(q=>q.id===b.dataset.edit)));v.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>runTeacherAction(async()=>{if(await confirmBox('Eliminar pregunta','Esta pregunta dejará de estar disponible para tus estudiantes.')){const {error}=await supabaseClient.from('questions').update({deleted_at:new Date().toISOString(),deleted_by:CURRENT_USER.id}).eq('id',b.dataset.del);if(error)throw error;await reloadContent();render();v4Toast('Pregunta eliminada.')}},'No se pudo eliminar la pregunta.'))};render()}
  async function openQuestionV4(existing){
  openModal(`<h3>${existing?'Editar':'Crear'} pregunta</h3>
    <div class="field"><label>Materia</label><select id="qvSubject">${SUBJECTS.map(s=>`<option value="${esc(s.id)}" ${existing?.subject_id===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Grado</label><select id="qvGrade">${gradeOptionsStrict(existing?.grade_id||'')}</select></div>
    <div class="field"><label>Tema</label><select id="qvTopic"></select></div>
    <div class="field"><label>Dificultad</label><select id="qvDiff">
      <option value="facil" ${existing?.difficulty==='facil'?'selected':''}>Fácil</option>
      <option value="media" ${!existing||existing?.difficulty==='media'?'selected':''}>Media</option>
      <option value="dificil" ${existing?.difficulty==='dificil'?'selected':''}>Difícil</option>
    </select></div>
    <div class="field"><label>Enunciado</label><textarea id="qvText" rows="4">${esc(existing?.question||'')}</textarea></div>
    <div class="field"><label>Imagen de la pregunta (opcional)</label><div class="file-control"><button type="button" class="btn btn-outline btn-sm" id="qvChoose">Elegir imagen</button><span class="file-name" id="qvName">Ningún archivo seleccionado</span><input id="qvFile" type="file" accept="image/png,image/jpeg,image/webp"></div></div>
    ${[0,1,2,3].map(i=>`<div class="field"><label>Opción ${String.fromCharCode(65+i)}</label><input id="qvO${i}" value="${esc(existing?.options?.[i]||'')}"></div>`).join('')}
    <div class="field"><label>Respuesta correcta</label><select id="qvCorrect">${[0,1,2,3].map(i=>`<option value="${i}" ${existing?.correct===i?'selected':''}>${String.fromCharCode(65+i)}</option>`).join('')}</select></div>
    <div class="field"><label>Explicación general</label><textarea id="qvWhy">${esc(existing?.why||'')}</textarea></div>
    ${[0,1,2,3].map(i=>`<div class="field"><label>Por qué ${String.fromCharCode(65+i)} (opcional)</label><textarea id="qvWrong${i}">${esc(existing?.why_wrong?.[i]||'')}</textarea></div>`).join('')}
    <button class="btn btn-primary btn-block" id="qvSave">${existing?'Guardar cambios':'Crear pregunta'}</button>`);

  const subjectEl=document.getElementById('qvSubject');
  const gradeEl=document.getElementById('qvGrade');
  const topicEl=document.getElementById('qvTopic');
  const fillTopics=()=>{
    const sid=subjectEl.value;
    const gid=gradeEl.value;
    const topics=TOPICS.filter(t=>t.subject_id===sid&&t.grade_id===gid);
    topicEl.innerHTML=topics.map(t=>`<option value="${esc(t.id)}" ${existing?.topic_id===t.id?'selected':''}>${esc(t.title)}</option>`).join('');
    if(!topics.length)topicEl.innerHTML='<option value="">No hay temas para este grado</option>';
  };
  subjectEl.onchange=fillTopics;
  gradeEl.onchange=fillTopics;
  fillTopics();

  document.getElementById('qvChoose').onclick=()=>document.getElementById('qvFile').click();
  document.getElementById('qvFile').onchange=e=>document.getElementById('qvName').textContent=e.target.files?.[0]?.name||'Ningún archivo seleccionado';

  document.getElementById('qvSave').onclick=()=>runTeacherAction(async()=>{
    const subject_id=subjectEl.value;
    const grade_id=gradeEl.value;
    const topic_id=topicEl.value||null;
    const question=document.getElementById('qvText').value.trim();
    const options=[0,1,2,3].map(i=>document.getElementById('qvO'+i).value.trim());
    const correct=Number(document.getElementById('qvCorrect').value);
    if(!grade_id){v4Toast('Selecciona un grado.','error');return}
    if(!topic_id){v4Toast('Selecciona un tema del grado elegido.','error');return}
    if(!question){v4Toast('Escribe el enunciado de la pregunta.','error');return}
    if(options.some(x=>!x)){v4Toast('Completa las cuatro opciones A, B, C y D.','error');return}

    let image_url=existing?.image_url||null;
    const f=document.getElementById('qvFile').files?.[0];
    if(f){
      if(f.size>5*1024*1024)throw new Error('La imagen debe pesar 5 MB o menos.');
      const ext=f.name.split('.').pop().toLowerCase();
      const path=`${CURRENT_USER.id}/${uid('qimage')}.${ext}`;
      const {error}=await supabaseClient.storage.from(BUCKETS.question).upload(path,f,{upsert:false,contentType:f.type,cacheControl:'3600'});
      if(error)throw error;
      image_url=path;
    }

    const why_wrong={};
    for(let i=0;i<4;i++)why_wrong[i]=document.getElementById('qvWrong'+i).value.trim();

    const row={
      id:existing?.id||uid('question'),
      subject_id,grade_id,topic_id,
      difficulty:document.getElementById('qvDiff').value,
      question,options,correct,
      why:document.getElementById('qvWhy').value.trim(),
      why_wrong,
      created_by:existing?.created_by||CURRENT_USER.id,
      image_url
    };
    const {error}=await supabaseClient.from('questions').upsert(row,{onConflict:'id'});
    if(error)throw error;
    closeModal();
    await reloadContent();
    showView('tPreguntas');
    v4Toast(existing?'Pregunta actualizada correctamente.':'Pregunta creada correctamente.');
  },'No se pudo guardar la pregunta.');
}

  RENDERERS.tMaterial=function(v){let sf='all',gf='all';const render=()=>{const rows=RESOURCES.filter(r=>r.created_by===CURRENT_USER.id&&(sf==='all'||r.subject_id===sf)&&(gf==='all'||r.grade_id===gf));v.innerHTML=`<div class="breadcrumb">Docente / Material</div><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h1>Material de aprendizaje</h1><button class="btn btn-primary btn-sm" id="addR">+ Agregar material</button></div><div class="tabs"><button class="tab ${sf==='all'?'active':''}" data-sf="all">Todas</button>${SUBJECTS.map(s=>`<button class="tab ${sf===s.id?'active':''}" data-sf="${s.id}">${esc(subjectIcon(s))} ${esc(s.name)}</button>`).join('')}</div><div class="field" style="max-width:260px"><label>Filtrar por grado</label><select id="gf"><option value="all">Todos los grados</option>${gradeOptionsStrict()}</select></div><div class="page-card"><div class="table-wrap"><table class="datatable"><thead><tr><th>Título</th><th>Materia</th><th>Grado</th><th>Tipo</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.title)}</td><td>${esc(subjectById(r.subject_id)?.name||r.subject_id)}</td><td>${esc(gradeName(r.grade_id))}</td><td>${esc(r.type)}</td><td class="row-actions"><button class="btn btn-ghost btn-sm" data-edit="${r.id}">Editar</button><button class="btn btn-danger btn-sm" data-del="${r.id}">Eliminar</button></td></tr>`).join('')}</tbody></table></div></div>`;const gs=v.querySelector('#gf');gs.value=gf;v.querySelectorAll('[data-sf]').forEach(b=>b.onclick=()=>{sf=b.dataset.sf;render()});gs.onchange=e=>{gf=e.target.value;render()};v.querySelector('#addR').onclick=()=>openResourceV4(null);v.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openResourceV4(RESOURCES.find(r=>r.id===b.dataset.edit)));v.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>runTeacherAction(async()=>{if(await confirmBox('Eliminar material','El material dejará de estar disponible.')){const {error}=await supabaseClient.from('learning_resources').delete().eq('id',b.dataset.del);if(error)throw error;await reloadContent();render();v4Toast('Material eliminado.')}},'No se pudo eliminar el material.'))};render()}
  async function openResourceV4(existing){openModal(`<h3>${existing?'Editar':'Agregar'} material</h3><div class="field"><label>Materia</label><select id="rvSubject">${SUBJECTS.map(s=>`<option value="${s.id}" ${existing?.subject_id===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label>Tema</label><select id="rvTopic"></select></div><div class="field"><label>Grado</label><select id="rvGrade">${gradeOptionsStrict(existing?.grade_id||'')}</select></div><div class="field"><label>Tipo</label><select id="rvType"><option value="pdf">PDF</option><option value="document">Documento</option><option value="image">Imagen</option><option value="video">Video</option><option value="reading">Lectura</option><option value="workshop">Taller</option><option value="other">Otro</option></select></div><div class="field"><label>Título</label><input id="rvTitle" value="${esc(existing?.title||'')}"></div><div class="field"><label>Descripción</label><textarea id="rvDesc">${esc(existing?.description||'')}</textarea></div><div class="field"><label>Enlace externo (opcional)</label><input id="rvUrl" value="${esc(existing?.url||'')}"></div><div class="field"><label>Archivo (opcional)</label><div class="file-control"><button type="button" class="btn btn-outline btn-sm" id="rvChoose">Elegir archivo</button><span class="file-name" id="rvName">Ningún archivo seleccionado</span><input id="rvFile" type="file"></div></div><button class="btn btn-primary btn-block" id="rvSave">Guardar material</button>`);const fill=()=>{const sid=document.getElementById('rvSubject').value;const gid=document.getElementById('rvGrade').value;document.getElementById('rvTopic').innerHTML=TOPICS.filter(t=>t.subject_id===sid&&t.grade_id===gid).map(t=>`<option value="${t.id}" ${existing?.topic_id===t.id?'selected':''}>${esc(t.title)}</option>`).join('')||'<option value="">No hay temas para este grado</option>'};document.getElementById('rvSubject').onchange=fill;document.getElementById('rvGrade').onchange=fill;fill();document.getElementById('rvType').value=existing?.type||'other';document.getElementById('rvChoose').onclick=()=>document.getElementById('rvFile').click();document.getElementById('rvFile').onchange=e=>document.getElementById('rvName').textContent=e.target.files?.[0]?.name||'Ningún archivo seleccionado';document.getElementById('rvSave').onclick=()=>runTeacherAction(async()=>{let file_url=existing?.file_url||null;const f=document.getElementById('rvFile').files?.[0];if(f){const ext=f.name.split('.').pop().toLowerCase();const path=`${CURRENT_USER.id}/${uid('resource')}.${ext}`;const {error}=await supabaseClient.storage.from(BUCKETS.resource).upload(path,f,{upsert:false,contentType:f.type,cacheControl:'3600'});if(error)throw error;file_url=path}const grade_id=document.getElementById('rvGrade').value;if(!grade_id)throw new Error('Debes asignar un grado.');const row={id:existing?.id||uid('resource'),subject_id:document.getElementById('rvSubject').value,topic_id:document.getElementById('rvTopic').value||null,grade_id,type:document.getElementById('rvType').value,title:document.getElementById('rvTitle').value.trim(),description:document.getElementById('rvDesc').value.trim(),url:document.getElementById('rvUrl').value.trim()||null,file_url,created_by:existing?.created_by||CURRENT_USER.id};const {error}=await supabaseClient.from('learning_resources').upsert(row,{onConflict:'id'});if(error)throw error;closeModal();await reloadContent();showView('tMaterial');v4Toast(existing?'Material actualizado.':'Material creado.');},'No se pudo guardar el material.')} 
  async function openEvalV4(existing,kind){
    const type=kind||(existing?(TESTS.some(x=>x.id===existing.id)?'test':'exam'):'test');
    const current=existing||null;
    openModal(`<h3>${current?'Editar':'Crear'} ${type==='test'?'test':'examen'}</h3>
      <div class="field"><label>Materia</label><select id="evSubject">${SUBJECTS.map(s=>`<option value="${esc(s.id)}" ${current?.subject_id===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Grado</label><select id="evGrade">${gradeOptionsStrict(current?.grade_id||'')}</select></div>
      <div class="field"><label>Tema</label><select id="evTopic"></select></div>
      <div class="field"><label>Título</label><input id="evTitle" value="${esc(current?.title||'')}"></div>
      <div class="field"><label>Preguntas del grado seleccionado</label><div id="evQs" style="max-height:280px;overflow:auto"></div></div>
      <button class="btn btn-primary btn-block" id="evSave">${current?'Guardar cambios':'Crear evaluación'}</button>`);

    const subjectEl=document.getElementById('evSubject');
    const gradeEl=document.getElementById('evGrade');
    const topicEl=document.getElementById('evTopic');
    const questionsEl=document.getElementById('evQs');

    const fill=()=>{
      const sid=subjectEl.value;
      const gid=gradeEl.value;
      const topics=TOPICS.filter(t=>t.subject_id===sid&&t.grade_id===gid);
      topicEl.innerHTML=topics.map(t=>`<option value="${esc(t.id)}" ${current?.topic_id===t.id?'selected':''}>${esc(t.title)}</option>`).join('')||'<option value="">Todos los temas del grado</option>';

      const questions=QUESTIONS.filter(q=>q.subject_id===sid&&q.grade_id===gid);
      questionsEl.innerHTML=questions.length
        ? questions.map(q=>`<label style="display:flex;gap:8px;padding:7px 0;align-items:flex-start"><input type="checkbox" value="${esc(q.id)}" ${(current?.question_ids||[]).includes(q.id)?'checked':''} style="width:auto;margin-top:3px"><span>${esc((q.question||'').slice(0,120))}</span></label>`).join('')
        : '<div class="empty-state">No hay preguntas disponibles para este grado y materia.</div>';
    };

    subjectEl.onchange=fill;
    gradeEl.onchange=fill;
    fill();

    document.getElementById('evSave').onclick=()=>runTeacherAction(async()=>{
      const grade_id=gradeEl.value;
      const subject_id=subjectEl.value;
      const topic_id=topicEl.value||null;
      const ids=[...questionsEl.querySelectorAll('input:checked')].map(x=>x.value);
      const title=document.getElementById('evTitle').value.trim();

      if(!grade_id){v4Toast('Debes asignar un grado.','error');return}
      if(!title){v4Toast('Escribe un título para la evaluación.','error');return}
      if(!ids.length){v4Toast('Selecciona al menos una pregunta.','error');return}

      const invalid=ids.some(id=>{
        const q=QUESTIONS.find(x=>x.id===id);
        return !q||q.grade_id!==grade_id||q.subject_id!==subject_id;
      });
      if(invalid){v4Toast('Todas las preguntas deben pertenecer al mismo grado y materia de la evaluación.','error');return}

      const row={
        id:current?.id||uid(type),
        subject_id,topic_id,grade_id,title,
        question_ids:ids,
        published:current?.published||false,
        created_by:current?.created_by||CURRENT_USER.id
      };
      const {error}=await supabaseClient.from(type==='test'?'tests':'exams').upsert(row,{onConflict:'id'});
      if(error)throw error;

      closeModal();
      await reloadContent();
      showView('tEvaluaciones');
      v4Toast(current?'Evaluación actualizada correctamente.':'Evaluación creada correctamente.');
    },'No se pudo guardar la evaluación.');
  }

  RENDERERS.tEvaluaciones=function(v){const render=()=>{v.innerHTML=`<div class="breadcrumb">Docente / Evaluaciones</div><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h1>Evaluaciones</h1><button class="btn btn-primary btn-sm" id="addEval">+ Crear evaluación</button></div><div class="page-card"><h3>Tests</h3><div class="table-wrap"><table class="datatable"><thead><tr><th>Título</th><th>Grado</th><th>Preguntas</th><th>Estado</th><th></th></tr></thead><tbody>${TESTS.filter(t=>t.created_by===CURRENT_USER.id).map(t=>`<tr><td>${esc(t.title)}</td><td>${esc(gradeName(t.grade_id))}</td><td>${t.question_ids?.length||0}</td><td>${t.published?'Publicado':'Borrador'}</td><td class="row-actions"><button class="btn btn-ghost btn-sm" data-edit="t:${t.id}">Editar</button><button class="btn btn-ghost btn-sm" data-pub="t:${t.id}">${t.published?'Ocultar':'Publicar'}</button><button class="btn btn-danger btn-sm" data-del="t:${t.id}">Eliminar</button></td></tr>`).join('')}</tbody></table></div></div><div class="page-card"><h3>Exámenes</h3><div class="table-wrap"><table class="datatable"><thead><tr><th>Título</th><th>Grado</th><th>Preguntas</th><th>Estado</th><th></th></tr></thead><tbody>${EXAMS.filter(e=>e.created_by===CURRENT_USER.id).map(e=>`<tr><td>${esc(e.title)}</td><td>${esc(gradeName(e.grade_id))}</td><td>${e.question_ids?.length||0}</td><td>${e.published?'Publicado':'Borrador'}</td><td class="row-actions"><button class="btn btn-ghost btn-sm" data-edit="e:${e.id}">Editar</button><button class="btn btn-ghost btn-sm" data-pub="e:${e.id}">${e.published?'Ocultar':'Publicar'}</button><button class="btn btn-danger btn-sm" data-del="e:${e.id}">Eliminar</button></td></tr>`).join('')}</tbody></table></div></div>`;v.querySelector('#addEval').onclick=()=>openEvalV4(null,'test');v.querySelectorAll('[data-edit]').forEach(b=>{b.onclick=()=>{const [k,id]=b.dataset.edit.split(':');const obj=(k==='t'?TESTS:EXAMS).find(x=>x.id===id);openEvalV4(obj,k==='t'?'test':'exam')}});v.querySelectorAll('[data-pub]').forEach(b=>b.onclick=()=>runTeacherAction(async()=>{const [k,id]=b.dataset.pub.split(':');const table=k==='t'?'tests':'exams';const obj=(k==='t'?TESTS:EXAMS).find(x=>x.id===id);if(!obj)return;if(!obj.grade_id)throw new Error('Asigna un grado antes de publicar.');const {error}=await supabaseClient.from(table).update({published:!obj.published}).eq('id',id);if(error)throw error;await reloadContent();render();v4Toast(obj.published?'Evaluación ocultada.':'Evaluación publicada.')},'No se pudo actualizar la evaluación.'));v.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>runTeacherAction(async()=>{if(await confirmBox('Eliminar evaluación','Se eliminará esta evaluación.')){const [k,id]=b.dataset.del.split(':');const {error}=await supabaseClient.from(k==='t'?'tests':'exams').delete().eq('id',id);if(error)throw error;await reloadContent();render();v4Toast('Evaluación eliminada.')}},'No se pudo eliminar la evaluación.'))};render()}

  RENDERERS.tResultados=async function(v,params={}){
    let grade=params.grade_id||'all',section=params.section||'all',subject='all',topic='all';
    let currentRows=[];

    const overallFrom=prog=>{
      const total=(prog.correct_count||0)+(prog.wrong_count||0);
      return total?Math.round((prog.correct_count||0)/total*100):0;
    };

    const getFilteredRows=async()=>{
      const {data:profiles,error}=await supabaseClient.from('profiles').select('*').eq('role','student').order('name');
      if(error)throw error;
      const rows=[];
      for(const p of profiles||[]){
        if(grade!=='all'&&p.grade_id!==grade)continue;
        if(section!=='all'&&p.section!==section)continue;
        const {data:pr,error:pe}=await supabaseClient.from('student_progress').select('*').eq('user_id',p.id).maybeSingle();
        if(pe)throw pe;
        const prog=progressFromRow(pr);
        let qs=QUESTIONS.filter(q=>q.grade_id===p.grade_id);
        if(subject!=='all')qs=qs.filter(q=>q.subject_id===subject);
        if(topic!=='all')qs=qs.filter(q=>q.topic_id===topic);
        let answered=0,correct=0;
        for(const q of qs){
          if(prog.answered?.[q.id]!==undefined){
            answered++;
            if(prog.answered[q.id]===q.correct)correct++;
          }
        }
        rows.push({p,answered,correct,pct:answered?Math.round(correct/answered*100):0});
      }
      return rows;
    };

    const filterLabel=()=>{
      const g=grade==='all'?'Todos':gradeName(grade);
      const s=section==='all'?'Todas':section;
      const su=subject==='all'?'Todas':subjectById(subject)?.name||'';
      const t=topic==='all'?'Todos':topicById(topic)?.title||'';
      return {g,s,su,t};
    };

    const render=async()=>{
      v.innerHTML=`<div class="breadcrumb">Docente / Resultados</div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div><h1>Resultados por grupo</h1><p class="small muted">Consulta por estudiante, grado, sección, materia y tema.</p></div>
          <div class="row-actions no-print">
            <button class="btn btn-outline btn-sm" id="printReport">🖨️ Imprimir</button>
            <button class="btn btn-primary btn-sm" id="downloadReport">📄 Descargar PDF</button>
          </div>
        </div>
        <div class="grid cols-4 no-print">
          <div class="field"><label>Grado</label><select id="rg"><option value="all">Todos</option>${gradeOptionsStrict()}</select></div>
          <div class="field"><label>Sección</label><select id="rs"><option value="all">Todas</option>${SECTIONS.map(x=>`<option value="${x}">${x}</option>`).join('')}</select></div>
          <div class="field"><label>Materia</label><select id="rsub"><option value="all">Todas</option>${SUBJECTS.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Tema</label><select id="rt"><option value="all">Todos</option>${TOPICS.map(t=>`<option value="${esc(t.id)}">${esc(t.title)} · ${esc(gradeName(t.grade_id))}</option>`).join('')}</select></div>
        </div>
        <div id="resultsTable"></div>`;

      const syncFilters=()=>{
        v.querySelector('#rg').value=grade;
        v.querySelector('#rs').value=section;
        v.querySelector('#rsub').value=subject;
        v.querySelector('#rt').value=topic;
      };
      syncFilters();

      for(const id of ['rg','rs','rsub','rt']){
        v.querySelector('#'+id).onchange=e=>{
          if(id==='rg')grade=e.target.value;
          if(id==='rs')section=e.target.value;
          if(id==='rsub')subject=e.target.value;
          if(id==='rt')topic=e.target.value;
          render();
        };
      }

      try{
        currentRows=await getFilteredRows();
      }catch(e){
        console.error('Resultados:',e);
        v.querySelector('#resultsTable').innerHTML=`<div class="empty-state">No se pudieron cargar los resultados. ${esc(friendly(e?.message,'Inténtalo nuevamente.'))}</div>`;
        return;
      }

      const labels=filterLabel();
      v.querySelector('#resultsTable').innerHTML=`<div class="page-card">
        <div class="print-only">
          <h1>Informe de resultados · Parche Saber</h1>
          <p>Grado: ${esc(labels.g)} · Sección: ${esc(labels.s)} · Materia: ${esc(labels.su)} · Tema: ${esc(labels.t)}</p>
          <p>Fecha: ${esc(new Date().toLocaleString('es-CO'))}</p>
        </div>
        <div class="table-wrap">
          <table class="datatable">
            <thead><tr><th>Estudiante</th><th>Grado</th><th>Sección</th><th>Preguntas</th><th>Correctas</th><th>Aciertos</th></tr></thead>
            <tbody>${currentRows.map(r=>`<tr><td>${esc(r.p.name)}</td><td>${esc(gradeName(r.p.grade_id))}</td><td>${esc(r.p.section||'—')}</td><td>${r.answered}</td><td>${r.correct}</td><td>${r.pct}%</td></tr>`).join('')||'<tr><td colspan="6">No hay estudiantes para este filtro.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;

      v.querySelector('#printReport').onclick=()=>window.print();
      v.querySelector('#downloadReport').onclick=()=>{
        try{
          const jspdf=window.jspdf?.jsPDF;
          if(!jspdf){v4Toast('No se pudo cargar el generador de PDF. Revisa tu conexión e inténtalo nuevamente.','error');return}
          const doc=new jspdf({orientation:'landscape',unit:'mm',format:'a4'});
          doc.setFontSize(16);
          doc.text('Informe de resultados · Parche Saber',14,15);
          doc.setFontSize(9);
          doc.text(`Grado: ${labels.g} · Sección: ${labels.s} · Materia: ${labels.su} · Tema: ${labels.t}`,14,22);
          doc.text(`Fecha: ${new Date().toLocaleString('es-CO')}`,14,28);
          doc.autoTable({
            startY:34,
            head:[['Estudiante','Grado','Sección','Preguntas','Correctas','Aciertos']],
            body:currentRows.map(r=>[r.p.name,gradeName(r.p.grade_id),r.p.section||'—',String(r.answered),String(r.correct),`${r.pct}%`]),
            styles:{fontSize:8,cellPadding:2.5},
            headStyles:{fontSize:8},
            margin:{left:14,right:14}
          });
          doc.save(`parche-saber-resultados-${Date.now()}.pdf`);
        }catch(e){
          console.error('PDF:',e);
          v4Toast('No se pudo generar el PDF. Inténtalo nuevamente.','error');
        }
      };
    };

    await render();
  }

  // ---- Tópicos docentes: ya disponible y con manejo de errores.

  // ---- Theme button / logout / profile button rebound after overrides.
  document.getElementById('themeBtn').onclick=()=>{const cur=document.documentElement.getAttribute('data-theme');setTheme(cur==='dark'?'light':'dark')};
  document.getElementById('publicThemeBtn')?.addEventListener('click',()=>{const cur=document.documentElement.getAttribute('data-theme');setTheme(cur==='dark'?'light':'dark')});
  document.getElementById('logoutBtn').onclick=logout;
  document.getElementById('profileBtn').onclick=()=>showView(CURRENT_USER?.role==='student'?'perfil':'tPerfil');

  // ---- Mobile/routing friendly; keep session state through reload.

  globalThis.authBoot=authBoot;
})();
window.addEventListener('error',e=>console.error('Saber:',e.error||e.message));
(async()=>{try{initSearch();try{await loadPublicRegistrationData()}catch(e){console.error('loadPublicRegistrationData:',e)}await authBoot();console.log('Saber: Supabase y aplicación OK')}catch(e){console.error('Bootstrap:',e);const x=document.getElementById('loginError');if(x)x.innerHTML='<div class="auth-error">No se pudo iniciar la aplicación. Revisa la consola.</div>';}})();

(function(){
  'use strict';

  const txt = (v)=>String(v ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const toastSafe=(m,type='info')=>{try{ if(typeof v4Toast==='function') v4Toast(m,type); else if(typeof toast==='function') toast(m); }catch(e){console.log(m,e)} };
  const fail=(container,title,error)=>{
    console.error(title,error);
    const msg=error?.message||error?.details||String(error||'Error desconocido');
    if(container) container.innerHTML=`<div class="page-card"><h2>⚠️ ${txt(title)}</h2><p class="muted">${txt(msg)}</p><p class="small muted">La aplicación sigue funcionando. Corrige el permiso o dato indicado y vuelve a entrar.</p></div>`;
  };
  const teacherOnly=()=>{ if(!CURRENT_USER || CURRENT_USER.role!=='teacher') throw new Error('Solo un docente puede realizar esta acción.'); };
  const idFor=(p)=>`${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
  const checked=(root)=>[...root.querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);
  const gradeLabel=(id)=>typeof gradeName==='function'?(gradeName(id)||id||'Sin definir'):(GRADES.find(g=>g.id===id)?.name||id||'Sin definir');

  async function ownRows(table){
    teacherOnly();
    const {data,error}=await supabaseClient.from(table).select('*').eq('created_by',CURRENT_USER.id).order('created_at',{ascending:false});
    if(error) throw error;
    return data||[];
  }
  async function insertRow(table,row){
    teacherOnly();
    const {error}=await supabaseClient.from(table).insert(row);
    if(error) throw error;
    return row;
  }
  async function updateRow(table,id,patch){
    teacherOnly();
    const {data,error}=await supabaseClient.from(table).update(patch).eq('id',id).eq('created_by',CURRENT_USER.id).select('*').maybeSingle();
    if(error) throw error;
    if(!data) throw new Error('No se encontró el registro o no tienes permiso para modificarlo.');
    return data;
  }

  function questionPool(subjectId,gradeId){
    return (QUESTIONS||[]).filter(q=>q.deleted_at==null && q.subject_id===subjectId && q.grade_id===gradeId);
  }
  async function ensureFormData(){
    if(!GRADES.length){ const {data,error}=await supabaseClient.from('grades').select('*').order('sort_order'); if(error)throw error; GRADES.splice(0,GRADES.length,...(data||[])); }
    if(!SUBJECTS.length){ const {data,error}=await supabaseClient.from('subjects').select('*').order('sort_order'); if(error)throw error; SUBJECTS.splice(0,SUBJECTS.length,...(data||[])); }
    if(!QUESTIONS.length){ const {data,error}=await supabaseClient.from('questions').select('*').is('deleted_at',null).order('created_at',{ascending:false}); if(error)throw error; QUESTIONS.splice(0,QUESTIONS.length,...(data||[])); }
  }

  function renderProfile(v){
    const p=PROFILE||{}; const student=CURRENT_USER?.role==='student'; const roleLabel=CURRENT_USER?.role==='admin'?'Administrador':(student?'Estudiante':'Docente');
    v.innerHTML=`
      <div class="breadcrumb">${roleLabel} / Perfil</div>
      <h1>Mi perfil</h1>
      <div class="page-card" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <div id="pfAvatarBox" style="width:64px;height:64px;border-radius:50%;overflow:hidden;background:var(--bg-2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.4rem;flex-shrink:0"></div>
        <div style="flex:1;min-width:200px">
          <h2>${txt([p.first_name,p.last_name].filter(Boolean).join(' ')||p.name||'Usuario')}</h2>
          <p class="muted">${txt(CURRENT_USER?.email||'')} · ${roleLabel}</p>
          <button class="btn btn-outline btn-sm" id="pfChoosePhoto" type="button">Cambiar foto de perfil</button>
          <input id="pfAvatarInput" type="file" accept="image/*" style="display:none">
        </div>
      </div>
      <div class="grid cols-2">
        <div class="page-card"><h3>Datos personales</h3>
          <div class="field"><label>Nombre</label><input id="pfFirst" value="${txt(p.first_name||'')}" maxlength="60"></div>
          <div class="field"><label>Apellido</label><input id="pfLast" value="${txt(p.last_name||'')}" maxlength="60"></div>
          <button class="btn btn-primary btn-sm" id="pfSave">Guardar cambios</button>
        </div>
        <div class="page-card"><h3>Información académica</h3>
          <p><b>Grado:</b> ${txt(gradeLabel(p.grade_id))}</p>
          <p><b>Sección:</b> ${txt(p.section||'Sin definir')}</p>
          ${student?'<p class="small muted">Tu grado y sección se conservan en tu perfil y no se vuelven a solicitar al entrar.</p>':''}
        </div>
      </div>
      <div class="page-card"><h3>Seguridad</h3><p class="muted">Esta acción elimina tu cuenta.</p><button class="btn btn-danger btn-sm" id="pfDelete">Eliminar mi cuenta</button></div>`;
    const avatarBox=v.querySelector('#pfAvatarBox');
    if(p.avatar_url){getSignedUrl(BUCKETS.avatar,p.avatar_url).then(url=>{if(url)avatarBox.innerHTML=`<img alt="Foto de perfil" src="${url}" style="width:100%;height:100%;object-fit:cover">`;else avatarBox.textContent=(p.first_name||p.name||'U').charAt(0).toUpperCase()})}
    else{avatarBox.textContent=(p.first_name||p.name||'U').charAt(0).toUpperCase()}
    v.querySelector('#pfChoosePhoto').onclick=()=>v.querySelector('#pfAvatarInput').click();
    v.querySelector('#pfAvatarInput').onchange=async e=>{
      const f=e.target.files?.[0]; if(!f)return;
      if(f.size>5*1024*1024){toastSafe('La foto debe pesar 5 MB o menos.','error');return}
      try{
        const ext=(f.name.split('.').pop()||'jpg').toLowerCase();
        const path=`${CURRENT_USER.id}/avatar.${ext}`;
        const {error}=await supabaseClient.storage.from(BUCKETS.avatar).upload(path,f,{upsert:true,contentType:f.type,cacheControl:'3600'});
        if(error)throw error;
        const {error:pErr}=await supabaseClient.from('profiles').update({avatar_url:path}).eq('id',CURRENT_USER.id);
        if(pErr)throw pErr;
        PROFILE={...PROFILE,avatar_url:path};
        if(typeof updateSidebar==='function')updateSidebar();
        renderProfile(v);
        toastSafe('Foto de perfil actualizada.','success');
      }catch(err){console.error(err);toastSafe('No se pudo guardar la foto de perfil.','error')}
    };
    v.querySelector('#pfSave').onclick=async()=>{
      try{
        const first=v.querySelector('#pfFirst').value.trim(), last=v.querySelector('#pfLast').value.trim();
        if(!first||!last)throw new Error('Nombre y apellido son obligatorios.');
        const patch={first_name:first,last_name:last,name:`${first} ${last}`};
        const {error}=await supabaseClient.from('profiles').update(patch).eq('id',CURRENT_USER.id); if(error)throw error;
        PROFILE={...PROFILE,...patch}; if(PROGRESS)PROGRESS.name=patch.name; if(typeof updateSidebar==='function')updateSidebar(); renderProfile(v); toastSafe('Perfil actualizado.','success');
      }catch(e){fail(v,'No se pudo actualizar el perfil.',e)}
    };
    v.querySelector('#pfDelete').onclick=()=>{ if(typeof deleteCurrentAccount==='function') deleteCurrentAccount(); else fail(v,'Eliminar cuenta no disponible',new Error('La función de eliminación no está cargada.')); };
  }

  async function openAssessment(current,kind){
    try{
      teacherOnly(); await ensureFormData();
      const exam=kind==='exam', table=exam?'exams':'tests';
      openModal(`<h3>${current?'Editar':'Crear'} ${exam?'evaluación':'test'}</h3>
        <div class="field"><label>Título</label><input id="afTitle" maxlength="160" value="${txt(current?.title||'')}"></div>
        <div class="field"><label>Materia</label><select id="afSubject">${SUBJECTS.map(s=>`<option value="${txt(s.id)}" ${current?.subject_id===s.id?'selected':''}>${txt(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Grado</label><select id="afGrade">${GRADES.map(g=>`<option value="${txt(g.id)}" ${current?.grade_id===g.id?'selected':''}>${txt(g.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Preguntas ${exam?'(mínimo 5)':''}</label><div id="afQuestions" style="max-height:360px;overflow:auto;border:1px solid var(--line);padding:10px;border-radius:10px"></div></div>
        <button class="btn btn-primary btn-block" id="afSave">${current?'Guardar cambios':`Crear ${exam?'evaluación':'test'}`}</button>`);
      const s=document.getElementById('afSubject'),g=document.getElementById('afGrade'),qbox=document.getElementById('afQuestions');
      const fill=()=>{const pool=questionPool(s.value,g.value); qbox.innerHTML=pool.length?pool.map(q=>`<label style="display:flex;gap:8px;padding:8px 0"><input type="checkbox" value="${txt(q.id)}" ${(current?.question_ids||[]).includes(q.id)?'checked':''} style="width:auto"><span>${txt((q.question||'').slice(0,220))}</span></label>`).join(''):'<div class="empty-state">No hay preguntas para esta materia y grado.</div>';};
      s.onchange=fill;g.onchange=fill;fill();
      document.getElementById('afSave').onclick=async()=>{
        try{
          const title=document.getElementById('afTitle').value.trim(), subject_id=s.value, grade_id=g.value, question_ids=checked(qbox);
          if(!title)throw new Error('Escribe un título.'); if(!subject_id||!grade_id)throw new Error('Selecciona materia y grado.'); if(!question_ids.length)throw new Error('Selecciona al menos una pregunta.'); if(exam&&question_ids.length<5)throw new Error('Una evaluación necesita mínimo 5 preguntas.');
          const allowed=new Set(questionPool(subject_id,grade_id).map(x=>x.id)); if(question_ids.some(id=>!allowed.has(id)))throw new Error('Hay preguntas que no corresponden a la materia y grado seleccionados.');
          const row={id:current?.id||idFor(exam?'exam':'test'),subject_id,topic_id:null,grade_id,title,question_ids,published:current?.published===true,created_by:CURRENT_USER.id,section_codes:Array.isArray(current?.section_codes)?current.section_codes:[]};
          const saved=current?await updateRow(table,current.id,{...row,id:undefined,created_by:undefined}):await insertRow(table,row);
          const list=exam?EXAMS:TESTS;const idx=list.findIndex(x=>x.id===saved.id);if(idx>=0)list[idx]=saved;else list.unshift(saved);
          closeModal();showView('tEvaluaciones');toastSafe(`${exam?'Evaluación':'Test'} ${current?'actualizado':'creado'} correctamente.`,'success');
        }catch(e){console.error('Guardar',e); const box=document.getElementById('modalBox'); if(box){const old=box.querySelector('.inline-error'); if(old)old.remove(); const d=document.createElement('div');d.className='inline-error';d.style.cssText='margin-top:12px;padding:10px;border:1px solid #c33;border-radius:8px;color:#c33';d.textContent=e?.message||String(e);box.appendChild(d);} }
      };
    }catch(e){console.error('Abrir formulario',e);alert(`No se pudo abrir el formulario: ${e?.message||e}`)}
  }

  async function openSim(current){
    try{
      teacherOnly(); await ensureFormData();
      openModal(`<h3>${current?'Editar':'Crear'} simulacro</h3>
        <div class="field"><label>Título</label><input id="sfTitle" maxlength="160" value="${txt(current?.title||'')}"></div>
        <div class="field"><label>Grado</label><select id="sfGrade">${GRADES.map(g=>`<option value="${txt(g.id)}" ${current?.grade_id===g.id?'selected':''}>${txt(g.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Secciones (opcional)</label><input id="sfSections" value="${txt((current?.section_codes||[]).join(', '))}" placeholder="A, B, C"></div>
        <div class="field"><label>Preguntas</label><div id="sfQuestions" style="max-height:360px;overflow:auto;border:1px solid var(--line);padding:10px;border-radius:10px"></div></div>
        <button class="btn btn-primary btn-block" id="sfSave">${current?'Guardar cambios':'Crear simulacro'}</button>`);
      const g=document.getElementById('sfGrade'),qbox=document.getElementById('sfQuestions');
      const fill=()=>{const pool=(QUESTIONS||[]).filter(q=>q.deleted_at==null&&q.grade_id===g.value);qbox.innerHTML=pool.length?pool.map(q=>`<label style="display:flex;gap:8px;padding:8px 0"><input type="checkbox" value="${txt(q.id)}" ${(current?.question_ids||[]).includes(q.id)?'checked':''} style="width:auto"><span>${txt((q.question||'').slice(0,220))}</span></label>`).join(''):'<div class="empty-state">No hay preguntas para este grado.</div>';};
      g.onchange=fill;fill();
      document.getElementById('sfSave').onclick=async()=>{
        try{
          const title=document.getElementById('sfTitle').value.trim(),grade_id=g.value,question_ids=checked(qbox),section_codes=document.getElementById('sfSections').value.split(',').map(x=>x.trim()).filter(Boolean);
          if(!title)throw new Error('Escribe un título.');if(!grade_id)throw new Error('Selecciona un grado.');if(!question_ids.length)throw new Error('Selecciona al menos una pregunta.');
          const allowed=new Set((QUESTIONS||[]).filter(q=>q.deleted_at==null&&q.grade_id===grade_id).map(q=>q.id));if(question_ids.some(id=>!allowed.has(id)))throw new Error('Hay preguntas que no corresponden al grado seleccionado.');
          const row={id:current?.id||idFor('simulacro'),grade_id,section_codes,title,question_ids,published:current?.published===true,created_by:CURRENT_USER.id};
          const saved=current?await updateRow('simulacros',current.id,{...row,id:undefined,created_by:undefined}):await insertRow('simulacros',row);
          const idx=SIMULACROS.findIndex(x=>x.id===saved.id);if(idx>=0)SIMULACROS[idx]=saved;else SIMULACROS.unshift(saved);
          closeModal();showView('tSimulacros');toastSafe(`Simulacro ${current?'actualizado':'creado'} correctamente.`,'success');
        }catch(e){console.error('Guardar simulacro',e);const box=document.getElementById('modalBox');if(box){const d=document.createElement('div');d.className='inline-error';d.style.cssText='margin-top:12px;padding:10px;border:1px solid #c33;border-radius:8px;color:#c33';d.textContent=e?.message||String(e);box.appendChild(d);}}
      };
    }catch(e){console.error('Abrir simulacro',e);alert(`No se pudo abrir el simulacro: ${e?.message||e}`)}
  }

  async function renderAssessments(v){
    try{
      teacherOnly();
      const [tests,exams]=await Promise.all([ownRows('tests'),ownRows('exams')]);
      TESTS.splice(0,TESTS.length,...tests);EXAMS.splice(0,EXAMS.length,...exams);
      v.innerHTML=`<div class="breadcrumb">Docente / Tests y evaluaciones</div><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><h1>Tests y evaluaciones</h1><p class="muted">Cada tipo se guarda y publica por separado.</p></div><div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" id="createTestClean">+ Crear test</button><button class="btn btn-outline btn-sm" id="createExamClean">+ Crear evaluación</button></div></div>
      <div class="page-card"><h3>Tests creados</h3><div class="table-wrap"><table class="datatable"><thead><tr><th>Título</th><th>Grado</th><th>Preguntas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${tests.map(x=>`<tr><td>${txt(x.title)}</td><td>${txt(gradeLabel(x.grade_id))}</td><td>${(x.question_ids||[]).length}</td><td>${x.published?'Publicado':'Borrador'}</td><td><button class="btn btn-ghost btn-sm" data-edit-t="${txt(x.id)}">Editar</button><button class="btn btn-ghost btn-sm" data-pub-t="${txt(x.id)}">${x.published?'Ocultar':'Publicar'}</button></td></tr>`).join('')||'<tr><td colspan="5">Aún no hay tests.</td></tr>'}</tbody></table></div></div>
      <div class="page-card"><h3>Evaluaciones creadas</h3><div class="table-wrap"><table class="datatable"><thead><tr><th>Título</th><th>Grado</th><th>Preguntas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${exams.map(x=>`<tr><td>${txt(x.title)}</td><td>${txt(gradeLabel(x.grade_id))}</td><td>${(x.question_ids||[]).length}</td><td>${x.published?'Publicado':'Borrador'}</td><td><button class="btn btn-ghost btn-sm" data-edit-e="${txt(x.id)}">Editar</button><button class="btn btn-ghost btn-sm" data-pub-e="${txt(x.id)}">${x.published?'Ocultar':'Publicar'}</button></td></tr>`).join('')||'<tr><td colspan="5">Aún no hay evaluaciones.</td></tr>'}</tbody></table></div></div>`;
      v.querySelector('#createTestClean').onclick=()=>openAssessment(null,'test');v.querySelector('#createExamClean').onclick=()=>openAssessment(null,'exam');
      v.querySelectorAll('[data-edit-t]').forEach(b=>b.onclick=()=>openAssessment(tests.find(x=>x.id===b.dataset.editT),'test'));v.querySelectorAll('[data-edit-e]').forEach(b=>b.onclick=()=>openAssessment(exams.find(x=>x.id===b.dataset.editE),'exam'));
      const toggle=async(table,id)=>{try{const saved=await updateRow(table,id,{published:!(table==='tests'?TESTS:EXAMS).find(x=>x.id===id).published});if(table==='tests'){const i=TESTS.findIndex(x=>x.id===id);TESTS[i]=saved}else{const i=EXAMS.findIndex(x=>x.id===id);EXAMS[i]=saved}await renderAssessments(v);toastSafe(saved.published?'Publicado.':'Ocultado.','success')}catch(e){fail(v,'No se pudo cambiar el estado.',e)}};
      v.querySelectorAll('[data-pub-t]').forEach(b=>b.onclick=()=>toggle('tests',b.dataset.pubT));v.querySelectorAll('[data-pub-e]').forEach(b=>b.onclick=()=>toggle('exams',b.dataset.pubE));
    }catch(e){fail(v,'No se pudieron cargar Tests y evaluaciones.',e)}
  }

  async function renderSim(v){
    try{
      teacherOnly();const rows=await ownRows('simulacros');SIMULACROS.splice(0,SIMULACROS.length,...rows);
      v.innerHTML=`<div class="breadcrumb">Docente / Simulacros</div><div style="display:flex;justify-content:space-between;align-items:center"><div><h1>Simulacros</h1><p class="muted">Crea y publica simulacros para tus estudiantes.</p></div><button class="btn btn-primary btn-sm" id="createSimClean">+ Crear simulacro</button></div><div class="page-card"><div class="table-wrap"><table class="datatable"><thead><tr><th>Título</th><th>Grado</th><th>Preguntas</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${txt(x.title)}</td><td>${txt(gradeLabel(x.grade_id))}</td><td>${(x.question_ids||[]).length}</td><td>${x.published?'Publicado':'Borrador'}</td><td><button class="btn btn-ghost btn-sm" data-edit-s="${txt(x.id)}">Editar</button><button class="btn btn-ghost btn-sm" data-pub-s="${txt(x.id)}">${x.published?'Ocultar':'Publicar'}</button></td></tr>`).join('')||'<tr><td colspan="5">Aún no hay simulacros.</td></tr>'}</tbody></table></div></div>`;
      v.querySelector('#createSimClean').onclick=()=>openSim(null);v.querySelectorAll('[data-edit-s]').forEach(b=>b.onclick=()=>openSim(rows.find(x=>x.id===b.dataset.editS)));
      v.querySelectorAll('[data-pub-s]').forEach(b=>b.onclick=async()=>{try{const x=rows.find(a=>a.id===b.dataset.pubS);const saved=await updateRow('simulacros',x.id,{published:!x.published});const i=SIMULACROS.findIndex(a=>a.id===x.id);SIMULACROS[i]=saved;await renderSim(v);toastSafe(saved.published?'Publicado.':'Ocultado.','success')}catch(e){fail(v,'No se pudo cambiar el estado del simulacro.',e)}});
    }catch(e){fail(v,'No se pudieron cargar los simulacros.',e)}
  }

  function renderMaterial(v){
    v.innerHTML=`<div class="breadcrumb">Docente / Material de aprendizaje</div><div style="display:flex;justify-content:space-between;align-items:center"><div><h1>Material de aprendizaje</h1><p class="muted">Consulta los archivos y recursos disponibles.</p></div></div><div id="materialCleanBody" class="page-card"><p class="muted">Cargando recursos...</p></div>`;
    (async()=>{try{const {data,error}=await supabaseClient.from('learning_resources').select('*').is('deleted_at',null).order('created_at',{ascending:false});if(error)throw error;const body=v.querySelector('#materialCleanBody');body.innerHTML=(data||[]).map(r=>`<div style="padding:12px 0;border-bottom:1px solid var(--line)"><h3>${txt(r.title)}</h3><p class="muted">${txt(r.description||'')}</p>${r.url?`<a href="${txt(r.url)}" target="_blank" rel="noopener">Abrir recurso</a>`:''}${r.file_url?`<a href="${txt(r.file_url)}" target="_blank" rel="noopener">Abrir archivo</a>`:''}</div>`).join('')||'<p>No hay recursos disponibles.</p>'}catch(e){fail(v,'No se pudieron cargar los archivos.',e)}})();
  }


  // Navegación final, sin duplicados.
  STUDENT_NAV.splice(0,STUDENT_NAV.length,['inicio','🏠','Inicio'],['materias','📚','Mis materias'],['repaso','🔁','Repasar errores'],['simulacro','⏱️','Simulacro Saber 11'],['progreso','📈','Progreso'],['logros','🏆','Logros'],['perfil','👤','Perfil']);
  TEACHER_NAV.splice(0,TEACHER_NAV.length,['tInicio','🏠','Inicio'],['tTemas','🧠','Temas'],['tPreguntas','❓','Banco de preguntas'],['tEvaluaciones','📝','Tests y evaluaciones'],['tSimulacros','⏱️','Simulacros'],['tResultados','📊','Resultados'],['tPerfil','👤','Perfil']);

  RENDERERS.perfil=renderProfile;
  RENDERERS.tPerfil=renderProfile;
  RENDERERS.tEvaluaciones=renderAssessments;
  RENDERERS.tSimulacros=renderSim;
  RENDERERS.tMaterial=renderMaterial;

  async function fetchAllProfiles(){
    const {data,error}=await supabaseClient.from('profiles').select('*').order('name',{ascending:true});
    if(error)throw error;
    return data||[];
  }

  async function renderAdminInicio(v){
    v.innerHTML=`<div class="breadcrumb">Administración / Inicio</div><h1>Panel de administración</h1><div id="aStats" class="grid cols-2"><p class="muted">Cargando…</p></div>`;
    try{
      const profiles=await fetchAllProfiles();
      const teachers=profiles.filter(p=>p.role==='teacher');
      const students=profiles.filter(p=>p.role==='student');
      const admins=profiles.filter(p=>p.role==='admin');
      const pending=teachers.filter(p=>p.approved===false);
      const disabled=profiles.filter(p=>p.disabled);
      const stat=(label,value)=>`<div class="page-card"><p class="muted small">${esc(label)}</p><h2>${value}</h2></div>`;
      v.querySelector('#aStats').innerHTML=
        stat('Docentes',teachers.length)+stat('Estudiantes',students.length)+
        stat('Administradores',admins.length)+stat('Preguntas en el banco',QUESTIONS.length)+
        stat('Temas creados',TOPICS.length)+stat('Cuentas deshabilitadas',disabled.length);
      if(pending.length){
        v.insertAdjacentHTML('beforeend',`<div class="page-card" style="border-color:var(--warn);margin-top:14px"><h3>⚠️ ${pending.length} docente(s) pendiente(s) de aprobación</h3><button class="btn btn-primary btn-sm" id="aGoPending">Ver en Usuarios</button></div>`);
        v.querySelector('#aGoPending').onclick=()=>showView('aUsuarios',{filter:'pending'});
      }
    }catch(e){fail(v,'No se pudo cargar el panel de administración.',e)}
  }

  async function renderAdminUsuarios(v,params={}){
    v.innerHTML=`<div class="breadcrumb">Administración / Usuarios</div><h1>Usuarios</h1>
      <div class="field" style="max-width:320px"><input id="aSearch" placeholder="Buscar por nombre…"></div>
      <div id="aUserList" class="grid cols-1" style="margin-top:10px"><p class="muted">Cargando…</p></div>`;
    let profiles=[];
    try{ profiles=await fetchAllProfiles(); }catch(e){ fail(v,'No se pudo cargar la lista de usuarios.',e); return; }
    const list=v.querySelector('#aUserList');
    function row(p){
      const roleName={student:'Estudiante',teacher:'Docente',admin:'Administrador'}[p.role]||p.role;
      const estado=p.disabled?'<span style="color:var(--danger)">Deshabilitada</span>':(p.role==='teacher'&&p.approved===false)?'<span style="color:var(--warn)">Pendiente</span>':'<span style="color:var(--ok)">Activa</span>';
      const extra=p.role==='student'?`Grado ${esc(gradeLabel(p.grade_id))}${p.section?(' · Sección '+esc(p.section)):''}`:(p.role==='teacher'?`Materia: ${esc((SUBJECTS.find(s=>s.id===p.teacher_subject_id)||{}).name||'Sin definir')}`:'');
      return `<div class="page-card" data-uid="${esc(p.id)}" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between">
        <div><b>${esc(p.name||[p.first_name,p.last_name].filter(Boolean).join(' ')||'Sin nombre')}</b><br><span class="small muted">${extra}</span></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="small">${estado}</span>
          <select class="roleSel" style="font-size:.8rem">
            <option value="student" ${p.role==='student'?'selected':''}>Estudiante</option>
            <option value="teacher" ${p.role==='teacher'?'selected':''}>Docente</option>
            <option value="admin" ${p.role==='admin'?'selected':''}>Administrador</option>
          </select>
          ${p.role==='teacher'&&p.approved===false?'<button class="btn btn-primary btn-sm approveBtn">Aprobar</button>':''}
          <button class="btn btn-outline btn-sm toggleDisabledBtn">${p.disabled?'Habilitar':'Deshabilitar'}</button>
        </div></div>`;
    }
    function paint(filterText,onlyPending){
      const q=(filterText||'').trim().toLowerCase();
      const filtered=profiles.filter(p=>{
        const name=(p.name||[p.first_name,p.last_name].filter(Boolean).join(' ')||'').toLowerCase();
        if(onlyPending)return p.role==='teacher'&&p.approved===false;
        return !q||name.includes(q);
      });
      list.innerHTML=filtered.length?filtered.map(row).join(''):'<p class="muted">No hay usuarios que coincidan.</p>';
      list.querySelectorAll('[data-uid]').forEach(card=>{
        const uid=card.dataset.uid; const p=profiles.find(x=>x.id===uid);
        card.querySelector('.roleSel').onchange=async e=>{
          const newRole=e.target.value;
          if(!await confirmBox('Cambiar rol',`¿Cambiar el rol de ${p.name||'este usuario'} a ${newRole}?`)){e.target.value=p.role;return}
          try{const {error}=await supabaseClient.from('profiles').update({role:newRole}).eq('id',uid);if(error)throw error;p.role=newRole;toastSafe('Rol actualizado.','success');paint(v.querySelector('#aSearch').value,false)}catch(err){toastSafe('No se pudo cambiar el rol.','error');console.error(err)}
        };
        const appBtn=card.querySelector('.approveBtn');
        if(appBtn)appBtn.onclick=async()=>{
          try{const {error}=await supabaseClient.from('profiles').update({approved:true}).eq('id',uid);if(error)throw error;p.approved=true;toastSafe('Docente aprobado.','success');paint(v.querySelector('#aSearch').value,false)}catch(err){toastSafe('No se pudo aprobar la cuenta.','error');console.error(err)}
        };
        card.querySelector('.toggleDisabledBtn').onclick=async()=>{
          const next=!p.disabled;
          if(!await confirmBox(next?'Deshabilitar cuenta':'Habilitar cuenta',`¿${next?'Deshabilitar':'Habilitar'} la cuenta de ${p.name||'este usuario'}?`))return;
          try{const {error}=await supabaseClient.from('profiles').update({disabled:next}).eq('id',uid);if(error)throw error;p.disabled=next;toastSafe(next?'Cuenta deshabilitada.':'Cuenta habilitada.','success');paint(v.querySelector('#aSearch').value,false)}catch(err){toastSafe('No se pudo actualizar la cuenta.','error');console.error(err)}
        };
      });
    }
    v.querySelector('#aSearch').oninput=e=>paint(e.target.value,false);
    paint('',params?.filter==='pending');
  }

  RENDERERS.aInicio=renderAdminInicio;
  RENDERERS.aUsuarios=renderAdminUsuarios;

  // Importante: el showView final solo enruta; cada renderer controla sus propios errores.
  const baseShow=showView;
  showView=function(id,params={}){
    if((CURRENT_USER?.role==='teacher'||CURRENT_USER?.role==='admin')&&id==='perfil')id='tPerfil';
    if(CURRENT_USER?.role==='student'&&id==='tPerfil')id='perfil';
    try{sessionStorage.setItem('parche_saber_last_view_v4',id);sessionStorage.setItem('parche_saber_last_params_v4',JSON.stringify(params||{}))}catch{}
    return baseShow(id,params);
  };
  globalThis.showView=showView;
  if(typeof renderNav==='function')renderNav();
  console.info('Saber: implementación única final cargada.');
})();
