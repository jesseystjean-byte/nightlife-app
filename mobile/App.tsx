import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, TouchableOpacity, ScrollView, FlatList, Image, ActivityIndicator, StyleSheet, Modal, Platform, KeyboardAvoidingView, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';

const API_BASE = 'https://project-ushrm.vercel.app';
const BG = '#0B0B0F';
const FG = '#F5F5F7';
const MUTED = '#8A8A92';
const CARD = '#15151B';
const ACCENT = '#D9FF3D';
const LINE = '#222229';

const PROFILE_KEY = '@5to9_profile_v1';
const SAVED_KEY = '@5to9_saved_v1';
const PASSED_KEY = '@5to9_passed_v1';

const INTERESTS = ['Live music','DJs / Electronic','Hip-hop','Indie','Jazz','Latin','House','Techno','Comedy','Theater','Art / Gallery','Film','Food / Tasting','Cocktails','Wine','Beer / Brewery','Dance','Karaoke','Trivia','Sports','Outdoor','Festival','Workshop','Meetup','LGBTQ+','Date night','After hours'];
const VIBES = ['Chill','Energetic','Romantic','Wild','Classy','Underground','Trendy','Cozy','Loud','Intimate'];
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const TIMES = ['Morning','Afternoon','Evening','Late night'];
const PRICE = ['Free','$','$$','$$$','$$$$'];
const SETTING = ['Indoor','Outdoor','Either'];
const COMPANY = ['Solo','Couple','Friends','Date','Group'];
const CROWD = ['Small','Medium','Large','No preference'];
const ACCESS = ['Wheelchair access','Quiet space','Sober-friendly','Sensory-friendly'];
const GENDER = ['Woman','Man','Non-binary','Prefer not to say'];
const REL = ['Single','Dating','In a relationship','Married','It\u2019s complicated','Prefer not to say'];

type Profile = {
  name: string; birthYear: number | null; gender: string;
  city: string; maxDistanceKm: number;
  relationship: string; occupation: string; languages: string;
  interests: string[]; vibes: string[];
  priceRange: string[]; daysAvailable: string[]; timesOfDay: string[];
  setting: string; company: string; crowdSize: string;
  accessibility: string[]; notifications: boolean;
  onboardingComplete: boolean;
};

const EMPTY_PROFILE: Profile = {
  name: '', birthYear: null, gender: '',
  city: '', maxDistanceKm: 25,
  relationship: '', occupation: '', languages: '',
  interests: [], vibes: [],
  priceRange: [], daysAvailable: [], timesOfDay: [],
  setting: 'Either', company: '', crowdSize: 'No preference',
  accessibility: [], notifications: true,
  onboardingComplete: false,
};

type EventItem = {
  id: string; source: string; title: string;
  startsAt: string; endsAt?: string;
  venue?: string; city?: string; lat?: number; lng?: number;
  url?: string; image?: string;
  price?: { min?: number; max?: number; currency?: string; free?: boolean };
  categories?: string[]; description?: string;
};

function fmtDate(iso?: string){
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  } catch { return iso; }
}
function fmtPrice(p?: EventItem['price']){
  if (!p) return '';
  if (p.free) return 'Free';
  if (p.min != null && p.max != null) return '$' + Math.round(p.min) + (p.max > p.min ? '\u2013$' + Math.round(p.max) : '');
  if (p.min != null) return '$' + Math.round(p.min) + '+';
  return '';
}

async function fetchEvents(profile: Profile, location: {lat:number; lng:number}, query?: string){
  try {
    const r = await fetch(API_BASE + '/api/townie', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ profile, location, query }),
    });
    if (!r.ok) return { events: [], summary: '' };
    return await r.json();
  } catch { return { events: [], summary: '' }; }
}

// ---------- UI Primitives ----------
function Chip({label, on, onPress, small}: any){
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, small && s.chipSm, on && s.chipOn]}>
      <Text style={[s.chipTxt, small && s.chipTxtSm, on && s.chipTxtOn]}>{label}</Text>
    </TouchableOpacity>
  );
}
function PrimaryBtn({label, onPress, disabled}: any){
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[s.btn, disabled && s.btnDis]}>
      <Text style={s.btnTxt}>{label}</Text>
    </TouchableOpacity>
  );
}
function GhostBtn({label, onPress}: any){
  return (
    <TouchableOpacity onPress={onPress} style={s.ghost}>
      <Text style={s.ghostTxt}>{label}</Text>
    </TouchableOpacity>
  );
}
function Field({label, children, hint}: any){
  return (
    <View style={{marginBottom:18}}>
      <Text style={s.label}>{label}</Text>
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}
function Progress({step, total}: any){
  return (
    <View style={s.progT}><View style={[s.progF, {width: ((step+1)/total)*100 + '%'}]} /></View>
  );
}

// ---------- Onboarding ----------
const STEPS = [
  'Welcome','You','Location','Lifestyle','Interests','Vibes','Schedule','Budget & Setting','Final touches'
];

function Onboarding({ onDone }: { onDone: (p: Profile) => void }){
  const [step, setStep] = useState(0);
  const [p, setP] = useState<Profile>(EMPTY_PROFILE);
  function toggle(arr: string[], v: string, min?: number, max?: number){
    const has = arr.includes(v);
    if (has) return arr.filter(x => x !== v);
    if (max && arr.length >= max) return arr;
    return [...arr, v];
  }
  const canNext = (() => {
    if (step === 1) return p.name.trim().length > 0 && !!p.birthYear && p.birthYear < new Date().getFullYear() - 12;
    if (step === 2) return p.city.trim().length > 0;
    if (step === 4) return p.interests.length >= 3;
    if (step === 5) return p.vibes.length >= 1;
    if (step === 6) return p.daysAvailable.length >= 1 && p.timesOfDay.length >= 1;
    if (step === 7) return p.priceRange.length >= 1 && !!p.company;
    return true;
  })();
  function next(){
    if (step === STEPS.length - 1) { onDone({ ...p, onboardingComplete: true }); return; }
    setStep(step + 1);
  }
  function back(){ if (step > 0) setStep(step - 1); }
  return (
    <SafeAreaView style={{flex:1, backgroundColor: BG}}>
      <StatusBar style="light" />
      <View style={s.obHeader}>
        <Text style={s.stepCount}>Step {step+1} of {STEPS.length}</Text>
        <Progress step={step} total={STEPS.length} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{flex:1}}>
        <ScrollView contentContainerStyle={s.obBody} keyboardShouldPersistTaps="handled">
          {step === 0 && (<>
            <Text style={s.brand}>5to9</Text>
            <Text style={s.h1}>Your nights, curated.</Text>
            <Text style={s.pBig}>Tell us a bit about you. We\u2019ll surface events you\u2019ll actually love \u2014 powered by Claude and licensed event data.</Text>
            <View style={{height:18}}/>
            <Text style={s.pSm}>Takes about 90 seconds. You can change anything later.</Text>
          </>)}
          {step === 1 && (<>
            <Text style={s.h1}>You</Text>
            <Field label="What should we call you?">
              <TextInput value={p.name} onChangeText={v=>setP({...p,name:v})} placeholder="First name" placeholderTextColor={MUTED} style={s.input}/>
            </Field>
            <Field label="Birth year" hint="We use this for age-appropriate suggestions.">
              <TextInput value={p.birthYear ? String(p.birthYear) : ''} onChangeText={v=>setP({...p,birthYear: v ? parseInt(v,10) : null})} keyboardType="number-pad" maxLength={4} placeholder="e.g. 1997" placeholderTextColor={MUTED} style={s.input}/>
            </Field>
            <Field label="Gender (optional)">
              <View style={s.wrap}>{GENDER.map(g => <Chip key={g} label={g} on={p.gender===g} onPress={()=>setP({...p,gender:p.gender===g?'':g})} small/>)}</View>
            </Field>
          </>)}
          {step === 2 && (<>
            <Text style={s.h1}>Where</Text>
            <Field label="Your city">
              <TextInput value={p.city} onChangeText={v=>setP({...p,city:v})} placeholder="e.g. Brooklyn, NY" placeholderTextColor={MUTED} style={s.input}/>
            </Field>
            <Field label={'Max distance: ' + p.maxDistanceKm + ' km'}>
              <View style={s.wrap}>{[5,10,25,50,100].map(d => <Chip key={d} label={d+' km'} on={p.maxDistanceKm===d} onPress={()=>setP({...p,maxDistanceKm:d})} small/>)}</View>
            </Field>
          </>)}
          {step === 3 && (<>
            <Text style={s.h1}>Lifestyle</Text>
            <Field label="Relationship"><View style={s.wrap}>{REL.map(r => <Chip key={r} label={r} on={p.relationship===r} onPress={()=>setP({...p,relationship:p.relationship===r?'':r})} small/>)}</View></Field>
            <Field label="Occupation (optional)"><TextInput value={p.occupation} onChangeText={v=>setP({...p,occupation:v})} placeholder="e.g. Designer" placeholderTextColor={MUTED} style={s.input}/></Field>
            <Field label="Languages (optional)" hint="Comma separated."><TextInput value={p.languages} onChangeText={v=>setP({...p,languages:v})} placeholder="e.g. English, Spanish" placeholderTextColor={MUTED} style={s.input}/></Field>
          </>)}
          {step === 4 && (<>
            <Text style={s.h1}>Interests</Text>
            <Text style={s.pSm}>Pick at least 3.</Text>
            <View style={[s.wrap, {marginTop:10}]}>{INTERESTS.map(i => <Chip key={i} label={i} on={p.interests.includes(i)} onPress={()=>setP({...p, interests: toggle(p.interests, i)})}/>)}</View>
          </>)}
          {step === 5 && (<>
            <Text style={s.h1}>Vibes</Text>
            <Text style={s.pSm}>How do you like your nights to feel?</Text>
            <View style={[s.wrap, {marginTop:10}]}>{VIBES.map(v => <Chip key={v} label={v} on={p.vibes.includes(v)} onPress={()=>setP({...p, vibes: toggle(p.vibes, v)})}/>)}</View>
          </>)}
          {step === 6 && (<>
            <Text style={s.h1}>When</Text>
            <Field label="Days you\u2019re usually free"><View style={s.wrap}>{DAYS.map(d => <Chip key={d} label={d} on={p.daysAvailable.includes(d)} onPress={()=>setP({...p, daysAvailable: toggle(p.daysAvailable, d)})} small/>)}</View></Field>
            <Field label="Times of day"><View style={s.wrap}>{TIMES.map(t => <Chip key={t} label={t} on={p.timesOfDay.includes(t)} onPress={()=>setP({...p, timesOfDay: toggle(p.timesOfDay, t)})} small/>)}</View></Field>
          </>)}
          {step === 7 && (<>
            <Text style={s.h1}>Budget & setting</Text>
            <Field label="Price range"><View style={s.wrap}>{PRICE.map(pr => <Chip key={pr} label={pr} on={p.priceRange.includes(pr)} onPress={()=>setP({...p, priceRange: toggle(p.priceRange, pr)})} small/>)}</View></Field>
            <Field label="Indoor / outdoor"><View style={s.wrap}>{SETTING.map(x => <Chip key={x} label={x} on={p.setting===x} onPress={()=>setP({...p, setting:x})} small/>)}</View></Field>
            <Field label="Going with"><View style={s.wrap}>{COMPANY.map(c => <Chip key={c} label={c} on={p.company===c} onPress={()=>setP({...p, company:c})} small/>)}</View></Field>
            <Field label="Crowd size"><View style={s.wrap}>{CROWD.map(c => <Chip key={c} label={c} on={p.crowdSize===c} onPress={()=>setP({...p, crowdSize:c})} small/>)}</View></Field>
          </>)}
          {step === 8 && (<>
            <Text style={s.h1}>Final touches</Text>
            <Field label="Accessibility needs (optional)"><View style={s.wrap}>{ACCESS.map(a => <Chip key={a} label={a} on={p.accessibility.includes(a)} onPress={()=>setP({...p, accessibility: toggle(p.accessibility, a)})} small/>)}</View></Field>
            <View style={s.rowSb}><Text style={s.label}>Event notifications</Text><Switch value={p.notifications} onValueChange={v=>setP({...p, notifications:v})} trackColor={{true: ACCENT}}/></View>
            <Text style={[s.pSm, {marginTop:24}]}>By continuing you agree to our Terms and Privacy Policy.</Text>
          </>)}
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={s.obFooter}>
        {step > 0 ? <GhostBtn label="Back" onPress={back}/> : <View style={{width:80}}/>}
        <PrimaryBtn label={step === STEPS.length - 1 ? 'Start exploring' : 'Continue'} onPress={next} disabled={!canNext}/>
      </View>
    </SafeAreaView>
  );
}

// ---------- Cards & Lists ----------
function EventCard({ ev, onOpen, onSave }: any){
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onOpen} style={s.card}>
      {ev.image ? <Image source={{uri: ev.image}} style={s.cardImg}/> : <View style={[s.cardImg, {backgroundColor:'#222'}]}/>}
      <View style={s.cardBody}>
        <View style={s.row}>
          {ev.source ? <View style={s.tag}><Text style={s.tagTxt}>{ev.source.replace('_',' ')}</Text></View> : null}
          {fmtPrice(ev.price) ? <View style={[s.tag, {marginLeft:6}]}><Text style={s.tagTxt}>{fmtPrice(ev.price)}</Text></View> : null}
        </View>
        <Text style={s.cardTitle} numberOfLines={2}>{ev.title}</Text>
        <Text style={s.cardMeta} numberOfLines={1}>{[ev.venue, ev.city].filter(Boolean).join(' \u00b7 ')}</Text>
        <Text style={s.cardMeta}>{fmtDate(ev.startsAt)}</Text>
        {ev.description ? <Text style={s.cardDesc} numberOfLines={3}>{ev.description}</Text> : null}
        <View style={[s.row, {marginTop:10}]}>
          <TouchableOpacity onPress={onSave} style={s.actSm}><Text style={s.actDetailsTxt}>Save</Text></TouchableOpacity>
          <TouchableOpacity onPress={onOpen} style={[s.actSm, {backgroundColor: ACCENT, marginLeft:8}]}><Text style={[s.actDetailsTxt, {color:'#000'}]}>Details</Text></TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function EventDetail({ ev, visible, onClose, onSave }: any){
  if (!ev) return null;
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={{flex:1, backgroundColor: BG}}>
        <ScrollView>
          {ev.image ? <Image source={{uri: ev.image}} style={{width:'100%', height:280}}/> : null}
          <View style={{padding:18}}>
            <Text style={s.detailTitle}>{ev.title}</Text>
            <Text style={s.detailMeta}>{[ev.venue, ev.city].filter(Boolean).join(' \u00b7 ')}</Text>
            <Text style={s.detailMeta}>{fmtDate(ev.startsAt)}</Text>
            {ev.price && <Text style={s.detailMeta}>{fmtPrice(ev.price)}</Text>}
            {ev.description ? <Text style={s.detailDesc}>{ev.description}</Text> : null}
          </View>
        </ScrollView>
        <View style={s.detailFooter}>
          <GhostBtn label="Close" onPress={onClose}/>
          <PrimaryBtn label="Save" onPress={onSave}/>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ---------- Discover Screen ----------
function Discover({ profile, onEditProfile }: any){
  const [events, setEvents] = useState<EventItem[]>([]);
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<EventItem | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [loc, setLoc] = useState<{lat:number;lng:number}>({lat: 40.7128, lng: -74.0060});
  
  useEffect(() => { (async () => {
    const sv = await AsyncStorage.getItem(SAVED_KEY);
    if (sv) setSaved(JSON.parse(sv));
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({});
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      }
    } catch {}
  })(); }, []);
  
  async function load(q?: string){
    setLoading(true);
    const r = await fetchEvents(profile, loc, q);
    setEvents(r.events || []);
    setSummary(r.summary || '');
    setLoading(false);
  }
  useEffect(() => { load(); }, [loc.lat, loc.lng]);
  
  async function toggleSave(id: string){
    const next = saved.includes(id) ? saved.filter(x => x !== id) : [...saved, id];
    setSaved(next);
    await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next));
  }
  
  return (
    <View style={{flex:1, backgroundColor: BG}}>
      <View style={s.topBar}>
        <Text style={s.brandSm}>5to9</Text>
        <TouchableOpacity onPress={onEditProfile} style={s.avatar}><Text style={s.avatarTxt}>{profile.name?.[0]?.toUpperCase() || '\u2606'}</Text></TouchableOpacity>
      </View>
      <View style={s.searchRow}>
        <View style={s.searchBox}>
          <TextInput value={query} onChangeText={setQuery} onSubmitEditing={()=>load(query)} returnKeyType="search" placeholder="Ask Townie: 'rooftop tonight'" placeholderTextColor={MUTED} style={s.searchInput}/>
        </View>
        <TouchableOpacity onPress={()=>load(query)} style={s.townieBtn}><Text style={s.townieBtnTxt}>Go</Text></TouchableOpacity>
      </View>
      {summary ? <Text style={s.summary}>{summary}</Text> : null}
      {loading ? (
        <View style={s.center}><ActivityIndicator color={ACCENT}/><Text style={s.emptyTxt}>Curating your night\u2026</Text></View>
      ) : events.length === 0 ? (
        <View style={s.center}><Text style={s.emptyTitle}>No events yet</Text><Text style={s.emptyTxt}>Try a wider radius or different keyword.</Text></View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          renderItem={({item}) => <EventCard ev={item} onOpen={()=>setOpen(item)} onSave={()=>toggleSave(item.id)} />}
          contentContainerStyle={{padding:14, paddingBottom:120}}
          ItemSeparatorComponent={()=> <View style={{height:14}}/>}
        />
      )}
      <EventDetail ev={open} visible={!!open} onClose={()=>setOpen(null)} onSave={()=>{ if(open){toggleSave(open.id); setOpen(null);}}}/>
    </View>
  );
}

function SavedList({ profile }: any){
  const [items, setItems] = useState<EventItem[]>([]);
  const [open, setOpen] = useState<EventItem | null>(null);
  useEffect(() => { (async () => {
    const sv = await AsyncStorage.getItem(SAVED_KEY);
    const ids: string[] = sv ? JSON.parse(sv) : [];
    if (ids.length === 0) { setItems([]); return; }
    const r = await fetchEvents(profile, {lat:40.7128,lng:-74.006});
    setItems((r.events || []).filter((e: EventItem) => ids.includes(e.id)));
  })(); }, []);
  return (
    <View style={{flex:1, backgroundColor: BG}}>
      <View style={s.topBar}><Text style={s.brandSm}>Saved</Text></View>
      {items.length === 0 ? (
        <View style={s.center}><Text style={s.emptyTitle}>Nothing saved yet</Text><Text style={s.emptyTxt}>Tap Save on any event.</Text></View>
      ) : (
        <FlatList data={items} keyExtractor={e=>e.id} renderItem={({item})=> <EventCard ev={item} onOpen={()=>setOpen(item)} onSave={()=>{}}/>} contentContainerStyle={{padding:14, paddingBottom:120}} ItemSeparatorComponent={()=> <View style={{height:14}}/>}/>
      )}
      <EventDetail ev={open} visible={!!open} onClose={()=>setOpen(null)} onSave={()=>setOpen(null)}/>
    </View>
  );
}

function VipScreen(){
  return (
    <View style={{flex:1, backgroundColor: BG}}>
      <View style={s.topBar}><Text style={s.brandSm}>VIP</Text></View>
      <View style={s.center}>
        <Text style={s.emptyTitle}>Coming soon</Text>
        <Text style={s.emptyTxt}>Curated invites, presales, and member-only nights.</Text>
      </View>
    </View>
  );
}

// ---------- Edit Profile ----------
function EditProfile({ profile, onSave, onClose }: any){
  const [p, setP] = useState<Profile>(profile);
  function toggle(arr: string[], v: string){ return arr.includes(v) ? arr.filter(x=>x!==v) : [...arr, v]; }
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{flex:1, backgroundColor: BG}}>
        <View style={s.obHeader}><Text style={s.h2}>Edit profile</Text></View>
        <ScrollView contentContainerStyle={{padding:18, paddingBottom:60}}>
          <Field label="Name"><TextInput value={p.name} onChangeText={v=>setP({...p,name:v})} style={s.input}/></Field>
          <Field label="City"><TextInput value={p.city} onChangeText={v=>setP({...p,city:v})} style={s.input}/></Field>
          <Field label={'Max distance: ' + p.maxDistanceKm + ' km'}><View style={s.wrap}>{[5,10,25,50,100].map(d => <Chip key={d} label={d+' km'} on={p.maxDistanceKm===d} onPress={()=>setP({...p, maxDistanceKm:d})} small/>)}</View></Field>
          <Field label="Interests"><View style={s.wrap}>{INTERESTS.map(i => <Chip key={i} label={i} on={p.interests.includes(i)} onPress={()=>setP({...p, interests: toggle(p.interests, i)})}/>)}</View></Field>
          <Field label="Vibes"><View style={s.wrap}>{VIBES.map(v => <Chip key={v} label={v} on={p.vibes.includes(v)} onPress={()=>setP({...p, vibes: toggle(p.vibes, v)})}/>)}</View></Field>
          <Field label="Price"><View style={s.wrap}>{PRICE.map(pr => <Chip key={pr} label={pr} on={p.priceRange.includes(pr)} onPress={()=>setP({...p, priceRange: toggle(p.priceRange, pr)})} small/>)}</View></Field>
          <View style={s.rowSb}><Text style={s.label}>Notifications</Text><Switch value={p.notifications} onValueChange={v=>setP({...p, notifications:v})} trackColor={{true: ACCENT}}/></View>
        </ScrollView>
        <View style={s.obFooter}>
          <GhostBtn label="Cancel" onPress={onClose}/>
          <PrimaryBtn label="Save" onPress={()=>onSave(p)}/>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ---------- Tab Bar ----------
function TabBar({ tab, setTab }: any){
  const tabs = [{k:'discover', l:'Discover'},{k:'saved', l:'Saved'},{k:'vip', l:'VIP'}];
  return (
    <View style={s.tabBar}>
      {tabs.map(t => (
        <TouchableOpacity key={t.k} style={s.tabItem} onPress={()=>setTab(t.k)}>
          <Text style={[s.tabLabel, tab===t.k && {color: ACCENT}]}>{t.l}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ---------- Root ----------
export default function App(){
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('discover');
  const [editing, setEditing] = useState(false);
  useEffect(() => { (async () => {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (raw) setProfile(JSON.parse(raw));
    setLoading(false);
  })(); }, []);
  async function handleOnboardDone(p: Profile){
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    setProfile(p);
  }
  async function handleSaveProfile(p: Profile){
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    setProfile(p); setEditing(false);
  }
  if (loading) return <View style={[s.center,{backgroundColor:BG, flex:1}]}><ActivityIndicator color={ACCENT}/></View>;
  if (!profile || !profile.onboardingComplete) return <Onboarding onDone={handleOnboardDone}/>;
  return (
    <SafeAreaView style={{flex:1, backgroundColor: BG}}>
      <StatusBar style="light"/>
      {tab === 'discover' && <Discover profile={profile} onEditProfile={()=>setEditing(true)}/>}
      {tab === 'saved' && <SavedList profile={profile}/>}
      {tab === 'vip' && <VipScreen/>}
      <TabBar tab={tab} setTab={setTab}/>
      {editing && <EditProfile profile={profile} onSave={handleSaveProfile} onClose={()=>setEditing(false)}/>}
    </SafeAreaView>
  );
}

// ---------- Styles ----------
const s = StyleSheet.create({
  obHeader: { paddingHorizontal:18, paddingTop:8, paddingBottom:14, borderBottomWidth:1, borderBottomColor: LINE },
  stepCount: { color: MUTED, fontSize:12, marginBottom:8, letterSpacing:1, textTransform:'uppercase' },
  obBody: { padding:18, paddingBottom:80 },
import { SafeAreaView, View, Text, TextInput, TouchableOpacity, ScrollView, FlatList, Image, ActivityIndicator, StyleSheet, Modal, Platform, KeyboardAvoidingView, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';

const API_BASE = 'https://project-ushrm.vercel.app';
const BG = '#0B0B0F';
const FG = '#F5F5F7';
const MUTED = '#8A8A92';
const CARD = '#15151B';
const ACCENT = '#D9FF3D';
const LINE = '#222229';

const PROFILE_KEY = '@5to9_profile_v1';
const SAVED_KEY = '@5to9_saved_v1';
const PASSED_KEY = '@5to9_passed_v1';

const INTERESTS = ['Live music','DJs / Electronic','Hip-hop','Indie','Jazz','Latin','House','Techno','Comedy','Theater','Art / Gallery','Film','Food / Tasting','Cocktails','Wine','Beer / Brewery','Dance','Karaoke','Trivia','Sports','Outdoor','Festival','Workshop','Meetup','LGBTQ+','Date night','After hours'];
const VIBES = ['Chill','Energetic','Romantic','Wild','Classy','Underground','Trendy','Cozy','Loud','Intimate'];
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const TIMES = ['Morning','Afternoon','Evening','Late night'];
const PRICE = ['Free','$','$$','$$$','$$$$'];
const SETTING = ['Indoor','Outdoor','Either'];
const COMPANY = ['Solo','Couple','Friends','Date','Group'];
const CROWD = ['Small','Medium','Large','No preference'];
const ACCESS = ['Wheelchair access','Quiet space','Sober-friendly','Sensory-friendly'];
const GENDER = ['Woman','Man','Non-binary','Prefer not to say'];
const REL = ['Single','Dating','In a relationship','Married','It\u2019s complicated','Prefer not to say'];

type Profile = {
  name: string; birthYear: number | null; gender: string;
  city: string; maxDistanceKm: number;
  relationship: string; occupation: string; languages: string;
  interests: string[]; vibes: string[];
  priceRange: string[]; daysAvailable: string[]; timesOfDay: string[];
  setting: string; company: string; crowdSize: string;
  accessibility: string[]; notifications: boolean;
  onboardingComplete: boolean;
};

const EMPTY_PROFILE: Profile = {
  name: '', birthYear: null, gender: '',
  city: '', maxDistanceKm: 25,
  relationship: '', occupation: '', languages: '',
  interests: [], vibes: [],
  priceRange: [], daysAvailable: [], timesOfDay: [],
  setting: 'Either', company: '', crowdSize: 'No preference',
  accessibility: [], notifications: true,
  onboardingComplete: false,
};

type EventItem = {
  id: string; source: string; title: string;
  startsAt: string; endsAt?: string;
  venue?: string; city?: string; lat?: number; lng?: number;
  url?: string; image?: string;
  price?: { min?: number; max?: number; currency?: string; free?: boolean };
  categories?: string[]; description?: string;
};

function fmtDate(iso?: string){
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  } catch { return iso; }
}
function fmtPrice(p?: EventItem['price']){
  if (!p) return '';
  if (p.free) return 'Free';
  if (p.min != null && p.max != null) return '$' + Math.round(p.min) + (p.max > p.min ? '\u2013$' + Math.round(p.max) : '');
  if (p.min != null) return '$' + Math.round(p.min) + '+';
  return '';
}

async function fetchEvents(profile: Profile, location: {lat:number; lng:number}, query?: string){
  try {
    const r = await fetch(API_BASE + '/api/townie', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ profile, location, query }),
    });
    if (!r.ok) return { events: [], summary: '' };
    return await r.json();
  } catch { return { events: [], summary: '' }; }
}

// ---------- UI Primitives ----------
function Chip({label, on, onPress, small}: any){
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, small && s.chipSm, on && s.chipOn]}>
      <Text style={[s.chipTxt, small && s.chipTxtSm, on && s.chipTxtOn]}>{label}</Text>
    </TouchableOpacity>
  );
}
function PrimaryBtn({label, onPress, disabled}: any){
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[s.btn, disabled && s.btnDis]}>
      <Text style={s.btnTxt}>{label}</Text>
    </TouchableOpacity>
  );
}
function GhostBtn({label, onPress}: any){
  return (
    <TouchableOpacity onPress={onPress} style={s.ghost}>
      <Text style={s.ghostTxt}>{label}</Text>
    </TouchableOpacity>
  );
}
function Field({label, children, hint}: any){
  return (
    <View style={{marginBottom:18}}>
      <Text style={s.label}>{label}</Text>
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}
function Progress({step, total}: any){
  return (
    <View style={s.progT}><View style={[s.progF, {width: ((step+1)/total)*100 + '%'}]} /></View>
  );
}

// ---------- Onboarding ----------
const STEPS = [
  'Welcome','You','Location','Lifestyle','Interests','Vibes','Schedule','Budget & Setting','Final touches'
];

function Onboarding({ onDone }: { onDone: (p: Profile) => void }){
  const [step, setStep] = useState(0);
  const [p, setP] = useState<Profile>(EMPTY_PROFILE);
  function toggle(arr: string[], v: string, min?: number, max?: number){
    const has = arr.includes(v);
    if (has) return arr.filter(x => x !== v);
    if (max && arr.length >= max) return arr;
    return [...arr, v];
  }
  const canNext = (() => {
    if (step === 1) return p.name.trim().length > 0 && !!p.birthYear && p.birthYear < new Date().getFullYear() - 12;
    if (step === 2) return p.city.trim().length > 0;
    if (step === 4) return p.interests.length >= 3;
    if (step === 5) return p.vibes.length >= 1;
    if (step === 6) return p.daysAvailable.length >= 1 && p.timesOfDay.length >= 1;
    if (step === 7) return p.priceRange.length >= 1 && !!p.company;
    return true;
  })();
  function next(){
    if (step === STEPS.length - 1) { onDone({ ...p, onboardingComplete: true }); return; }
    setStep(step + 1);
  }
  function back(){ if (step > 0) setStep(step - 1); }
  return (
    <SafeAreaView style={{flex:1, backgroundColor: BG}}>
      <StatusBar style="light" />
      <View style={s.obHeader}>
        <Text style={s.stepCount}>Step {step+1} of {STEPS.length}</Text>
        <Progress step={step} total={STEPS.length} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{flex:1}}>
        <ScrollView contentContainerStyle={s.obBody} keyboardShouldPersistTaps="handled">
          {step === 0 && (<>
            <Text style={s.brand}>5to9</Text>
            <Text style={s.h1}>Your nights, curated.</Text>
            <Text style={s.pBig}>Tell us a bit about you. We\u2019ll surface events you\u2019ll actually love \u2014 powered by Claude and licensed event data.</Text>
            <View style={{height:18}}/>
            <Text style={s.pSm}>Takes about 90 seconds. You can change anything later.</Text>
          </>)}
          {step === 1 && (<>
            <Text style={s.h1}>You</Text>
            <Field label="What should we call you?">
              <TextInput value={p.name} onChangeText={v=>setP({...p,name:v})} placeholder="First name" placeholderTextColor={MUTED} style={s.input}/>
            </Field>
            <Field label="Birth year" hint="We use this for age-appropriate suggestions.">
              <TextInput value={p.birthYear ? String(p.birthYear) : ''} onChangeText={v=>setP({...p,birthYear: v ? parseInt(v,10) : null})} keyboardType="number-pad" maxLength={4} placeholder="e.g. 1997" placeholderTextColor={MUTED} style={s.input}/>
            </Field>
            <Field label="Gender (optional)">
              <View style={s.wrap}>{GENDER.map(g => <Chip key={g} label={g} on={p.gender===g} onPress={()=>setP({...p,gender:p.gender===g?'':g})} small/>)}</View>
            </Field>
          </>)}
          {step === 2 && (<>
            <Text style={s.h1}>Where</Text>
            <Field label="Your city">
              <TextInput value={p.city} onChangeText={v=>setP({...p,city:v})} placeholder="e.g. Brooklyn, NY" placeholderTextColor={MUTED} style={s.input}/>
            </Field>
            <Field label={'Max distance: ' + p.maxDistanceKm + ' km'}>
              <View style={s.wrap}>{[5,10,25,50,100].map(d => <Chip key={d} label={d+' km'} on={p.maxDistanceKm===d} onPress={()=>setP({...p,maxDistanceKm:d})} small/>)}</View>
            </Field>
          </>)}
          {step === 3 && (<>
            <Text style={s.h1}>Lifestyle</Text>
            <Field label="Relationship"><View style={s.wrap}>{REL.map(r => <Chip key={r} label={r} on={p.relationship===r} onPress={()=>setP({...p,relationship:p.relationship===r?'':r})} small/>)}</View></Field>
            <Field label="Occupation (optional)"><TextInput value={p.occupation} onChangeText={v=>setP({...p,occupation:v})} placeholder="e.g. Designer" placeholderTextColor={MUTED} style={s.input}/></Field>
            <Field label="Languages (optional)" hint="Comma separated."><TextInput value={p.languages} onChangeText={v=>setP({...p,languages:v})} placeholder="e.g. English, Spanish" placeholderTextColor={MUTED} style={s.input}/></Field>
          </>)}
          {step === 4 && (<>
            <Text style={s.h1}>Interests</Text>
            <Text style={s.pSm}>Pick at least 3.</Text>
            <View style={[s.wrap, {marginTop:10}]}>{INTERESTS.map(i => <Chip key={i} label={i} on={p.interests.includes(i)} onPress={()=>setP({...p, interests: toggle(p.interests, i)})}/>)}</View>
          </>)}
          {step === 5 && (<>
            <Text style={s.h1}>Vibes</Text>
            <Text style={s.pSm}>How do you like your nights to feel?</Text>
            <View style={[s.wrap, {marginTop:10}]}>{VIBES.map(v => <Chip key={v} label={v} on={p.vibes.includes(v)} onPress={()=>setP({...p, vibes: toggle(p.vibes, v)})}/>)}</View>
          </>)}
          {step === 6 && (<>
            <Text style={s.h1}>When</Text>
            <Field label="Days you\u2019re usually free"><View style={s.wrap}>{DAYS.map(d => <Chip key={d} label={d} on={p.daysAvailable.includes(d)} onPress={()=>setP({...p, daysAvailable: toggle(p.daysAvailable, d)})} small/>)}</View></Field>
            <Field label="Times of day"><View style={s.wrap}>{TIMES.map(t => <Chip key={t} label={t} on={p.timesOfDay.includes(t)} onPress={()=>setP({...p, timesOfDay: toggle(p.timesOfDay, t)})} small/>)}</View></Field>
          </>)}
          {step === 7 && (<>
            <Text style={s.h1}>Budget & setting</Text>
            <Field label="Price range"><View style={s.wrap}>{PRICE.map(pr => <Chip key={pr} label={pr} on={p.priceRange.includes(pr)} onPress={()=>setP({...p, priceRange: toggle(p.priceRange, pr)})} small/>)}</View></Field>
            <Field label="Indoor / outdoor"><View style={s.wrap}>{SETTING.map(x => <Chip key={x} label={x} on={p.setting===x} onPress={()=>setP({...p, setting:x})} small/>)}</View></Field>
            <Field label="Going with"><View style={s.wrap}>{COMPANY.map(c => <Chip key={c} label={c} on={p.company===c} onPress={()=>setP({...p, company:c})} small/>)}</View></Field>
            <Field label="Crowd size"><View style={s.wrap}>{CROWD.map(c => <Chip key={c} label={c} on={p.crowdSize===c} onPress={()=>setP({...p, crowdSize:c})} small/>)}</View></Field>
          </>)}
          {step === 8 && (<>
            <Text style={s.h1}>Final touches</Text>
            <Field label="Accessibility needs (optional)"><View style={s.wrap}>{ACCESS.map(a => <Chip key={a} label={a} on={p.accessibility.includes(a)} onPress={()=>setP({...p, accessibility: toggle(p.accessibility, a)})} small/>)}</View></Field>
            <View style={s.rowSb}><Text style={s.label}>Event notifications</Text><Switch value={p.notifications} onValueChange={v=>setP({...p, notifications:v})} trackColor={{true: ACCENT}}/></View>
            <Text style={[s.pSm, {marginTop:24}]}>By continuing you agree to our Terms and Privacy Policy.</Text>
          </>)}
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={s.obFooter}>
        {step > 0 ? <GhostBtn label="Back" onPress={back}/> : <View style={{width:80}}/>}
        <PrimaryBtn label={step === STEPS.length - 1 ? 'Start exploring' : 'Continue'} onPress={next} disabled={!canNext}/>
      </View>
    </SafeAreaView>
  );
}

// ---------- Cards & Lists ----------
function EventCard({ ev, onOpen, onSave }: any){
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onOpen} style={s.card}>
      {ev.image ? <Image source={{uri: ev.image}} style={s.cardImg}/> : <View style={[s.cardImg, {backgroundColor:'#222'}]}/>}
      <View style={s.cardBody}>
        <View style={s.row}>
          {ev.source ? <View style={s.tag}><Text style={s.tagTxt}>{ev.source.replace('_',' ')}</Text></View> : null}
          {fmtPrice(ev.price) ? <View style={[s.tag, {marginLeft:6}]}><Text style={s.tagTxt}>{fmtPrice(ev.price)}</Text></View> : null}
        </View>
        <Text style={s.cardTitle} numberOfLines={2}>{ev.title}</Text>
        <Text style={s.cardMeta} numberOfLines={1}>{[ev.venue, ev.city].filter(Boolean).join(' \u00b7 ')}</Text>
        <Text style={s.cardMeta}>{fmtDate(ev.startsAt)}</Text>
        {ev.description ? <Text style={s.cardDesc} numberOfLines={3}>{ev.description}</Text> : null}
        <View style={[s.row, {marginTop:10}]}>
          <TouchableOpacity onPress={onSave} style={s.actSm}><Text style={s.actDetailsTxt}>Save</Text></TouchableOpacity>
          <TouchableOpacity onPress={onOpen} style={[s.actSm, {backgroundColor: ACCENT, marginLeft:8}]}><Text style={[s.actDetailsTxt, {color:'#000'}]}>Details</Text></TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function EventDetail({ ev, visible, onClose, onSave }: any){
  if (!ev) return null;
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={{flex:1, backgroundColor: BG}}>
        <ScrollView>
          {ev.image ? <Image source={{uri: ev.image}} style={{width:'100%', height:280}}/> : null}
          <View style={{padding:18}}>
            <Text style={s.detailTitle}>{ev.title}</Text>
            <Text style={s.detailMeta}>{[ev.venue, ev.city].filter(Boolean).join(' \u00b7 ')}</Text>
            <Text style={s.detailMeta}>{fmtDate(ev.startsAt)}</Text>
            {ev.price && <Text style={s.detailMeta}>{fmtPrice(ev.price)}</Text>}
            {ev.description ? <Text style={s.detailDesc}>{ev.description}</Text> : null}
          </View>
        </ScrollView>
        <View style={s.detailFooter}>
          <GhostBtn label="Close" onPress={onClose}/>
          <PrimaryBtn label="Save" onPress={onSave}/>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ---------- Discover Screen ----------
function Discover({ profile, onEditProfile }: any){
  const [events, setEvents] = useState<EventItem[]>([]);
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<EventItem | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [loc, setLoc] = useState<{lat:number;lng:number}>({lat: 40.7128, lng: -74.0060});
  
  useEffect(() => { (async () => {
    const sv = await AsyncStorage.getItem(SAVED_KEY);
    if (sv) setSaved(JSON.parse(sv));
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({});
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      }
    } catch {}
  })(); }, []);
  
  async function load(q?: string){
    setLoading(true);
    const r = await fetchEvents(profile, loc, q);
    setEvents(r.events || []);
    setSummary(r.summary || '');
    setLoading(false);
  }
  useEffect(() => { load(); }, [loc.lat, loc.lng]);
  
  async function toggleSave(id: string){
    const next = saved.includes(id) ? saved.filter(x => x !== id) : [...saved, id];
    setSaved(next);
    await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next));
  }
  
  return (
    <View style={{flex:1, backgroundColor: BG}}>
      <View style={s.topBar}>
        <Text style={s.brandSm}>5to9</Text>
        <TouchableOpacity onPress={onEditProfile} style={s.avatar}><Text style={s.avatarTxt}>{profile.name?.[0]?.toUpperCase() || '\u2606'}</Text></TouchableOpacity>
      </View>
      <View style={s.searchRow}>
        <View style={s.searchBox}>
          <TextInput value={query} onChangeText={setQuery} onSubmitEditing={()=>load(query)} returnKeyType="search" placeholder="Ask Townie: 'rooftop tonight'" placeholderTextColor={MUTED} style={s.searchInput}/>
        </View>
        <TouchableOpacity onPress={()=>load(query)} style={s.townieBtn}><Text style={s.townieBtnTxt}>Go</Text></TouchableOpacity>
      </View>
      {summary ? <Text style={s.summary}>{summary}</Text> : null}
      {loading ? (
        <View style={s.center}><ActivityIndicator color={ACCENT}/><Text style={s.emptyTxt}>Curating your night\u2026</Text></View>
      ) : events.length === 0 ? (
        <View style={s.center}><Text style={s.emptyTitle}>No events yet</Text><Text style={s.emptyTxt}>Try a wider radius or different keyword.</Text></View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          renderItem={({item}) => <EventCard ev={item} onOpen={()=>setOpen(item)} onSave={()=>toggleSave(item.id)} />}
          contentContainerStyle={{padding:14, paddingBottom:120}}
          ItemSeparatorComponent={()=> <View style={{height:14}}/>}
        />
      )}
      <EventDetail ev={open} visible={!!open} onClose={()=>setOpen(null)} onSave={()=>{ if(open){toggleSave(open.id); setOpen(null);}}}/>
    </View>
  );
}

function SavedList({ profile }: any){
  const [items, setItems] = useState<EventItem[]>([]);
  const [open, setOpen] = useState<EventItem | null>(null);
  useEffect(() => { (async () => {
    const sv = await AsyncStorage.getItem(SAVED_KEY);
    const ids: string[] = sv ? JSON.parse(sv) : [];
    if (ids.length === 0) { setItems([]); return; }
    const r = await fetchEvents(profile, {lat:40.7128,lng:-74.006});
    setItems((r.events || []).filter((e: EventItem) => ids.includes(e.id)));
  })(); }, []);
  return (
    <View style={{flex:1, backgroundColor: BG}}>
      <View style={s.topBar}><Text style={s.brandSm}>Saved</Text></View>
      {items.length === 0 ? (
        <View style={s.center}><Text style={s.emptyTitle}>Nothing saved yet</Text><Text style={s.emptyTxt}>Tap Save on any event.</Text></View>
      ) : (
        <FlatList data={items} keyExtractor={e=>e.id} renderItem={({item})=> <EventCard ev={item} onOpen={()=>setOpen(item)} onSave={()=>{}}/>} contentContainerStyle={{padding:14, paddingBottom:120}} ItemSeparatorComponent={()=> <View style={{height:14}}/>}/>
      )}
      <EventDetail ev={open} visible={!!open} onClose={()=>setOpen(null)} onSave={()=>setOpen(null)}/>
    </View>
  );
}

function VipScreen(){
  return (
    <View style={{flex:1, backgroundColor: BG}}>
      <View style={s.topBar}><Text style={s.brandSm}>VIP</Text></View>
      <View style={s.center}>
        <Text style={s.emptyTitle}>Coming soon</Text>
        <Text style={s.emptyTxt}>Curated invites, presales, and member-only nights.</Text>
      </View>
    </View>
  );
}

// ---------- Edit Profile ----------
function EditProfile({ profile, onSave, onClose }: any){
  const [p, setP] = useState<Profile>(profile);
  function toggle(arr: string[], v: string){ return arr.includes(v) ? arr.filter(x=>x!==v) : [...arr, v]; }
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{flex:1, backgroundColor: BG}}>
        <View style={s.obHeader}><Text style={s.h2}>Edit profile</Text></View>
        <ScrollView contentContainerStyle={{padding:18, paddingBottom:60}}>
          <Field label="Name"><TextInput value={p.name} onChangeText={v=>setP({...p,name:v})} style={s.input}/></Field>
          <Field label="City"><TextInput value={p.city} onChangeText={v=>setP({...p,city:v})} style={s.input}/></Field>
          <Field label={'Max distance: ' + p.maxDistanceKm + ' km'}><View style={s.wrap}>{[5,10,25,50,100].map(d => <Chip key={d} label={d+' km'} on={p.maxDistanceKm===d} onPress={()=>setP({...p, maxDistanceKm:d})} small/>)}</View></Field>
          <Field label="Interests"><View style={s.wrap}>{INTERESTS.map(i => <Chip key={i} label={i} on={p.interests.includes(i)} onPress={()=>setP({...p, interests: toggle(p.interests, i)})}/>)}</View></Field>
          <Field label="Vibes"><View style={s.wrap}>{VIBES.map(v => <Chip key={v} label={v} on={p.vibes.includes(v)} onPress={()=>setP({...p, vibes: toggle(p.vibes, v)})}/>)}</View></Field>
          <Field label="Price"><View style={s.wrap}>{PRICE.map(pr => <Chip key={pr} label={pr} on={p.priceRange.includes(pr)} onPress={()=>setP({...p, priceRange: toggle(p.priceRange, pr)})} small/>)}</View></Field>
          <View style={s.rowSb}><Text style={s.label}>Notifications</Text><Switch value={p.notifications} onValueChange={v=>setP({...p, notifications:v})} trackColor={{true: ACCENT}}/></View>
        </ScrollView>
        <View style={s.obFooter}>
          <GhostBtn label="Cancel" onPress={onClose}/>
          <PrimaryBtn label="Save" onPress={()=>onSave(p)}/>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ---------- Tab Bar ----------
function TabBar({ tab, setTab }: any){
  const tabs = [{k:'discover', l:'Discover'},{k:'saved', l:'Saved'},{k:'vip', l:'VIP'}];
  return (
    <View style={s.tabBar}>
      {tabs.map(t => (
        <TouchableOpacity key={t.k} style={s.tabItem} onPress={()=>setTab(t.k)}>
          <Text style={[s.tabLabel, tab===t.k && {color: ACCENT}]}>{t.l}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ---------- Root ----------
export default function App(){
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('discover');
  const [editing, setEditing] = useState(false);
  useEffect(() => { (async () => {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (raw) setProfile(JSON.parse(raw));
    setLoading(false);
  })(); }, []);
  async function handleOnboardDone(p: Profile){
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    setProfile(p);
  }
  async function handleSaveProfile(p: Profile){
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    setProfile(p); setEditing(false);
  }
  if (loading) return <View style={[s.center,{backgroundColor:BG, flex:1}]}><ActivityIndicator color={ACCENT}/></View>;
  if (!profile || !profile.onboardingComplete) return <Onboarding onDone={handleOnboardDone}/>;
  return (
    <SafeAreaView style={{flex:1, backgroundColor: BG}}>
      <StatusBar style="light"/>
      {tab === 'discover' && <Discover profile={profile} onEditProfile={()=>setEditing(true)}/>}
      {tab === 'saved' && <SavedList profile={profile}/>}
      {tab === 'vip' && <VipScreen/>}
      <TabBar tab={tab} setTab={setTab}/>
      {editing && <EditProfile profile={profile} onSave={handleSaveProfile} onClose={()=>setEditing(false)}/>}
    </SafeAreaView>
  );
}

// ---------- Styles ----------
const s = StyleSheet.create({
  obHeader: { paddingHorizontal:18, paddingTop:8, paddingBottom:14, borderBottomWidth:1, borderBottomColor: LINE },
  stepCount: { color: MUTED, fontSize:12, marginBottom:8, letterSpacing:1, textTransform:'uppercase' },
  obBody: { padding:18, paddingBottom:80 },
  brand: { color: ACCENT, fontSize:42, fontWeight:'900', letterSpacing:-1, marginBottom:8 },
  h1: { color: FG, fontSize:28, fontWeight:'800', marginBottom:8 },
  h2: { color: FG, fontSize:20, fontWeight:'700' },
  pBig: { color: FG, fontSize:16, lineHeight:24 },
  pSm: { color: MUTED, fontSize:13, lineHeight:20 },
  row: { flexDirection:'row', alignItems:'center' },
  rowSb: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:18 },
  label: { color: FG, fontSize:14, fontWeight:'600', marginBottom:8 },
  hint: { color: MUTED, fontSize:12, marginTop:6 },
  input: { backgroundColor: CARD, color: FG, borderRadius:12, paddingHorizontal:14, paddingVertical:14, fontSize:16, borderWidth:1, borderColor: LINE },
  wrap: { flexDirection:'row', flexWrap:'wrap', gap:8 },
  chip: { paddingHorizontal:14, paddingVertical:10, borderRadius:999, borderWidth:1, borderColor: LINE, backgroundColor: CARD, marginRight:8, marginBottom:8 },
  chipSm: { paddingHorizontal:12, paddingVertical:7 },
  chipOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  chipTxt: { color: FG, fontSize:14 },
  chipTxtSm: { fontSize:13 },
  chipTxtOn: { color:'#000', fontWeight:'700' },
  progT: { height:4, backgroundColor: LINE, borderRadius:2, overflow:'hidden' },
  progF: { height:4, backgroundColor: ACCENT },
  obFooter: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', padding:14, paddingBottom:24, borderTopWidth:1, borderTopColor: LINE, backgroundColor: BG, gap:10 },
  btn: { backgroundColor: ACCENT, paddingHorizontal:22, paddingVertical:14, borderRadius:999, flex:1, alignItems:'center' },
  btnDis: { opacity:0.4 },
  btnTxt: { color:'#000', fontWeight:'800', fontSize:15 },
  ghost: { paddingHorizontal:18, paddingVertical:14, borderRadius:999 },
  ghostTxt: { color: FG, fontWeight:'600' },
  topBar: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingVertical:12, borderBottomWidth:1, borderBottomColor: LINE },
  brandSm: { color: ACCENT, fontSize:22, fontWeight:'900', letterSpacing:-0.5 },
  avatar: { width:36, height:36, borderRadius:18, backgroundColor: CARD, alignItems:'center', justifyContent:'center', borderWidth:1, borderColor: LINE },
  avatarTxt: { color: FG, fontWeight:'700' },
  searchRow: { flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingVertical:10, gap:8 },
  searchBox: { flex:1, backgroundColor: CARD, borderRadius:12, borderWidth:1, borderColor: LINE, paddingHorizontal:14 },
  searchInput: { color: FG, fontSize:15, paddingVertical:12 },
  townieBtn: { backgroundColor: ACCENT, paddingHorizontal:16, paddingVertical:12, borderRadius:12 },
  townieBtnTxt: { color:'#000', fontWeight:'800' },
  summary: { color: MUTED, paddingHorizontal:16, paddingBottom:6, fontStyle:'italic' },
  center: { flex:1, alignItems:'center', justifyContent:'center', padding:30 },
  emptyTitle: { color: FG, fontSize:18, fontWeight:'700', marginTop:10 },
  emptyTxt: { color: MUTED, fontSize:14, textAlign:'center', marginTop:6 },
  card: { backgroundColor: CARD, borderRadius:18, overflow:'hidden', borderWidth:1, borderColor: LINE },
  cardImg: { width:'100%', height:180, backgroundColor:'#1a1a22' },
  cardBody: { padding:14 },
  tag: { backgroundColor:'#222', paddingHorizontal:8, paddingVertical:4, borderRadius:6 },
  tagTxt: { color: MUTED, fontSize:11, textTransform:'uppercase', letterSpacing:0.5 },
  cardTitle: { color: FG, fontSize:18, fontWeight:'700', marginTop:8 },
  cardMeta: { color: MUTED, fontSize:13, marginTop:3 },
  cardDesc: { color: FG, fontSize:14, marginTop:8, lineHeight:20 },
  actSm: { paddingHorizontal:14, paddingVertical:8, borderRadius:999, backgroundColor:'#222' },
  actDetailsTxt: { color: FG, fontSize:13, fontWeight:'700' },
  tabBar: { position:'absolute', bottom:0, left:0, right:0, flexDirection:'row', backgroundColor: BG, borderTopWidth:1, borderTopColor: LINE, paddingBottom:24, paddingTop:8 },
  tabItem: { flex:1, alignItems:'center', paddingVertical:8 },
  tabLabel: { color: MUTED, fontSize:13, fontWeight:'700' },
  detailTitle: { color: FG, fontSize:24, fontWeight:'800' },
  detailMeta: { color: MUTED, fontSize:14, marginTop:4 },
  detailDesc: { color: FG, fontSize:15, lineHeight:22, marginTop:14 },
  detailFooter: { flexDirection:'row', gap:10, padding:14, paddingBottom:24, borderTopWidth:1, borderTopColor: LINE },
});
