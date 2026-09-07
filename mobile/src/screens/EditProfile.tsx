import React, { useState } from 'react';
import { Modal, SafeAreaView, ScrollView, View, Text, TextInput, Switch, Alert, TouchableOpacity, ActivityIndicator } from 'react-native';
import { s, BG, MUTED, ACCENT } from '../theme';
import { Chip, PrimaryBtn, GhostBtn, Field } from '../components';
import { Profile, INTERESTS, VIBES, PRICE } from '../types';
import { deleteMyData } from '../storage';

// ---------- Edit Profile ----------
export function EditProfile({ profile, onSave, onClose, onDelete }: any){
  const [p, setP] = useState<Profile>(profile);
  const [deleting, setDeleting] = useState(false);
  function confirmDelete(){
    Alert.alert(
      'Delete my data?',
      'This permanently deletes your profile and all saved events from this device, and removes your Friends record from our server. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
            setDeleting(true);
            try { await deleteMyData(); } finally { setDeleting(false); onDelete && onDelete(); }
        } },
      ],
    );
  }
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

          <View style={{height:28}}/>
          <View style={{height:1, backgroundColor:'#2A2A31', marginBottom:18}}/>
          <Text style={s.label}>Privacy</Text>
          <Text style={[s.pSm,{marginTop:6, marginBottom:12}]}>Your onboarding details are stored on this device. Delete them anytime.</Text>
          <TouchableOpacity onPress={confirmDelete} disabled={deleting} style={{borderWidth:1, borderColor:'#E5484D', borderRadius:12, paddingVertical:14, alignItems:'center'}}>
            {deleting ? <ActivityIndicator color="#E5484D"/> : <Text style={{color:'#E5484D', fontWeight:'700'}}>Delete my data</Text>}
          </TouchableOpacity>
        </ScrollView>
        <View style={s.obFooter}>
          <GhostBtn label="Cancel" onPress={onClose}/>
          <PrimaryBtn label="Save" onPress={()=>onSave(p)}/>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
