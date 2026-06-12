import React, { useState } from 'react';
import { SafeAreaView, View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform, Switch } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { s, BG, MUTED, ACCENT } from '../theme';
import { Chip, PrimaryBtn, GhostBtn, Field, Progress } from '../components';
import { Profile, EMPTY_PROFILE, INTERESTS, VIBES, PRICE, SETTING, COMPANY, CROWD, ACCESS, GENDER, REL } from '../types';

// ---------- Onboarding ----------
export const STEPS = [
  'Welcome','You','Location','Lifestyle','Interests','Vibes','Budget & Setting','Final touches'
];

export function Onboarding({ onDone }: { onDone: (p: Profile) => void }){
  const [step, setStep] = useState(0);
  const [p, setP] = useState<Profile>(EMPTY_PROFILE);
  function toggle(arr: string[], v: string, min?: number, max?: number){
    const has = arr.includes(v);
    if (has) return arr.filter(x => x !== v);
    if (max && arr.length >= max) return arr;
    return [...arr, v];
  }
  const canNext = (() => {
    if (step === 1) return p.name.trim().length > 0 && !!p.birthYear && p.birthYear < new Date().getFullYear() - 12;
    if (step === 2) return p.city.trim().length > 0;
    if (step === 4) return p.interests.length >= 3;
    if (step === 5) return p.vibes.length >= 1;
    if (step === 6) return p.priceRange.length >= 1 && !!p.company;
    return true;
  })();
  function next(){
    if (step === STEPS.length - 1) { onDone({ ...p, onboardingComplete: true }); return; }
    setStep(step + 1);
  }
  function back(){ if (step > 0) setStep(step - 1); }
  return (
    <SafeAreaView style={{flex:1, backgroundColor: BG}}>
      <StatusBar style="light" />
      <View style={s.obHeader}>
        <Text style={s.stepCount}>Step {step+1} of {STEPS.length}</Text>
        <Progress step={step} total={STEPS.length} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{flex:1}}>
        <ScrollView contentContainerStyle={s.obBody} keyboardShouldPersistTaps="handled">
          {step === 0 && (<>
            <Text style={s.brand}>5to9</Text>
            <Text style={s.h1}>Your nights, curated.</Text>
            <Text style={s.pBig}>Tell us a bit about you. We\u2019ll surface events you\u2019ll actually love \u2014 powered by Claude and licensed event data.</Text>
            <View style={{height:18}}/>
            <Text style={s.pSm}>Takes about 90 seconds. You can change anything later.</Text>
          </>)}
          {step === 1 && (<>
            <Text style={s.h1}>You</Text>
            <Field label="What should we call you?">
              <TextInput value={p.name} onChangeText={v=>setP({...p,name:v})} placeholder="First name" placeholderTextColor={MUTED} style={s.input}/>
            </Field>
            <Field label="Birth year" hint="We use this for age-appropriate suggestions.">
              <TextInput value={p.birthYear ? String(p.birthYear) : ''} onChangeText={v=>setP({...p,birthYear: v ? parseInt(v,10) : null})} keyboardType="number-pad" maxLength={4} placeholder="e.g. 1997" placeholderTextColor={MUTED} style={s.input}/>
            </Field>
            <Field label="Gender (optional)">
              <View style={s.wrap}>{GENDER.map(g => <Chip key={g} label={g} on={p.gender===g} onPress={()=>setP({...p,gender:p.gender===g?'':g})} small/>)}</View>
            </Field>
          </>)}
          {step === 2 && (<>
            <Text style={s.h1}>Where</Text>
            <Field label="Your city">
              <TextInput value={p.city} onChangeText={v=>setP({...p,city:v})} placeholder="e.g. Brooklyn, NY" placeholderTextColor={MUTED} style={s.input}/>
            </Field>
            <Field label={'Max distance: ' + p.maxDistanceKm + ' mi'}>
              <View style={s.wrap}>{[5,10,25,50,100].map(d => <Chip key={d} label={d+' mi'} on={p.maxDistanceKm===d} onPress={()=>setP({...p,maxDistanceKm:d})} small/>)}</View>
            </Field>
          </>)}
          {step === 3 && (<>
            <Text style={s.h1}>Lifestyle</Text>
            <Field label="Relationship"><View style={s.wrap}>{REL.map(r => <Chip key={r} label={r} on={p.relationship===r} onPress={()=>setP({...p,relationship:p.relationship===r?'':r})} small/>)}</View></Field>
            <Field label="Occupation (optional)"><TextInput value={p.occupation} onChangeText={v=>setP({...p,occupation:v})} placeholder="e.g. Designer" placeholderTextColor={MUTED} style={s.input}/></Field>
            <Field label="Languages (optional)" hint="Comma separated."><TextInput value={p.languages} onChangeText={v=>setP({...p,languages:v})} placeholder="e.g. English, Spanish" placeholderTextColor={MUTED} style={s.input}/></Field>
          </>)}
          {step === 4 && (<>
            <Text style={s.h1}>Interests</Text>
            <Text style={s.pSm}>Pick at least 3.</Text>
            <View style={[s.wrap, {marginTop:10}]}>{INTERESTS.map(i => <Chip key={i} label={i} on={p.interests.includes(i)} onPress={()=>setP({...p, interests: toggle(p.interests, i)})}/>)}</View>
          </>)}
          {step === 5 && (<>
            <Text style={s.h1}>Vibes</Text>
            <Text style={s.pSm}>How do you like your nights to feel?</Text>
            <View style={[s.wrap, {marginTop:10}]}>{VIBES.map(v => <Chip key={v} label={v} on={p.vibes.includes(v)} onPress={()=>setP({...p, vibes: toggle(p.vibes, v)})}/>)}</View>
          </>)}
          {step === 6 && (<>
            <Text style={s.h1}>Budget & setting</Text>
            <Field label="Price range"><View style={s.wrap}>{PRICE.map(pr => <Chip key={pr} label={pr} on={p.priceRange.includes(pr)} onPress={()=>setP({...p, priceRange: toggle(p.priceRange, pr)})} small/>)}</View></Field>
            <Field label="Indoor / outdoor"><View style={s.wrap}>{SETTING.map(x => <Chip key={x} label={x} on={p.setting===x} onPress={()=>setP({...p, setting:x})} small/>)}</View></Field>
            <Field label="Going with"><View style={s.wrap}>{COMPANY.map(c => <Chip key={c} label={c} on={p.company===c} onPress={()=>setP({...p, company:c})} small/>)}</View></Field>
            <Field label="Crowd size"><View style={s.wrap}>{CROWD.map(c => <Chip key={c} label={c} on={p.crowdSize===c} onPress={()=>setP({...p, crowdSize:c})} small/>)}</View></Field>
          </>)}
          {step === 7 && (<>
            <Text style={s.h1}>Final touches</Text>
            <Field label="Accessibility needs (optional)"><View style={s.wrap}>{ACCESS.map(a => <Chip key={a} label={a} on={p.accessibility.includes(a)} onPress={()=>setP({...p, accessibility: toggle(p.accessibility, a)})} small/>)}</View></Field>
            <View style={s.rowSb}><Text style={s.label}>Event notifications</Text><Switch value={p.notifications} onValueChange={v=>setP({...p, notifications:v})} trackColor={{true: ACCENT}}/></View>
            <Text style={[s.pSm, {marginTop:24}]}>By continuing you agree to our Terms and Privacy Policy.</Text>
          </>)}
        </ScrollView>
      </KeyboardAvoidingView>
      <View style={s.obFooter}>
        {step > 0 ? <GhostBtn label="Back" onPress={back}/> : <View style={{width:80}}/>}
        <PrimaryBtn label={step === STEPS.length - 1 ? 'Start exploring' : 'Continue'} onPress={next} disabled={!canNext}/>
      </View>
    </SafeAreaView>
  );
}

