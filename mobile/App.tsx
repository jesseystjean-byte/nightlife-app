import React, { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { s, BG, ACCENT, MUTED } from './src/theme';
import { PROFILE_KEY } from './src/storage';
import { initErrorReporting } from './src/reporting';
import { Onboarding } from './src/screens/Onboarding';
import { Discover } from './src/screens/Discover';
import { SavedList } from './src/screens/SavedList';
import { StandoutScreen } from './src/screens/Standout';
import { FriendsScreen } from './src/screens/Friends';
import { VipScreen } from './src/screens/Vip';
import { EditProfile } from './src/screens/EditProfile';
import type { Profile } from './src/types';

// Report uncaught JS errors to the backend (visible at /api/log).
initErrorReporting();

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

