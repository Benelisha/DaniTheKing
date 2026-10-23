import React,{useEffect,useState} from 'react';
import {ScrollView,View,Text,ActivityIndicator} from 'react-native';
import BusinessWebsite from '../shared/BusinessWebsite';
export default function App(){
 const [site,setSite]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;const slug=typeof window!=='undefined'?window.location.pathname.split('/').filter(Boolean)[0]:'';
 if(!slug){setError('Choose a business website from your link.');return;}
 fetch(`https://daniboy-be1c0.web.app/api/public/sites/${encodeURIComponent(slug)}`).then(async r=>{if(!r.ok)throw Error('This website is not available.');return r.json();}).then(v=>{if(active){setSite(v);if(typeof document!=='undefined')document.title=v.business.businessName;}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 if(!site)return <View style={{flex:1,minHeight:600,justifyContent:'center',alignItems:'center',padding:32,backgroundColor:'#f5f6f1'}}>{error?<Text style={{fontSize:24,color:'#233b32',textAlign:'center'}}>{error}</Text>:<ActivityIndicator color="#1c6850"/>}</View>;
 return <ScrollView><BusinessWebsite site={site}/></ScrollView>;
}
