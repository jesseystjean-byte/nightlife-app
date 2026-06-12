import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { s, BG } from '../theme';
import { EventCard, EventDetail } from '../components';
import { fetchEvents, resolveLocation } from '../api';
import { SAVED_KEY, getSavedEvents, addSavedEvent, removeSavedEvent } from '../storage';
import type { EventItem } from '../types';

export function SavedList({ profile, onClose }: any){
  const [items, setItems] = useState<EventItem[]>([]);
  const [open, setOpen] = useState<EventItem | null>(null);
  useEffect(() => { (async () => {
    // Saved events are stored as full objects, so they render instantly, work offline, and never
    // disappear when the daily feed rotates. Legacy id-only saves fall back to a feed lookup once.
    const evs = await getSavedEvents();
    if (evs.length > 0) { setItems(evs.slice().reverse()); return; }
    const sv = await AsyncStorage.getItem(SAVED_KEY);
    const ids: string[] = sv ? JSON.parse(sv) : [];
    if (ids.length === 0) { setItems([]); return; }
    const r = await fetchEvents(profile, await resolveLocation(profile));
    const found = (r.events || []).filter((e: EventItem) => ids.includes(e.id));
    setItems(found);
    for (const e of found) await addSavedEvent(e); // migrate legacy saves to full objects
  })(); }, []);
  async function unsave(ev: EventItem){
    await removeSavedEvent(ev.id);
    try {
      const sv = await AsyncStorage.getItem(SAVED_KEY);
      const ids: string[] = sv ? JSON.parse(sv) : [];
      await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(ids.filter(x => x !== ev.id)));
    } catch {}
    setItems(prev => prev.filter(x => x.id !== ev.id));
  }
  return (
    <View style={{flex:1, backgroundColor: BG}}>
      <View style={s.topBar}><Text style={s.brandSm}>Saved</Text>{onClose ? <TouchableOpacity onPress={onClose} style={s.iconBtn}><Text style={s.actDetailsTxt}>Done</Text></TouchableOpacity> : null}</View>
      {items.length === 0 ? (
        <View style={s.center}><Text style={s.emptyTitle}>Nothing saved yet</Text><Text style={s.emptyTxt}>Tap Save on any event.</Text></View>
      ) : (
        <FlatList data={items} keyExtractor={e=>e.id} renderItem={({item})=> <EventCard ev={item} saved onOpen={()=>setOpen(item)} onSave={()=>unsave(item)}/>} contentContainerStyle={{padding:14, paddingBottom:120}} ItemSeparatorComponent={()=> <View style={{height:14}}/>}/>
      )}
      <EventDetail ev={open} visible={!!open} onClose={()=>setOpen(null)} onSave={()=>setOpen(null)}/>
    </View>
  );
}

