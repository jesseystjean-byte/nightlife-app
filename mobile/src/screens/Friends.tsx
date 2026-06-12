import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Switch, Share } from 'react-native';
import { s, BG, MUTED, ACCENT } from '../theme';
import { PrimaryBtn } from '../components';
import { ensureIdentity, friendsApi } from '../storage';
import { API_BASE } from '../config';

// ---------- Friends Screen (invite-code social graph) ----------
export function FriendsScreen({ profile }: any){
  const [me, setMe] = useState<any>(null);
  const [friends, setFriends] = useState<any[]>([]);
  const [addCode, setAddCode] = useState('');
  const [planText, setPlanText] = useState('');
  const [going, setGoing] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadFriends(_uid?: string){
    try { const d = await friendsApi('list'); setFriends(d.friends || []); } catch {}
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
      const d = await friendsApi('addFriend', { code: addCode });
      if (d.ok) { setAddCode(''); setMsg('Added!'); await loadFriends(me.userId); }
      else setMsg(d.error || 'Could not add that code.');
    } catch { setMsg('Network error.'); }
  }
  async function savePlan(){
    if (!me?.userId) return;
    setMsg('');
    try {
      await friendsApi('setPlan', { plan: planText, going });
      setMsg('Plan updated.');
    } catch { setMsg('Network error.'); }
  }
  async function shareInvite(){
    try { await Share.share({ message: `Join me on 5to9 — find the best nightlife & events near you. Add me with code ${me?.code || ''}. Get the app: https://project-ushrm.vercel.app` }); } catch {}
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
          <TouchableOpacity onPress={shareInvite} style={s.igBtn}><Text style={s.igBtnTxt}>Invite friends</Text></TouchableOpacity>
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

