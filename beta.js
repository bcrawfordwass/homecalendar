import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const $ = id => document.getElementById(id);
const show = (id, yes) => $(id).classList.toggle('hidden', !yes);
const message = (txt, bad=false) => { $('status').textContent = txt; $('status').classList.toggle('error', bad); };
let client, selectedHousehold, activeHousehold = null, currentSession = null;
// Public browser configuration. Security comes from Supabase RLS, not secrecy of this key.
const SUPABASE_URL = 'https://zmddqauowtjiqghakkcz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_5QkMowoiTtIsYbFCe6Aq-Q_1aWZFI01';
function setupClient() {
 client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
 client.auth.onAuthStateChange((_event,session)=>{ queueMicrotask(()=>renderSession(session)); });
 client.auth.getSession().then(({data,error})=>{
   if(error) message('Unable to restore sign-in: '+error.message,true);
   else renderSession(data.session);
 }).catch(e=>message('Connection error: '+e.message,true));
}
setupClient();
async function auth(action){try{
 const email=$('email').value.trim(),password=$('password').value;
 if(!email||password.length<8) throw Error('Enter an email and password of at least 8 characters.');
 const {data,error}=await (action==='signup'?client.auth.signUp({email,password}):client.auth.signInWithPassword({email,password}));
 if(error) throw error;
 message(action==='signup'&&!data.session?'Account created. Check your email to confirm, then sign in.':'Signed in.');
}catch(e){message(e.message,true)}}
$('signup').onclick=()=>auth('signup'); $('signin').onclick=()=>auth('signin');
$('signout').onclick=$('dashboard-signout').onclick=async()=>{await client.auth.signOut();selectedHousehold=null;activeHousehold=null;currentSession=null;show('cloud-dashboard',false);show('home',false);show('auth',true);message('Signed out.');};
async function renderSession(session){
 currentSession=session;show('home',!!session);show('auth',!session);if(!session){show('cloud-dashboard',false);show('home',false);return;}
 $('signedin').textContent='Signed in as '+session.user.email;
 try{await loadHouseholds()}catch(e){message('Database setup needed: '+e.message,true)}
}
async function loadHouseholds(){
 const {data,error}=await client.from('households').select('id,name,created_at').order('created_at');
 if(error)throw error;
 $('household-list').replaceChildren();
 show('household-setup',data.length===0);
 for(const h of data){const b=document.createElement('button');b.className='secondary';b.textContent=h.name;b.onclick=()=>chooseHousehold(h);$('household-list').append(b)}
 if(data.length){await chooseHousehold(data.find(h=>h.id===selectedHousehold)||data[0]);openDashboard();}else{show('people-panel',false);show('cloud-dashboard',false);show('home',true);}
}
$('create-household').onclick=async()=>{try{
 const {error}=await client.rpc('create_household',{p_name:$('household-name').value.trim()});if(error)throw error;
 message('Household created.');await loadHouseholds();
}catch(e){message(e.message,true)}};
async function chooseHousehold(h){selectedHousehold=h.id;activeHousehold=h;show('people-panel',true);await loadPeople();}
async function loadPeople(){
 const {data,error}=await client.from('family_people').select('id,name,color').eq('household_id',selectedHousehold).order('created_at');
 if(error)throw error;
 $('people-list').replaceChildren();
 renderDashboardPeople(data);
 for(const p of data){const row=document.createElement('div');row.className='person';const left=document.createElement('span');const dot=document.createElement('i');dot.className='dot';dot.style.background=p.color;left.append(dot,document.createTextNode(p.name));const del=document.createElement('button');del.className='secondary';del.textContent='Remove';del.onclick=async()=>{if(!confirm('Remove '+p.name+'?'))return;const {error}=await client.from('family_people').delete().eq('id',p.id);if(error)message(error.message,true);else await loadPeople()};row.append(left,del);$('people-list').append(row)}
}
$('add-person-form').onsubmit=async e=>{e.preventDefault();try{
 if(!selectedHousehold)throw Error('Select a household.');
 const {error}=await client.from('family_people').insert({household_id:selectedHousehold,name:$('person-name').value.trim(),color:$('person-color').value});if(error)throw error;
 $('person-name').value='';message('Family member added.');await loadPeople();
}catch(err){message(err.message,true)}};

function renderDashboardPeople(people){
 $('dashboard-count').textContent=people.length+' '+(people.length===1?'person':'people');
 const root=$('dashboard-people');root.replaceChildren();
 if(!people.length){const p=document.createElement('p');p.textContent='No family profiles yet. Add your first person in Manage family.';root.append(p);return;}
 for(const person of people){const tile=document.createElement('div');tile.className='family-tile';const dot=document.createElement('span');dot.className='family-avatar';dot.style.background=person.color;dot.textContent=(person.name||'?').trim().slice(0,1).toUpperCase();const name=document.createElement('strong');name.textContent=person.name;tile.append(dot,name);root.append(tile);}
}
function openDashboard(){if(!currentSession||!activeHousehold){message('Create or choose a household first.',true);return;}show('home',false);show('cloud-dashboard',true);show('show-management',false);$('dashboard-date').textContent=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());const hour=new Date().getHours();$('dashboard-greeting').textContent=(hour<12?'Good morning':hour<17?'Good afternoon':'Good evening')+', '+(activeHousehold.name||'Family');message('Showing your cloud household dashboard.');}
function openManagement(){show('cloud-dashboard',false);show('home',true);}
$('show-dashboard').onclick=openDashboard;
$('dashboard-manage').onclick=openManagement;
$('show-management').onclick=openManagement;

$('dashboard-family-nav').onclick=openManagement;
