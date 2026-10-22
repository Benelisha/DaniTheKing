import React, {useEffect, useState} from "react";
import {View,Text,Linking,Switch} from "react-native";
import {api} from "./firebase";
import {Lead} from "./types";
import {Button,ExternalLink,Field,Choices,s} from "./ui";
export function WorkerStatus() {
  const [state,setState]=useState<{online:boolean;ready:boolean}|null>(null);
  useEffect(()=>{let active=true;const load=()=>api('/generator/status').then(v=>{if(active)setState(v);}).catch(()=>{if(active)setState(null);});void load();const timer=setInterval(load,30000);return()=>{active=false;clearInterval(timer);};},[]);
  return <Text style={s.body}>{state?.online && state.ready ? 'Generator online · ready on your computer' : state ? 'Generator offline · queued jobs cannot start until the local worker is running' : 'Generator status unavailable'}</Text>;
}
export function GenerationControls({lead,refresh}:{lead:Lead;refresh:()=>Promise<void>}) {
  const [id,setId]=useState(lead.generationId),[job,setJob]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>setId(lead.generationId),[lead.generationId]);
  useEffect(()=>{
    if(!id)return;let active=true,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const v=await api(`/generations/${id}`);if(!active)return;setJob(v);if(!['completed','failed'].includes(v.status))timer=setTimeout(poll,3000);else if(v.status==='completed' && v.publishedUrl!==lead.generatedWebsiteUrl)void refresh();}catch(e){if(active){setError((e as Error).message);timer=setTimeout(poll,10000);}}};
    void poll();return()=>{active=false;clearTimeout(timer);};
  },[id,lead.generatedWebsiteUrl]);
  const running=!!id && (!job || !['completed','failed'].includes(job.status));
  const eligible=lead.googleVerified && lead.competitors?.length===5 && lead.callStatus!=='Do not call';
  async function generate(){if(busy||running)return;setBusy(true);setError('');try{const v=await api(`/leads/${lead.id}/generations`,'POST',{expectedVersion:lead.version});setJob(null);setId(v.id);await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function retry(){setBusy(true);setError('');try{await api(`/generations/${id}/retry`,'POST',{});setJob(null);setId(undefined);setTimeout(()=>setId(id),0);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <View style={{gap:6}}>
    <View style={[s.row,{flexWrap:'wrap',gap:10}]}>
      <Button label={busy?'Queuing…':lead.generatedWebsiteUrl?'Regenerate':'Generate'} icon="zap" disabled={!eligible||busy||running} onPress={()=>void generate()}/>
      {!!(job?.publishedUrl||lead.generatedWebsiteUrl)&&<ExternalLink url={job?.publishedUrl||lead.generatedWebsiteUrl!} label="Open website"/>}
    </View>
    {!!job&&<Text style={s.body}>{({queued:'Queued · waiting for the local generator',researching:'Inspecting the five example websites',generating:'Generating website',validating:'Checking desktop and mobile layouts',publishing:'Publishing website',completed:'Website ready',failed:'Generation failed'} as Record<string,string>)[job.status] || job.status}{job.spentUsd>0?` · $${job.spentUsd.toFixed(3)} API usage`:''}</Text>}
    {job?.status==='queued'&&<Text style={s.body}>Starts when the generator is online and earlier jobs finish. No completion estimate yet.</Text>}
    {!eligible&&<Text style={s.body}>{!lead.googleVerified?'Google listing verification required':lead.callStatus==='Do not call'?'Contact suppressed':'Five competitor examples required'}</Text>}
    {!!(error||job?.error)&&<Text style={s.error}>{error||job.error}</Text>}
    {job?.status==='failed'&&<Button subtle label="Retry saved job" disabled={busy||!eligible} onPress={()=>void retry()}/>}
  </View>;
}
export function GoogleVerification({lead,refresh}:{lead:Lead;refresh:()=>Promise<void>}) {
  const [url,setUrl]=useState(lead.googleVerification?.listingUrl||lead.profile?.googleMapsUrl||''),[notes,setNotes]=useState(''),[status,setStatus]=useState('verified'),[opened,setOpened]=useState(false),[name,setName]=useState(false),[phone,setPhone]=useState(false),[area,setArea]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(){setBusy(true);setError('');try{await api(`/leads/${lead.id}/verification`,'POST',{expectedVersion:lead.version,status,listingUrl:url,notes,nameMatched:name,phoneMatched:phone,areaMatched:area});await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <View style={[s.card,{gap:10}]}>
    <Text style={s.h2}>Google Maps verification</Text>
    <Text style={s.body}>{lead.googleVerified?`Verified by ${lead.googleVerification?.reviewer} on ${lead.googleVerification?.verifiedAt?.slice(0,10)}`:'Hidden from the working list until manually verified.'}</Text>
    <Field label="Full Google Maps listing URL (not a search or short link)" value={url} onChangeText={v=>{setUrl(v);setOpened(false);setName(false);setPhone(false);setArea(false);}}/>
    <Button subtle label="Open listing to review" disabled={!/^https:\/\/(www\.)?google\.com\/maps|^https:\/\/maps\.google\.com\//.test(url)} onPress={()=>{void Linking.openURL(url).then(()=>setOpened(true));}}/>
    <Choices values={['verified','unmatched','ambiguous']} value={status} onChange={setStatus}/>
    {([{label:'Business name matches',value:name,set:setName},{label:'Phone matches',value:phone,set:setPhone},{label:'Address / service area matches',value:area,set:setArea}]).map(item=><View key={item.label} style={s.row}><Switch disabled={!opened} value={item.value} onValueChange={item.set}/><Text style={s.body}>{item.label}</Text></View>)}
    <Field multiline label="Identity-match notes (what you checked)" value={notes} onChangeText={setNotes}/>
    {!!error&&<Text style={s.error}>{error}</Text>}
    <Button label={busy?'Saving…':'Save Google review'} disabled={busy||notes.trim().length<15||(status==='verified'&&(!opened||!name||!phone||!area))} onPress={()=>void save()}/>
  </View>;
}
