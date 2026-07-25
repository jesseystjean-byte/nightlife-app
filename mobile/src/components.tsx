import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Image, ActivityIndicator, Modal, SafeAreaView, Linking } from 'react-native';
import { s, ACCENT, MUTED, BG } from './theme';
import { fmtDate, fmtTime, fmtPrice } from './format';
import { API_BASE } from './config';
import type { EventItem } from './types';

// Pretty source name: "google_events" -> "Google Events", "ticketmaster" -> "Ticketmaster".
function srcName(source?: string){
  return String(source || '').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
}

// ---------- Cosmic backdrop ----------
// Deep-space background rendered behind every tab: a solid base, two faint violet
// nebula glows, and a fixed scatter of stars. Pure <View>s — no images, no native
// modules — so it is safe on every device and adds nothing to the build.
const COSMIC_STARS: { x: number; y: number; s: number; o: number }[] = [
  {x:8,y:6,s:2,o:0.5},{x:22,y:12,s:1,o:0.35},{x:37,y:4,s:2,o:0.6},{x:52,y:9,s:1,o:0.4},
  {x:68,y:5,s:2,o:0.55},{x:81,y:13,s:1,o:0.3},{x:93,y:7,s:2,o:0.5},{x:14,y:22,s:1,o:0.4},
  {x:29,y:28,s:2,o:0.45},{x:46,y:24,s:1,o:0.3},{x:61,y:30,s:2,o:0.5},{x:77,y:26,s:1,o:0.35},
  {x:90,y:33,s:2,o:0.45},{x:6,y:40,s:1,o:0.35},{x:20,y:46,s:2,o:0.5},{x:35,y:52,s:1,o:0.3},
  {x:50,y:44,s:2,o:0.4},{x:64,y:50,s:1,o:0.35},{x:79,y:56,s:2,o:0.5},{x:92,y:48,s:1,o:0.3},
  {x:11,y:63,s:2,o:0.45},{x:26,y:70,s:1,o:0.3},{x:42,y:66,s:2,o:0.5},{x:58,y:72,s:1,o:0.35},
  {x:73,y:68,s:2,o:0.4},{x:88,y:74,s:1,o:0.3},{x:16,y:82,s:2,o:0.5},{x:33,y:88,s:1,o:0.3},
  {x:49,y:84,s:2,o:0.45},{x:66,y:90,s:1,o:0.35},{x:82,y:86,s:2,o:0.5},{x:95,y:92,s:1,o:0.3},
];
export function CosmicBg(){
  return (
    <View pointerEvents="none" style={s.cosmicWrap}>
      <View style={[s.nebula, { top:-90, right:-70, backgroundColor:'rgba(139,123,255,0.16)' }]} />
      <View style={[s.nebula, { bottom:20, left:-100, backgroundColor:'rgba(84,74,183,0.15)' }]} />
      {COSMIC_STARS.map((st, i) => (
        <View key={i} style={[s.star, { left: (st.x + '%') as any, top: (st.y + '%') as any, width: st.s, height: st.s, borderRadius: st.s/2, opacity: st.o }]} />
      ))}
    </View>
  );
}

// ---------- UI Primitives ----------
export function Chip({label, on, onPress, small}: any){
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, small && s.chipSm, on && s.chipOn]}>
      <Text style={[s.chipTxt, small && s.chipTxtSm, on && s.chipTxtOn]}>{label}</Text>
    </TouchableOpacity>
  );
}
export function PrimaryBtn({label, onPress, disabled}: any){
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[s.btn, disabled && s.btnDis]}>
      <Text style={s.btnTxt}>{label}</Text>
    </TouchableOpacity>
  );
}
export function GhostBtn({label, onPress}: any){
  return (
    <TouchableOpacity onPress={onPress} style={s.ghost}>
      <Text style={s.ghostTxt}>{label}</Text>
    </TouchableOpacity>
  );
}
export function Field({label, children, hint}: any){
  return (
    <View style={{marginBottom:18}}>
      <Text style={s.label}>{label}</Text>
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}
export function Progress({step, total}: any){
  return (
    <View style={s.progT}><View style={[s.progF, {width: ((step+1)/total)*100 + '%'}]} /></View>
  );
}


// ---------- Cards & Lists ----------
export function EventCard({ ev, onOpen, onSave, rank, saved }: any){
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
          {(ev.categories || []).slice(0,1).map((c: string, i: number) => (
            <View key={i} style={s.tag}><Text style={s.tagTxt}>{c}</Text></View>
          ))}
          {fmtPrice(ev.price) ? <View style={[s.tag, {marginLeft:6}]}><Text style={s.tagTxt}>{fmtPrice(ev.price)}</Text></View> : null}
        </View>
        <Text style={s.cardTitle} numberOfLines={2}>{ev.title}</Text>
        <Text style={s.cardMeta} numberOfLines={1}>{[ev.venue, ev.city].filter(Boolean).join(' · ')}</Text>
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

export function EventDetail({ ev, visible, onClose, onSave, onLike, onPass }: any){
  if (!ev) return null;
  const when = fmtDate(ev.startsAt);
  const end = ev.endsAt ? fmtTime(ev.endsAt) : '';
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={{flex:1, backgroundColor: BG}}>
        <ScrollView>
          {ev.image ? <Image source={{uri: ev.image}} style={{width:'100%', height:280}}/> : null}
          <View style={{padding:18}}>
            <View style={[s.wrap, {marginBottom:10}]}>
              {(ev.categories || []).slice(0,3).map((c: string, i: number) => (
                <View key={i} style={s.catChip}><Text style={s.catChipTxt}>{c}</Text></View>
              ))}
              {ev._score != null && ev._score > 0 ? <View style={s.matchChip}><Text style={s.matchChipTxt}>{Math.round(ev._score)}% match</Text></View> : null}
            </View>
            <Text style={s.detailTitle}>{ev.title}</Text>
            <View style={{marginTop:12}}>
              <View style={s.detailRow}><Text style={s.detailIcon}>{'📍'}</Text><Text style={s.detailMetaBig}>{[ev.venue, ev.city].filter(Boolean).join(' · ') || 'Venue TBA'}</Text></View>
              <View style={s.detailRow}><Text style={s.detailIcon}>{'🗓'}</Text><Text style={s.detailMetaBig}>{when}{end ? ' – ' + end : ''}</Text></View>
              <View style={s.detailRow}><Text style={s.detailIcon}>{'💵'}</Text><Text style={s.detailMetaBig}>{fmtPrice(ev.price) || 'See tickets for pricing'}</Text></View>
              {ev.source ? <View style={s.detailRow}><Text style={s.detailIcon}>{'🔎'}</Text><Text style={s.detailMetaBig}>via {srcName(ev.source)}</Text></View> : null}
            </View>
            {ev._note ? (<>
              <Text style={s.detailSection}>Why this pick</Text>
              <Text style={s.detailNote}>{ev._note}</Text>
            </>) : null}
            {ev.description ? (<>
              <Text style={s.detailSection}>About this event</Text>
              <Text style={s.detailDesc}>{ev.description}</Text>
            </>) : null}
            {ev.url ? <TouchableOpacity onPress={()=>Linking.openURL(ev.url)} style={s.linkBtn}><Text style={s.linkBtnTxt}>Get tickets / more info</Text></TouchableOpacity> : null}
          </View>
        </ScrollView>
        {(onLike || onPass) ? (
          <View style={s.detailFooter}>
            <TouchableOpacity onPress={onPass} style={[s.swipeBtn, s.swipeNo]}><Text style={s.swipeBtnIcon}>{'👎'}</Text></TouchableOpacity>
            <GhostBtn label="Close" onPress={onClose}/>
            <TouchableOpacity onPress={onLike} style={[s.swipeBtn, s.swipeYes]}><Text style={s.swipeBtnIcon}>{'❤️'}</Text></TouchableOpacity>
          </View>
        ) : (
          <View style={s.detailFooter}>
            <GhostBtn label="Close" onPress={onClose}/>
            <PrimaryBtn label="Save" onPress={onSave}/>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}


// ---------- Import event from a link (compliant: oEmbed + link unfurl) ----------
export function ImportLinkModal({ visible, onClose, onImported }: any){
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
          <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder={'https://…'} placeholderTextColor={MUTED} style={[s.input, {marginTop:14}]}/>
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
