import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Image, ActivityIndicator, Modal, SafeAreaView, Linking } from 'react-native';
import { s, ACCENT, MUTED, BG } from './theme';
import { fmtDate, fmtTime, fmtPrice } from './format';
import { API_BASE } from './config';
import type { EventItem } from './types';

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
              <View style={s.detailRow}><Text style={s.detailIcon}>\ud83d\udccd</Text><Text style={s.detailMetaBig}>{[ev.venue, ev.city].filter(Boolean).join(' \u00b7 ') || 'Venue TBA'}</Text></View>
              <View style={s.detailRow}><Text style={s.detailIcon}>\ud83d\uddd3</Text><Text style={s.detailMetaBig}>{when}{end ? ' \u2013 ' + end : ''}</Text></View>
              <View style={s.detailRow}><Text style={s.detailIcon}>\ud83d\udcb5</Text><Text style={s.detailMetaBig}>{fmtPrice(ev.price) || 'See tickets for pricing'}</Text></View>
              {ev.source ? <View style={s.detailRow}><Text style={s.detailIcon}>\ud83d\udd0e</Text><Text style={s.detailMetaBig}>via {String(ev.source).replace('_',' ')}</Text></View> : null}
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
            <TouchableOpacity onPress={onPass} style={[s.swipeBtn, s.swipeNo]}><Text style={s.swipeBtnIcon}>\ud83d\udc4e</Text></TouchableOpacity>
            <GhostBtn label="Close" onPress={onClose}/>
            <TouchableOpacity onPress={onLike} style={[s.swipeBtn, s.swipeYes]}><Text style={s.swipeBtnIcon}>\u2764\ufe0f</Text></TouchableOpacity>
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

