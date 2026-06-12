import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { s, BG, ACCENT } from '../theme';
import { EventCard, EventDetail } from '../components';
import { fetchEvents, useResolvedLocation } from '../api';
import { SAVED_KEY, addSavedEvent, removeSavedEvent } from '../storage';
import type { EventItem } from '../types';

// ---------- Standout Screen (popular near you) ----------
export function popularityScore(e: EventItem){
  let v = 0;
  if (e.price && (e.price.min != null || e.price.max != null)) v += 2; // ticketed => real demand
  if (e.image) v += 1;
  if (e.source === 'ticketmaster' || e.source === 'seatgeek') v += 2;
  if (e.source === 'google_places') v += 1;
  const m = /\((\d+)\s+reviews?\)/i.exec(e.description || '');
  if (m) v += Math.min(parseInt(m[1], 10) / 200, 5);
  return v;
}

export function StandoutScreen({ profile, onEditProfile, onShowSaved }: any){
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<EventItem | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const loc = useResolvedLocation(profile);
  useEffect(() => { (async () => {
    const sv = await AsyncStorage.getItem(SAVED_KEY);
    if (sv) setSaved(JSON.parse(sv));
  })(); }, []);
  useEffect(() => { if (!loc) return; (async () => {
    setLoading(true);
    const r = await fetchEvents(profile, loc);
    const list = (r.events || []).slice().sort((a: EventItem, b: EventItem) => popularityScore(b) - popularityScore(a));
    setEvents(list);
    setLoading(false);
  })(); }, [loc?.lat, loc?.lng, loc?.city]);
  async function toggleSave(ev: EventItem){
    const has = saved.includes(ev.id);
    const next = has ? saved.filter(x => x !== ev.id) : [...saved, ev.id];
    setSaved(next);
    await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next));
    if (has) await removeSavedEvent(ev.id); else await addSavedEvent(ev);
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
          renderItem={({item, index}) => <EventCard ev={item} rank={index + 1} saved={saved.includes(item.id)} onOpen={()=>setOpen(item)} onSave={()=>toggleSave(item)} />}
          contentContainerStyle={{padding:14, paddingBottom:120}}
          ItemSeparatorComponent={()=> <View style={{height:14}}/>}
        />
      )}
      <EventDetail ev={open} visible={!!open} onClose={()=>setOpen(null)} onSave={()=>{ if(open){toggleSave(open); setOpen(null);} }}/>
    </View>
  );
}

