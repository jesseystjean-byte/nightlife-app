import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, ActivityIndicator, Modal, SafeAreaView, Linking, Alert } from 'react-native';
import { s, BG, MUTED, ACCENT } from '../theme';
import { EventCard, EventDetail, PrimaryBtn, GhostBtn, Field } from '../components';
import { API_BASE } from '../config';
import type { EventItem } from '../types';

// ---------- VIP Screen (members free, vendors pay) ----------
export function VipScreen(){
  const [featured, setFeatured] = useState<EventItem[]>([]);
  const [open, setOpen] = useState<EventItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  async function loadFeatured(){
    try { const r = await fetch(API_BASE + '/api/featured'); const d = await r.json(); setFeatured(d.events || []); } catch {}
  }
  async function connectInstagram(){
    try {
      const r = await fetch(API_BASE + '/api/social?action=connect');
      const d = await r.json();
      if (d.url) { await Linking.openURL(d.url); return; }
      Alert.alert('Instagram connect', d.error || 'Instagram connection isn’t available yet — check back soon.');
    } catch {
      Alert.alert('Instagram connect', 'Couldn’t reach the server. Check your connection and try again.');
    }
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

        <Text style={s.sectionTitle}>Auto-post from Instagram</Text>
        <View style={s.vipCard}>
          <Text style={s.vipCardSub}>Connect your Instagram business account and the events you post show up in 5to9 automatically — in real time.</Text>
          <TouchableOpacity onPress={connectInstagram} style={s.igBtn}><Text style={s.igBtnTxt}>Connect Instagram</Text></TouchableOpacity>
        </View>
      </View>
      <EventDetail ev={open} visible={!!open} onClose={()=>setOpen(null)} onSave={()=>setOpen(null)}/>
      <VendorListingModal visible={showForm} onClose={()=>setShowForm(false)} onPublished={()=>{ setShowForm(false); loadFeatured(); }}/>
    </ScrollView>
  );
}

// ---------- Vendor listing + PayPal checkout ----------
export function VendorListingModal({ visible, onClose, onPublished }: any){
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

