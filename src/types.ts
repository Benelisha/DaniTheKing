export type Lead = {
  id: string;
  businessName: string;
  alternateNames: string[];
  phone: string;
  service: string;
  location: string;
  callStatus: string;
  websiteStatus: string;
  websiteUrl: string;
  generatedWebsiteUrl?: string;
  generationId?: string;
  generationStatus?: string;
  googleVerified?: boolean;
  googleVerification?: {status:string;listingUrl:string;reviewer:string;verifiedAt:string;notes:string;identityFingerprint:string} | null;
  websiteCheckedAt: string | null;
  researchNotes: string;
  sources: { url: string; title: string; observedAt: string }[];
  evidence: {
    query: string;
    url?: string;
    summary: string;
    checkedAt: string;
  }[];
  profile?: {
    addressNotes?: string; googleMapsLinkType?: "listing" | "search";
    address?: string; googleMapsUrl?: string; googlePlaceId?: string;
    rating?: number; reviewCount?: number; publicEmail?: string; openingHours?: string;
    onlinePresence?: { platform: string; status: "Found" | "Not found" | "Not checked"; url?: string; sourceUrl: string; checkedAt: string; notes?: string }[];
    services?: string[];
    images?: { url: string; sourceUrl: string; caption: string }[];
    reviews?: { text: string; rating?: number; author: string; sourceUrl: string; publishedAt?: string }[];
    sourceUrl: string; observedAt: string;
  };
  competitors?: { businessName: string; service: string; location: string; websiteUrl: string; sourceUrl: string; verifiedAt: string; verificationNotes: string }[];
  createdAt?: string;
  version: number;
  potentialDuplicateId?: string;
};
export const callStatuses = [
  "Not called",
  "No answer",
  "Follow up",
  "Interested",
  "Not interested",
  "Wrong number",
  "Do not call",
];
export const websiteStatuses = [
  "Not checked",
  "No site found",
  "Independent site found",
  "Uncertain",
  "Owner confirmed no website",
];
export type Settings = {
  enabled: boolean;
  times: string[];
  timeZone: string;
  categories: string[];
  locations: string[];
  maxCandidates: number;
};
export type Run = {
  id: string;
  status: string;
  startedAt: string;
  query?: string;
  message?: string;
  created: number;
  merged: number;
  reviewed: number;
};
