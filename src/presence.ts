import type { Lead } from './types';
export const socialPlatforms = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'YouTube', 'X', 'Nextdoor', 'Yelp'] as const;
export const presencePlatforms = ['Website', ...socialPlatforms, 'Google Maps', 'Directories'] as const;
export type Presence = { platform: string; status: 'Found' | 'Not found' | 'Not checked'; url?: string; sourceUrl?: string; checkedAt?: string; notes?: string; links?: {label:string;url:string}[] };
const hosts: Record<string,string> = { 'instagram.com':'Instagram', 'facebook.com':'Facebook', 'linkedin.com':'LinkedIn', 'tiktok.com':'TikTok', 'youtube.com':'YouTube', 'youtu.be':'YouTube', 'x.com':'X', 'twitter.com':'X', 'nextdoor.com':'Nextdoor', 'yelp.com':'Yelp', 'allbiz.com':'Directories', 'manta.com':'Directories', 'yellowpages.com':'Directories', 'findpoolcleaner.com':'Directories', 'poolservicescout.com':'Directories', 'arizonainspectors.com':'Directories', 'landscape.directory':'Directories', 'bbb.org':'Directories' };
export function sourcePlatform(url: string): string | undefined {
  try { const parsed = new URL(url), host = parsed.hostname.toLowerCase();
    if ((host === 'google.com' || host.endsWith('.google.com')) && parsed.pathname.startsWith('/maps')) return 'Google Maps';
    return Object.entries(hosts).find(([domain])=>host === domain || host.endsWith('.'+domain))?.[1];
  } catch { return undefined; }
}
export function onlinePresence(lead: Lead): Presence[] {
  const found = new Map<string, Presence>();
  // Only business source URLs count: competitors, generated sites and mentions in notes never establish a profile.
  for (const url of [...lead.sources.map(s=>s.url), lead.profile?.sourceUrl || '', lead.profile?.googleMapsLinkType === 'listing' ? lead.profile.googleMapsUrl || '' : '']) {
    const platform = sourcePlatform(url);
    if (platform && !(platform === 'Google Maps' && /\/maps\/search|[?&]query=/.test(url))) {
      const links = platform === 'Directories' ? [...(found.get(platform)?.links || []), {label:new URL(url).hostname.replace(/^www\./,''),url}].filter((link,i,all)=>all.findIndex(other=>other.url===link.url)===i) : undefined;
      found.set(platform, {platform,status:'Found',url,sourceUrl:url,notes:'Recorded business source',...(links?{links}:{})});
    }
  }
  for (const entry of lead.profile?.onlinePresence || []) found.set(entry.platform, entry);
  const websiteFound = ['Independent site found','Owner confirmed no website'].includes(lead.websiteStatus);
  found.set('Website', {platform:'Website',status:lead.websiteStatus === 'Independent site found' && !!lead.websiteUrl ? 'Found' : ['No site found','Owner confirmed no website'].includes(lead.websiteStatus) ? 'Not found' : 'Not checked', ...(lead.websiteStatus === 'Independent site found' && lead.websiteUrl ? {url:lead.websiteUrl} : {}),checkedAt:lead.websiteCheckedAt || undefined,notes:lead.websiteStatus === 'Owner confirmed no website' ? 'Owner confirmed no website' : lead.websiteStatus === 'No site found' ? 'No independent website found in recorded searches' : websiteFound ? lead.websiteStatus : 'Independent website needs review'});
  return presencePlatforms.map(platform=>found.get(platform)||{platform,status:'Not checked'});
}
export function matchesLead(lead: Lead, query: string) {
  const normalize = (v:string)=>v.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9@]+/g,' ');
  const presence=onlinePresence(lead);
  const platformOnly=presencePlatforms.find(p=>normalize(p).trim()===normalize(query).trim());
  if (platformOnly) return presence.some(p=>p.platform===platformOnly && p.status === 'Found');
  const text=normalize(JSON.stringify({businessName:lead.businessName,alternateNames:lead.alternateNames,phone:lead.phone,service:lead.service,location:lead.location,profile:lead.profile,researchNotes:lead.researchNotes,sources:lead.sources,evidence:lead.evidence,presence}));
  return normalize(query).trim().split(/\s+/).every(term=>text.includes(term));
}
