import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, TouchableOpacity, ScrollView, FlatList, Image, ActivityIndicator, StyleSheet, Modal, Platform, KeyboardAvoidingView, Switch, Linking } from 'react-native';
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
const FRIENDS_KEY = '@5to9_friends_v1';
const IMPORTED_KEY = '@5to9_imported_v1';
const USER_KEY = '@5to9_user_v1';

// Login-free identity: a stable device userId + a shareable invite code (registered on the backend).
async function ensureIdentity(profile?: any){
  let stored: any = null;
  try { const raw = await AsyncStorage.getItem(USER_KEY); stored = raw ? JSON.parse(raw) : null; } catch {}
  let userId = stored?.userId;
  if (!userId) {
    userId = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify({ userId }));
  }
  try {
    const r = await fetch(API_BASE + '/api/friends', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'register', userId, name: profile?.name || '', city: profile?.city || '', vibes: profile?.vibes || [] }),
    });
    const d = await r.json();
    if (d.user) { await AsyncStorage.setItem(USER_KEY, JSON.stringify({ userId, code: d.user.code })); return d.user; }
  } catch {}
  return { userId, code: stored?.code };
}

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
function fmtTime(iso?: string){
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(undefined, { hour:'numeric', minute:'2-digit' }).replace(/\s/g,'').toLowerCase(); } catch { return ''; }
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
  'Welcome','You','Location','Lifestyle','Interests','Vibes','Budget & Setting','Final touches'
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
    if (step === 6) return p.priceRange.length >= 1 && !!p.company;
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
            <Field label={'Max distance: ' + p.maxDistanceKm + ' mi'}>
              <View style={s.wrap}>{[5,10,25,50,100].map(d => <Chip key={d} label={d+' mi'} on={p.maxDistanceKm===d} onPress={()=>setP({...p,maxDistanceKm:d})} small/>)}</View>
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
            <Text style={s.h1}>Budget & setting</Text>
            <Field label="Price range"><View style={s.wrap}>{PRICE.map(pr => <Chip key={pr} label={pr} on={p.priceRange.includes(pr)} onPress={()=>setP({...p, priceRange: toggle(p.priceRange, pr)})} small/>)}</View></Field>
            <Field label="Indoor / outdoor"><View style={s.wrap}>{SETTING.map(x => <Chip key={x} label={x} on={p.setting===x} onPress={()=>setP({...p, setting:x})} small/>)}</View></Field>
            <Field label="Going with"><View style={s.wrap}>{COMPANY.map(c => <Chip key={c} label={c} on={p.company===c} onPress={()=>setP({...p, company:c})} small/>)}</View></Field>
            <Field label="Crowd size"><View style={s.wrap}>{CROWD.map(c => <Chip key={c} label={c} on={p.crowdSize===c} onPress={()=>setP({...p, crowdSize:c})} small/>)}</View></Field>
          </>)}
          {step === 7 && (<>
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
function EventCard({ ev, onOpen, onSave, rank, saved }: any){
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onOpen} style={s.card}>
      <View>
        {ev.image
          ? <Image source={{uri: ev.image}} style={s.cardImg}/>
          : <View style={[s.cardImg, s.cardImgFallback]}><Text style={s.cardImgFallbackTxt}>{(ev.title||'5to9')[0].toUpperCase()}</Text></View>}
        {rank ? <View style={s.rankBadge}><Text style={s.rankTxt}>#{rank} nearby</Text></View> : null}
        <TouchableOpacity onPress={onSave} style={s.heartOverlay}><Text style={s.heartOverlayTxt}>{saved ? '♥' : '♡'}</Text></TouchableOpacity>
      </View>
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
            {(ev as any)._note ? <Text style={s.detailNote}>{(ev as any)._note}</Text> : null}
            {ev.description ? <Text style={s.detailDesc}>{ev.description}</Text> : null}
            {ev.url ? <TouchableOpacity onPress={()=>Linking.openURL(ev.url)} style={s.linkBtn}><Text style={s.linkBtnTxt}>Get tickets / more info</Text></TouchableOpacity> : null}
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

// ---------- Import event from a link (compliant: oEmbed + link unfurl) ----------
function ImportLinkModal({ visible, onClose, onImported }: any){
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  async function go(){
    if (!/^https?:\/\//i.test(url)) { setErr('Paste a full link starting with https://'); return; }
    setErr(''); setLoading(true);
    try {
      const r = await fetch(API_BASE + '/api/import', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ url }) });
      const data = await r.json();
      if (data.event) { onImported(data.event); setUrl(''); onClose(); }
      else setErr("Couldn't find an event in that link. Try a different post.");
    } catch { setErr('Something went wrong. Try again.'); }
    setLoading(false);
  }
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.sheetWrap}>
        <View style={s.sheet}>
          <Text style={s.h2}>Add event from a link</Text>
          <Text style={s.pSm}>Paste an Instagram, TikTok, X, or any event link. We'll read the post and turn it into an event card.</Text>
          <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://…" placeholderTextColor={MUTED} style={[s.input, {marginTop:14}]}/>
          {err ? <Text style={s.errTxt}>{err}</Text> : null}
          <View style={{height:14}}/>
          {loading ? <ActivityIndicator color={ACCENT}/> : (
            <View style={[s.row, {gap:10}]}>
              <GhostBtn label="Cancel" onPress={onClose}/>
              <PrimaryBtn label="Import" onPress={go}/>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ---------- Discover Screen ----------
function Discover({ profile, onEditProfile, onShowSaved }: any){
  const [events, setEvents] = useState<EventItem[]>([]);
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<EventItem | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [index, setIndex] = useState(0);
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
    const impRaw = await AsyncStorage.getItem(IMPORTED_KEY);
    const imp: EventItem[] = impRaw ? JSON.parse(impRaw) : [];
    const paRaw = await AsyncStorage.getItem(PASSED_KEY);
    const pa: string[] = paRaw ? JSON.parse(paRaw) : [];
    const list = [...imp, ...(r.events || [])].filter(e => !pa.includes(e.id));
    setEvents(list);
    setIndex(0);
    setSummary(r.summary || '');
    setLoading(false);
  }
  async function onTownie(){
    const q = query.trim();
    if (/^https?:\/\//i.test(q)) {
      try {
        const r = await fetch(API_BASE + '/api/import', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ url: q }) });
        const d = await r.json();
        if (d.event) { await handleImported(d.event); setQuery(''); }
      } catch {}
    } else { load(q); }
  }
  async function pass(){
    const cur = events[index];
    if (cur) {
      const praw = await AsyncStorage.getItem(PASSED_KEY);
      const pa: string[] = praw ? JSON.parse(praw) : [];
      if (!pa.includes(cur.id)) { pa.push(cur.id); await AsyncStorage.setItem(PASSED_KEY, JSON.stringify(pa)); }
    }
    setIndex(i => i + 1);
  }
  async function like(){
    const cur = events[index];
    if (cur && !saved.includes(cur.id)) await toggleSave(cur.id);
    setIndex(i => i + 1);
  }
  async function handleImported(ev: EventItem){
    const impRaw = await AsyncStorage.getItem(IMPORTED_KEY);
    const imp: EventItem[] = impRaw ? JSON.parse(impRaw) : [];
    const next = [ev, ...imp.filter(e => e.id !== ev.id)];
    await AsyncStorage.setItem(IMPORTED_KEY, JSON.stringify(next));
    setEvents(prev => [ev, ...prev.filter(e => e.id !== ev.id)]);
    setOpen(ev);
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
        <View style={s.row}>
          <TouchableOpacity onPress={onShowSaved} style={s.iconBtn}><Text style={s.iconTxt}>{'\u2661'}</Text></TouchableOpacity>
          <TouchableOpacity onPress={onEditProfile} style={s.avatar}><Text style={s.avatarTxt}>{profile.name?.[0]?.toUpperCase() || '\u2606'}</Text></TouchableOpacity>
        </View>
      </View>
      <View style={s.searchRow}>
        <View style={s.searchBox}>
          <TextInput value={query} onChangeText={setQuery} onSubmitEditing={onTownie} returnKeyType="search" placeholder="Search events" placeholderTextColor={MUTED} style={s.searchInput}/>
        </View>
        <TouchableOpacity onPress={onTownie} style={s.toniePill}><Text style={s.toniePillTxt}>🤖</Text></TouchableOpacity>
      </View>
      {summary ? <Text style={s.summary}>{summary}</Text> : null}
      {loading ? (
        <View style={s.center}><ActivityIndicator color={ACCENT}/><Text style={s.emptyTxt}>Curating your night\u2026</Text></View>
      ) : !events[index] ? (
        <View style={s.center}><Text style={s.emptyTitle}>That's everything for now</Text><Text style={s.emptyTxt}>Check back later, widen your radius, or ask Townie.</Text><View style={{height:16}}/><PrimaryBtn label="Reload" onPress={()=>load()}/></View>
      ) : (
        <View style={{flex:1, paddingHorizontal:16, paddingTop:6}}>
          {(() => { const cur:any = events[index]; return (
          <>
          <View style={s.swipeCard}>
            {cur.image
              ? <Image source={{uri: cur.image}} style={s.swipeImg}/>
              : <View style={[s.swipeImg, s.cardImgFallback]}><Text style={s.cardImgFallbackTxt}>{(cur.title||'5to9')[0].toUpperCase()}</Text></View>}
            <View style={s.swipeBody}>
              <View style={[s.wrap, {marginBottom:8}]}>
                {(cur.categories||[]).slice(0,2).map((c:string,i:number)=>(<View key={i} style={s.catChip}><Text style={s.catChipTxt}>{c}</Text></View>))}
                {cur._score!=null ? <View style={s.matchChip}><Text style={s.matchChipTxt}>{Math.round(cur._score)}% match</Text></View> : null}
              </View>
              <Text style={s.swipeTitle} numberOfLines={2}>{cur.title}</Text>
              <Text style={s.swipeMeta}>{[cur.venue||cur.city, fmtTime(cur.startsAt), fmtPrice(cur.price)].filter(Boolean).join('  ·  ')}</Text>
              {cur._note || cur.description ? <Text style={s.swipeDesc} numberOfLines={2}>{cur._note || cur.description}</Text> : null}
            </View>
          </View>
          <View style={s.swipeActions}>
            <TouchableOpacity onPress={pass} style={[s.swipeBtn, s.swipeNo]}><Text style={s.swipeBtnIcon}>👎</Text></TouchableOpacity>
            <TouchableOpacity onPress={()=>setOpen(cur)} style={s.detailsBtn}><Text style={s.detailsBtnTxt}>More Details</Text></TouchableOpacity>
            <TouchableOpacity onPress={like} style={[s.swipeBtn, s.swipeYes]}><Text style={s.swipeBtnIcon}>❤️</Text></TouchableOpacity>
          </View>
          </>
          ); })()}
        </View>
      )}
      <EventDetail ev={open} visible={!!open} onClose={()=>setOpen(null)} onSave={()=>{ if(open){toggleSave(open.id); setOpen(null);}}}/>
      <ImportLinkModal visible={importing} onClose={()=>setImporting(false)} onImported={handleImported}/>
    </View>
  );
}

function SavedList({ profile, onClose }: any){
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
      <View style={s.topBar}><Text style={s.brandSm}>Saved</Text>{onClose ? <TouchableOpacity onPress={onClose} style={s.iconBtn}><Text style={s.actDetailsTxt}>Done</Text></TouchableOpacity> : null}</View>
      {items.length === 0 ? (
        <View style={s.center}><Text style={s.emptyTitle}>Nothing saved yet</Text><Text style={s.emptyTxt}>Tap Save on any event.</Text></View>
      ) : (
        <FlatList data={items} keyExtractor={e=>e.id} renderItem={({item})=> <EventCard ev={item} onOpen={()=>setOpen(item)} onSave={()=>{}}/>} contentContainerStyle={{padding:14, paddingBottom:120}} ItemSeparatorComponent={()=> <View style={{height:14}}/>}/>
      )}
      <EventDetail ev={open} visible={!!open} onClose={()=>setOpen(null)} onSave={()=>setOpen(null)}/>
    </View>
  );
}

// ---------- Standout Screen (popular near you) ----------
function popularityScore(e: EventItem){
  let v = 0;
  if (e.price && (e.price.min != null || e.price.max != null)) v += 2; // ticketed => real demand
  if (e.image) v += 1;
  if (e.source === 'ticketmaster' || e.source === 'seatgeek') v += 2;
  if (e.source === 'google_places') v += 1;
  const m = /\((\d+)\s+reviews?\)/i.exec(e.description || '');
  if (m) v += Math.min(parseInt(m[1], 10) / 200, 5);
  return v;
}

function StandoutScreen({ profile, onEditProfile, onShowSaved }: any){
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
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
  useEffect(() => { (async () => {
    setLoading(true);
    const r = await fetchEvents(profile, loc);
    const list = (r.events || []).slice().sort((a: EventItem, b: EventItem) => popularityScore(b) - popularityScore(a));
    setEvents(list);
    setLoading(false);
  })(); }, [loc.lat, loc.lng]);
  async function toggleSave(id: string){
    const next = saved.includes(id) ? saved.filter(x => x !== id) : [...saved, id];
    setSaved(next);
    await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next));
  }
  return (
    <View style={{flex:1, backgroundColor: BG}}>
      <View style={s.topBar}>
        <View><Text style={s.kicker}>TONIGHT</Text><Text style={s.brandSm}>Standouts</Text></View>
        <View style={s.row}>
          <TouchableOpacity onPress={onShowSaved} style={s.iconBtn}><Text style={s.iconTxt}>{'♡'}</Text></TouchableOpacity>
          <TouchableOpacity onPress={onEditProfile} style={s.avatar}><Text style={s.avatarTxt}>{profile.name?.[0]?.toUpperCase() || '☆'}</Text></TouchableOpacity>
        </View>
      </View>
      <Text style={s.subhead}>The most popular experiences around you right now</Text>
      {loading ? (
        <View style={s.center}><ActivityIndicator color={ACCENT}/><Text style={s.emptyTxt}>Finding what's hot nearby…</Text></View>
      ) : events.length === 0 ? (
        <View style={s.center}><Text style={s.emptyTitle}>Nothing nearby yet</Text><Text style={s.emptyTxt}>Try a wider radius in your profile.</Text></View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          renderItem={({item, index}) => <EventCard ev={item} rank={index + 1} saved={saved.includes(item.id)} onOpen={()=>setOpen(item)} onSave={()=>toggleSave(item.id)} />}
          contentContainerStyle={{padding:14, paddingBottom:120}}
          ItemSeparatorComponent={()=> <View style={{height:14}}/>}
        />
      )}
      <EventDetail ev={open} visible={!!open} onClose={()=>setOpen(null)} onSave={()=>{ if(open){toggleSave(open.id); setOpen(null);} }}/>
    </View>
  );
}

// ---------- Friends Screen (invite-code social graph) ----------
function FriendsScreen({ profile }: any){
  const [me, setMe] = useState<any>(null);
  const [friends, setFriends] = useState<any[]>([]);
  const [addCode, setAddCode] = useState('');
  const [planText, setPlanText] = useState('');
  const [going, setGoing] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadFriends(uid: string){
    try {
      const r = await fetch(API_BASE + '/api/friends', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ action:'list', userId: uid }) });
      const d = await r.json();
      setFriends(d.friends || []);
    } catch {}
  }
  useEffect(() => { (async () => {
    setLoading(true);
    const u = await ensureIdentity(profile);
    setMe(u);
    if (u?.plan) setPlanText(u.plan);
    if (u?.going) setGoing(!!u.going);
    if (u?.userId) await loadFriends(u.userId);
    setLoading(false);
  })(); }, []);

  async function addFriend(){
    if (!addCode.trim() || !me?.userId) return;
    setMsg('');
    try {
      const r = await fetch(API_BASE + '/api/friends', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ action:'addFriend', userId: me.userId, code: addCode }) });
      const d = await r.json();
      if (d.ok) { setAddCode(''); setMsg('Added!'); await loadFriends(me.userId); }
      else setMsg(d.error || 'Could not add that code.');
    } catch { setMsg('Network error.'); }
  }
  async function savePlan(){
    if (!me?.userId) return;
    setMsg('');
    try {
      await fetch(API_BASE + '/api/friends', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ action:'setPlan', userId: me.userId, plan: planText, going }) });
      setMsg('Plan updated.');
    } catch { setMsg('Network error.'); }
  }

  if (loading) return (
    <View style={{flex:1, backgroundColor: BG}}>
      <View style={s.topBar}><View><Text style={s.kicker}>YOUR CREW</Text><Text style={s.brandSm}>Friends</Text></View></View>
      <View style={s.center}><ActivityIndicator color={ACCENT}/></View>
    </View>
  );

  return (
    <View style={{flex:1, backgroundColor: BG}}>
      <View style={s.topBar}><View><Text style={s.kicker}>YOUR CREW</Text><Text style={s.brandSm}>Friends</Text></View></View>
      <ScrollView contentContainerStyle={{padding:16, paddingBottom:140}}>
        <View style={s.vipCard}>
          <Text style={s.label}>Your invite code</Text>
          <Text style={s.codeBig}>{me?.code || '—'}</Text>
          <Text style={s.pSm}>Share this code so friends can add you, and enter theirs below.</Text>
          <View style={[s.row, {marginTop:12, gap:8}]}>
            <TextInput value={addCode} onChangeText={setAddCode} autoCapitalize="characters" autoCorrect={false} placeholder="Enter a friend's code" placeholderTextColor={MUTED} style={[s.input, {flex:1}]}/>
            <TouchableOpacity onPress={addFriend} style={s.townieBtn}><Text style={s.townieBtnTxt}>Add</Text></TouchableOpacity>
          </View>
        </View>

        <Text style={s.sectionTitle}>Your night</Text>
        <TextInput value={planText} onChangeText={setPlanText} placeholder="What are you up to tonight?" placeholderTextColor={MUTED} style={s.input}/>
        <View style={[s.rowSb, {marginTop:12}]}>
          <Text style={s.label}>I'm going out</Text>
          <Switch value={going} onValueChange={setGoing} trackColor={{true: ACCENT}}/>
        </View>
        <PrimaryBtn label="Update my plan" onPress={savePlan}/>
        {msg ? <Text style={[s.pSm, {marginTop:10, textAlign:'center'}]}>{msg}</Text> : null}

        <Text style={s.sectionTitle}>Tonight's plans</Text>
        {friends.length === 0 ? (
          <Text style={s.emptyTxt}>No friends yet. Share your code to build your crew.</Text>
        ) : friends.map((f, i) => (
          <View key={i} style={s.friendRow}>
            <View style={s.friendAvatar}><Text style={s.avatarTxt}>{(f.name || '?').split(' ').map((x: string)=>x[0]).join('').slice(0,2).toUpperCase()}</Text></View>
            <View style={{flex:1}}>
              <Text style={s.friendName}>{f.name}</Text>
              <Text style={s.cardMeta}>{f.plan || 'Free tonight'}</Text>
            </View>
            {f.going ? <View style={s.goingPill}><Text style={s.goingTxt}>Going</Text></View> : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ---------- VIP Screen (members free, vendors pay) ----------
function VipScreen(){
  const [featured, setFeatured] = useState<EventItem[]>([]);
  const [open, setOpen] = useState<EventItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  async function loadFeatured(){
    try { const r = await fetch(API_BASE + '/api/featured'); const d = await r.json(); setFeatured(d.events || []); } catch {}
  }
  useEffect(() => { loadFeatured(); }, []);
  return (
    <ScrollView style={{flex:1, backgroundColor: BG}} contentContainerStyle={{paddingBottom:120}}>
      <View style={s.topBar}><View><Text style={s.kicker}>5TO9</Text><Text style={s.brandSm}>VIP</Text></View></View>
      <View style={{padding:18}}>
        <View style={s.vipHero}>
          <Text style={s.vipHeroTitle}>Members get in free.</Text>
          <Text style={s.vipHeroSub}>5to9 is always free for you. Venues, promoters and event hosts pay to feature their nights and reach the right crowd.</Text>
        </View>

        {featured.length > 0 ? (
          <View>
            <Text style={s.sectionTitle}>Featured tonight</Text>
            {featured.map(ev => (
              <View key={ev.id} style={{marginBottom:14}}>
                <EventCard ev={ev} saved={false} onOpen={()=>setOpen(ev)} onSave={()=>{}}/>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={s.sectionTitle}>For members</Text>
        {['Priority access to featured nights & presales','Curated invites that match your vibe','See where your crew is going'].map((t, i) => (
          <View key={i} style={s.vipRow}><Text style={s.vipCheck}>✓</Text><Text style={s.vipRowTxt}>{t}</Text></View>
        ))}

        <Text style={s.sectionTitle}>For venues & promoters</Text>
        <View style={s.vipCard}>
          <Text style={s.vipCardTitle}>Feature your event</Text>
          <Text style={s.vipCardSub}>Put your night in front of nearby people whose interests match. Pay per featured event — never any cost to attendees.</Text>
          <View style={s.vipPriceRow}><Text style={s.vipPrice}>$10</Text><Text style={s.vipPriceUnit}> / featured event</Text></View>
          <PrimaryBtn label="List your event" onPress={()=>setShowForm(true)}/>
          <Text style={s.vipNote}>Payments are processed securely via PayPal.</Text>
        </View>
      </View>
      <EventDetail ev={open} visible={!!open} onClose={()=>setOpen(null)} onSave={()=>setOpen(null)}/>
      <VendorListingModal visible={showForm} onClose={()=>setShowForm(false)} onPublished={()=>{ setShowForm(false); loadFeatured(); }}/>
    </ScrollView>
  );
}

// ---------- Vendor listing + PayPal checkout ----------
function VendorListingModal({ visible, onClose, onPublished }: any){
  const [f, setF] = useState({ title:'', venue:'', city:'', startsAt:'', url:'', image:'', description:'' });
  const [phase, setPhase] = useState<'form'|'approving'|'capturing'|'done'>('form');
  const [orderID, setOrderID] = useState('');
  const [err, setErr] = useState('');
  function set(k: string, v: string){ setF(prev => ({ ...prev, [k]: v })); }
  function resetAll(){ setF({ title:'', venue:'', city:'', startsAt:'', url:'', image:'', description:'' }); setPhase('form'); setOrderID(''); setErr(''); }
  async function startCheckout(){
    if (!f.title.trim()) { setErr('Add an event title.'); return; }
    setErr('');
    try {
      const r = await fetch(API_BASE + '/api/checkout', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ event: f }) });
      const d = await r.json();
      if (!r.ok || !d.approveUrl) { setErr(d.error || 'Could not start PayPal checkout.'); return; }
      setOrderID(d.orderID);
      setPhase('approving');
      Linking.openURL(d.approveUrl);
    } catch { setErr('Network error. Try again.'); }
  }
  async function finishCheckout(){
    setPhase('capturing'); setErr('');
    try {
      const r = await fetch(API_BASE + '/api/capture', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ orderID }) });
      const d = await r.json();
      if (d.ok) { setPhase('done'); setTimeout(()=>{ onPublished(); resetAll(); }, 1300); }
      else { setErr(d.error || 'Payment not completed yet. Approve it in PayPal, then tap again.'); setPhase('approving'); }
    } catch { setErr('Network error. Try again.'); setPhase('approving'); }
  }
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{flex:1, backgroundColor: BG}}>
        <View style={s.obHeader}><Text style={s.h2}>Feature your event</Text></View>
        <ScrollView contentContainerStyle={{padding:18, paddingBottom:40}}>
          {phase === 'form' ? (
            <View>
              <Field label="Event title"><TextInput value={f.title} onChangeText={v=>set('title',v)} style={s.input} placeholder="Neon Rave" placeholderTextColor={MUTED}/></Field>
              <Field label="Venue"><TextInput value={f.venue} onChangeText={v=>set('venue',v)} style={s.input} placeholder="Studio 54" placeholderTextColor={MUTED}/></Field>
              <Field label="City"><TextInput value={f.city} onChangeText={v=>set('city',v)} style={s.input} placeholder="Seattle" placeholderTextColor={MUTED}/></Field>
              <Field label="Date & time" hint="e.g. 2026-06-14 22:00"><TextInput value={f.startsAt} onChangeText={v=>set('startsAt',v)} style={s.input} placeholder="2026-06-14 22:00" placeholderTextColor={MUTED}/></Field>
              <Field label="Link (tickets / info)"><TextInput value={f.url} onChangeText={v=>set('url',v)} autoCapitalize="none" style={s.input} placeholder="https://…" placeholderTextColor={MUTED}/></Field>
              <Field label="Image URL"><TextInput value={f.image} onChangeText={v=>set('image',v)} autoCapitalize="none" style={s.input} placeholder="https://…/poster.jpg" placeholderTextColor={MUTED}/></Field>
              <Field label="Description"><TextInput value={f.description} onChangeText={v=>set('description',v)} multiline style={[s.input,{height:90, textAlignVertical:'top'}]} placeholder="Tell people what to expect" placeholderTextColor={MUTED}/></Field>
              {err ? <Text style={s.errTxt}>{err}</Text> : null}
            </View>
          ) : phase === 'approving' ? (
            <View style={{paddingVertical:20}}>
              <Text style={s.pBig}>Complete your $10 payment in the PayPal window that just opened.</Text>
              <View style={{height:10}}/>
              <Text style={s.pSm}>Once you've approved it in PayPal, come back here and tap "I've completed payment" to publish your event.</Text>
              {err ? <Text style={s.errTxt}>{err}</Text> : null}
            </View>
          ) : phase === 'capturing' ? (
            <View style={s.center}><ActivityIndicator color={ACCENT}/><Text style={s.emptyTxt}>Confirming payment…</Text></View>
          ) : (
            <View style={s.center}><Text style={s.emptyTitle}>You're live! 🎉</Text><Text style={s.emptyTxt}>Your event is now featured in 5to9.</Text></View>
          )}
        </ScrollView>
        <View style={s.obFooter}>
          <GhostBtn label="Cancel" onPress={()=>{ resetAll(); onClose(); }}/>
          {phase === 'form' ? <PrimaryBtn label="Pay $10 with PayPal" onPress={startCheckout}/> : null}
          {phase === 'approving' ? <PrimaryBtn label="I've completed payment" onPress={finishCheckout}/> : null}
        </View>
      </SafeAreaView>
    </Modal>
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
          <Field label={'Max distance: ' + p.maxDistanceKm + ' mi'}><View style={s.wrap}>{[5,10,25,50,100].map(d => <Chip key={d} label={d+' mi'} on={p.maxDistanceKm===d} onPress={()=>setP({...p, maxDistanceKm:d})} small/>)}</View></Field>
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
  const tabs = [{k:'discover', l:'Discover'},{k:'standout', l:'Standout'},{k:'friends', l:'Friends'},{k:'vip', l:'VIP'}];
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
  const [showSaved, setShowSaved] = useState(false);
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
      {tab === 'discover' && <Discover profile={profile} onEditProfile={()=>setEditing(true)} onShowSaved={()=>setShowSaved(true)}/>}
      {tab === 'standout' && <StandoutScreen profile={profile} onEditProfile={()=>setEditing(true)} onShowSaved={()=>setShowSaved(true)}/>}
      {tab === 'friends' && <FriendsScreen profile={profile}/>}
      {tab === 'vip' && <VipScreen/>}
      <TabBar tab={tab} setTab={setTab}/>
      {editing && <EditProfile profile={profile} onSave={handleSaveProfile} onClose={()=>setEditing(false)}/>}
      {showSaved && (
        <Modal visible animationType="slide" onRequestClose={()=>setShowSaved(false)}>
          <SafeAreaView style={{flex:1, backgroundColor: BG}}>
            <SavedList profile={profile} onClose={()=>setShowSaved(false)}/>
          </SafeAreaView>
        </Modal>
      )}
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

  // --- added: sleeker look + new screens ---
  kicker: { color: ACCENT, fontSize:11, fontWeight:'800', letterSpacing:1.5, textTransform:'uppercase', marginBottom:2 },
  subhead: { color: MUTED, fontSize:13, paddingHorizontal:16, paddingTop:2, paddingBottom:6 },
  iconBtn: { width:36, height:36, borderRadius:18, backgroundColor: CARD, alignItems:'center', justifyContent:'center', borderWidth:1, borderColor: LINE, marginRight:8 },
  iconTxt: { color: FG, fontSize:16 },
  sectionTitle: { color: FG, fontSize:16, fontWeight:'800', marginTop:22, marginBottom:12 },
  cardImgFallback: { alignItems:'center', justifyContent:'center', backgroundColor:'#1c1c24' },
  cardImgFallbackTxt: { color: ACCENT, fontSize:54, fontWeight:'900', opacity:0.5 },
  rankBadge: { position:'absolute', top:12, left:12, backgroundColor: ACCENT, paddingHorizontal:10, paddingVertical:5, borderRadius:999 },
  rankTxt: { color:'#000', fontSize:12, fontWeight:'800' },
  heartOverlay: { position:'absolute', top:10, right:10, width:36, height:36, borderRadius:18, backgroundColor:'rgba(0,0,0,0.45)', alignItems:'center', justifyContent:'center' },
  heartOverlayTxt: { color: ACCENT, fontSize:18, fontWeight:'700' },
  invitePill: { backgroundColor: ACCENT, paddingHorizontal:16, paddingVertical:9, borderRadius:999 },
  invitePillTxt: { color:'#000', fontWeight:'800', fontSize:13 },
  friendRow: { flexDirection:'row', alignItems:'center', paddingVertical:12, borderBottomWidth:1, borderBottomColor: LINE, gap:12 },
  friendAvatar: { width:46, height:46, borderRadius:23, backgroundColor: CARD, borderWidth:1.5, borderColor: ACCENT, alignItems:'center', justifyContent:'center' },
  friendName: { color: FG, fontSize:16, fontWeight:'700' },
  goingPill: { borderWidth:1, borderColor:'#2e7d32', borderRadius:999, paddingHorizontal:12, paddingVertical:6 },
  goingTxt: { color:'#5dd15d', fontWeight:'700', fontSize:12 },
  vipHero: { backgroundColor: CARD, borderRadius:20, borderWidth:1, borderColor: LINE, padding:20 },
  vipHeroTitle: { color: FG, fontSize:24, fontWeight:'900', letterSpacing:-0.5 },
  vipHeroSub: { color: MUTED, fontSize:14, lineHeight:21, marginTop:8 },
  vipRow: { flexDirection:'row', alignItems:'flex-start', gap:10, marginBottom:10 },
  vipCheck: { color: ACCENT, fontWeight:'900', fontSize:15 },
  vipRowTxt: { color: FG, fontSize:14, flex:1, lineHeight:20 },
  vipCard: { backgroundColor: CARD, borderRadius:20, borderWidth:1, borderColor: LINE, padding:20 },
  vipCardTitle: { color: FG, fontSize:18, fontWeight:'800' },
  vipCardSub: { color: MUTED, fontSize:14, lineHeight:21, marginTop:6, marginBottom:14 },
  vipPriceRow: { flexDirection:'row', alignItems:'baseline', marginBottom:14 },
  vipPrice: { color: ACCENT, fontSize:32, fontWeight:'900' },
  vipPriceUnit: { color: MUTED, fontSize:14 },
  vipNote: { color: MUTED, fontSize:11, marginTop:12, textAlign:'center' },
  sheetWrap: { flex:1, justifyContent:'flex-end', backgroundColor:'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: BG, borderTopLeftRadius:22, borderTopRightRadius:22, borderWidth:1, borderColor: LINE, padding:22, paddingBottom:34 },
  errTxt: { color:'#ff6b6b', fontSize:13, marginTop:10 },
  codeBig: { color: ACCENT, fontSize:34, fontWeight:'900', letterSpacing:4, marginVertical:6 },
  // --- Discover swipe layout ---
  toniePill: { backgroundColor: CARD, borderWidth:1, borderColor: ACCENT, borderRadius:999, paddingHorizontal:14, paddingVertical:11, justifyContent:'center' },
  toniePillTxt: { color: ACCENT, fontWeight:'800', fontSize:14 },
  swipeCard: { flex:1, backgroundColor: CARD, borderRadius:22, overflow:'hidden', borderWidth:1, borderColor: LINE, marginBottom:14 },
  swipeImg: { width:'100%', flex:1, minHeight:200, backgroundColor:'#1a1a22' },
  swipeBody: { padding:16 },
  catChip: { backgroundColor:'rgba(217,255,61,0.14)', borderWidth:1, borderColor: ACCENT, borderRadius:999, paddingHorizontal:12, paddingVertical:5, marginRight:8, marginBottom:6 },
  catChipTxt: { color: ACCENT, fontSize:12, fontWeight:'700' },
  matchChip: { backgroundColor: ACCENT, borderRadius:999, paddingHorizontal:12, paddingVertical:5, marginBottom:6 },
  matchChipTxt: { color:'#000', fontSize:12, fontWeight:'800' },
  swipeTitle: { color: FG, fontSize:26, fontWeight:'800', marginTop:2 },
  swipeMeta: { color: MUTED, fontSize:14, marginTop:6 },
  swipeDesc: { color: FG, fontSize:14, fontStyle:'italic', marginTop:8, lineHeight:20 },
  swipeActions: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingBottom:24, gap:14 },
  swipeBtn: { width:64, height:64, borderRadius:32, alignItems:'center', justifyContent:'center', borderWidth:1, borderColor: LINE },
  swipeNo: { backgroundColor: CARD },
  swipeYes: { backgroundColor: CARD },
  swipeBtnIcon: { fontSize:26 },
  detailsBtn: { flex:1, backgroundColor: CARD, borderWidth:1, borderColor: LINE, borderRadius:999, paddingVertical:16, alignItems:'center' },
  detailsBtnTxt: { color: FG, fontWeight:'700', fontSize:15 },
  detailNote: { color: ACCENT, fontSize:14, fontStyle:'italic', marginTop:12, lineHeight:20 },
  linkBtn: { marginTop:18, backgroundColor: ACCENT, borderRadius:12, paddingVertical:14, alignItems:'center' },
  linkBtnTxt: { color:'#000', fontWeight:'800', fontSize:15 },
});
