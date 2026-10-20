import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const $ = id => document.getElementById(id);
const show = (id, yes) => $(id).classList.toggle('hidden', !yes);
const message = (txt, bad=false) => { $('status').textContent = txt; $('status').classList.toggle('error', bad); };
let client, selectedHousehold, activeHousehold = null, currentSession = null;
let googleCalendarToken = null;
let calendarItems = [];
let calendarAnchor = new Date();
let calendarViewMode = "week";
let familyProfiles = [];
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
$('google-signin').onclick = async () => {
 try {
  const button = $('google-signin');
  button.disabled = true;
  message('Opening Google sign-in…');
  // Supabase's PKCE redirect returns to this exact beta page, not the v1 dashboard.
  const redirectTo = new URL('beta.html', window.location.href).href;
  const { error } = await client.auth.signInWithOAuth({
   provider: 'google',
   options: { redirectTo, skipBrowserRedirect: false }
  });
  if (error) throw error;
 } catch (e) {
  $('google-signin').disabled = false;
  message('Google sign-in failed: ' + e.message, true);
 }
};
// OAuth errors can arrive in the callback URL before a session is established.
const oauthParams = new URLSearchParams(window.location.search);
const oauthHash = new URLSearchParams(window.location.hash.slice(1));
const oauthError = oauthParams.get('error_description') || oauthHash.get('error_description');
if (oauthError) message('Google sign-in failed: ' + oauthError, true);

$('signout').onclick=$('dashboard-signout').onclick=async()=>{await client.auth.signOut();selectedHousehold=null;activeHousehold=null;currentSession=null;googleCalendarToken=null;show('cloud-dashboard',false);show('home',false);show('auth',true);message('Signed out.');};
async function renderSession(session){
 currentSession=session; if (session?.provider_token) googleCalendarToken = session.provider_token; show('home',!!session);show('auth',!session);if(!session){show('cloud-dashboard',false);show('home',false);return;}
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
 renderDashboardPeople(data); familyProfiles=data; renderFamilyEvents();
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
function openDashboard(){if(!currentSession||!activeHousehold){message('Create or choose a household first.',true);return;}show('home',false);show('cloud-dashboard',true);show('show-management',false);$('dashboard-date').textContent=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());const hour=new Date().getHours();$('dashboard-greeting').textContent=(hour<12?'Good morning':hour<17?'Good afternoon':'Good evening')+', '+(activeHousehold.name||'Family');message('Showing your cloud household dashboard.'); renderCalendarConnection(); renderCalendarPanels(); showCalendarScreen("dashboard");}
function openManagement(){show('cloud-dashboard',false);show('home',true);}
$('show-dashboard').onclick=openDashboard;
$('dashboard-manage').onclick=openManagement;
$('show-management').onclick=openManagement;

$('dashboard-family-nav').onclick=()=>showCalendarScreen('family');
$('dashboard-calendar-nav').onclick=()=>showCalendarScreen('calendar');

// Alpha 6: foreground-only, read-only Google Calendar preview.
// The Google provider token is short-lived; never persist it in localStorage or Supabase.
function renderCalendarConnection(){
 const state=$('calendar-state');
 if(!state)return;
 state.textContent=googleCalendarToken?'Google Calendar access available for this session.':'Connect Google Calendar to preview events. You may need to grant access again after the token expires.';
 show('calendar-refresh',!!googleCalendarToken);
}
$('calendar-connect').onclick=async()=>{
 try {
  message('Opening Google Calendar permission screen…');
  const redirectTo=new URL('beta.html',window.location.href).href;
  const {error}=await client.auth.signInWithOAuth({provider:'google',options:{
   redirectTo,
   scopes:'https://www.googleapis.com/auth/calendar.readonly',
   queryParams:{access_type:'online',prompt:'consent',include_granted_scopes:'true'}
  }});
  if(error)throw error;
 }catch(e){message('Calendar connection failed: '+e.message,true)}
};
$('calendar-refresh').onclick=loadGoogleEvents;
async function loadGoogleEvents(){
 const root=$('calendar-events');root.replaceChildren();
 if(!googleCalendarToken){message('Reconnect Google Calendar to get a fresh access token.',true);return;}
 const status=$('calendar-state');status.textContent='Loading upcoming events…';
 try{
  const now=new Date(),until=new Date(now.getTime()+45*86400000);
  const resp=await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?'+new URLSearchParams({
   timeMin:now.toISOString(),timeMax:until.toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'250'
  }),{headers:{Authorization:'Bearer '+googleCalendarToken}});
  if(!resp.ok){const err=await resp.json().catch(()=>({}));throw Error(err.error?.message||'Google returned HTTP '+resp.status)}
  const data=await resp.json();status.textContent='Upcoming events from your primary Google Calendar';
  calendarItems=data.items||[]; renderCalendarPanels(); if(!data.items?.length){root.textContent='No upcoming events in the next seven days.';return;}
  for(const ev of data.items){const item=document.createElement('div');item.className='calendar-event';
   const date=document.createElement('span');date.className='calendar-event-date';
   const raw=ev.start?.dateTime||ev.start?.date;date.textContent=raw?new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',...(ev.start?.dateTime?{hour:'2-digit',minute:'2-digit'}:{})}).format(new Date(ev.start?.dateTime||raw+'T12:00:00')):'Date unavailable';
   const title=document.createElement('strong');title.textContent=ev.summary||'Untitled event';item.append(date,title);root.append(item);
  }
 }catch(e){status.textContent='Calendar could not be loaded.';message('Google Calendar: '+e.message,true);}
}

// Alpha 7: read-only calendar views. These reuse the fetched Google events, never write to Google.
const calDate = d => new Date(d.getFullYear(),d.getMonth(),d.getDate());
const plusDays=(d,n)=>{const x=calDate(d);x.setDate(x.getDate()+n);return x};
const startOfWeek=d=>plusDays(d,-((d.getDay()+6)%7));
const fmt=(d,opts)=>new Intl.DateTimeFormat('en-GB',opts).format(d);
const eventStart=e=>new Date(e.start?.dateTime || (e.start?.date ? e.start.date+'T00:00:00':0));
const eventEnd=e=>new Date(e.end?.dateTime || (e.end?.date ? e.end.date+'T00:00:00':0));
const eventOverlaps=(e,start,end)=>eventStart(e)<end && eventEnd(e)>start;
function eventIcon(t=''){
 const rules=[[/swim|pool/i,'🏊'],[/holiday|vacation/i,'🏖️'],[/doctor|hospital|gp /i,'🩺'],[/dentist/i,'🦷'],[/football|soccer/i,'⚽'],[/nursery|school/i,'🎒'],[/birthday|party/i,'🎂'],[/flight|airport/i,'✈️'],[/office|meeting|work/i,'💼'],[/dinner|restaurant/i,'🍽️'],[/haircut|hairdresser/i,'✂️'],[/train/i,'🚆'],[/gym|exercise/i,'🏋️'],[/shopping|groceries/i,'🛒']];
 return rules.find(([rx])=>rx.test(t))?.[1]||'📅';
}
function makeEventRow(e){
 const el=document.createElement('button');el.type='button';el.className='calendar-entry';
 const time=e.start?.dateTime?fmt(eventStart(e),{hour:'2-digit',minute:'2-digit'}):'All day';
 el.textContent=`${eventIcon(e.summary)} ${time} · ${e.summary||'Untitled event'}`;
 el.title='View event details';el.onclick=()=>{
 const end=e.end?.dateTime?fmt(eventEnd(e),{hour:'2-digit',minute:'2-digit'}):'All day';
 alert([e.summary||'Untitled event',`Starts: ${fmt(eventStart(e),{dateStyle:'full',...(e.start?.dateTime?{timeStyle:'short'}:{})})}`,`Ends: ${end}`,e.location?`Location: ${e.location}`:'',e.description||''].filter(Boolean).join('\n'));
 };return el;
}
function showCalendarScreen(which){
 const dashboard=which==='dashboard';
 $('hub-main-layout').classList.toggle('hidden',!dashboard);
 show('calendar-full-view',which==='calendar');show('family-events-view',which==='family');
 for(const [id,active] of [['dashboard-calendar-nav',which==='calendar'],['dashboard-family-nav',which==='family']]){$(id).classList.toggle('active',active)}
 renderCalendarPanels();
}
$('calendar-back').onclick=$('family-back').onclick=()=>showCalendarScreen('dashboard');
$('cal-day').onclick=()=>{calendarViewMode='day';renderCalendarPanels()};
$('cal-week').onclick=()=>{calendarViewMode='week';renderCalendarPanels()};
$('cal-month').onclick=()=>{calendarViewMode='month';renderCalendarPanels()};
$('cal-today').onclick=()=>{calendarAnchor=new Date();renderCalendarPanels()};
$('cal-prev').onclick=()=>shiftCalendar(-1);
$('cal-next').onclick=()=>shiftCalendar(1);
function shiftCalendar(n){
 if(calendarViewMode==='month')calendarAnchor=new Date(calendarAnchor.getFullYear(),calendarAnchor.getMonth()+n,1);
 else calendarAnchor=plusDays(calendarAnchor,n*(calendarViewMode==='week'?7:1));
 renderCalendarPanels();
}
function renderCalendarPanels(){
 const today=calDate(new Date()),next=plusDays(today,1);
 const todayRoot=$('calendar-today'),weekRoot=$('calendar-week');
 if(!todayRoot||!weekRoot)return;
 todayRoot.replaceChildren();weekRoot.replaceChildren();
 const todayEvents=calendarItems.filter(e=>eventOverlaps(e,today,next)).slice(0,4);
 const heading=document.createElement('strong');heading.textContent='Today';todayRoot.append(heading);
 if(!todayEvents.length)todayRoot.append(document.createTextNode(' · No events today'));
 for(const e of todayEvents)todayRoot.append(makeEventRow(e));
 const weekEnd=plusDays(today,7);
 const weekEvents=calendarItems.filter(e=>eventOverlaps(e,next,weekEnd)).slice(0,6);
 const h=document.createElement('strong');h.textContent='Coming up';weekRoot.append(h);
 if(!weekEvents.length)weekRoot.append(document.createTextNode(' · No upcoming events'));
 for(const e of weekEvents){const row=makeEventRow(e);row.textContent=fmt(eventStart(e),{weekday:'short'})+' · '+row.textContent;weekRoot.append(row)}
 renderCalendarGrid();renderFamilyEvents();
}
function renderCalendarGrid(){
 const grid=$('cal-grid');if(!grid)return;grid.replaceChildren();
 const start=calendarViewMode==='day'?calDate(calendarAnchor):calendarViewMode==='week'?startOfWeek(calendarAnchor):startOfWeek(new Date(calendarAnchor.getFullYear(),calendarAnchor.getMonth(),1));
 const count=calendarViewMode==='day'?1:calendarViewMode==='week'?7:42;
 $('cal-period').textContent=calendarViewMode==='month'?fmt(calendarAnchor,{month:'long',year:'numeric'}):calendarViewMode==='week'?fmt(start,{day:'numeric',month:'short'})+' – '+fmt(plusDays(start,6),{day:'numeric',month:'short',year:'numeric'}):fmt(start,{dateStyle:'full'});
 for(const mode of ['day','week','month'])$('cal-'+mode).classList.toggle('cal-selected',calendarViewMode===mode);
 grid.className='calendar-grid calendar-'+calendarViewMode;
 for(let i=0;i<count;i++){
  const d=plusDays(start,i),end=plusDays(d,1),cell=document.createElement('div');cell.className='calendar-day';
  if(d.toDateString()===new Date().toDateString())cell.classList.add('is-today');
  if(calendarViewMode==='month'&&d.getMonth()!==calendarAnchor.getMonth())cell.classList.add('outside-month');
  const heading=document.createElement('strong');heading.className='calendar-day-label';heading.textContent=fmt(d,{weekday:'short',day:'numeric'});cell.append(heading);
  const events=calendarItems.filter(e=>eventOverlaps(e,d,end));
  for(const e of events.slice(0,calendarViewMode==='month'?3:30))cell.append(makeEventRow(e));
  if(events.length>3&&calendarViewMode==='month'){const more=document.createElement('span');more.textContent=`+${events.length-3} more`;cell.append(more)}
  grid.append(cell);
 }
}
function renderFamilyEvents(){
 const root=$('family-events-list');if(!root)return;root.replaceChildren();
 const info=document.createElement('p');info.textContent='Google Calendar events are not assigned to Family Hub people yet. Assignments will become available when cloud event records are added.';root.append(info);
 for(const person of familyProfiles){const section=document.createElement('section');section.className='family-schedule';const title=document.createElement('h4');title.textContent=person.name;title.style.borderLeft=`5px solid ${person.color}`;section.append(title);const empty=document.createElement('p');empty.textContent='No assigned events yet';section.append(empty);root.append(section)}
}
