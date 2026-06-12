import React, { useState } from 'react';
import { Modal, SafeAreaView, ScrollView, View, Text, TextInput, Switch } from 'react-native';
import { s, BG, MUTED, ACCENT } from '../theme';
import { Chip, PrimaryBtn, GhostBtn, Field } from '../components';
import { Profile, INTERESTS, VIBES, PRICE } from '../types';

// ---------- Edit Profile ----------
export function EditProfile({ profile, onSave, onClose }: any){
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

