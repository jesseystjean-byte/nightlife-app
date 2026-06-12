import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, ActivityIndicator, Animated, PanResponder, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { s, BG, MUTED, ACCENT } from '../theme';
import { PrimaryBtn, EventDetail, ImportLinkModal } from '../components';
import { fetchEvents, useResolvedLocation } from '../api';
import { SAVED_KEY, PASSED_KEY, IMPORTED_KEY, addSavedEvent, removeSavedEvent, recordPassed } from '../storage';
import { fmtTime, fmtPrice } from '../format';
import { API_BASE } from '../config';
import type { EventItem } from '../types';

// ---------- Discover Screen ----------
export function Discover({ profile, onEditProfile, onShowSaved }: any){
  const [events, setEvents] = useState<EventItem[]>([]);
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState(''); // the search the current results belong to
  const [open, setOpen] = useState<EventItem | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [index, setIndex] = useState(0);
  const loc = useResolvedLocation(profile);

  // --- Tinder-style swipe: drag right to save, left to pass ---
  const SCREEN_W = Dimensions.get('window').width;
  const pan = useRef(new Animated.ValueXY()).current;
  const swipingRef = useRef(false); // block double-fires while a card animates off
  const swipeHandlersRef = useRef({ like: () => {}, pass: () => {} });
  function swipeOut(dir: 1 | -1){
    if (swipingRef.current) return;
    swipingRef.current = true;
    Animated.timing(pan, { toValue: { x: dir * SCREEN_W * 1.3, y: 0 }, duration: 220, useNativeDriver: false }).start(() => {
      pan.setValue({ x: 0, y: 0 });
      swipingRef.current = false;
      if (dir === 1) swipeHandlersRef.current.like(); else swipeHandlersRef.current.pass();
    });
  }
  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
    onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
    onPanResponderRelease: (_e, g) => {
      if (g.dx > 110 || g.vx > 1.2) swipeOut(1);
      else if (g.dx < -110 || g.vx < -1.2) swipeOut(-1);
      else Animated.spring(pan, { toValue: { x: 0, y: 0 }, friction: 6, useNativeDriver: false }).start();
    },
    onPanResponderTerminate: () => Animated.spring(pan, { toValue: { x: 0, y: 0 }, friction: 6, useNativeDriver: false }).start(),
  })).current;
  const cardRotate = pan.x.interpolate({ inputRange: [-SCREEN_W, 0, SCREEN_W], outputRange: ['-12deg', '0deg', '12deg'] });
  const likeOpacity = pan.x.interpolate({ inputRange: [20, 120], outputRange: [0, 1], extrapolate: 'clamp' });
  const nopeOpacity = pan.x.interpolate({ inputRange: [-120, -20], outputRange: [1, 0], extrapolate: 'clamp' });

  useEffect(() => { (async () => {
    const sv = await AsyncStorage.getItem(SAVED_KEY);
    if (sv) setSaved(JSON.parse(sv));
  })(); }, []);

  async function load(q?: string){
    if (!loc) return;
    setLoading(true);
    const r = await fetchEvents(profile, loc, q);
    const impRaw = await AsyncStorage.getItem(IMPORTED_KEY);
    const imp: EventItem[] = impRaw ? JSON.parse(impRaw) : [];
    // Prune imported events whose date has passed so old link-imports don't pin the top of the feed forever.
    const fresh = imp.filter(e => { const t = Date.parse(e.startsAt || ''); return isNaN(t) || t > Date.now() - 24 * 3600 * 1000; });
    if (fresh.length !== imp.length) await AsyncStorage.setItem(IMPORTED_KEY, JSON.stringify(fresh));
    const paRaw = await AsyncStorage.getItem(PASSED_KEY);
    const pa: string[] = paRaw ? JSON.parse(paRaw) : [];
    // During an explicit search, imported events don't belong in the results.
    const list = [...(q ? [] : fresh), ...(r.events || [])].filter(e => !pa.includes(e.id));
    setEvents(list);
    setIndex(0);
    setActiveQuery(q || '');
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
      await recordPassed(cur); // taste learning signal
    }
    setIndex(i => i + 1);
  }
  async function like(){
    const cur = events[index];
    if (cur && !saved.includes(cur.id)) await toggleSave(cur);
    setIndex(i => i + 1);
  }
  // Keep the swipe gesture wired to the freshest like/pass closures on every render.
  swipeHandlersRef.current = { like, pass };
  async function handleImported(ev: EventItem){
    const impRaw = await AsyncStorage.getItem(IMPORTED_KEY);
    const imp: EventItem[] = impRaw ? JSON.parse(impRaw) : [];
    const next = [ev, ...imp.filter(e => e.id !== ev.id)];
    await AsyncStorage.setItem(IMPORTED_KEY, JSON.stringify(next));
    setEvents(prev => [ev, ...prev.filter(e => e.id !== ev.id)]);
    setOpen(ev);
  }
  useEffect(() => { if (loc) load(); }, [loc?.lat, loc?.lng, loc?.city]);

  async function toggleSave(ev: EventItem){
    const has = saved.includes(ev.id);
    const next = has ? saved.filter(x => x !== ev.id) : [...saved, ev.id];
    setSaved(next);
    await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next));
    if (has) await removeSavedEvent(ev.id); else await addSavedEvent(ev); // full object → Saved + taste
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
        activeQuery ? (
          <View style={s.center}>
            <Text style={s.emptyTitle}>No matches for “{activeQuery}”</Text>
            <Text style={s.emptyTxt}>Townie only shows genuine matches for a search — no filler. Try different words, or clear the search to see tonight's feed.</Text>
            <View style={{height:16}}/>
            <PrimaryBtn label="Clear search" onPress={()=>{ setQuery(''); load(); }}/>
          </View>
        ) : (
          <View style={s.center}><Text style={s.emptyTitle}>That's everything for now</Text><Text style={s.emptyTxt}>Check back later, widen your radius, or ask Townie.</Text><View style={{height:16}}/><PrimaryBtn label="Reload" onPress={()=>load()}/></View>
        )
      ) : (
        <View style={{flex:1, paddingHorizontal:16, paddingTop:6}}>
          {(() => { const cur:any = events[index]; const nxt:any = events[index+1]; return (
          <>
          <View style={{flex:1, marginBottom:14}}>
            {nxt ? (
              <View style={[s.swipeCard, s.swipeCardUnder]} pointerEvents="none">
                {nxt.image
                  ? <Image source={{uri: nxt.image}} style={s.swipeImg}/>
                  : <View style={[s.swipeImg, s.cardImgFallback]}><Text style={s.cardImgFallbackTxt}>{(nxt.title||'5to9')[0].toUpperCase()}</Text></View>}
                <View style={s.swipeBody}><Text style={s.swipeTitle} numberOfLines={1}>{nxt.title}</Text></View>
              </View>
            ) : null}
            <Animated.View
              {...panResponder.panHandlers}
              style={[s.swipeCard, {transform: [{ translateX: pan.x }, { translateY: Animated.multiply(pan.y, 0.25) }, { rotate: cardRotate }]}]}
            >
              {cur.image
                ? <Image source={{uri: cur.image}} style={s.swipeImg}/>
                : <View style={[s.swipeImg, s.cardImgFallback]}><Text style={s.cardImgFallbackTxt}>{(cur.title||'5to9')[0].toUpperCase()}</Text></View>}
              <Animated.View style={[s.swipeStamp, s.stampLike, {opacity: likeOpacity}]}><Text style={s.stampLikeTxt}>SAVE</Text></Animated.View>
              <Animated.View style={[s.swipeStamp, s.stampNope, {opacity: nopeOpacity}]}><Text style={s.stampNopeTxt}>PASS</Text></Animated.View>
              <View style={s.swipeBody}>
                <View style={[s.wrap, {marginBottom:8}]}>
                  {(cur.categories||[]).slice(0,2).map((c:string,i:number)=>(<View key={i} style={s.catChip}><Text style={s.catChipTxt}>{c}</Text></View>))}
                  {cur._score!=null && cur._score>0 ? <View style={s.matchChip}><Text style={s.matchChipTxt}>{Math.round(cur._score)}% match</Text></View> : null}
                </View>
                <Text style={s.swipeTitle} numberOfLines={2}>{cur.title}</Text>
                <Text style={s.swipeMeta}>{[cur.venue||cur.city, fmtTime(cur.startsAt), fmtPrice(cur.price)].filter(Boolean).join('  ·  ')}</Text>
                {cur._note || cur.description ? <Text style={s.swipeDesc} numberOfLines={2}>{cur._note || cur.description}</Text> : null}
              </View>
            </Animated.View>
          </View>
          <View style={s.swipeActions}>
            <TouchableOpacity onPress={()=>setOpen(cur)} style={s.detailsBtn}><Text style={s.detailsBtnTxt}>More Details</Text></TouchableOpacity>
          </View>
          <Text style={s.swipeHint}>Swipe right to save · swipe left to pass</Text>
          </>
          ); })()}
        </View>
      )}
      <EventDetail ev={open} visible={!!open} onClose={()=>setOpen(null)}
        onLike={()=>{ setOpen(null); like(); }}
        onPass={()=>{ setOpen(null); pass(); }}/>
      <ImportLinkModal visible={importing} onClose={()=>setImporting(false)} onImported={handleImported}/>
    </View>
  );
}

